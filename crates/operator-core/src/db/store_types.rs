// ============================================================================
// Store / Marketplace Types for OperatorDb (redb)
// ============================================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Category of a store item
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoreItemCategory {
    Clothing,
    Accessory,
    Hair,
    Eyes,
    Headwear,
    Footwear,
}

impl StoreItemCategory {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "clothing" => Some(Self::Clothing),
            "accessory" => Some(Self::Accessory),
            "hair" => Some(Self::Hair),
            "eyes" => Some(Self::Eyes),
            "headwear" => Some(Self::Headwear),
            "footwear" => Some(Self::Footwear),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Clothing => "clothing",
            Self::Accessory => "accessory",
            Self::Hair => "hair",
            Self::Eyes => "eyes",
            Self::Headwear => "headwear",
            Self::Footwear => "footwear",
        }
    }
}

/// Rarity tier for store items
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemRarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
}

/// A store item available for purchase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: StoreItemCategory,
    pub price: u64,
    pub rarity: ItemRarity,
    pub thumbnail_url: String,
    pub glb_path: String,
    pub attach_bone: String,
    pub scale: [f32; 3],
    pub offset: [f32; 3],
    pub rotation: [f32; 3],
    pub slot: String,
    pub created_at: i64,
}

/// User inventory entry (which items the user owns)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInventoryEntry {
    pub item_id: String,
    pub acquired_at: i64,
}

/// User inventory container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInventory {
    pub wallet_address: String,
    pub items: Vec<UserInventoryEntry>,
}

/// Equipped items state — maps slot name to item ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquippedItems {
    pub wallet_address: String,
    pub slots: HashMap<String, String>,
}
