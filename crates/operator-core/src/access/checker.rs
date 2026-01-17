//! ============================================================================
//! Access Checker - Token balance verification for access tiers
//! ============================================================================
//! Queries $TETSUO token balance from Solana RPC to determine access tier.
//! ============================================================================

use anyhow::{anyhow, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use spl_associated_token_account::get_associated_token_address;
use std::str::FromStr;
use tracing::{debug, warn};

use super::types::{AccessTier, AccessTierInfo, TETSUO_DECIMALS, TETSUO_MINT};

/// Checks $TETSUO token balance and determines access tier
pub struct AccessChecker {
    rpc_client: RpcClient,
    tetsuo_mint: Pubkey,
}

impl AccessChecker {
    /// Create a new access checker with the given RPC URL
    pub fn new(rpc_url: &str) -> Result<Self> {
        let tetsuo_mint = Pubkey::from_str(TETSUO_MINT)
            .map_err(|e| anyhow!("Invalid TETSUO mint address: {}", e))?;

        Ok(Self {
            rpc_client: RpcClient::new(rpc_url.to_string()),
            tetsuo_mint,
        })
    }

    /// Get the user's $TETSUO token balance
    pub fn get_tetsuo_balance(&self, wallet: &Pubkey) -> Result<u64> {
        let ata = get_associated_token_address(wallet, &self.tetsuo_mint);

        debug!(
            "Checking TETSUO balance for wallet {} at ATA {}",
            wallet, ata
        );

        match self.rpc_client.get_token_account_balance(&ata) {
            Ok(balance) => {
                let amount = balance.amount.parse::<u64>().unwrap_or(0);
                debug!("TETSUO balance: {} (raw)", amount);
                Ok(amount)
            }
            Err(e) => {
                // Account doesn't exist = 0 balance (user never held TETSUO)
                warn!("Failed to get token account balance: {} - assuming 0", e);
                Ok(0)
            }
        }
    }

    /// Get the access tier for a wallet based on $TETSUO holdings
    pub fn get_access_tier(&self, wallet: &Pubkey) -> Result<AccessTier> {
        let balance = self.get_tetsuo_balance(wallet)?;
        Ok(AccessTier::from_balance(balance, TETSUO_DECIMALS))
    }

    /// Get full access tier info including balance details
    pub fn get_access_tier_info(&self, wallet: &Pubkey) -> Result<AccessTierInfo> {
        let balance = self.get_tetsuo_balance(wallet)?;
        Ok(AccessTierInfo::new(balance, TETSUO_DECIMALS))
    }

    /// Check if a wallet can use a specific feature
    pub fn can_use_feature(&self, wallet: &Pubkey, feature: super::types::Feature) -> Result<bool> {
        let tier = self.get_access_tier(wallet)?;
        Ok(tier.can_use_feature(feature))
    }

    /// Get the token mint pubkey
    pub fn tetsuo_mint(&self) -> &Pubkey {
        &self.tetsuo_mint
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_checker_creation() {
        // Test with devnet (won't have actual TETSUO but tests the setup)
        let checker = AccessChecker::new("https://api.devnet.solana.com");
        assert!(checker.is_ok());
    }

    #[test]
    fn test_mint_address_valid() {
        let mint = Pubkey::from_str(TETSUO_MINT);
        assert!(mint.is_ok());
    }
}
