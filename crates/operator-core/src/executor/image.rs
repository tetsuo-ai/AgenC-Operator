//! ============================================================================
//! Image Executor - Image Generation via Grok API
//! ============================================================================
//! Handles generating images using Grok's grok-2-image-1212 model:
//! - Generate images from text prompts
//! - Save generated images to disk
//! ============================================================================

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::types::ImageGenResult;

/// Grok Image API endpoint
const GROK_IMAGE_API: &str = "https://api.x.ai/v1/images/generations";

/// Executor for image generation via Grok
pub struct ImageExecutor {
    client: reqwest::Client,
    api_key: String,
}

impl ImageExecutor {
    /// Create a new ImageExecutor with Grok API key
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Generate an image from a prompt, returning raw bytes
    pub async fn generate(&self, prompt: &str) -> Result<Vec<u8>> {
        info!("Generating image: {}...", &prompt[..prompt.len().min(50)]);

        let request = ImageRequest {
            model: "grok-2-image-1212".to_string(),
            prompt: prompt.to_string(),
            n: 1,
            response_format: "b64_json".to_string(),
        };

        let response = self
            .client
            .post(GROK_IMAGE_API)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to call Grok Image API: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Grok Image API error {}: {}", status, body));
        }

        let image_response: ImageResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse image response: {}", e))?;

        let b64 = image_response
            .data
            .first()
            .and_then(|d| d.b64_json.as_ref())
            .ok_or_else(|| anyhow!("No image data in response"))?;

        let bytes = STANDARD
            .decode(b64)
            .map_err(|e| anyhow!("Failed to decode base64 image: {}", e))?;

        info!("Image generated: {} bytes", bytes.len());

        Ok(bytes)
    }

    /// Generate an image and save it to a file
    pub async fn generate_and_save(&self, prompt: &str, path: &str) -> Result<ImageGenResult> {
        let bytes = self.generate(prompt).await?;

        // Ensure parent directory exists
        if let Some(parent) = Path::new(path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| anyhow!("Failed to create directory: {}", e))?;
        }

        tokio::fs::write(path, &bytes)
            .await
            .map_err(|e| anyhow!("Failed to save image: {}", e))?;

        info!("Image saved to: {}", path);

        Ok(ImageGenResult {
            path: path.to_string(),
        })
    }
}

// ============================================================================
// Grok Image API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct ImageRequest {
    model: String,
    prompt: String,
    n: u32,
    response_format: String,
}

#[derive(Debug, Deserialize)]
struct ImageResponse {
    data: Vec<ImageData>,
}

#[derive(Debug, Deserialize)]
struct ImageData {
    b64_json: Option<String>,
    #[allow(dead_code)]
    url: Option<String>,
}
