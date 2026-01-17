//! ============================================================================
//! Memory Manager - Orchestrates memory storage and retrieval
//! ============================================================================
//! High-level API for storing, searching, and managing conversation memory.
//! ============================================================================

use anyhow::Result;
use tracing::{debug, info};

use super::embeddings::EmbeddingService;
use super::store::MemoryStore;
use super::types::{ConversationTurn, Memory, MemoryType, UserContext};
use crate::access::{AccessGate, AccessTier, TETSUO_DECIMALS};

/// Memory manager combining store and embeddings
pub struct MemoryManager {
    store: MemoryStore,
    embeddings: EmbeddingService,
}

impl MemoryManager {
    /// Create a new memory manager
    pub async fn new(qdrant_url: &str, embedding_service: EmbeddingService) -> Result<Self> {
        let store = MemoryStore::new(qdrant_url).await?;

        Ok(Self {
            store,
            embeddings: embedding_service,
        })
    }

    /// Build context for a user's current message
    pub async fn build_context(
        &self,
        user_id: &str,
        current_message: &str,
        recent_turns: Vec<ConversationTurn>,
        access_gate: &AccessGate,
    ) -> Result<UserContext> {
        let wallet_pubkey = user_id.to_string(); // Assuming user_id is wallet pubkey

        // Get access tier
        let wallet = wallet_pubkey
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid wallet pubkey: {}", e))?;
        let (access_tier, tetsuo_balance) = access_gate.check_access(&wallet).await?;

        // Search for relevant memories if message is non-empty
        let relevant_memories = if !current_message.is_empty() {
            self.search_memories(user_id, current_message, 5).await?
        } else {
            // Fall back to recent memories
            self.get_user_memories(user_id, 5).await?
        };

        Ok(UserContext {
            user_id: user_id.to_string(),
            wallet_pubkey,
            tetsuo_balance,
            access_tier,
            recent_turns,
            relevant_memories,
        })
    }

    /// Store a new memory with auto-generated embedding
    pub async fn store_memory(
        &self,
        user_id: &str,
        content: &str,
        memory_type: MemoryType,
        importance: f32,
    ) -> Result<Memory> {
        debug!(
            "Storing memory for user {}: {:?}",
            user_id, memory_type
        );

        // Generate embedding
        let embedding = self.embeddings.embed_single(content).await?;

        // Create and store memory
        let memory = Memory::new(
            user_id.to_string(),
            content.to_string(),
            memory_type,
            importance,
        )
        .with_embedding(embedding);

        self.store.store_memory(&memory).await?;

        info!(
            "Stored memory {} for user {} ({:?})",
            memory.id, user_id, memory_type
        );

        Ok(memory)
    }

    /// Search memories by semantic similarity
    pub async fn search_memories(
        &self,
        user_id: &str,
        query: &str,
        limit: u64,
    ) -> Result<Vec<Memory>> {
        debug!("Searching memories for user {} with query: {}", user_id, query);

        // Generate query embedding
        let query_embedding = self.embeddings.embed_single(query).await?;

        // Search in store
        self.store
            .search_memories(user_id, query_embedding, limit)
            .await
    }

    /// Get recent memories for a user (non-semantic)
    pub async fn get_user_memories(&self, user_id: &str, limit: u64) -> Result<Vec<Memory>> {
        self.store.get_user_memories(user_id, limit).await
    }

    /// Delete all memories for a user
    pub async fn delete_user_memories(&self, user_id: &str) -> Result<u64> {
        self.store.delete_user_memories(user_id).await
    }

    /// Extract and store important facts from a conversation
    /// This is a simplified version - in production, use LLM for extraction
    pub async fn extract_and_store_from_conversation(
        &self,
        user_id: &str,
        turns: &[ConversationTurn],
    ) -> Result<Vec<Memory>> {
        let mut stored = Vec::new();

        for turn in turns {
            if turn.role == "user" {
                // Simple heuristics for important information
                // In production, use LLM to extract facts

                // Check for name mentions
                if let Some(fact) = extract_name_fact(&turn.content) {
                    let memory = self
                        .store_memory(user_id, &fact, MemoryType::UserFact, 0.9)
                        .await?;
                    stored.push(memory);
                }

                // Check for preference mentions
                if let Some(pref) = extract_preference(&turn.content) {
                    let memory = self
                        .store_memory(user_id, &pref, MemoryType::Preference, 0.8)
                        .await?;
                    stored.push(memory);
                }

                // Check for goal mentions
                if let Some(goal) = extract_goal(&turn.content) {
                    let memory = self
                        .store_memory(user_id, &goal, MemoryType::Goal, 0.85)
                        .await?;
                    stored.push(memory);
                }
            }
        }

        if !stored.is_empty() {
            info!(
                "Extracted and stored {} memories from conversation for user {}",
                stored.len(),
                user_id
            );
        }

        Ok(stored)
    }

    /// Check if the memory system is healthy
    pub async fn health_check(&self) -> Result<bool> {
        self.store.health_check().await
    }

    /// Get memory store stats
    pub async fn get_stats(&self) -> Result<super::store::CollectionStats> {
        self.store.get_stats().await
    }

    /// Get reference to the store (for advanced operations)
    pub fn store(&self) -> &MemoryStore {
        &self.store
    }
}

// Simple extraction heuristics (in production, use LLM)

fn extract_name_fact(content: &str) -> Option<String> {
    let lower = content.to_lowercase();

    // "my name is X" or "I'm X" or "call me X"
    let patterns = [
        ("my name is ", 11),
        ("i'm ", 4),
        ("i am ", 5),
        ("call me ", 8),
        ("they call me ", 13),
    ];

    for (pattern, offset) in patterns {
        if let Some(pos) = lower.find(pattern) {
            let rest = &content[pos + offset..];
            let name: String = rest
                .chars()
                .take_while(|c| c.is_alphabetic() || *c == ' ')
                .collect();
            let name = name.trim();
            if !name.is_empty() && name.len() < 50 {
                return Some(format!("User's name is {}", name));
            }
        }
    }

    None
}

fn extract_preference(content: &str) -> Option<String> {
    let lower = content.to_lowercase();

    // "I prefer X" or "I like X" or "I want X"
    let patterns = ["i prefer ", "i like ", "i love ", "i hate ", "i don't like "];

    for pattern in patterns {
        if let Some(pos) = lower.find(pattern) {
            let rest = &content[pos..];
            // Take the rest of the sentence (up to period or end)
            let pref: String = rest
                .chars()
                .take_while(|c| *c != '.' && *c != '!' && *c != '?')
                .collect();
            let pref = pref.trim();
            if pref.len() > 10 && pref.len() < 200 {
                return Some(format!("User preference: {}", pref));
            }
        }
    }

    None
}

fn extract_goal(content: &str) -> Option<String> {
    let lower = content.to_lowercase();

    // "I want to X" or "I'm trying to X" or "my goal is X"
    let patterns = [
        "i want to ",
        "i'm trying to ",
        "i need to ",
        "my goal is ",
        "i'm working on ",
    ];

    for pattern in patterns {
        if let Some(pos) = lower.find(pattern) {
            let rest = &content[pos..];
            let goal: String = rest
                .chars()
                .take_while(|c| *c != '.' && *c != '!' && *c != '?')
                .collect();
            let goal = goal.trim();
            if goal.len() > 15 && goal.len() < 200 {
                return Some(format!("User goal: {}", goal));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_name() {
        assert_eq!(
            extract_name_fact("My name is Alice"),
            Some("User's name is Alice".to_string())
        );
        assert_eq!(
            extract_name_fact("I'm Bob and I work here"),
            Some("User's name is Bob".to_string())
        );
        assert_eq!(extract_name_fact("Hello there"), None);
    }

    #[test]
    fn test_extract_preference() {
        assert!(extract_preference("I prefer short responses").is_some());
        assert!(extract_preference("I like using TypeScript for frontend").is_some());
        assert!(extract_preference("Hello").is_none());
    }

    #[test]
    fn test_extract_goal() {
        assert!(extract_goal("I want to build a trading bot").is_some());
        assert!(extract_goal("I'm working on a new project for crypto").is_some());
        assert!(extract_goal("Hello").is_none());
    }
}
