//! ============================================================================
//! Access Gate - Cached access tier checking with feature gating
//! ============================================================================
//! Provides cached tier lookups to avoid hitting RPC on every request.
//! ============================================================================

use anyhow::{anyhow, Result};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use super::checker::AccessChecker;
use super::types::{AccessTier, AccessTierInfo, Feature, TETSUO_DECIMALS};

/// Default cache duration in seconds (5 minutes)
pub const DEFAULT_CACHE_DURATION_SECS: i64 = 300;

/// Maximum number of entries in the tier cache to prevent unbounded growth
const MAX_CACHE_SIZE: usize = 1000;

/// Cached tier information
#[derive(Debug, Clone)]
struct CachedTier {
    tier: AccessTier,
    balance: u64,
    cached_at: i64,
}

/// Access gate with caching for efficient tier lookups
pub struct AccessGate {
    checker: AccessChecker,
    tier_cache: Arc<RwLock<HashMap<String, CachedTier>>>,
    cache_duration_secs: i64,
}

impl AccessGate {
    /// Create a new access gate with the given RPC URL
    pub fn new(rpc_url: &str) -> Result<Self> {
        Self::with_cache_duration(rpc_url, DEFAULT_CACHE_DURATION_SECS)
    }

    /// Create a new access gate with custom cache duration
    pub fn with_cache_duration(rpc_url: &str, cache_duration_secs: i64) -> Result<Self> {
        Ok(Self {
            checker: AccessChecker::new(rpc_url)?,
            tier_cache: Arc::new(RwLock::new(HashMap::new())),
            cache_duration_secs,
        })
    }

    /// Check access and return tier info, using cache when possible
    pub async fn check_access(&self, wallet: &Pubkey) -> Result<(AccessTier, u64)> {
        let wallet_str = wallet.to_string();
        let now = chrono::Utc::now().timestamp();

        // Check cache first
        {
            let cache = self.tier_cache.read().await;
            if let Some(cached) = cache.get(&wallet_str) {
                if now - cached.cached_at < self.cache_duration_secs {
                    debug!(
                        "Cache hit for wallet {}: {:?} (age: {}s)",
                        wallet_str,
                        cached.tier,
                        now - cached.cached_at
                    );
                    return Ok((cached.tier, cached.balance));
                }
            }
        }

        // Cache miss or expired - fetch fresh
        debug!("Cache miss for wallet {}, fetching from RPC", wallet_str);
        let balance = self.checker.get_tetsuo_balance(wallet)?;
        let tier = AccessTier::from_balance(balance, TETSUO_DECIMALS);

        // Update cache
        {
            let mut cache = self.tier_cache.write().await;
            // Evict oldest entry if cache is at capacity
            if cache.len() >= MAX_CACHE_SIZE {
                if let Some(oldest_key) = cache
                    .iter()
                    .min_by_key(|(_, v)| v.cached_at)
                    .map(|(k, _)| k.clone())
                {
                    cache.remove(&oldest_key);
                }
            }
            cache.insert(
                wallet_str.clone(),
                CachedTier {
                    tier,
                    balance,
                    cached_at: now,
                },
            );
        }

        info!(
            "Access tier for {}: {:?} ({} TETSUO)",
            wallet_str,
            tier,
            balance as f64 / 1_000_000.0
        );

        Ok((tier, balance))
    }

    /// Get full access tier info with caching
    pub async fn get_access_tier_info(&self, wallet: &Pubkey) -> Result<AccessTierInfo> {
        let (_, balance) = self.check_access(wallet).await?;
        Ok(AccessTierInfo::new(balance, TETSUO_DECIMALS))
    }

    /// Gate a feature - returns Ok(tier) if allowed, Err with message if not
    pub async fn gate_feature(&self, wallet: &Pubkey, feature: Feature) -> Result<AccessTier> {
        let (tier, balance) = self.check_access(wallet).await?;

        if !tier.can_use_feature(feature) {
            let required = feature.required_tier();
            let required_amount = required.required_amount();
            let current_amount = balance as f64 / 1_000_000.0;

            warn!(
                "Access denied for {:?}: wallet {} has {:?} tier, needs {:?}",
                feature, wallet, tier, required
            );

            return Err(anyhow!(
                "Access denied. {} requires {} tier ({}+ $TETSUO). You have {:.2} $TETSUO ({:?} tier).",
                feature.display_name(),
                required.display_name(),
                format_amount(required_amount),
                current_amount,
                tier
            ));
        }

        Ok(tier)
    }

    /// Check if a wallet can use a specific feature (non-blocking, uses cache)
    pub async fn can_use_feature(&self, wallet: &Pubkey, feature: Feature) -> Result<bool> {
        let (tier, _) = self.check_access(wallet).await?;
        Ok(tier.can_use_feature(feature))
    }

    /// Invalidate cache for a wallet (e.g., after token transfer)
    pub async fn invalidate_cache(&self, wallet: &Pubkey) {
        let wallet_str = wallet.to_string();
        let mut cache = self.tier_cache.write().await;
        if cache.remove(&wallet_str).is_some() {
            info!("Invalidated cache for wallet {}", wallet_str);
        }
    }

    /// Clear the entire cache
    pub async fn clear_cache(&self) {
        let mut cache = self.tier_cache.write().await;
        let count = cache.len();
        cache.clear();
        info!("Cleared {} cached tier entries", count);
    }

    /// Get cache statistics
    pub async fn cache_stats(&self) -> (usize, usize) {
        let cache = self.tier_cache.read().await;
        let now = chrono::Utc::now().timestamp();
        let total = cache.len();
        let valid = cache
            .values()
            .filter(|c| now - c.cached_at < self.cache_duration_secs)
            .count();
        (total, valid)
    }
}

/// Format amount with K/M suffix for error messages
fn format_amount(amount: f64) -> String {
    if amount >= 1_000_000.0 {
        format!("{:.0}M", amount / 1_000_000.0)
    } else if amount >= 1_000.0 {
        format!("{:.0}K", amount / 1_000.0)
    } else {
        format!("{:.0}", amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_amount() {
        assert_eq!(format_amount(10_000.0), "10K");
        assert_eq!(format_amount(100_000.0), "100K");
        assert_eq!(format_amount(1_000_000.0), "1M");
    }

    #[tokio::test]
    async fn test_gate_creation() {
        let gate = AccessGate::new("https://api.devnet.solana.com");
        assert!(gate.is_ok());
    }
}
