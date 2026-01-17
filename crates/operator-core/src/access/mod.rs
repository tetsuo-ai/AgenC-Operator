//! ============================================================================
//! Access Module - Token-gated access control for Tetsuo
//! ============================================================================
//! Provides access tier checking based on $TETSUO token holdings.
//!
//! ## Tiers
//! - **None**: No tokens, no access
//! - **Basic**: 10K+ TETSUO - Voice, Trading, Memory
//! - **Pro**: 100K+ TETSUO - Social, Email, Code, Images, API
//! - **Whale**: 1M+ TETSUO - Spawn, Priority Queue, Custom Personality
//! - **Diamond**: 1M+ with holding period (future)
//!
//! ## Usage
//! ```rust,ignore
//! use operator_core::access::{AccessGate, Feature};
//!
//! let gate = AccessGate::new("https://api.mainnet-beta.solana.com")?;
//! let tier = gate.gate_feature(&wallet_pubkey, Feature::Voice).await?;
//! ```
//! ============================================================================

mod checker;
mod gate;
mod types;

// Re-export public types
pub use checker::AccessChecker;
pub use gate::{AccessGate, DEFAULT_CACHE_DURATION_SECS};
pub use types::{
    AccessTier, AccessTierInfo, Feature, TETSUO_DECIMALS, TETSUO_MINT,
    TIER_BASIC_THRESHOLD, TIER_PRO_THRESHOLD, TIER_WHALE_THRESHOLD,
};
