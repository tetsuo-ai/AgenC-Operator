//! ============================================================================
//! Slack Executor - Slack Workspace Messaging
//! ============================================================================
//! Handles posting to Slack workspaces using Bot token authentication:
//! - Post messages to channels
//! - Post blocks (rich messages) to channels
//! - Reply to threads
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// Slack API base URL
const SLACK_API: &str = "https://slack.com/api";

/// Result from a Slack operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackResult {
    pub message_ts: String,
    pub channel: String,
}

/// Executor for Slack operations
pub struct SlackExecutor {
    client: reqwest::Client,
    bot_token: String,
    default_channel: Option<String>,
}

impl SlackExecutor {
    /// Create a new SlackExecutor with bot token
    pub fn new(bot_token: String, default_channel: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            bot_token,
            default_channel,
        }
    }

    /// Post a simple text message to a channel
    pub async fn post_message(
        &self,
        channel: &str,
        text: &str,
        thread_ts: Option<&str>,
    ) -> Result<SlackResult> {
        info!(
            "Posting to Slack #{}: {}...",
            channel,
            &text[..text.len().min(50)]
        );

        let request = ChatPostMessage {
            channel: channel.to_string(),
            text: Some(text.to_string()),
            blocks: None,
            thread_ts: thread_ts.map(|s| s.to_string()),
        };

        self.send_message(request).await
    }

    /// Post a rich message with blocks to a channel
    pub async fn post_blocks(
        &self,
        channel: &str,
        blocks: Vec<Block>,
        fallback_text: &str,
        thread_ts: Option<&str>,
    ) -> Result<SlackResult> {
        info!(
            "Posting blocks to Slack #{}: {} blocks",
            channel,
            blocks.len()
        );

        let request = ChatPostMessage {
            channel: channel.to_string(),
            text: Some(fallback_text.to_string()),
            blocks: Some(blocks),
            thread_ts: thread_ts.map(|s| s.to_string()),
        };

        self.send_message(request).await
    }

    /// Post a notification-style message with header and context
    pub async fn post_notification(
        &self,
        channel: &str,
        title: &str,
        message: &str,
        emoji: Option<&str>,
    ) -> Result<SlackResult> {
        let emoji_prefix = emoji.map(|e| format!("{} ", e)).unwrap_or_default();

        let blocks = vec![
            Block::Header {
                text: PlainText {
                    r#type: "plain_text".to_string(),
                    text: format!("{}{}", emoji_prefix, title),
                },
            },
            Block::Section {
                text: MrkdwnText {
                    r#type: "mrkdwn".to_string(),
                    text: message.to_string(),
                },
            },
        ];

        let fallback = format!("{}: {}", title, message);
        self.post_blocks(channel, blocks, &fallback, None).await
    }

    /// Send the message request to Slack API
    async fn send_message(&self, request: ChatPostMessage) -> Result<SlackResult> {
        let url = format!("{}/chat.postMessage", SLACK_API);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.bot_token))
            .header("Content-Type", "application/json; charset=utf-8")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to post to Slack: {}", e))?;

        let status = response.status();
        let body: SlackResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Slack response: {}", e))?;

        if !body.ok {
            let error = body.error.unwrap_or_else(|| "Unknown error".to_string());
            return Err(anyhow!("Slack API error ({}): {}", status, error));
        }

        let ts = body.ts.ok_or_else(|| anyhow!("Missing message timestamp in response"))?;
        let channel = body
            .channel
            .unwrap_or_else(|| request.channel.clone());

        info!("Posted to Slack #{} (ts: {})", channel, ts);

        Ok(SlackResult {
            message_ts: ts,
            channel,
        })
    }

    /// Get the channel, using override or default
    pub fn get_channel(&self, override_channel: Option<&str>) -> Result<String> {
        override_channel
            .map(|s| s.to_string())
            .or_else(|| self.default_channel.clone())
            .ok_or_else(|| anyhow!("No channel provided and no default configured"))
    }

    /// Look up a channel ID by name (for channels not using #name format)
    pub async fn lookup_channel(&self, name: &str) -> Result<String> {
        debug!("Looking up channel: {}", name);

        let url = format!("{}/conversations.list", SLACK_API);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.bot_token))
            .query(&[("types", "public_channel,private_channel"), ("limit", "1000")])
            .send()
            .await
            .map_err(|e| anyhow!("Failed to list channels: {}", e))?;

        let body: ConversationsListResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse channels: {}", e))?;

        if !body.ok {
            let error = body.error.unwrap_or_else(|| "Unknown error".to_string());
            return Err(anyhow!("Slack API error: {}", error));
        }

        body.channels
            .unwrap_or_default()
            .iter()
            .find(|c| c.name.as_ref().map(|n| n == name).unwrap_or(false))
            .map(|c| c.id.clone())
            .ok_or_else(|| anyhow!("Channel '{}' not found", name))
    }
}

// ============================================================================
// Slack API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct ChatPostMessage {
    channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocks: Option<Vec<Block>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_ts: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum Block {
    #[serde(rename = "header")]
    Header { text: PlainText },
    #[serde(rename = "section")]
    Section { text: MrkdwnText },
    #[serde(rename = "divider")]
    Divider,
    #[serde(rename = "context")]
    Context { elements: Vec<ContextElement> },
}

#[derive(Debug, Serialize, Clone)]
pub struct PlainText {
    pub r#type: String,
    pub text: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct MrkdwnText {
    pub r#type: String,
    pub text: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum ContextElement {
    #[serde(rename = "mrkdwn")]
    Mrkdwn { text: String },
    #[serde(rename = "plain_text")]
    PlainText { text: String },
}

#[derive(Debug, Deserialize)]
struct SlackResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    ts: Option<String>,
    #[serde(default)]
    channel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConversationsListResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    channels: Option<Vec<ChannelInfo>>,
}

#[derive(Debug, Deserialize)]
struct ChannelInfo {
    id: String,
    name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slack_executor_creation() {
        let executor = SlackExecutor::new("xoxb-test-token".to_string(), Some("#general".to_string()));
        assert_eq!(executor.get_channel(None).unwrap(), "#general");
        assert_eq!(executor.get_channel(Some("#random")).unwrap(), "#random");
    }

    #[test]
    fn test_get_channel_no_default() {
        let executor = SlackExecutor::new("xoxb-test-token".to_string(), None);
        assert!(executor.get_channel(None).is_err());
        assert_eq!(executor.get_channel(Some("#test")).unwrap(), "#test");
    }

    #[test]
    fn test_block_serialization() {
        let blocks = vec![
            Block::Header {
                text: PlainText {
                    r#type: "plain_text".to_string(),
                    text: "Test Header".to_string(),
                },
            },
            Block::Section {
                text: MrkdwnText {
                    r#type: "mrkdwn".to_string(),
                    text: "Test *message* with _formatting_".to_string(),
                },
            },
            Block::Divider,
        ];

        let json = serde_json::to_string(&blocks).unwrap();
        assert!(json.contains("header"));
        assert!(json.contains("section"));
        assert!(json.contains("divider"));
    }
}
