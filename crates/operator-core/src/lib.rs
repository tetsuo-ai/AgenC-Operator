//! ============================================================================
//! OPERATOR-CORE: Tetsuo's Brain
//! ============================================================================
//! This crate handles all backend logic for the AgenC Operator:
//! - Solana transaction building/signing via solana-sdk
//! - Local whisper-rs for offline ASR wake word detection
//! - Policy gate for security confirmations
//! - Audio capture/playback via cpal/rodio
//! ============================================================================

pub mod solana_exec;
pub mod voice_local;
pub mod policy_gate;
pub mod types;

// Re-export main types for convenience
pub use types::*;
pub use solana_exec::SolanaExecutor;
pub use voice_local::LocalVoiceProcessor;
pub use policy_gate::PolicyGate;
