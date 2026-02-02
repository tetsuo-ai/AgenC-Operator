//! ============================================================================
//! Transaction Retry Logic - Exponential Backoff & Confirmation Polling
//! ============================================================================
//! Provides robust transaction sending with:
//! - Exponential backoff with jitter for retries
//! - Transaction confirmation status polling
//! - Blockhash refresh on expiration
//! - Error classification (retryable vs permanent)
//! ============================================================================

use anyhow::{anyhow, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    signature::Signature,
    transaction::VersionedTransaction,
};
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info, warn};

/// Configuration for transaction retry behavior
#[derive(Clone)]
pub struct RetryConfig {
    /// Maximum number of send attempts
    pub max_send_retries: u32,
    /// Maximum number of confirmation polling attempts
    pub max_confirm_retries: u32,
    /// Base delay between retries (will be multiplied by 2^attempt)
    pub base_delay_ms: u64,
    /// Maximum delay between retries
    pub max_delay_ms: u64,
    /// Confirmation polling interval
    pub poll_interval_ms: u64,
    /// Whether to add jitter to delays
    pub jitter: bool,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_send_retries: 5,
            max_confirm_retries: 30,
            base_delay_ms: 500,
            max_delay_ms: 10000,
            poll_interval_ms: 1000,
            jitter: true,
        }
    }
}

/// Transaction send result with detailed error information
#[derive(Debug)]
pub enum SendResult {
    /// Transaction confirmed successfully
    Confirmed(Signature),
    /// Transaction failed with a permanent error (don't retry)
    PermanentFailure(String),
    /// Transaction failed with a retryable error
    RetryableFailure(String),
    /// Transaction sent but confirmation timed out (may still confirm)
    ConfirmationTimeout(Signature),
}

/// Error classification for retry decisions
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ErrorKind {
    /// Error is likely transient, should retry
    Retryable,
    /// Error is permanent, don't retry
    Permanent,
    /// Blockhash expired, need fresh blockhash
    BlockhashExpired,
    /// Rate limited, back off more aggressively
    RateLimited,
}

/// Classify an error to determine if retry is appropriate
pub fn classify_error(error: &str) -> ErrorKind {
    let lower = error.to_lowercase();

    // Blockhash related errors - need fresh blockhash
    if lower.contains("blockhash")
        || lower.contains("block height exceeded")
        || lower.contains("transaction has already been processed")
    {
        return ErrorKind::BlockhashExpired;
    }

    // Rate limiting errors
    if lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("429")
    {
        return ErrorKind::RateLimited;
    }

    // Permanent errors - don't retry these
    if lower.contains("insufficient funds")
        || lower.contains("insufficient lamports")
        || lower.contains("invalid signature")
        || lower.contains("invalid account")
        || lower.contains("account not found")
        || lower.contains("program failed")
        || lower.contains("custom program error")
        || lower.contains("simulation failed")
    {
        return ErrorKind::Permanent;
    }

    // Network/connection errors are usually retryable
    if lower.contains("connection")
        || lower.contains("timeout")
        || lower.contains("network")
        || lower.contains("temporary")
        || lower.contains("try again")
    {
        return ErrorKind::Retryable;
    }

    // Default to retryable for unknown errors
    ErrorKind::Retryable
}

/// Calculate delay with exponential backoff and optional jitter
pub fn calculate_delay(attempt: u32, config: &RetryConfig) -> Duration {
    // Use saturating multiplication to avoid overflow
    let multiplier = 2u64.saturating_pow(attempt.min(63)); // Cap exponent to prevent overflow
    let base_delay = config.base_delay_ms.saturating_mul(multiplier);
    let capped_delay = base_delay.min(config.max_delay_ms);

    let final_delay = if config.jitter {
        // Add random jitter (0-50% of delay)
        let jitter_factor = 1.0 + (rand_simple() * 0.5);
        (capped_delay as f64 * jitter_factor) as u64
    } else {
        capped_delay
    };

    Duration::from_millis(final_delay)
}

/// Simple pseudo-random number generator (0.0 to 1.0)
/// Uses time-based seed for simplicity
fn rand_simple() -> f64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (nanos % 1000) as f64 / 1000.0
}

/// Transaction sender with retry logic
pub struct TransactionSender<'a> {
    rpc: &'a RpcClient,
    config: RetryConfig,
}

impl<'a> TransactionSender<'a> {
    /// Create a new TransactionSender with the given RPC client
    pub fn new(rpc: &'a RpcClient) -> Self {
        Self {
            rpc,
            config: RetryConfig::default(),
        }
    }

    /// Create a new TransactionSender with custom config
    pub fn with_config(rpc: &'a RpcClient, config: RetryConfig) -> Self {
        Self { rpc, config }
    }

    /// Send a transaction with retry logic
    /// Returns the signature on success
    pub fn send_with_retry(&self, tx: &VersionedTransaction) -> Result<SendResult> {
        let mut last_error = String::new();

        for attempt in 0..self.config.max_send_retries {
            if attempt > 0 {
                let delay = calculate_delay(attempt - 1, &self.config);
                debug!(
                    "Retry attempt {} after {:?} delay",
                    attempt, delay
                );
                std::thread::sleep(delay);
            }

            match self.rpc.send_transaction(tx) {
                Ok(signature) => {
                    info!("Transaction sent: {} (attempt {})", signature, attempt + 1);
                    return Ok(SendResult::Confirmed(signature));
                }
                Err(e) => {
                    let error_str = e.to_string();
                    let error_kind = classify_error(&error_str);

                    warn!(
                        "Send attempt {} failed ({:?}): {}",
                        attempt + 1,
                        error_kind,
                        error_str
                    );

                    match error_kind {
                        ErrorKind::Permanent => {
                            return Ok(SendResult::PermanentFailure(error_str));
                        }
                        ErrorKind::BlockhashExpired => {
                            // Caller should refresh blockhash and retry
                            return Ok(SendResult::RetryableFailure(
                                "Blockhash expired - refresh required".to_string(),
                            ));
                        }
                        ErrorKind::RateLimited => {
                            // Extra delay for rate limiting
                            let rate_limit_delay =
                                Duration::from_millis(self.config.max_delay_ms);
                            warn!("Rate limited, waiting {:?}", rate_limit_delay);
                            std::thread::sleep(rate_limit_delay);
                        }
                        ErrorKind::Retryable => {
                            // Normal retry flow
                        }
                    }

                    last_error = error_str;
                }
            }
        }

        Ok(SendResult::RetryableFailure(format!(
            "Max retries ({}) exceeded. Last error: {}",
            self.config.max_send_retries, last_error
        )))
    }

    /// Send and confirm a transaction with retry logic
    /// This is the main entry point for transaction sending
    pub fn send_and_confirm_with_retry(
        &self,
        tx: &VersionedTransaction,
    ) -> Result<SendResult> {
        // First, try to send the transaction
        let send_result = self.send_with_retry(tx)?;

        match send_result {
            SendResult::Confirmed(signature) => {
                // Transaction sent, now poll for confirmation
                self.poll_confirmation(signature)
            }
            other => Ok(other),
        }
    }

    /// Poll for transaction confirmation status
    pub fn poll_confirmation(&self, signature: Signature) -> Result<SendResult> {
        info!("Polling confirmation for {}", signature);

        for attempt in 0..self.config.max_confirm_retries {
            std::thread::sleep(Duration::from_millis(self.config.poll_interval_ms));

            match self.rpc.get_signature_status(&signature) {
                Ok(Some(status)) => match status {
                    Ok(()) => {
                        info!(
                            "Transaction confirmed: {} (poll attempt {})",
                            signature,
                            attempt + 1
                        );
                        return Ok(SendResult::Confirmed(signature));
                    }
                    Err(e) => {
                        warn!("Transaction failed on-chain: {}", e);
                        return Ok(SendResult::PermanentFailure(format!(
                            "Transaction failed: {}",
                            e
                        )));
                    }
                },
                Ok(None) => {
                    debug!("Transaction not yet confirmed (attempt {})", attempt + 1);
                }
                Err(e) => {
                    warn!("Error checking status (attempt {}): {}", attempt + 1, e);
                    // Continue polling on RPC errors
                }
            }
        }

        warn!(
            "Confirmation polling timed out for {} after {} attempts",
            signature, self.config.max_confirm_retries
        );
        Ok(SendResult::ConfirmationTimeout(signature))
    }
}

/// Async version of TransactionSender for use with tokio
pub struct AsyncTransactionSender<'a> {
    rpc: &'a RpcClient,
    config: RetryConfig,
}

impl<'a> AsyncTransactionSender<'a> {
    /// Create a new AsyncTransactionSender
    pub fn new(rpc: &'a RpcClient) -> Self {
        Self {
            rpc,
            config: RetryConfig::default(),
        }
    }

    /// Create with custom config
    pub fn with_config(rpc: &'a RpcClient, config: RetryConfig) -> Self {
        Self { rpc, config }
    }

    /// Send a transaction with async retry logic
    pub async fn send_with_retry(&self, tx: &VersionedTransaction) -> Result<SendResult> {
        let mut last_error = String::new();

        for attempt in 0..self.config.max_send_retries {
            if attempt > 0 {
                let delay = calculate_delay(attempt - 1, &self.config);
                debug!("Retry attempt {} after {:?} delay", attempt, delay);
                sleep(delay).await;
            }

            match self.rpc.send_transaction(tx) {
                Ok(signature) => {
                    info!("Transaction sent: {} (attempt {})", signature, attempt + 1);
                    return Ok(SendResult::Confirmed(signature));
                }
                Err(e) => {
                    let error_str = e.to_string();
                    let error_kind = classify_error(&error_str);

                    warn!(
                        "Send attempt {} failed ({:?}): {}",
                        attempt + 1,
                        error_kind,
                        error_str
                    );

                    match error_kind {
                        ErrorKind::Permanent => {
                            return Ok(SendResult::PermanentFailure(error_str));
                        }
                        ErrorKind::BlockhashExpired => {
                            return Ok(SendResult::RetryableFailure(
                                "Blockhash expired - refresh required".to_string(),
                            ));
                        }
                        ErrorKind::RateLimited => {
                            let rate_limit_delay =
                                Duration::from_millis(self.config.max_delay_ms);
                            warn!("Rate limited, waiting {:?}", rate_limit_delay);
                            sleep(rate_limit_delay).await;
                        }
                        ErrorKind::Retryable => {}
                    }

                    last_error = error_str;
                }
            }
        }

        Ok(SendResult::RetryableFailure(format!(
            "Max retries ({}) exceeded. Last error: {}",
            self.config.max_send_retries, last_error
        )))
    }

    /// Poll for confirmation asynchronously
    pub async fn poll_confirmation(&self, signature: Signature) -> Result<SendResult> {
        info!("Polling confirmation for {}", signature);

        for attempt in 0..self.config.max_confirm_retries {
            sleep(Duration::from_millis(self.config.poll_interval_ms)).await;

            match self.rpc.get_signature_status(&signature) {
                Ok(Some(status)) => match status {
                    Ok(()) => {
                        info!(
                            "Transaction confirmed: {} (poll attempt {})",
                            signature,
                            attempt + 1
                        );
                        return Ok(SendResult::Confirmed(signature));
                    }
                    Err(e) => {
                        warn!("Transaction failed on-chain: {}", e);
                        return Ok(SendResult::PermanentFailure(format!(
                            "Transaction failed: {}",
                            e
                        )));
                    }
                },
                Ok(None) => {
                    debug!("Transaction not yet confirmed (attempt {})", attempt + 1);
                }
                Err(e) => {
                    warn!("Error checking status (attempt {}): {}", attempt + 1, e);
                }
            }
        }

        warn!(
            "Confirmation polling timed out for {} after {} attempts",
            signature, self.config.max_confirm_retries
        );
        Ok(SendResult::ConfirmationTimeout(signature))
    }

    /// Send and confirm with full retry logic
    pub async fn send_and_confirm_with_retry(
        &self,
        tx: &VersionedTransaction,
    ) -> Result<SendResult> {
        let send_result = self.send_with_retry(tx).await?;

        match send_result {
            SendResult::Confirmed(signature) => self.poll_confirmation(signature).await,
            other => Ok(other),
        }
    }
}

/// Helper function to convert SendResult to a standard Result
pub fn send_result_to_result(result: SendResult) -> Result<Signature> {
    match result {
        SendResult::Confirmed(sig) => Ok(sig),
        SendResult::PermanentFailure(msg) => Err(anyhow!("Transaction failed: {}", msg)),
        SendResult::RetryableFailure(msg) => {
            Err(anyhow!("Transaction failed after retries: {}", msg))
        }
        SendResult::ConfirmationTimeout(sig) => {
            // Return the signature but warn - transaction may still confirm
            warn!(
                "Transaction confirmation timed out but may still confirm: {}",
                sig
            );
            Ok(sig)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_classification() {
        assert_eq!(
            classify_error("insufficient funds for transaction"),
            ErrorKind::Permanent
        );
        assert_eq!(
            classify_error("Blockhash not found"),
            ErrorKind::BlockhashExpired
        );
        assert_eq!(
            classify_error("rate limit exceeded"),
            ErrorKind::RateLimited
        );
        assert_eq!(
            classify_error("connection refused"),
            ErrorKind::Retryable
        );
        assert_eq!(
            classify_error("unknown error xyz"),
            ErrorKind::Retryable
        );
    }

    #[test]
    fn test_error_classification_permanent_errors() {
        // All permanent errors should not be retried
        let permanent_errors = [
            "insufficient lamports for rent",
            "invalid signature",
            "invalid account owner",
            "account not found",
            "program failed to complete",
            "custom program error: 0x1",
            "simulation failed",
        ];

        for error in permanent_errors {
            assert_eq!(
                classify_error(error),
                ErrorKind::Permanent,
                "Expected Permanent for: {}",
                error
            );
        }
    }

    #[test]
    fn test_error_classification_blockhash_errors() {
        let blockhash_errors = [
            "Blockhash expired",
            "block height exceeded",
            "transaction has already been processed",
        ];

        for error in blockhash_errors {
            assert_eq!(
                classify_error(error),
                ErrorKind::BlockhashExpired,
                "Expected BlockhashExpired for: {}",
                error
            );
        }
    }

    #[test]
    fn test_error_classification_rate_limit() {
        let rate_limit_errors = [
            "rate limit exceeded",
            "too many requests",
            "HTTP 429 Too Many Requests",
        ];

        for error in rate_limit_errors {
            assert_eq!(
                classify_error(error),
                ErrorKind::RateLimited,
                "Expected RateLimited for: {}",
                error
            );
        }
    }

    #[test]
    fn test_error_classification_retryable() {
        let retryable_errors = [
            "connection refused",
            "timeout waiting for response",
            "network unreachable",
            "temporary failure",
            "please try again later",
        ];

        for error in retryable_errors {
            assert_eq!(
                classify_error(error),
                ErrorKind::Retryable,
                "Expected Retryable for: {}",
                error
            );
        }
    }

    #[test]
    fn test_calculate_delay() {
        let config = RetryConfig {
            jitter: false,
            ..Default::default()
        };

        // Without jitter, delays should be deterministic
        assert_eq!(calculate_delay(0, &config), Duration::from_millis(500));
        assert_eq!(calculate_delay(1, &config), Duration::from_millis(1000));
        assert_eq!(calculate_delay(2, &config), Duration::from_millis(2000));
        assert_eq!(calculate_delay(3, &config), Duration::from_millis(4000));
        assert_eq!(calculate_delay(4, &config), Duration::from_millis(8000));
        // Should be capped at max_delay_ms
        assert_eq!(calculate_delay(10, &config), Duration::from_millis(10000));
    }

    #[test]
    fn test_calculate_delay_with_jitter() {
        let config = RetryConfig {
            jitter: true,
            base_delay_ms: 1000,
            max_delay_ms: 10000,
            ..Default::default()
        };

        // With jitter, delay should be in range [base, base * 1.5]
        for _ in 0..10 {
            let delay = calculate_delay(0, &config);
            assert!(delay >= Duration::from_millis(1000));
            assert!(delay <= Duration::from_millis(1500));
        }
    }

    #[test]
    fn test_calculate_delay_respects_max() {
        let config = RetryConfig {
            jitter: false,
            base_delay_ms: 500,
            max_delay_ms: 5000,
            ..Default::default()
        };

        // High attempt (but not overflow-causing) should be capped
        let delay = calculate_delay(20, &config);
        assert_eq!(delay, Duration::from_millis(5000));
    }

    #[test]
    fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_send_retries, 5);
        assert_eq!(config.max_confirm_retries, 30);
        assert_eq!(config.base_delay_ms, 500);
        assert_eq!(config.max_delay_ms, 10000);
        assert_eq!(config.poll_interval_ms, 1000);
        assert!(config.jitter);
    }

    #[test]
    fn test_send_result_variants() {
        // Test that all variants can be constructed
        let sig = Signature::default();

        let confirmed = SendResult::Confirmed(sig);
        matches!(confirmed, SendResult::Confirmed(_));

        let permanent = SendResult::PermanentFailure("test".to_string());
        matches!(permanent, SendResult::PermanentFailure(_));

        let retryable = SendResult::RetryableFailure("test".to_string());
        matches!(retryable, SendResult::RetryableFailure(_));

        let timeout = SendResult::ConfirmationTimeout(sig);
        matches!(timeout, SendResult::ConfirmationTimeout(_));
    }

    #[test]
    fn test_send_result_to_result_confirmed() {
        let sig = Signature::default();
        let result = send_result_to_result(SendResult::Confirmed(sig));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), sig);
    }

    #[test]
    fn test_send_result_to_result_permanent_failure() {
        let result = send_result_to_result(SendResult::PermanentFailure("test error".to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("test error"));
    }

    #[test]
    fn test_send_result_to_result_retryable_failure() {
        let result =
            send_result_to_result(SendResult::RetryableFailure("retryable error".to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("after retries"));
    }

    #[test]
    fn test_send_result_to_result_timeout_returns_signature() {
        // Timeout still returns the signature since tx may confirm later
        let sig = Signature::default();
        let result = send_result_to_result(SendResult::ConfirmationTimeout(sig));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), sig);
    }
}
