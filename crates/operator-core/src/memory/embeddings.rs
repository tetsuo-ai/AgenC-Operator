//! ============================================================================
//! Embedding Service - Vector embeddings for semantic memory search
//! ============================================================================
//! Generates text embeddings using x.ai's OpenAI-compatible API.
//! Falls back to OpenAI if x.ai embeddings unavailable.
//! ============================================================================

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// Default embedding model (OpenAI compatible)
pub const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";

/// Expected embedding dimension for text-embedding-3-small
pub const EMBEDDING_DIM: usize = 1536;

/// Embedding service for generating text vectors
pub struct EmbeddingService {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
    model: String,
    usage: Option<EmbeddingUsage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
    index: usize,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct EmbeddingUsage {
    prompt_tokens: u32,
    total_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ErrorDetail {
    message: String,
    #[serde(rename = "type")]
    error_type: Option<String>,
}

impl EmbeddingService {
    /// Create a new embedding service using x.ai API
    pub fn new_xai(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: "https://api.x.ai/v1".to_string(),
            model: DEFAULT_EMBEDDING_MODEL.to_string(),
        }
    }

    /// Create a new embedding service using OpenAI API (fallback)
    pub fn new_openai(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: "https://api.openai.com/v1".to_string(),
            model: DEFAULT_EMBEDDING_MODEL.to_string(),
        }
    }

    /// Create with custom base URL and model
    pub fn new_custom(api_key: String, base_url: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url,
            model,
        }
    }

    /// Generate embeddings for multiple texts
    pub async fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        debug!("Generating embeddings for {} texts", texts.len());

        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: texts.clone(),
        };

        let response = self
            .client
            .post(format!("{}/embeddings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send embedding request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

        if !status.is_success() {
            // Try to parse error response
            if let Ok(error) = serde_json::from_str::<ErrorResponse>(&body) {
                return Err(anyhow!(
                    "Embedding API error ({}): {}",
                    status,
                    error.error.message
                ));
            }
            return Err(anyhow!("Embedding API error ({}): {}", status, body));
        }

        let embedding_response: EmbeddingResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse embedding response: {} - body: {}", e, body))?;

        if let Some(usage) = &embedding_response.usage {
            debug!(
                "Embedding tokens used: {} (model: {})",
                usage.total_tokens, embedding_response.model
            );
        }

        // Sort by index and extract embeddings
        let mut embeddings: Vec<(usize, Vec<f32>)> = embedding_response
            .data
            .into_iter()
            .map(|d| (d.index, d.embedding))
            .collect();
        embeddings.sort_by_key(|(idx, _)| *idx);

        Ok(embeddings.into_iter().map(|(_, e)| e).collect())
    }

    /// Generate embedding for a single text
    pub async fn embed_single(&self, text: &str) -> Result<Vec<f32>> {
        let embeddings = self.embed(vec![text.to_string()]).await?;
        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("No embedding returned"))
    }

    /// Get the current model name
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Get the base URL
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

/// Create an embedding service, trying x.ai first, then OpenAI
pub fn create_embedding_service(xai_api_key: Option<String>, openai_api_key: Option<String>) -> Result<EmbeddingService> {
    if let Some(key) = xai_api_key {
        if !key.is_empty() {
            debug!("Using x.ai for embeddings");
            return Ok(EmbeddingService::new_xai(key));
        }
    }

    if let Some(key) = openai_api_key {
        if !key.is_empty() {
            warn!("x.ai API key not available, falling back to OpenAI for embeddings");
            return Ok(EmbeddingService::new_openai(key));
        }
    }

    Err(anyhow!("No embedding API key available (tried x.ai and OpenAI)"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_creation() {
        let service = EmbeddingService::new_xai("test-key".to_string());
        assert_eq!(service.base_url(), "https://api.x.ai/v1");
        assert_eq!(service.model(), DEFAULT_EMBEDDING_MODEL);
    }

    #[test]
    fn test_openai_fallback() {
        let service = EmbeddingService::new_openai("test-key".to_string());
        assert_eq!(service.base_url(), "https://api.openai.com/v1");
    }

    #[tokio::test]
    async fn test_empty_input() {
        let service = EmbeddingService::new_xai("test-key".to_string());
        let result = service.embed(vec![]).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
