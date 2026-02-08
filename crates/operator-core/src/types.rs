//! ============================================================================
//! Core Types for Tetsuo Operator
//! ============================================================================
//! Defines all data structures for voice commands, protocol state, and tasks.
//! These types are serialized to JSON for IPC with the TypeScript frontend.
//! ============================================================================

use serde::{Deserialize, Serialize};

/// Intent parsed from voice command by Grok
/// Example: "Tetsuo create task: audit program X, reward 0.5 SOL"
/// -> { action: "create_task", params: { description: "audit program X", reward_sol: 0.5 } }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceIntent {
    pub action: IntentAction,
    pub params: serde_json::Value,
    /// Raw transcript for logging/display
    pub raw_transcript: Option<String>,
}

/// Supported intent actions for AgenC protocol
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IntentAction {
    // Task Management
    CreateTask,
    ClaimTask,
    CompleteTask,
    CancelTask,
    ListOpenTasks,
    GetTaskStatus,

    // Wallet/Account
    GetBalance,
    GetAddress,

    // Protocol Status
    GetProtocolState,

    // Code Operations (Pro tier)
    CodeFix,
    CodeReview,
    CodeGenerate,
    CodeExplain,

    // Trading Operations (Basic tier)
    SwapTokens,
    GetSwapQuote,
    GetTokenPrice,

    // Social Operations (Pro tier)
    PostTweet,
    PostThread,

    // Discord Operations (Pro tier)
    PostDiscord,
    PostDiscordEmbed,

    // Email Operations (Pro tier)
    SendEmail,
    SendBulkEmail,

    // Image Generation (Pro tier)
    GenerateImage,

    // GitHub Operations (Pro tier)
    CreateGist,
    CreateGitHubIssue,
    AddGitHubComment,
    TriggerGitHubWorkflow,

    // System
    Help,
    Unknown,
}

impl IntentAction {
    /// Get the Feature required for this action (for access tier gating)
    /// Returns None for actions that don't require feature gating (blockchain ops use policy gate)
    pub fn required_feature(&self) -> Option<crate::access::Feature> {
        use crate::access::Feature;
        match self {
            // Code operations - Pro tier
            IntentAction::CodeFix
            | IntentAction::CodeReview
            | IntentAction::CodeGenerate
            | IntentAction::CodeExplain
            | IntentAction::CreateGist
            | IntentAction::CreateGitHubIssue
            | IntentAction::AddGitHubComment
            | IntentAction::TriggerGitHubWorkflow => Some(Feature::Code),

            // Trading - Basic tier
            IntentAction::SwapTokens
            | IntentAction::GetSwapQuote
            | IntentAction::GetTokenPrice => Some(Feature::Trading),

            // Social - Pro tier (Twitter + Discord)
            IntentAction::PostTweet
            | IntentAction::PostThread
            | IntentAction::PostDiscord
            | IntentAction::PostDiscordEmbed => Some(Feature::Social),

            // Email - Pro tier
            IntentAction::SendEmail | IntentAction::SendBulkEmail => Some(Feature::Email),

            // Image generation - Pro tier
            IntentAction::GenerateImage => Some(Feature::ImageGen),

            // Blockchain operations - no feature gating (policy gate handles these)
            _ => None,
        }
    }
}

/// Parameters for creating a new task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskParams {
    pub description: String,
    pub reward_sol: f64,
    /// Optional SKR token reward (in display units, e.g. 100.0 = 100 SKR)
    #[serde(default)]
    pub reward_skr: Option<f64>,
    #[serde(default)]
    pub deadline_hours: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Parameters for claiming a task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimTaskParams {
    pub task_id: String,
}

/// Parameters for completing a task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteTaskParams {
    pub task_id: String,
    pub proof_url: Option<String>,
    pub notes: Option<String>,
}

/// Represents an AgenC task on-chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgencTask {
    pub id: String,
    pub creator: String,
    pub description: String,
    pub reward_lamports: u64,
    /// SKR token reward (raw token amount, 0 if none)
    #[serde(default)]
    pub reward_skr_tokens: u64,
    pub status: TaskStatus,
    pub claimer: Option<String>,
    pub created_at: i64,
    pub deadline: Option<i64>,
}

impl AgencTask {
    /// Convert lamports to SOL for display
    pub fn reward_sol(&self) -> f64 {
        self.reward_lamports as f64 / 1_000_000_000.0
    }

    /// Convert raw SKR tokens to display units
    pub fn reward_skr_display(&self) -> f64 {
        self.reward_skr_tokens as f64 / 1_000_000_000.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Open,
    Claimed,
    Completed,
    Cancelled,
    Disputed,
}

/// Protocol state snapshot for HUD display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolState {
    pub open_task_count: u64,
    pub total_value_locked_sol: f64,
    pub active_operators: u64,
    pub last_updated: i64,
}

/// Result of executing an intent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub message: String,
    /// Transaction signature if applicable
    pub signature: Option<String>,
    /// Updated data (task, balance, etc.)
    pub data: Option<serde_json::Value>,
}

/// Voice state for UI synchronization
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VoiceState {
    Idle,
    Listening,
    Processing,
    Speaking,
    Error,
}

/// Wallet info for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: String,
    pub balance_sol: f64,
    pub is_connected: bool,
}

/// Policy check result - determines if action needs confirmation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCheck {
    pub allowed: bool,
    pub requires_confirmation: bool,
    pub confirmation_type: ConfirmationType,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationType {
    None,
    Verbal,
    Typed,
    Hardware,
}

/// Error types for the operator
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
pub enum OperatorError {
    #[error("Wallet not connected")]
    WalletNotConnected,

    #[error("Insufficient balance: need {needed} SOL, have {available} SOL")]
    InsufficientBalance { needed: f64, available: f64 },

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Policy denied: {0}")]
    PolicyDenied(String),

    #[error("Transaction failed: {0}")]
    TransactionFailed(String),

    #[error("Voice processing error: {0}")]
    VoiceError(String),

    #[error("Network error: {0}")]
    NetworkError(String),
}

// ============================================================================
// Code Operation Types
// ============================================================================

/// Parameters for code fix operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeFixParams {
    pub file_path: String,
    pub issue_description: String,
    #[serde(default)]
    pub auto_apply: bool,
}

/// Parameters for code review operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeReviewParams {
    pub file_path: String,
}

/// Parameters for code generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeGenerateParams {
    pub description: String,
    pub language: String,
    #[serde(default)]
    pub output_path: Option<String>,
}

/// Parameters for code explanation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeExplainParams {
    pub file_path: String,
}

/// Result from code operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeResult {
    pub code: Option<String>,
    pub explanation: Option<String>,
    pub suggestions: Vec<String>,
}

// ============================================================================
// Trading/Swap Types
// ============================================================================

/// Parameters for token swap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapParams {
    pub input_mint: String,
    pub output_mint: String,
    /// Amount in smallest denomination (lamports for SOL)
    pub amount: u64,
    /// Slippage tolerance in basis points (100 = 1%)
    #[serde(default = "default_slippage")]
    pub slippage_bps: u16,
}

fn default_slippage() -> u16 {
    50 // 0.5% default
}

/// Quote response from Jupiter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapQuote {
    pub in_amount: String,
    pub out_amount: String,
    pub price_impact_pct: String,
    pub other_amount_threshold: String,
    pub swap_mode: String,
}

/// Token price info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPrice {
    pub mint: String,
    pub price_usd: f64,
}

// ============================================================================
// Twitter/Social Types
// ============================================================================

/// Parameters for posting a tweet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TweetParams {
    pub text: String,
    #[serde(default)]
    pub reply_to_id: Option<String>,
}

/// Parameters for posting a thread
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadParams {
    pub tweets: Vec<String>,
}

/// Result from posting a tweet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TweetResult {
    pub tweet_id: String,
    pub url: String,
}

// ============================================================================
// Discord Types
// ============================================================================

/// Parameters for posting to Discord
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordMessageParams {
    pub channel_name: String,
    pub content: String,
    #[serde(default)]
    pub server_id: Option<String>,
}

/// Parameters for posting an embed to Discord
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordEmbedParams {
    pub channel_name: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub color: Option<u32>,
    #[serde(default)]
    pub server_id: Option<String>,
}

/// Result from Discord operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordResult {
    pub message_id: String,
    pub channel_id: String,
}

// ============================================================================
// Email Types
// ============================================================================

/// Parameters for sending a single email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailParams {
    pub to: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub html: bool,
}

/// Parameters for sending bulk emails
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkEmailParams {
    pub recipients: Vec<String>,
    pub subject: String,
    pub body: String,
}

/// Result from email operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailResult {
    pub id: String,
}

/// Result from bulk email operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkEmailResult {
    pub success: u32,
    pub failed: u32,
}

// ============================================================================
// Image Generation Types
// ============================================================================

/// Parameters for generating an image
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenParams {
    pub prompt: String,
    #[serde(default)]
    pub save_path: Option<String>,
}

/// Result from image generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenResult {
    pub path: String,
    /// Base64-encoded PNG image data for inline display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b64_data: Option<String>,
}

// ============================================================================
// GitHub Types
// ============================================================================

/// Parameters for creating a gist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGistParams {
    pub description: String,
    pub filename: String,
    pub content: String,
    #[serde(default)]
    pub public: bool,
}

/// Parameters for creating a GitHub issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGitHubIssueParams {
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
}

/// Parameters for adding a comment to an issue/PR
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddGitHubCommentParams {
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    pub issue_number: u64,
    pub body: String,
}

/// Parameters for triggering a workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerGitHubWorkflowParams {
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    pub workflow_id: String,
    pub ref_name: String,
    #[serde(default)]
    pub inputs: Option<serde_json::Value>,
}
