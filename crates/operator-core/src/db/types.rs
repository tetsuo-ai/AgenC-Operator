// ============================================================================
// Database Types for OperatorDb (redb)
// ============================================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Status of a task in the operator pipeline
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DbTaskStatus {
    Claimed,
    InProgress,
    Completed,
    Disputed,
    Resolved,
}

/// A task record stored in the embedded database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub task_id: String,
    pub payload: Vec<u8>,
    pub status: DbTaskStatus,
    pub claimed_at: i64,
    pub completed_at: Option<i64>,
    pub on_chain_signature: Option<String>,
    pub description: Option<String>,
    pub reward_lamports: Option<u64>,
    /// SKR token reward (raw token amount)
    #[serde(default)]
    pub reward_skr_tokens: Option<u64>,
    pub creator: Option<String>,
}

/// A single transcript entry within a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

/// Session state persisted across restarts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_id: String,
    pub transcript: Vec<TranscriptEntry>,
    pub active_task_ids: Vec<String>,
    pub command_history: Vec<String>,
    pub created_at: i64,
    pub last_active: i64,
}

/// Proof-of-work log for dispute resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationLog {
    pub task_id: String,
    pub inputs: Vec<u8>,
    pub outputs: Vec<u8>,
    pub proof_hash: String,
    pub timestamp: i64,
    pub submitted: bool,
    pub submission_signature: Option<String>,
}

/// Operator configuration stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorConfig {
    pub wallet_pubkey: Option<String>,
    pub rpc_url: String,
    pub network: String,
    pub capabilities: Vec<String>,
    pub model_preferences: Option<serde_json::Value>,
}

/// Database statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub total_tasks: usize,
    pub task_counts: HashMap<String, usize>,
    pub total_sessions: usize,
    pub total_proofs: usize,
}
