//! ============================================================================
//! Memory Store - Qdrant vector database operations
//! ============================================================================
//! Stores and retrieves memories using vector similarity search.
//! ============================================================================

use anyhow::{anyhow, Result};
use qdrant_client::qdrant::{
    point_id::PointIdOptions, points_selector::PointsSelectorOneOf, Condition,
    CreateCollectionBuilder, DeletePointsBuilder, Distance, Filter, PointStruct,
    ScrollPointsBuilder, SearchPointsBuilder, UpsertPointsBuilder, Value, VectorParamsBuilder,
};
use qdrant_client::Qdrant;
use std::collections::HashMap;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::embeddings::EMBEDDING_DIM;
use super::types::{Memory, MemoryType};

/// Collection name for memories
pub const COLLECTION_NAME: &str = "tetsuo_memories";

/// Memory store backed by Qdrant vector database
pub struct MemoryStore {
    client: Qdrant,
}

impl MemoryStore {
    /// Create a new memory store, connecting to Qdrant
    pub async fn new(url: &str) -> Result<Self> {
        debug!("Connecting to Qdrant at {}", url);

        let client = Qdrant::from_url(url)
            .build()
            .map_err(|e| anyhow!("Failed to create Qdrant client: {}", e))?;

        let store = Self { client };

        // Ensure collection exists
        store.ensure_collection().await?;

        Ok(store)
    }

    /// Ensure the memories collection exists
    async fn ensure_collection(&self) -> Result<()> {
        let exists = self
            .client
            .collection_exists(COLLECTION_NAME)
            .await
            .map_err(|e| anyhow!("Failed to check collection existence: {}", e))?;

        if !exists {
            info!("Creating collection: {}", COLLECTION_NAME);

            self.client
                .create_collection(
                    CreateCollectionBuilder::new(COLLECTION_NAME)
                        .vectors_config(VectorParamsBuilder::new(
                            EMBEDDING_DIM as u64,
                            Distance::Cosine,
                        )),
                )
                .await
                .map_err(|e| anyhow!("Failed to create collection: {}", e))?;

            info!("Collection {} created successfully", COLLECTION_NAME);
        } else {
            debug!("Collection {} already exists", COLLECTION_NAME);
        }

        Ok(())
    }

    /// Store a memory in the database
    pub async fn store_memory(&self, memory: &Memory) -> Result<()> {
        if memory.embedding.is_empty() {
            return Err(anyhow!("Cannot store memory without embedding"));
        }

        debug!("Storing memory {} for user {}", memory.id, memory.user_id);

        let payload: HashMap<String, Value> = [
            ("user_id".to_string(), Value::from(memory.user_id.clone())),
            ("content".to_string(), Value::from(memory.content.clone())),
            (
                "memory_type".to_string(),
                Value::from(memory.memory_type.to_string()),
            ),
            ("importance".to_string(), Value::from(memory.importance as f64)),
            ("created_at".to_string(), Value::from(memory.created_at)),
            (
                "last_accessed".to_string(),
                Value::from(memory.last_accessed),
            ),
            ("access_count".to_string(), Value::from(memory.access_count as i64)),
        ]
        .into_iter()
        .collect();

        let point = PointStruct::new(
            memory.id.to_string(),
            memory.embedding.clone(),
            payload,
        );

        self.client
            .upsert_points(UpsertPointsBuilder::new(COLLECTION_NAME, vec![point]))
            .await
            .map_err(|e| anyhow!("Failed to upsert memory: {}", e))?;

        debug!("Memory {} stored successfully", memory.id);
        Ok(())
    }

    /// Search for memories similar to a query vector
    pub async fn search_memories(
        &self,
        user_id: &str,
        query_embedding: Vec<f32>,
        limit: u64,
    ) -> Result<Vec<Memory>> {
        debug!(
            "Searching memories for user {} (limit: {})",
            user_id, limit
        );

        // Build filter for user_id match
        let filter = Filter::must([Condition::matches("user_id", user_id.to_string())]);

        let search_result = self
            .client
            .search_points(
                SearchPointsBuilder::new(COLLECTION_NAME, query_embedding, limit)
                    .filter(filter)
                    .with_payload(true),
            )
            .await
            .map_err(|e| anyhow!("Failed to search memories: {}", e))?;

        let memories: Vec<Memory> = search_result
            .result
            .into_iter()
            .filter_map(|point| {
                let id = extract_uuid_from_point_id(point.id?)?;
                let payload = point.payload;

                Some(Memory {
                    id,
                    user_id: get_string(&payload, "user_id")?,
                    content: get_string(&payload, "content")?,
                    memory_type: get_string(&payload, "memory_type")?
                        .parse()
                        .unwrap_or(MemoryType::UserFact),
                    importance: get_f64(&payload, "importance").unwrap_or(0.5) as f32,
                    embedding: vec![], // Not returned in search results
                    created_at: get_i64(&payload, "created_at").unwrap_or(0),
                    last_accessed: get_i64(&payload, "last_accessed").unwrap_or(0),
                    access_count: get_i64(&payload, "access_count").unwrap_or(0) as u32,
                })
            })
            .collect();

        debug!("Found {} matching memories", memories.len());
        Ok(memories)
    }

    /// Get all memories for a user (paginated)
    pub async fn get_user_memories(&self, user_id: &str, limit: u64) -> Result<Vec<Memory>> {
        debug!("Getting memories for user {} (limit: {})", user_id, limit);

        let filter = Filter::must([Condition::matches("user_id", user_id.to_string())]);

        let scroll_result = self
            .client
            .scroll(
                ScrollPointsBuilder::new(COLLECTION_NAME)
                    .filter(filter)
                    .limit(limit as u32)
                    .with_payload(true),
            )
            .await
            .map_err(|e| anyhow!("Failed to scroll memories: {}", e))?;

        let memories: Vec<Memory> = scroll_result
            .result
            .into_iter()
            .filter_map(|point| {
                let id = extract_uuid_from_point_id(point.id?)?;
                let payload = point.payload;

                Some(Memory {
                    id,
                    user_id: get_string(&payload, "user_id")?,
                    content: get_string(&payload, "content")?,
                    memory_type: get_string(&payload, "memory_type")?
                        .parse()
                        .unwrap_or(MemoryType::UserFact),
                    importance: get_f64(&payload, "importance").unwrap_or(0.5) as f32,
                    embedding: vec![],
                    created_at: get_i64(&payload, "created_at").unwrap_or(0),
                    last_accessed: get_i64(&payload, "last_accessed").unwrap_or(0),
                    access_count: get_i64(&payload, "access_count").unwrap_or(0) as u32,
                })
            })
            .collect();

        debug!("Retrieved {} memories for user {}", memories.len(), user_id);
        Ok(memories)
    }

    /// Delete all memories for a user
    pub async fn delete_user_memories(&self, user_id: &str) -> Result<u64> {
        info!("Deleting all memories for user {}", user_id);

        let filter = Filter::must([Condition::matches("user_id", user_id.to_string())]);

        self.client
            .delete_points(
                DeletePointsBuilder::new(COLLECTION_NAME)
                    .points(PointsSelectorOneOf::Filter(filter)),
            )
            .await
            .map_err(|e| anyhow!("Failed to delete memories: {}", e))?;

        info!("Deleted memories for user {}", user_id);
        // Qdrant doesn't return count for filter deletes, return 0
        Ok(0)
    }

    /// Delete a specific memory by ID
    pub async fn delete_memory(&self, memory_id: &Uuid) -> Result<()> {
        debug!("Deleting memory {}", memory_id);

        self.client
            .delete_points(DeletePointsBuilder::new(COLLECTION_NAME).points(vec![
                memory_id.to_string(),
            ]))
            .await
            .map_err(|e| anyhow!("Failed to delete memory: {}", e))?;

        Ok(())
    }

    /// Get collection info/stats
    pub async fn get_stats(&self) -> Result<CollectionStats> {
        let info = self
            .client
            .collection_info(COLLECTION_NAME)
            .await
            .map_err(|e| anyhow!("Failed to get collection info: {}", e))?;

        Ok(CollectionStats {
            points_count: info.result.map(|r| r.points_count.unwrap_or(0)).unwrap_or(0),
        })
    }

    /// Check if the store is healthy/connected
    pub async fn health_check(&self) -> Result<bool> {
        match self.client.health_check().await {
            Ok(_) => Ok(true),
            Err(e) => {
                warn!("Qdrant health check failed: {}", e);
                Ok(false)
            }
        }
    }
}

/// Collection statistics
#[derive(Debug, Clone)]
pub struct CollectionStats {
    pub points_count: u64,
}

// Helper to extract UUID from PointId
fn extract_uuid_from_point_id(point_id: qdrant_client::qdrant::PointId) -> Option<Uuid> {
    match point_id.point_id_options? {
        PointIdOptions::Uuid(uuid_str) => Uuid::parse_str(&uuid_str).ok(),
        PointIdOptions::Num(_) => None, // We use UUID strings, not numeric IDs
    }
}

// Helper functions to extract values from payload
fn get_string(payload: &HashMap<String, Value>, key: &str) -> Option<String> {
    payload.get(key).and_then(|v| {
        if let Some(s) = v.as_str() {
            Some(s.to_string())
        } else {
            None
        }
    })
}

fn get_f64(payload: &HashMap<String, Value>, key: &str) -> Option<f64> {
    payload.get(key).and_then(|v| v.as_double())
}

fn get_i64(payload: &HashMap<String, Value>, key: &str) -> Option<i64> {
    payload.get(key).and_then(|v| v.as_integer())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration tests require a running Qdrant instance
    // These are marked as ignored by default

    #[tokio::test]
    #[ignore]
    async fn test_store_and_search() {
        let store = MemoryStore::new("http://localhost:6333").await.unwrap();

        let memory = Memory::new(
            "test_user".to_string(),
            "Test memory content".to_string(),
            MemoryType::UserFact,
            0.9,
        )
        .with_embedding(vec![0.1; EMBEDDING_DIM]);

        store.store_memory(&memory).await.unwrap();

        let results = store
            .search_memories("test_user", vec![0.1; EMBEDDING_DIM], 10)
            .await
            .unwrap();

        assert!(!results.is_empty());
        assert_eq!(results[0].content, "Test memory content");

        // Cleanup
        store.delete_memory(&memory.id).await.unwrap();
    }
}
