//! ============================================================================
//! Jupiter Swap Executor - Token Trading via Jupiter Aggregator
//! ============================================================================
//! Handles token swaps on Solana using Jupiter's aggregator API:
//! - Get quotes for token swaps
//! - Execute swaps with slippage protection
//! - Get token prices
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    signature::Keypair,
    signer::Signer,
    transaction::VersionedTransaction,
};
use std::sync::{Arc, RwLock};
use tracing::{debug, info, warn};

use crate::transaction_retry::{
    classify_error, ErrorKind, SendResult, TransactionSender,
};
use crate::types::{SwapParams, SwapQuote, TokenPrice};

/// Jupiter Quote API endpoint
const JUPITER_QUOTE_URL: &str = "https://quote-api.jup.ag/v6/quote";

/// Jupiter Swap API endpoint
const JUPITER_SWAP_URL: &str = "https://quote-api.jup.ag/v6/swap";

/// Jupiter Price API endpoint
const JUPITER_PRICE_URL: &str = "https://api.jup.ag/price/v2";

/// Common token mints
pub mod tokens {
    /// SOL (wrapped)
    pub const SOL: &str = "So11111111111111111111111111111111111111112";
    /// USDC
    pub const USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    /// USDT
    pub const USDT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    /// JUP
    pub const JUP: &str = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
}

/// Executor for Jupiter swap operations
pub struct JupiterSwapExecutor {
    client: reqwest::Client,
    rpc: RpcClient,
    keypair: Arc<RwLock<Option<Keypair>>>,
}

impl JupiterSwapExecutor {
    /// Create a new JupiterSwapExecutor
    pub fn new(rpc_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            rpc: RpcClient::new(rpc_url.to_string()),
            keypair: Arc::new(RwLock::new(None)),
        }
    }

    /// Set the keypair for signing transactions
    pub fn set_keypair(&mut self, keypair: Arc<RwLock<Option<Keypair>>>) {
        self.keypair = keypair;
    }

    /// Maximum allowed slippage in basis points (5% = 500 bps).
    /// Prevents accidental or malicious extreme slippage settings.
    const MAX_SLIPPAGE_BPS: u16 = 500;

    /// Get a quote for a swap
    pub async fn get_quote(&self, params: &SwapParams) -> Result<SwapQuote> {
        // SECURITY: Cap slippage to prevent accepting arbitrarily bad prices.
        let slippage_bps = params.slippage_bps.min(Self::MAX_SLIPPAGE_BPS);
        if params.slippage_bps > Self::MAX_SLIPPAGE_BPS {
            warn!(
                "Slippage {} bps exceeds max, clamped to {} bps",
                params.slippage_bps, Self::MAX_SLIPPAGE_BPS
            );
        }

        info!(
            "Getting quote: {} {} -> {}",
            params.amount, params.input_mint, params.output_mint
        );

        let url = format!(
            "{}?inputMint={}&outputMint={}&amount={}&slippageBps={}",
            JUPITER_QUOTE_URL,
            params.input_mint,
            params.output_mint,
            params.amount,
            slippage_bps
        );

        debug!("Quote URL: {}", url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to get quote: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Jupiter quote error {}: {}", status, body));
        }

        let quote_response: JupiterQuoteResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse quote response: {}", e))?;

        Ok(SwapQuote {
            in_amount: quote_response.in_amount,
            out_amount: quote_response.out_amount,
            price_impact_pct: quote_response.price_impact_pct,
            other_amount_threshold: quote_response.other_amount_threshold,
            swap_mode: quote_response.swap_mode,
        })
    }

    /// Execute a swap transaction
    pub async fn execute_swap(&self, params: SwapParams) -> Result<String> {
        info!(
            "Executing swap: {} {} -> {}",
            params.amount, params.input_mint, params.output_mint
        );

        // Extract keypair info before any async operations (to avoid holding lock across await)
        let (user_pubkey, keypair_bytes) = {
            let keypair_guard = self
                .keypair
                .read()
                .map_err(|_| anyhow!("Failed to acquire keypair lock"))?;
            let keypair = keypair_guard
                .as_ref()
                .ok_or_else(|| anyhow!("No keypair configured"))?;
            (keypair.pubkey(), keypair.to_bytes())
        }; // Guard dropped here

        // First get a quote
        let quote = self.get_quote(&params).await?;

        // Check price impact
        let price_impact: f64 = quote.price_impact_pct.parse().unwrap_or(0.0);
        if price_impact > 5.0 {
            warn!("High price impact: {}%", price_impact);
            return Err(anyhow!(
                "Price impact too high: {}% (max 5%)",
                price_impact
            ));
        }

        // Build swap request
        let swap_request = JupiterSwapRequest {
            quote_response: JupiterQuoteResponse {
                in_amount: quote.in_amount,
                out_amount: quote.out_amount,
                price_impact_pct: quote.price_impact_pct,
                other_amount_threshold: quote.other_amount_threshold,
                swap_mode: quote.swap_mode,
            },
            user_public_key: user_pubkey.to_string(),
            wrap_and_unwrap_sol: Some(true),
            dynamic_compute_unit_limit: Some(true),
            priority_level_with_max_lamports: Some(PriorityLevel {
                priority_level: "high".to_string(),
                max_lamports: Some(1_000_000), // 0.001 SOL max priority fee
            }),
        };

        // Get swap transaction
        let response = self
            .client
            .post(JUPITER_SWAP_URL)
            .json(&swap_request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to get swap transaction: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Jupiter swap error {}: {}", status, body));
        }

        let swap_response: JupiterSwapResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse swap response: {}", e))?;

        // Decode and sign transaction
        let tx_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &swap_response.swap_transaction,
        )
        .map_err(|e| anyhow!("Failed to decode transaction: {}", e))?;

        let mut tx: VersionedTransaction = bincode::deserialize(&tx_bytes)
            .map_err(|e| anyhow!("Failed to deserialize transaction: {}", e))?;

        // Sign the transaction using restored keypair
        let keypair = Keypair::try_from(keypair_bytes.as_slice())
            .map_err(|e| anyhow!("Failed to restore keypair: {}", e))?;

        // Retry loop for blockhash expiration
        let max_blockhash_retries = 3;
        let mut last_error = String::new();

        for blockhash_attempt in 0..max_blockhash_retries {
            // Get fresh blockhash for each attempt
            let recent_blockhash = self
                .rpc
                .get_latest_blockhash()
                .map_err(|e| anyhow!("Failed to get blockhash: {}", e))?;

            tx.message.set_recent_blockhash(recent_blockhash);

            let signature = keypair.sign_message(tx.message.serialize().as_slice());
            tx.signatures[0] = signature;

            // Send transaction with retry logic
            let sender = TransactionSender::new(&self.rpc);
            let result = sender.send_and_confirm_with_retry(&tx)?;

            match result {
                SendResult::Confirmed(sig) => {
                    info!("Swap completed: {}", sig);
                    return Ok(sig.to_string());
                }
                SendResult::PermanentFailure(msg) => {
                    return Err(anyhow!("Transaction failed: {}", msg));
                }
                SendResult::RetryableFailure(msg) => {
                    // Check if it's a blockhash issue
                    let error_kind = classify_error(&msg);
                    if error_kind == ErrorKind::BlockhashExpired && blockhash_attempt < max_blockhash_retries - 1 {
                        warn!(
                            "Blockhash expired (attempt {}), refreshing...",
                            blockhash_attempt + 1
                        );
                        last_error = msg;
                        continue;
                    }
                    return Err(anyhow!("Transaction failed after retries: {}", msg));
                }
                SendResult::ConfirmationTimeout(sig) => {
                    // Transaction may still confirm - return signature with warning
                    warn!(
                        "Transaction confirmation timed out (may still confirm): {}",
                        sig
                    );
                    return Ok(sig.to_string());
                }
            }
        }

        Err(anyhow!(
            "Transaction failed after {} blockhash refresh attempts: {}",
            max_blockhash_retries,
            last_error
        ))
    }

    /// Get token price in USD
    pub async fn get_price(&self, token_mint: &str) -> Result<TokenPrice> {
        info!("Getting price for {}", token_mint);

        let url = format!("{}?ids={}", JUPITER_PRICE_URL, token_mint);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to get price: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Jupiter price error {}: {}", status, body));
        }

        let price_response: JupiterPriceResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse price response: {}", e))?;

        let price_data = price_response
            .data
            .get(token_mint)
            .ok_or_else(|| anyhow!("Price not found for {}", token_mint))?;

        Ok(TokenPrice {
            mint: token_mint.to_string(),
            price_usd: price_data.price.parse().unwrap_or(0.0),
        })
    }

    /// Resolve token symbol to mint address
    pub fn resolve_token(&self, symbol: &str) -> Option<&'static str> {
        match symbol.to_uppercase().as_str() {
            "SOL" | "WSOL" => Some(tokens::SOL),
            "USDC" => Some(tokens::USDC),
            "USDT" => Some(tokens::USDT),
            "JUP" | "JUPITER" => Some(tokens::JUP),
            _ => None,
        }
    }
}

// ============================================================================
// Jupiter API Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JupiterQuoteResponse {
    in_amount: String,
    out_amount: String,
    price_impact_pct: String,
    other_amount_threshold: String,
    swap_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JupiterSwapRequest {
    quote_response: JupiterQuoteResponse,
    user_public_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    wrap_and_unwrap_sol: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dynamic_compute_unit_limit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority_level_with_max_lamports: Option<PriorityLevel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PriorityLevel {
    priority_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_lamports: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JupiterSwapResponse {
    swap_transaction: String,
}

#[derive(Debug, Deserialize)]
struct JupiterPriceResponse {
    data: std::collections::HashMap<String, JupiterPriceData>,
}

#[derive(Debug, Deserialize)]
struct JupiterPriceData {
    price: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_token() {
        let executor = JupiterSwapExecutor::new("https://api.mainnet-beta.solana.com");
        assert_eq!(executor.resolve_token("SOL"), Some(tokens::SOL));
        assert_eq!(executor.resolve_token("usdc"), Some(tokens::USDC));
        assert_eq!(executor.resolve_token("UNKNOWN"), None);
    }
}
