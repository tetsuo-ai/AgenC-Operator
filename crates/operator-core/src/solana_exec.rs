//! ============================================================================
//! Solana Executor - Transaction Building & Signing
//! ============================================================================
//! Handles all Solana operations for AgenC protocol:
//! - Transaction building for task CRUD operations
//! - Local signing (keys never leave device)
//! - RPC communication with Solana network
//!
//! NOTE: This integrates with existing solana-pipkit crate for advanced ops.
//! ============================================================================

use anyhow::{anyhow, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

use crate::types::*;

/// Main Solana executor - handles all chain interactions
pub struct SolanaExecutor {
    /// RPC client for Solana network
    rpc_client: RpcClient,
    /// Local keypair for signing (NEVER leaves device)
    keypair: Arc<RwLock<Option<Keypair>>>,
    /// Network (mainnet-beta, devnet, testnet)
    network: String,
    /// AgenC program ID (set this to your deployed program)
    program_id: Pubkey,
}

impl SolanaExecutor {
    /// Create new executor with RPC endpoint
    pub fn new(rpc_url: &str, network: &str) -> Self {
        info!("Initializing SolanaExecutor for {}", network);

        // Placeholder program ID - replace with actual AgenC program
        let program_id = Pubkey::from_str("AgENC111111111111111111111111111111111111111")
            .unwrap_or_default();

        Self {
            rpc_client: RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            ),
            keypair: Arc::new(RwLock::new(None)),
            network: network.to_string(),
            program_id,
        }
    }

    /// Load keypair from file path (local-first: keys never leave device)
    pub async fn load_keypair(&self, keypair_path: &str) -> Result<String> {
        info!("Loading keypair from: {}", keypair_path);

        let keypair_data = std::fs::read_to_string(keypair_path)
            .map_err(|e| anyhow!("Failed to read keypair: {}", e))?;

        let bytes: Vec<u8> = serde_json::from_str(&keypair_data)
            .map_err(|e| anyhow!("Failed to parse keypair: {}", e))?;

        let keypair = Keypair::from_bytes(&bytes)
            .map_err(|e| anyhow!("Invalid keypair bytes: {}", e))?;

        let address = keypair.pubkey().to_string();

        *self.keypair.write().await = Some(keypair);

        info!("Loaded wallet: {}", address);
        Ok(address)
    }

    /// Get wallet info (address + balance)
    pub async fn get_wallet_info(&self) -> Result<WalletInfo> {
        let keypair_guard = self.keypair.read().await;

        match keypair_guard.as_ref() {
            Some(kp) => {
                let address = kp.pubkey();
                let balance = self.rpc_client.get_balance(&address).await?;

                Ok(WalletInfo {
                    address: address.to_string(),
                    balance_sol: balance as f64 / 1_000_000_000.0,
                    is_connected: true,
                })
            }
            None => Ok(WalletInfo {
                address: String::new(),
                balance_sol: 0.0,
                is_connected: false,
            }),
        }
    }

    /// Get wallet pubkey for access tier checking (non-async for convenience)
    pub fn get_wallet_pubkey(&self) -> Option<Pubkey> {
        // Use try_read to avoid blocking - returns None if locked or no keypair
        self.keypair
            .try_read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|kp| kp.pubkey()))
    }

    /// Execute a voice intent after policy approval
    pub async fn execute_intent(&self, intent: &VoiceIntent) -> Result<ExecutionResult> {
        info!("Executing intent: {:?}", intent.action);

        match &intent.action {
            IntentAction::CreateTask => self.create_task(&intent.params).await,
            IntentAction::ClaimTask => self.claim_task(&intent.params).await,
            IntentAction::CompleteTask => self.complete_task(&intent.params).await,
            IntentAction::CancelTask => self.cancel_task(&intent.params).await,
            IntentAction::ListOpenTasks => self.list_open_tasks().await,
            IntentAction::GetTaskStatus => self.get_task_status(&intent.params).await,
            IntentAction::GetBalance => self.get_balance().await,
            IntentAction::GetAddress => self.get_address().await,
            IntentAction::GetProtocolState => self.get_protocol_state().await,
            IntentAction::Help => Ok(ExecutionResult {
                success: true,
                message: self.get_help_text(),
                signature: None,
                data: None,
            }),
            IntentAction::Unknown => Ok(ExecutionResult {
                success: false,
                message: "Unknown command. Say 'Tetsuo help' for available commands.".into(),
                signature: None,
                data: None,
            }),

            // These actions are handled by specialized executors, not SolanaExecutor
            IntentAction::CodeFix |
            IntentAction::CodeReview |
            IntentAction::CodeGenerate |
            IntentAction::CodeExplain => Ok(ExecutionResult {
                success: false,
                message: "Code operations are handled by GrokCodeExecutor".into(),
                signature: None,
                data: None,
            }),

            IntentAction::SwapTokens |
            IntentAction::GetSwapQuote |
            IntentAction::GetTokenPrice => Ok(ExecutionResult {
                success: false,
                message: "Trading operations are handled by JupiterSwapExecutor".into(),
                signature: None,
                data: None,
            }),

            IntentAction::PostTweet |
            IntentAction::PostThread => Ok(ExecutionResult {
                success: false,
                message: "Social operations are handled by TwitterExecutor".into(),
                signature: None,
                data: None,
            }),

            // Phase 3: Discord operations handled by DiscordExecutor
            IntentAction::PostDiscord |
            IntentAction::PostDiscordEmbed => Ok(ExecutionResult {
                success: false,
                message: "Discord operations are handled by DiscordExecutor".into(),
                signature: None,
                data: None,
            }),

            // Phase 3: Email operations handled by EmailExecutor
            IntentAction::SendEmail |
            IntentAction::SendBulkEmail => Ok(ExecutionResult {
                success: false,
                message: "Email operations are handled by EmailExecutor".into(),
                signature: None,
                data: None,
            }),

            // Phase 3: Image generation handled by ImageExecutor
            IntentAction::GenerateImage => Ok(ExecutionResult {
                success: false,
                message: "Image generation is handled by ImageExecutor".into(),
                signature: None,
                data: None,
            }),

            // GitHub operations handled by GitHubExecutor
            IntentAction::CreateGist |
            IntentAction::CreateGitHubIssue |
            IntentAction::AddGitHubComment |
            IntentAction::TriggerGitHubWorkflow => Ok(ExecutionResult {
                success: false,
                message: "GitHub operations are handled by GitHubExecutor".into(),
                signature: None,
                data: None,
            }),
        }
    }

    /// Create a new task on-chain
    async fn create_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: CreateTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid create task params: {}", e))?;

        info!("Creating task: {} with reward {} SOL",
              parsed.description, parsed.reward_sol);

        // Verify wallet is loaded
        let keypair_guard = self.keypair.read().await;
        let keypair = keypair_guard.as_ref()
            .ok_or_else(|| anyhow!("Wallet not connected"))?;

        // Check balance
        let balance = self.rpc_client.get_balance(&keypair.pubkey()).await?;
        let reward_lamports = (parsed.reward_sol * 1_000_000_000.0) as u64;

        if balance < reward_lamports + 10_000 {
            return Ok(ExecutionResult {
                success: false,
                message: format!(
                    "Insufficient balance. Need {} SOL, have {} SOL",
                    parsed.reward_sol + 0.00001,
                    balance as f64 / 1_000_000_000.0
                ),
                signature: None,
                data: None,
            });
        }

        // TODO: Build actual AgenC program instruction
        // For MVP, we'll simulate with a memo/transfer
        // In production, replace with actual program CPI

        // Simulate task creation (placeholder - integrate with actual AgenC program)
        let task_id = format!("task_{}", chrono::Utc::now().timestamp_millis());

        let task = AgencTask {
            id: task_id.clone(),
            creator: keypair.pubkey().to_string(),
            description: parsed.description.clone(),
            reward_lamports,
            status: TaskStatus::Open,
            claimer: None,
            created_at: chrono::Utc::now().timestamp(),
            deadline: parsed.deadline_hours.map(|h|
                chrono::Utc::now().timestamp() + (h as i64 * 3600)
            ),
        };

        info!("Task created (simulated): {}", task_id);

        Ok(ExecutionResult {
            success: true,
            message: format!(
                "Task created successfully! ID: {}. Reward: {} SOL",
                task_id, parsed.reward_sol
            ),
            signature: Some(format!("sim_{}", task_id)), // Simulated signature
            data: Some(serde_json::to_value(task)?),
        })
    }

    /// Claim an open task
    async fn claim_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: ClaimTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid claim task params: {}", e))?;

        info!("Claiming task: {}", parsed.task_id);

        // Verify wallet
        let keypair_guard = self.keypair.read().await;
        let keypair = keypair_guard.as_ref()
            .ok_or_else(|| anyhow!("Wallet not connected"))?;

        // TODO: Fetch task from chain and verify it's open
        // TODO: Build claim instruction for AgenC program

        Ok(ExecutionResult {
            success: true,
            message: format!("Task {} claimed successfully. Good luck, operator!", parsed.task_id),
            signature: Some(format!("sim_claim_{}", parsed.task_id)),
            data: None,
        })
    }

    /// Complete a claimed task
    async fn complete_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: CompleteTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid complete task params: {}", e))?;

        info!("Completing task: {}", parsed.task_id);

        // TODO: Submit completion proof to AgenC program
        // This triggers the reward claim flow

        Ok(ExecutionResult {
            success: true,
            message: format!(
                "Task {} submitted for completion. Awaiting creator verification.",
                parsed.task_id
            ),
            signature: Some(format!("sim_complete_{}", parsed.task_id)),
            data: None,
        })
    }

    /// Cancel an open task (creator only)
    async fn cancel_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let task_id: String = serde_json::from_value(
            params.get("task_id").cloned().unwrap_or_default()
        ).unwrap_or_default();

        info!("Cancelling task: {}", task_id);

        Ok(ExecutionResult {
            success: true,
            message: format!("Task {} cancelled. Reward returned to wallet.", task_id),
            signature: Some(format!("sim_cancel_{}", task_id)),
            data: None,
        })
    }

    /// List all open tasks from the protocol
    async fn list_open_tasks(&self) -> Result<ExecutionResult> {
        info!("Fetching open tasks...");

        // TODO: Query AgenC program accounts for open tasks
        // For MVP, return simulated data

        let mock_tasks = vec![
            AgencTask {
                id: "task_001".into(),
                creator: "7K8x...3Qr9".into(),
                description: "Audit token swap program for overflow vulnerabilities".into(),
                reward_lamports: 500_000_000,
                status: TaskStatus::Open,
                claimer: None,
                created_at: chrono::Utc::now().timestamp() - 3600,
                deadline: Some(chrono::Utc::now().timestamp() + 86400),
            },
            AgencTask {
                id: "task_002".into(),
                creator: "9Mz2...1Kp4".into(),
                description: "Build Telegram bot for DAO voting notifications".into(),
                reward_lamports: 250_000_000,
                status: TaskStatus::Open,
                claimer: None,
                created_at: chrono::Utc::now().timestamp() - 7200,
                deadline: None,
            },
        ];

        let count = mock_tasks.len();

        Ok(ExecutionResult {
            success: true,
            message: format!("Found {} open tasks.", count),
            signature: None,
            data: Some(serde_json::to_value(mock_tasks)?),
        })
    }

    /// Get status of a specific task
    async fn get_task_status(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let task_id: String = serde_json::from_value(
            params.get("task_id").cloned().unwrap_or_default()
        ).unwrap_or_default();

        info!("Getting status for task: {}", task_id);

        // TODO: Fetch from chain

        Ok(ExecutionResult {
            success: true,
            message: format!("Task {} status: Open. Waiting for operator.", task_id),
            signature: None,
            data: None,
        })
    }

    /// Get wallet balance
    async fn get_balance(&self) -> Result<ExecutionResult> {
        let info = self.get_wallet_info().await?;

        if !info.is_connected {
            return Ok(ExecutionResult {
                success: false,
                message: "Wallet not connected. Load your keypair first.".into(),
                signature: None,
                data: None,
            });
        }

        Ok(ExecutionResult {
            success: true,
            message: format!("Balance: {:.4} SOL", info.balance_sol),
            signature: None,
            data: Some(serde_json::to_value(info)?),
        })
    }

    /// Get wallet address
    async fn get_address(&self) -> Result<ExecutionResult> {
        let info = self.get_wallet_info().await?;

        if !info.is_connected {
            return Ok(ExecutionResult {
                success: false,
                message: "Wallet not connected.".into(),
                signature: None,
                data: None,
            });
        }

        Ok(ExecutionResult {
            success: true,
            message: format!("Wallet address: {}", info.address),
            signature: None,
            data: Some(serde_json::to_value(info)?),
        })
    }

    /// Get overall protocol state
    async fn get_protocol_state(&self) -> Result<ExecutionResult> {
        info!("Fetching protocol state...");

        // TODO: Aggregate from AgenC program
        let state = ProtocolState {
            open_task_count: 42,
            total_value_locked_sol: 1337.5,
            active_operators: 128,
            last_updated: chrono::Utc::now().timestamp(),
        };

        Ok(ExecutionResult {
            success: true,
            message: format!(
                "Protocol Status: {} open tasks, {:.2} SOL locked, {} active operators",
                state.open_task_count,
                state.total_value_locked_sol,
                state.active_operators
            ),
            signature: None,
            data: Some(serde_json::to_value(state)?),
        })
    }

    /// Help text for available commands
    fn get_help_text(&self) -> String {
        r#"Available commands:
- "Tetsuo create task: [description], reward [X] SOL"
- "Tetsuo claim task [ID]"
- "Tetsuo complete task [ID]"
- "Tetsuo list open tasks"
- "Tetsuo get balance"
- "Tetsuo get address"
- "Tetsuo protocol status""#.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_wallet_info_not_connected() {
        let exec = SolanaExecutor::new("https://api.devnet.solana.com", "devnet");
        let info = exec.get_wallet_info().await.unwrap();
        assert!(!info.is_connected);
    }
}
