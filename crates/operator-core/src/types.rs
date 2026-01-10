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

    // System
    Help,
    Unknown,
}

/// Parameters for creating a new task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskParams {
    pub description: String,
    pub reward_sol: f64,
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
