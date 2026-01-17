//! ============================================================================
//! Twitter Executor - Social Media Posting via Twitter API v2
//! ============================================================================
//! Handles posting to Twitter using OAuth 2.0 Bearer token authentication:
//! - Post single tweets
//! - Post threaded tweets
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::Deserialize;
use tracing::{debug, info};

use crate::types::TweetResult;

/// Twitter API v2 tweet endpoint
const TWITTER_TWEET_URL: &str = "https://api.twitter.com/2/tweets";

/// Executor for Twitter posting operations
pub struct TwitterExecutor {
    client: reqwest::Client,
    access_token: String,
}

impl TwitterExecutor {
    /// Create a new TwitterExecutor with OAuth 2.0 access token
    pub fn new(access_token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            access_token,
        }
    }

    /// Update the access token (e.g., after refresh)
    pub fn set_access_token(&mut self, access_token: String) {
        self.access_token = access_token;
    }

    /// Post a single tweet
    pub async fn post_tweet(&self, text: &str, reply_to: Option<&str>) -> Result<TweetResult> {
        info!("Posting tweet: {}...", &text[..text.len().min(50)]);

        // Validate tweet length
        if text.len() > 280 {
            return Err(anyhow!("Tweet exceeds 280 characters"));
        }

        // Build request body
        let mut body = serde_json::json!({
            "text": text
        });

        if let Some(reply_id) = reply_to {
            body["reply"] = serde_json::json!({
                "in_reply_to_tweet_id": reply_id
            });
        }

        // Send request with Bearer token
        let response = self
            .client
            .post(TWITTER_TWEET_URL)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to post tweet: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Twitter API error {}: {}", status, body));
        }

        let tweet_response: TwitterTweetResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse tweet response: {}", e))?;

        let tweet_id = tweet_response.data.id;
        let url = format!("https://twitter.com/i/status/{}", tweet_id);

        info!("Tweet posted: {}", url);

        Ok(TweetResult { tweet_id, url })
    }

    /// Post a thread of tweets
    pub async fn post_thread(&self, tweets: Vec<String>) -> Result<Vec<TweetResult>> {
        info!("Posting thread with {} tweets", tweets.len());

        if tweets.is_empty() {
            return Err(anyhow!("Thread must have at least one tweet"));
        }

        // Validate all tweets
        for (i, tweet) in tweets.iter().enumerate() {
            if tweet.len() > 280 {
                return Err(anyhow!("Tweet {} exceeds 280 characters", i + 1));
            }
        }

        let mut results = Vec::with_capacity(tweets.len());
        let mut last_id: Option<String> = None;

        for (i, tweet_text) in tweets.iter().enumerate() {
            debug!("Posting tweet {}/{}", i + 1, tweets.len());

            let result = self.post_tweet(tweet_text, last_id.as_deref()).await?;
            last_id = Some(result.tweet_id.clone());
            results.push(result);

            // Small delay between tweets to avoid rate limiting
            if i < tweets.len() - 1 {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }

        info!("Thread posted successfully");
        Ok(results)
    }
}

// ============================================================================
// Twitter API Types
// ============================================================================

#[derive(Debug, Deserialize)]
struct TwitterTweetResponse {
    data: TwitterTweetData,
}

#[derive(Debug, Deserialize)]
struct TwitterTweetData {
    id: String,
}
