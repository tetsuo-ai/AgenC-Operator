//! ============================================================================
//! Database Types - Serializable records for redb storage
//! ============================================================================

use serde::{Deserialize, Serialize};

/// Task record stored in the local database.
/// Mirrors on-chain task state with additional local metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub task_id: String,
    /// Raw task payload from chain (ABI-encoded)
    pub payload: Vec<u8>,
    pub status: DbTaskStatus,
    pub claimed_at: i64,
    pub completed_at: Option<i64>,
    /// On-chain transaction signature for this task action
    pub on_chain_signature: Option<String>,
    /// Task description (human-readable, for local display)
    pub description: Option<String>,
    /// Reward in lamports
    pub reward_lamports: Option<u64>,
    /// Creator's pubkey
    pub creator: Option<String>,
}

/// Task status in the local database.
/// Named DbTaskStatus to avoid conflict with types::TaskStatus.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DbTaskStatus {
    Claimed,
    InProgress,
    Completed,
    Disputed,
    Resolved,
}

/// Session state for the voice interface.
/// Persists across restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_id: String,
    /// Recent conversation transcript
    pub transcript: Vec<TranscriptEntry>,
    /// Active task references
    pub active_task_ids: Vec<String>,
    /// Command history
    pub command_history: Vec<String>,
    pub created_at: i64,
    pub last_active: i64,
}

/// Single transcript entry in a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    /// "user" or "assistant"
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

/// Verification log for completed tasks.
/// Submitted on-chain when disputes arise.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationLog {
    pub task_id: String,
    /// Input data (what was requested)
    pub inputs: Vec<u8>,
    /// Output data (what was produced)
    pub outputs: Vec<u8>,
    /// Cryptographic proof (hash of inputs + outputs)
    pub proof_hash: String,
    pub timestamp: i64,
    /// Whether this proof has been submitted on-chain
    pub submitted: bool,
    /// On-chain tx signature if submitted
    pub submission_signature: Option<String>,
}

/// Operator configuration stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorConfig {
    /// Operator wallet pubkey
    pub wallet_pubkey: Option<String>,
    /// RPC endpoint
    pub rpc_url: String,
    /// Network (devnet/mainnet)
    pub network: String,
    /// Registered capabilities
    pub capabilities: Vec<String>,
    /// Model preferences
    pub model_preferences: Option<serde_json::Value>,
}
