//! ============================================================================
//! Memory Module - Persistent conversation memory for Tetsuo
//! ============================================================================
//! Provides vector-based memory storage using Qdrant for semantic search.
//!
//! ## Features
//! - Store and retrieve memories with vector embeddings
//! - Semantic search for relevant context
//! - Auto-extract important facts from conversations
//! - Per-user memory isolation
//!
//! ## Architecture
//! ```text
//! User Message → Embed → Vector Search → Relevant Memories
//!                                              ↓
//!                         [System Prompt] + [Memories] + [Tier Info]
//!                                              ↓
//!                                        Grok Voice API
//!                                              ↓
//!                         Extract & Store New Memories
//! ```
//!
//! ## Usage
//! ```rust,ignore
//! use operator_core::memory::{MemoryManager, EmbeddingService};
//!
//! let embeddings = EmbeddingService::new_xai(api_key);
//! let manager = MemoryManager::new("http://localhost:6333", embeddings).await?;
//!
//! // Store a memory
//! manager.store_memory(user_id, "User prefers concise responses", MemoryType::Preference, 0.8).await?;
//!
//! // Search memories
//! let relevant = manager.search_memories(user_id, "how should I respond", 5).await?;
//! ```
//! ============================================================================

mod embeddings;
mod manager;
mod store;
mod types;

// Re-export public types
pub use embeddings::{create_embedding_service, EmbeddingService, EMBEDDING_DIM};
pub use manager::MemoryManager;
pub use store::{CollectionStats, MemoryStore, COLLECTION_NAME};
pub use types::{
    ConversationTurn, Memory, MemoryType, SearchMemoriesRequest, StoreMemoryRequest, UserContext,
};
