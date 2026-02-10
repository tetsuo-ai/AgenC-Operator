//! ============================================================================
//! Video Executor - Video Generation via Grok Imagine API
//! ============================================================================
//! Handles generating videos using Grok's grok-imagine-video model:
//! - Generate videos from text prompts with async polling
//! - Save generated videos to disk
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::types::VideoGenResult;

/// Grok Video generation API endpoint
const GROK_VIDEO_API: &str = "https://api.x.ai/v1/videos/generations";

/// Grok Video polling base URL (+ request_id)
const GROK_VIDEO_POLL: &str = "https://api.x.ai/v1/videos/";

/// Poll interval in seconds
const POLL_INTERVAL_SECS: u64 = 2;

/// Maximum polling duration in seconds (5 minutes)
const POLL_TIMEOUT_SECS: u64 = 300;

/// Default video resolution
const DEFAULT_RESOLUTION: &str = "720p";

/// Executor for video generation via Grok Imagine
pub struct VideoExecutor {
    client: reqwest::Client,
    api_key: String,
}

impl VideoExecutor {
    /// Create a new VideoExecutor with Grok API key
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Generate a video from a prompt, returning the video URL and metadata
    pub async fn generate(
        &self,
        prompt: &str,
        duration_sec: Option<u32>,
        aspect_ratio: Option<&str>,
        resolution: Option<&str>,
    ) -> Result<(String, u32)> {
        info!("Generating video: {}...", &prompt[..prompt.len().min(50)]);

        let duration = duration_sec.unwrap_or(10);
        let aspect = aspect_ratio.unwrap_or("16:9");
        let res = resolution.unwrap_or(DEFAULT_RESOLUTION);

        let request = VideoRequest {
            model: "grok-imagine-video".to_string(),
            prompt: prompt.to_string(),
            duration,
            aspect_ratio: aspect.to_string(),
            resolution: res.to_string(),
        };

        // POST to create the video generation job
        let response = self
            .client
            .post(GROK_VIDEO_API)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to call Grok Video API: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Grok Video API error {}: {}", status, body));
        }

        let create_response: VideoCreateResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse video creation response: {}", e))?;

        let request_id = create_response
            .request_id
            .ok_or_else(|| anyhow!("No request_id in video creation response"))?;

        info!("Video generation started, request_id: {}", request_id);

        // Poll for completion
        let poll_url = format!("{}{}", GROK_VIDEO_POLL, request_id);
        let start = std::time::Instant::now();

        loop {
            if start.elapsed().as_secs() > POLL_TIMEOUT_SECS {
                return Err(anyhow!(
                    "Video generation timed out after {}s",
                    POLL_TIMEOUT_SECS
                ));
            }

            tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;

            let poll_response = self
                .client
                .get(&poll_url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .send()
                .await
                .map_err(|e| anyhow!("Failed to poll video status: {}", e))?;

            if !poll_response.status().is_success() {
                let status = poll_response.status();
                let body = poll_response.text().await.unwrap_or_default();
                return Err(anyhow!("Video poll error {}: {}", status, body));
            }

            let poll_data: VideoPollResponse = poll_response
                .json()
                .await
                .map_err(|e| anyhow!("Failed to parse video poll response: {}", e))?;

            match poll_data.status.as_str() {
                "done" | "completed" | "succeeded" => {
                    let video_url = poll_data
                        .video_url
                        .or(poll_data.url)
                        .or_else(|| {
                            poll_data.output.and_then(|o| o.video_url.or(o.url))
                        })
                        .ok_or_else(|| anyhow!("Video completed but no URL found in response"))?;

                    info!("Video generation complete: {}", video_url);
                    return Ok((video_url, duration));
                }
                "failed" | "error" => {
                    let error_msg = poll_data
                        .error
                        .unwrap_or_else(|| "Unknown error".to_string());
                    return Err(anyhow!("Video generation failed: {}", error_msg));
                }
                status => {
                    info!(
                        "Video generation in progress (status: {}, elapsed: {}s)",
                        status,
                        start.elapsed().as_secs()
                    );
                }
            }
        }
    }

    /// Generate a video and save it to disk
    pub async fn generate_and_save(
        &self,
        prompt: &str,
        duration_sec: Option<u32>,
        aspect_ratio: Option<&str>,
        path: &str,
    ) -> Result<VideoGenResult> {
        let (video_url, duration) = self
            .generate(prompt, duration_sec, aspect_ratio, None)
            .await?;

        // Download the video
        let response = self
            .client
            .get(&video_url)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to download video: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Video download failed with status {}",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| anyhow!("Failed to read video bytes: {}", e))?;

        // Ensure parent directory exists
        if let Some(parent) = Path::new(path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| anyhow!("Failed to create directory: {}", e))?;
        }

        tokio::fs::write(path, &bytes)
            .await
            .map_err(|e| anyhow!("Failed to save video: {}", e))?;

        info!("Video saved to: {} ({} bytes)", path, bytes.len());

        Ok(VideoGenResult {
            path: path.to_string(),
            duration_sec: duration,
            format: "mp4".to_string(),
            url: Some(video_url),
        })
    }
}

// ============================================================================
// Grok Video API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct VideoRequest {
    model: String,
    prompt: String,
    duration: u32,
    aspect_ratio: String,
    resolution: String,
}

#[derive(Debug, Deserialize)]
struct VideoCreateResponse {
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VideoPollResponse {
    status: String,
    #[serde(default)]
    video_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    output: Option<VideoOutput>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VideoOutput {
    #[serde(default)]
    video_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
}
