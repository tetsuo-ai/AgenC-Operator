//! ============================================================================
//! Policy Gate - Security & Confirmation Logic
//! ============================================================================
//! Enforces security policies for Tetsuo operator:
//! - Read-only operations (balance, list tasks) are instant
//! - Spending operations require verbal + typed/hardware confirmation
//! - Admin operations (large transfers, key export) need hardware confirm
//!
//! The gate ensures keys never leave the device and user explicitly
//! approves all state-changing transactions.
//! ============================================================================

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::types::*;

/// Spending threshold in SOL that requires extra confirmation
const HIGH_VALUE_THRESHOLD_SOL: f64 = 1.0;

/// Maximum spend per session without hardware confirmation
const SESSION_LIMIT_SOL: f64 = 10.0;

/// Policy gate for security enforcement
pub struct PolicyGate {
    /// Current session spending (reset on app restart)
    session_spending_lamports: u64,
    /// Whether hardware wallet is connected
    hardware_wallet_connected: bool,
    /// Policy configuration
    config: PolicyConfig,
}

/// Policy configuration (can be customized by user)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyConfig {
    /// Enable voice-only confirmation for small amounts
    pub allow_voice_only_small: bool,
    /// Maximum SOL for voice-only confirmation
    pub voice_only_max_sol: f64,
    /// Require typed confirmation for all spends
    pub always_require_typed: bool,
    /// Enable hardware wallet requirement for large amounts
    pub hardware_for_large: bool,
    /// Large amount threshold in SOL
    pub large_threshold_sol: f64,
    /// Blocked actions (e.g., "export_key")
    pub blocked_actions: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            allow_voice_only_small: true,
            voice_only_max_sol: 0.1,
            always_require_typed: false,
            hardware_for_large: true,
            large_threshold_sol: HIGH_VALUE_THRESHOLD_SOL,
            blocked_actions: vec!["export_key".to_string()],
        }
    }
}

impl PolicyGate {
    /// Create new policy gate with default config
    pub fn new() -> Self {
        Self {
            session_spending_lamports: 0,
            hardware_wallet_connected: false,
            config: PolicyConfig::default(),
        }
    }

    /// Create with custom config
    pub fn with_config(config: PolicyConfig) -> Self {
        Self {
            session_spending_lamports: 0,
            hardware_wallet_connected: false,
            config,
        }
    }

    /// Connect hardware wallet (e.g., Ledger)
    pub fn set_hardware_wallet(&mut self, connected: bool) {
        self.hardware_wallet_connected = connected;
        info!("Hardware wallet connected: {}", connected);
    }

    /// Check if an intent is allowed and what confirmation it needs
    pub fn check_policy(&self, intent: &VoiceIntent) -> PolicyCheck {
        // Check if action is blocked
        let action_name = format!("{:?}", intent.action).to_lowercase();
        if self.config.blocked_actions.contains(&action_name) {
            return PolicyCheck {
                allowed: false,
                requires_confirmation: false,
                confirmation_type: ConfirmationType::None,
                reason: format!("Action '{}' is blocked by policy", action_name),
            };
        }

        // Categorize the action
        match &intent.action {
            // Read-only operations - always allowed, no confirmation
            IntentAction::ListOpenTasks |
            IntentAction::GetTaskStatus |
            IntentAction::GetBalance |
            IntentAction::GetAddress |
            IntentAction::GetProtocolState |
            IntentAction::Help |
            IntentAction::Unknown => {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: false,
                    confirmation_type: ConfirmationType::None,
                    reason: "Read-only operation".into(),
                }
            }

            // Task creation - requires confirmation based on amount
            IntentAction::CreateTask => {
                self.check_spending_action(intent, "create task")
            }

            // Task claim - low risk, verbal confirmation only
            IntentAction::ClaimTask => {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: true,
                    confirmation_type: ConfirmationType::Verbal,
                    reason: "Claiming task requires verbal confirmation".into(),
                }
            }

            // Task completion - low risk
            IntentAction::CompleteTask => {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: true,
                    confirmation_type: ConfirmationType::Verbal,
                    reason: "Completing task requires verbal confirmation".into(),
                }
            }

            // Task cancellation - returns funds, medium risk
            IntentAction::CancelTask => {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: true,
                    confirmation_type: ConfirmationType::Typed,
                    reason: "Cancelling task requires typed confirmation".into(),
                }
            }
        }
    }

    /// Check policy for spending actions
    fn check_spending_action(&self, intent: &VoiceIntent, action_name: &str) -> PolicyCheck {
        // Try to extract SOL amount from params
        let amount_sol = self.extract_sol_amount(&intent.params);

        // Check session limit
        let new_session_total = self.session_spending_lamports +
            (amount_sol * 1_000_000_000.0) as u64;
        let session_total_sol = new_session_total as f64 / 1_000_000_000.0;

        if session_total_sol > SESSION_LIMIT_SOL && !self.hardware_wallet_connected {
            return PolicyCheck {
                allowed: false,
                requires_confirmation: true,
                confirmation_type: ConfirmationType::Hardware,
                reason: format!(
                    "Session limit ({} SOL) exceeded. Connect hardware wallet.",
                    SESSION_LIMIT_SOL
                ),
            };
        }

        // Determine confirmation type based on amount
        if amount_sol <= self.config.voice_only_max_sol && self.config.allow_voice_only_small {
            PolicyCheck {
                allowed: true,
                requires_confirmation: true,
                confirmation_type: ConfirmationType::Verbal,
                reason: format!("{} ({} SOL) - voice confirmation", action_name, amount_sol),
            }
        } else if amount_sol > self.config.large_threshold_sol && self.config.hardware_for_large {
            if self.hardware_wallet_connected {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: true,
                    confirmation_type: ConfirmationType::Hardware,
                    reason: format!(
                        "{} ({} SOL) - hardware confirmation required",
                        action_name, amount_sol
                    ),
                }
            } else {
                PolicyCheck {
                    allowed: true,
                    requires_confirmation: true,
                    confirmation_type: ConfirmationType::Typed,
                    reason: format!(
                        "{} ({} SOL) - typed confirmation (connect hardware for large txs)",
                        action_name, amount_sol
                    ),
                }
            }
        } else {
            PolicyCheck {
                allowed: true,
                requires_confirmation: true,
                confirmation_type: if self.config.always_require_typed {
                    ConfirmationType::Typed
                } else {
                    ConfirmationType::Verbal
                },
                reason: format!("{} ({} SOL)", action_name, amount_sol),
            }
        }
    }

    /// Extract SOL amount from intent params
    fn extract_sol_amount(&self, params: &serde_json::Value) -> f64 {
        // Try common field names
        if let Some(sol) = params.get("reward_sol").and_then(|v| v.as_f64()) {
            return sol;
        }
        if let Some(sol) = params.get("amount_sol").and_then(|v| v.as_f64()) {
            return sol;
        }
        if let Some(lamports) = params.get("lamports").and_then(|v| v.as_u64()) {
            return lamports as f64 / 1_000_000_000.0;
        }

        0.0 // Default to 0 if no amount found
    }

    /// Record spending after successful transaction
    pub fn record_spending(&mut self, lamports: u64) {
        self.session_spending_lamports += lamports;
        info!(
            "Session spending: {} SOL",
            self.session_spending_lamports as f64 / 1_000_000_000.0
        );
    }

    /// Get current session spending
    pub fn session_spending_sol(&self) -> f64 {
        self.session_spending_lamports as f64 / 1_000_000_000.0
    }

    /// Reset session (e.g., on timeout or user request)
    pub fn reset_session(&mut self) {
        self.session_spending_lamports = 0;
        info!("Session spending reset");
    }

    /// Get current policy config
    pub fn config(&self) -> &PolicyConfig {
        &self.config
    }

    /// Update policy config
    pub fn update_config(&mut self, config: PolicyConfig) {
        warn!("Policy config updated");
        self.config = config;
    }
}

impl Default for PolicyGate {
    fn default() -> Self {
        Self::new()
    }
}

/// Verbal confirmation helper
pub struct VerbalConfirmation;

impl VerbalConfirmation {
    /// Phrases that confirm an action
    const CONFIRM_PHRASES: &'static [&'static str] = &[
        "yes", "confirm", "do it", "proceed", "execute", "approved", "go ahead"
    ];

    /// Phrases that cancel an action
    const CANCEL_PHRASES: &'static [&'static str] = &[
        "no", "cancel", "stop", "abort", "nevermind", "don't"
    ];

    /// Check if response is a confirmation
    pub fn is_confirmed(response: &str) -> bool {
        let lower = response.to_lowercase();
        Self::CONFIRM_PHRASES.iter().any(|p| lower.contains(p))
    }

    /// Check if response is a cancellation
    pub fn is_cancelled(response: &str) -> bool {
        let lower = response.to_lowercase();
        Self::CANCEL_PHRASES.iter().any(|p| lower.contains(p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_only_allowed() {
        let gate = PolicyGate::new();
        let intent = VoiceIntent {
            action: IntentAction::GetBalance,
            params: serde_json::json!({}),
            raw_transcript: None,
        };

        let check = gate.check_policy(&intent);
        assert!(check.allowed);
        assert!(!check.requires_confirmation);
    }

    #[test]
    fn test_spending_requires_confirmation() {
        let gate = PolicyGate::new();
        let intent = VoiceIntent {
            action: IntentAction::CreateTask,
            params: serde_json::json!({ "reward_sol": 0.5 }),
            raw_transcript: None,
        };

        let check = gate.check_policy(&intent);
        assert!(check.allowed);
        assert!(check.requires_confirmation);
    }

    #[test]
    fn test_verbal_confirmation() {
        assert!(VerbalConfirmation::is_confirmed("Yes, do it"));
        assert!(VerbalConfirmation::is_cancelled("No, cancel that"));
        assert!(!VerbalConfirmation::is_confirmed("maybe"));
    }
}
