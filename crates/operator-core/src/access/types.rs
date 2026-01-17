//! ============================================================================
//! Access Types - Token-gated access tiers and features
//! ============================================================================
//! Defines access tiers based on $TETSUO token holdings and gatable features.
//! ============================================================================

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Token mint address for $TETSUO
pub const TETSUO_MINT: &str = "8i51XNNpGaKaj4G4nDdmQh95v4FKAxw8mhtaRoKd9tE8";

/// Token decimals for $TETSUO
pub const TETSUO_DECIMALS: u8 = 6;

/// Access tier thresholds (in human-readable amounts, not raw)
pub const TIER_BASIC_THRESHOLD: f64 = 10_000.0;       // 10K TETSUO
pub const TIER_PRO_THRESHOLD: f64 = 100_000.0;        // 100K TETSUO
pub const TIER_WHALE_THRESHOLD: f64 = 1_000_000.0;    // 1M TETSUO

/// Access tiers based on $TETSUO holdings
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AccessTier {
    /// No access - need to hold tokens
    #[default]
    None,
    /// Basic access - limited features (100K+ TETSUO)
    Basic,
    /// Pro access - most features (1M+ TETSUO)
    Pro,
    /// Whale access - all features + priority (10M+ TETSUO)
    Whale,
    /// Diamond hands - long-term holder benefits (10M+ with holding period)
    Diamond,
}

impl AccessTier {
    /// Determine access tier from token balance
    pub fn from_balance(balance: u64, decimals: u8) -> Self {
        let amount = balance as f64 / 10f64.powi(decimals as i32);

        match amount {
            x if x >= TIER_WHALE_THRESHOLD => AccessTier::Whale,
            x if x >= TIER_PRO_THRESHOLD => AccessTier::Pro,
            x if x >= TIER_BASIC_THRESHOLD => AccessTier::Basic,
            _ => AccessTier::None,
        }
    }

    /// Check if this tier can use a specific feature
    pub fn can_use_feature(&self, feature: Feature) -> bool {
        match feature {
            Feature::Voice => *self >= AccessTier::Basic,
            Feature::Trading => *self >= AccessTier::Basic,
            Feature::Social => *self >= AccessTier::Pro,
            Feature::Email => *self >= AccessTier::Pro,
            Feature::Code => *self >= AccessTier::Pro,
            Feature::ImageGen => *self >= AccessTier::Pro,
            Feature::Spawn => *self >= AccessTier::Whale,
            Feature::PriorityQueue => *self >= AccessTier::Whale,
            Feature::CustomPersonality => *self >= AccessTier::Whale,
            Feature::ApiAccess => *self >= AccessTier::Pro,
            Feature::Memory => *self >= AccessTier::Basic,
        }
    }

    /// Get daily message limit for this tier
    pub fn daily_message_limit(&self) -> Option<u32> {
        match self {
            AccessTier::None => Some(0),
            AccessTier::Basic => Some(50),
            AccessTier::Pro => Some(500),
            AccessTier::Whale | AccessTier::Diamond => None, // Unlimited
        }
    }

    /// Get max spawn agents for this tier
    pub fn max_spawn_agents(&self) -> u32 {
        match self {
            AccessTier::None => 0,
            AccessTier::Basic => 0,
            AccessTier::Pro => 5,
            AccessTier::Whale => 100,
            AccessTier::Diamond => 1000,
        }
    }

    /// Get max memories stored for this tier
    pub fn max_memories(&self) -> u32 {
        match self {
            AccessTier::None => 0,
            AccessTier::Basic => 100,
            AccessTier::Pro => 1000,
            AccessTier::Whale | AccessTier::Diamond => 10000,
        }
    }

    /// Get the numeric rank for comparison
    fn rank(&self) -> u8 {
        match self {
            AccessTier::None => 0,
            AccessTier::Basic => 1,
            AccessTier::Pro => 2,
            AccessTier::Whale => 3,
            AccessTier::Diamond => 4,
        }
    }

    /// Get human-readable tier name
    pub fn display_name(&self) -> &'static str {
        match self {
            AccessTier::None => "No Access",
            AccessTier::Basic => "Basic",
            AccessTier::Pro => "Pro",
            AccessTier::Whale => "Whale",
            AccessTier::Diamond => "Diamond",
        }
    }

    /// Get the minimum token amount required for this tier
    pub fn required_amount(&self) -> f64 {
        match self {
            AccessTier::None => 0.0,
            AccessTier::Basic => TIER_BASIC_THRESHOLD,
            AccessTier::Pro => TIER_PRO_THRESHOLD,
            AccessTier::Whale | AccessTier::Diamond => TIER_WHALE_THRESHOLD,
        }
    }
}

impl PartialOrd for AccessTier {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AccessTier {
    fn cmp(&self, other: &Self) -> Ordering {
        self.rank().cmp(&other.rank())
    }
}

/// Features that can be gated by access tier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    /// Voice interface access
    Voice,
    /// Trading operations (swaps, DCA, etc.)
    Trading,
    /// Social media posting
    Social,
    /// Email sending
    Email,
    /// Code operations (fix, review, deploy)
    Code,
    /// Image generation
    ImageGen,
    /// Agent spawning for parallel execution
    Spawn,
    /// Priority execution queue
    PriorityQueue,
    /// Custom personality settings
    CustomPersonality,
    /// Direct API access
    ApiAccess,
    /// Memory/context persistence
    Memory,
}

impl Feature {
    /// Get the minimum tier required for this feature
    pub fn required_tier(&self) -> AccessTier {
        match self {
            Feature::Voice | Feature::Trading | Feature::Memory => AccessTier::Basic,
            Feature::Social | Feature::Email | Feature::Code | Feature::ImageGen | Feature::ApiAccess => {
                AccessTier::Pro
            }
            Feature::Spawn | Feature::PriorityQueue | Feature::CustomPersonality => AccessTier::Whale,
        }
    }

    /// Get human-readable feature name
    pub fn display_name(&self) -> &'static str {
        match self {
            Feature::Voice => "Voice Interface",
            Feature::Trading => "Trading",
            Feature::Social => "Social Media",
            Feature::Email => "Email",
            Feature::Code => "Code Operations",
            Feature::ImageGen => "Image Generation",
            Feature::Spawn => "Agent Spawning",
            Feature::PriorityQueue => "Priority Queue",
            Feature::CustomPersonality => "Custom Personality",
            Feature::ApiAccess => "API Access",
            Feature::Memory => "Memory",
        }
    }
}

/// Access tier info with balance details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessTierInfo {
    pub tier: AccessTier,
    pub balance: u64,
    pub balance_formatted: String,
    pub next_tier: Option<AccessTier>,
    pub tokens_to_next_tier: Option<f64>,
}

impl AccessTierInfo {
    pub fn new(balance: u64, decimals: u8) -> Self {
        let tier = AccessTier::from_balance(balance, decimals);
        let amount = balance as f64 / 10f64.powi(decimals as i32);

        let (next_tier, tokens_to_next) = match tier {
            AccessTier::None => (Some(AccessTier::Basic), Some(TIER_BASIC_THRESHOLD - amount)),
            AccessTier::Basic => (Some(AccessTier::Pro), Some(TIER_PRO_THRESHOLD - amount)),
            AccessTier::Pro => (Some(AccessTier::Whale), Some(TIER_WHALE_THRESHOLD - amount)),
            AccessTier::Whale | AccessTier::Diamond => (None, None),
        };

        Self {
            tier,
            balance,
            balance_formatted: format_balance(amount),
            next_tier,
            tokens_to_next_tier: tokens_to_next,
        }
    }
}

/// Format balance with K/M/B suffixes
fn format_balance(amount: f64) -> String {
    if amount >= 1_000_000_000.0 {
        format!("{:.2}B", amount / 1_000_000_000.0)
    } else if amount >= 1_000_000.0 {
        format!("{:.2}M", amount / 1_000_000.0)
    } else if amount >= 1_000.0 {
        format!("{:.2}K", amount / 1_000.0)
    } else {
        format!("{:.2}", amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_from_balance() {
        // 6 decimals (1 token = 1_000_000 raw)
        assert_eq!(AccessTier::from_balance(0, 6), AccessTier::None);
        assert_eq!(AccessTier::from_balance(5_000_000_000, 6), AccessTier::None); // 5K
        assert_eq!(AccessTier::from_balance(10_000_000_000, 6), AccessTier::Basic); // 10K
        assert_eq!(AccessTier::from_balance(50_000_000_000, 6), AccessTier::Basic); // 50K
        assert_eq!(AccessTier::from_balance(100_000_000_000, 6), AccessTier::Pro); // 100K
        assert_eq!(AccessTier::from_balance(500_000_000_000, 6), AccessTier::Pro); // 500K
        assert_eq!(AccessTier::from_balance(1_000_000_000_000, 6), AccessTier::Whale); // 1M
    }

    #[test]
    fn test_tier_ordering() {
        assert!(AccessTier::None < AccessTier::Basic);
        assert!(AccessTier::Basic < AccessTier::Pro);
        assert!(AccessTier::Pro < AccessTier::Whale);
        assert!(AccessTier::Whale < AccessTier::Diamond);
    }

    #[test]
    fn test_feature_access() {
        assert!(!AccessTier::None.can_use_feature(Feature::Voice));
        assert!(AccessTier::Basic.can_use_feature(Feature::Voice));
        assert!(AccessTier::Basic.can_use_feature(Feature::Trading));
        assert!(!AccessTier::Basic.can_use_feature(Feature::Social));
        assert!(AccessTier::Pro.can_use_feature(Feature::Social));
        assert!(!AccessTier::Pro.can_use_feature(Feature::Spawn));
        assert!(AccessTier::Whale.can_use_feature(Feature::Spawn));
    }

    #[test]
    fn test_format_balance() {
        assert_eq!(format_balance(500.0), "500.00");
        assert_eq!(format_balance(1500.0), "1.50K");
        assert_eq!(format_balance(1_500_000.0), "1.50M");
        assert_eq!(format_balance(1_500_000_000.0), "1.50B");
    }
}
