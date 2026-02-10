//! ============================================================================
//! OPERATOR-CORE: Tetsuo's Brain
//! ============================================================================
//! This crate handles all backend logic for the AgenC Operator:
//! - Solana transaction building/signing via solana-sdk
//! - Local whisper-rs for offline ASR wake word detection
//! - Policy gate for security confirmations
//! - Audio capture/playback via cpal/rodio
//! - Token-gated access control based on $TETSUO holdings
//! - Vector-based conversation memory with Qdrant
//! ============================================================================

pub mod access;
pub mod agenc_program;
pub mod auth;
pub mod db;
pub mod executor;
pub mod memory;
pub mod policy_gate;
pub mod solana_exec;
pub mod transaction_retry;
pub mod types;
#[cfg(feature = "native-audio")]
pub mod voice_local;

// Re-export main types for convenience
pub use types::*;

// Database
pub use db::{
    DbStats, DbTaskStatus, OperatorConfig as DbOperatorConfig, OperatorDb, SessionState,
    TaskRecord, TranscriptEntry, VerificationLog,
};

// Solana executor
pub use solana_exec::SolanaExecutor;

// Voice processing (only available with native audio support)
#[cfg(feature = "native-audio")]
pub use voice_local::LocalVoiceProcessor;

// Policy gate
pub use policy_gate::PolicyGate;

// Access control
pub use access::{AccessChecker, AccessGate, AccessTier, AccessTierInfo, Feature};

// Memory system
pub use memory::{
    ConversationTurn, EmbeddingService, Memory, MemoryManager, MemoryStore, MemoryType,
    UserContext,
};

// Executors
pub use executor::{
    DiscordExecutor, EmailExecutor, GitHubExecutor, GrokCodeExecutor, ImageExecutor,
    JupiterSwapExecutor, SlackExecutor, TwitterExecutor, VideoExecutor,
    // GitHub result types
    CommentResult, GistResult, IssueResult, WorkflowResult,
    // Slack types
    Block, ContextElement, MrkdwnText, PlainText, SlackResult,
};

// Transaction retry
pub use transaction_retry::{
    AsyncTransactionSender, ErrorKind, RetryConfig, SendResult, TransactionSender,
    classify_error, send_result_to_result,
};
