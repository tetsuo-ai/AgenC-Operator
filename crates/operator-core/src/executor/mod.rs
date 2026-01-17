//! ============================================================================
//! Executor Module - Action Executors for Tetsuo
//! ============================================================================
//! Contains specialized executors for different capability domains:
//! - GrokCodeExecutor: Code operations (fix, review, generate, explain)
//! - JupiterSwapExecutor: Token trading via Jupiter aggregator
//! - TwitterExecutor: Social media posting via Twitter API v2
//! - DiscordExecutor: Discord bot messaging
//! - EmailExecutor: Email sending via Resend API
//! - ImageExecutor: Image generation via Grok API
//! - SlackExecutor: Slack workspace messaging
//! - GitHubExecutor: GitHub issues, comments, workflows, gists
//! ============================================================================

mod discord;
mod email;
mod github;
mod grok_code;
mod image;
mod jupiter_swap;
mod slack;
mod twitter;

pub use discord::DiscordExecutor;
pub use email::EmailExecutor;
pub use github::{GitHubExecutor, GistResult, IssueResult, CommentResult, WorkflowResult};
pub use grok_code::GrokCodeExecutor;
pub use image::ImageExecutor;
pub use jupiter_swap::JupiterSwapExecutor;
pub use slack::{SlackExecutor, SlackResult, Block, PlainText, MrkdwnText, ContextElement};
pub use twitter::TwitterExecutor;
