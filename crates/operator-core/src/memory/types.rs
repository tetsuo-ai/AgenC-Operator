//! ============================================================================
//! Memory Types - Data structures for conversation memory
//! ============================================================================
//! Defines memory entries, conversation turns, and user context structures.
//! ============================================================================

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::access::AccessTier;

/// A single memory entry stored in the vector database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    /// Unique identifier for this memory
    pub id: Uuid,
    /// User identifier (wallet pubkey)
    pub user_id: String,
    /// The actual memory content
    pub content: String,
    /// Type of memory
    pub memory_type: MemoryType,
    /// Importance score (0.0 - 1.0)
    pub importance: f32,
    /// Vector embedding (not serialized to frontend)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub embedding: Vec<f32>,
    /// Unix timestamp when memory was created
    pub created_at: i64,
    /// Unix timestamp when memory was last accessed
    pub last_accessed: i64,
    /// Number of times this memory was retrieved
    pub access_count: u32,
}

impl Memory {
    /// Create a new memory entry
    pub fn new(user_id: String, content: String, memory_type: MemoryType, importance: f32) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: Uuid::new_v4(),
            user_id,
            content,
            memory_type,
            importance,
            embedding: Vec::new(),
            created_at: now,
            last_accessed: now,
            access_count: 0,
        }
    }

    /// Create a memory with a pre-computed embedding
    pub fn with_embedding(mut self, embedding: Vec<f32>) -> Self {
        self.embedding = embedding;
        self
    }
}

/// Types of memories that can be stored
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    /// Facts about the user (name, preferences, etc.)
    UserFact,
    /// User's goals and ongoing projects
    Goal,
    /// Important events or decisions
    Event,
    /// Conversation summary
    Summary,
    /// User preferences for Tetsuo's behavior
    Preference,
    /// Task-related information
    Task,
}

impl MemoryType {
    /// Get the display name for this memory type
    pub fn display_name(&self) -> &'static str {
        match self {
            MemoryType::UserFact => "User Fact",
            MemoryType::Goal => "Goal",
            MemoryType::Event => "Event",
            MemoryType::Summary => "Summary",
            MemoryType::Preference => "Preference",
            MemoryType::Task => "Task",
        }
    }
}

impl std::fmt::Display for MemoryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::str::FromStr for MemoryType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "userfact" | "user_fact" => Ok(MemoryType::UserFact),
            "goal" => Ok(MemoryType::Goal),
            "event" => Ok(MemoryType::Event),
            "summary" => Ok(MemoryType::Summary),
            "preference" => Ok(MemoryType::Preference),
            "task" => Ok(MemoryType::Task),
            _ => Err(format!("Unknown memory type: {}", s)),
        }
    }
}

/// A single turn in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    /// Role: "user" or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
    /// Unix timestamp
    pub timestamp: i64,
}

impl ConversationTurn {
    pub fn user(content: String) -> Self {
        Self {
            role: "user".to_string(),
            content,
            timestamp: chrono::Utc::now().timestamp(),
        }
    }

    pub fn assistant(content: String) -> Self {
        Self {
            role: "assistant".to_string(),
            content,
            timestamp: chrono::Utc::now().timestamp(),
        }
    }
}

/// Assembled context for a user, ready to inject into system prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserContext {
    /// User identifier (wallet pubkey)
    pub user_id: String,
    /// Wallet public key
    pub wallet_pubkey: String,
    /// $TETSUO balance (raw)
    pub tetsuo_balance: u64,
    /// Access tier based on holdings
    pub access_tier: AccessTier,
    /// Recent conversation turns (last N)
    pub recent_turns: Vec<ConversationTurn>,
    /// Relevant memories retrieved from vector search
    pub relevant_memories: Vec<Memory>,
}

impl UserContext {
    /// Create a new empty user context
    pub fn new(user_id: String, wallet_pubkey: String) -> Self {
        Self {
            user_id,
            wallet_pubkey,
            tetsuo_balance: 0,
            access_tier: AccessTier::None,
            recent_turns: Vec::new(),
            relevant_memories: Vec::new(),
        }
    }

    /// Format memories for inclusion in system prompt
    pub fn format_memories_for_prompt(&self) -> String {
        if self.relevant_memories.is_empty() {
            return String::new();
        }

        let mut formatted = String::from("\n<user_context>\nWhat you remember about this user:\n");

        for memory in &self.relevant_memories {
            formatted.push_str(&format!(
                "- [{}] {}\n",
                memory.memory_type.display_name(),
                memory.content
            ));
        }

        formatted.push_str("</user_context>\n");
        formatted
    }

    /// Format recent conversation for context
    pub fn format_recent_turns(&self, max_turns: usize) -> String {
        if self.recent_turns.is_empty() {
            return String::new();
        }

        let turns: Vec<_> = self
            .recent_turns
            .iter()
            .rev()
            .take(max_turns)
            .rev()
            .collect();

        let mut formatted = String::from("\n<recent_conversation>\n");

        for turn in turns {
            let role_label = if turn.role == "user" { "User" } else { "Tetsuo" };
            formatted.push_str(&format!("{}: {}\n", role_label, turn.content));
        }

        formatted.push_str("</recent_conversation>\n");
        formatted
    }

    /// Build complete context string for system prompt
    pub fn build_prompt_context(&self) -> String {
        let mut context = String::new();

        // Add access tier info
        context.push_str(&format!(
            "\n<access_info>\nUser Access Tier: {:?}\nFeatures Available: {}\n</access_info>\n",
            self.access_tier,
            self.get_available_features_string()
        ));

        // Add memories
        context.push_str(&self.format_memories_for_prompt());

        // Add recent conversation
        context.push_str(&self.format_recent_turns(5));

        context
    }

    fn get_available_features_string(&self) -> String {
        use crate::access::Feature;

        let all_features = [
            Feature::Voice,
            Feature::Trading,
            Feature::Social,
            Feature::Email,
            Feature::Code,
            Feature::ImageGen,
            Feature::Spawn,
            Feature::Memory,
        ];

        all_features
            .iter()
            .filter(|f| self.access_tier.can_use_feature(**f))
            .map(|f| f.display_name())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Request to store a new memory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreMemoryRequest {
    pub user_id: String,
    pub content: String,
    pub memory_type: MemoryType,
    pub importance: Option<f32>,
}

/// Request to search memories
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMemoriesRequest {
    pub user_id: String,
    pub query: String,
    pub limit: Option<u64>,
    pub memory_types: Option<Vec<MemoryType>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_creation() {
        let memory = Memory::new(
            "wallet123".to_string(),
            "User's name is Alice".to_string(),
            MemoryType::UserFact,
            0.9,
        );

        assert_eq!(memory.user_id, "wallet123");
        assert_eq!(memory.content, "User's name is Alice");
        assert_eq!(memory.memory_type, MemoryType::UserFact);
        assert_eq!(memory.importance, 0.9);
        assert_eq!(memory.access_count, 0);
    }

    #[test]
    fn test_memory_type_parsing() {
        assert_eq!("user_fact".parse::<MemoryType>().unwrap(), MemoryType::UserFact);
        assert_eq!("goal".parse::<MemoryType>().unwrap(), MemoryType::Goal);
        assert_eq!("event".parse::<MemoryType>().unwrap(), MemoryType::Event);
    }

    #[test]
    fn test_context_formatting() {
        let mut context = UserContext::new("user123".to_string(), "wallet123".to_string());
        context.access_tier = AccessTier::Pro;
        context.relevant_memories.push(Memory::new(
            "user123".to_string(),
            "User prefers concise responses".to_string(),
            MemoryType::Preference,
            0.8,
        ));

        let formatted = context.format_memories_for_prompt();
        assert!(formatted.contains("User prefers concise responses"));
        assert!(formatted.contains("Preference"));
    }
}
