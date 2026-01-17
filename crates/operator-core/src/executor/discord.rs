//! ============================================================================
//! Discord Executor - Discord Bot Messaging
//! ============================================================================
//! Handles posting to Discord servers using Bot token authentication:
//! - Post messages to channels
//! - Post embeds to channels
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::types::DiscordResult;

/// Discord API v10 base URL
const DISCORD_API: &str = "https://discord.com/api/v10";

/// Executor for Discord bot operations
pub struct DiscordExecutor {
    client: reqwest::Client,
    bot_token: String,
    default_guild_id: Option<String>,
}

impl DiscordExecutor {
    /// Create a new DiscordExecutor with bot token
    pub fn new(bot_token: String, default_guild_id: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            bot_token,
            default_guild_id,
        }
    }

    /// Post a message to a channel by name
    pub async fn post_message(
        &self,
        guild_id: &str,
        channel_name: &str,
        content: &str,
    ) -> Result<DiscordResult> {
        info!("Posting to Discord #{}: {}...", channel_name, &content[..content.len().min(50)]);

        let channel_id = self.find_channel(guild_id, channel_name).await?;

        let url = format!("{}/channels/{}/messages", DISCORD_API, channel_id);
        let request = MessageRequest {
            content: content.to_string(),
            embeds: None,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bot {}", self.bot_token))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to post to Discord: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Discord API error {}: {}", status, body));
        }

        let msg_response: MessageResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Discord response: {}", e))?;

        info!("Posted to Discord #{}", channel_name);

        Ok(DiscordResult {
            message_id: msg_response.id,
            channel_id,
        })
    }

    /// Post an embed to a channel by name
    pub async fn post_embed(
        &self,
        guild_id: &str,
        channel_name: &str,
        title: &str,
        description: &str,
        color: Option<u32>,
    ) -> Result<DiscordResult> {
        info!("Posting embed to Discord #{}: {}", channel_name, title);

        let channel_id = self.find_channel(guild_id, channel_name).await?;

        let url = format!("{}/channels/{}/messages", DISCORD_API, channel_id);
        let request = MessageRequest {
            content: String::new(),
            embeds: Some(vec![Embed {
                title: Some(title.to_string()),
                description: Some(description.to_string()),
                color,
            }]),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bot {}", self.bot_token))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to post embed to Discord: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Discord API error {}: {}", status, body));
        }

        let msg_response: MessageResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Discord response: {}", e))?;

        info!("Posted embed to Discord #{}", channel_name);

        Ok(DiscordResult {
            message_id: msg_response.id,
            channel_id,
        })
    }

    /// Find a channel by name in a guild
    async fn find_channel(&self, guild_id: &str, channel_name: &str) -> Result<String> {
        debug!("Looking up channel '{}' in guild {}", channel_name, guild_id);

        let url = format!("{}/guilds/{}/channels", DISCORD_API, guild_id);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bot {}", self.bot_token))
            .send()
            .await
            .map_err(|e| anyhow!("Failed to fetch channels: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Discord API error {}: {}", status, body));
        }

        let channels: Vec<Channel> = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse channels: {}", e))?;

        channels
            .iter()
            .find(|c| c.name.as_ref().map(|n| n == channel_name).unwrap_or(false))
            .map(|c| c.id.clone())
            .ok_or_else(|| anyhow!("Channel '{}' not found in guild", channel_name))
    }

    /// Get the guild ID, using override or default
    pub fn get_guild_id(&self, override_id: Option<&str>) -> Result<String> {
        override_id
            .map(|s| s.to_string())
            .or_else(|| self.default_guild_id.clone())
            .ok_or_else(|| anyhow!("No guild ID provided and no default configured"))
    }
}

// ============================================================================
// Discord API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct MessageRequest {
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    embeds: Option<Vec<Embed>>,
}

#[derive(Debug, Serialize)]
struct Embed {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct Channel {
    id: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageResponse {
    id: String,
}
