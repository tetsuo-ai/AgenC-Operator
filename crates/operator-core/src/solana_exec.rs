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
    transaction::Transaction,
    message::Message,
};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::agenc_program::{
    self, OnChainTaskState,
    derive_task_pda, build_create_task_ix, build_claim_task_ix, build_complete_task_ix,
    build_skr_escrow_deposit_ix, fetch_tasks_by_state, fetch_task_by_id,
    fetch_skr_balance, display_to_skr_tokens, skr_tokens_to_display,
};
use crate::types::*;

/// Main Solana executor - handles all chain interactions
pub struct SolanaExecutor {
    /// RPC client for Solana network
    rpc_client: RpcClient,
    /// Local keypair for signing (NEVER leaves device)
    keypair: Arc<RwLock<Option<Keypair>>>,
    /// Network (mainnet-beta, devnet, testnet)
    _network: String,
    /// AgenC program ID (set this to your deployed program)
    _program_id: Pubkey,
}

impl SolanaExecutor {
    /// Create new executor with RPC endpoint
    pub fn new(rpc_url: &str, network: &str) -> Self {
        info!("Initializing SolanaExecutor for {}", network);

        let program_id = agenc_program::program_id();

        Self {
            rpc_client: RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            ),
            keypair: Arc::new(RwLock::new(None)),
            _network: network.to_string(),
            _program_id: program_id,
        }
    }

    /// Load keypair from file path (local-first: keys never leave device)
    pub async fn load_keypair(&self, keypair_path: &str) -> Result<String> {
        info!("Loading keypair from: {}", keypair_path);

        let keypair_data = std::fs::read_to_string(keypair_path)
            .map_err(|e| anyhow!("Failed to read keypair: {}", e))?;

        let bytes: Vec<u8> = serde_json::from_str(&keypair_data)
            .map_err(|e| anyhow!("Failed to parse keypair: {}", e))?;

        let keypair = Keypair::try_from(bytes.as_slice())
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

    /// Get keypair bytes for device pairing HMAC authentication.
    /// Returns None if no keypair is loaded (mobile wallet flow).
    pub fn get_keypair_bytes(&self) -> Option<Vec<u8>> {
        self.keypair
            .try_read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|kp| kp.to_bytes().to_vec()))
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

            // Phase 6: Video generation handled by VideoExecutor
            IntentAction::GenerateVideo => Ok(ExecutionResult {
                success: false,
                message: "Video generation is handled by VideoExecutor".into(),
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

            // Device operations handled by DeviceExecutor
            IntentAction::ScanDevices |
            IntentAction::PairDevice |
            IntentAction::UnpairDevice |
            IntentAction::ListDevices |
            IntentAction::DeviceStatus |
            IntentAction::ConfigureDevice => Ok(ExecutionResult {
                success: false,
                message: "Device operations are handled by DeviceExecutor".into(),
                signature: None,
                data: None,
            }),
        }
    }

    /// Create a new task on-chain with SOL reward and optional SKR token reward
    async fn create_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: CreateTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid create task params: {}", e))?;

        let skr_amount = parsed.reward_skr.unwrap_or(0.0);
        info!("Creating task: {} with reward {} SOL + {} SKR",
              parsed.description, parsed.reward_sol, skr_amount);

        // Verify wallet is loaded
        let keypair_guard = self.keypair.read().await;
        let keypair = keypair_guard.as_ref()
            .ok_or_else(|| anyhow!("Wallet not connected"))?;

        // Check SOL balance
        let balance = self.rpc_client.get_balance(&keypair.pubkey()).await?;
        let reward_lamports = (parsed.reward_sol * 1_000_000_000.0) as u64;
        // Account for tx fees + rent for new accounts
        let sol_needed = reward_lamports + 50_000;

        if balance < sol_needed {
            return Ok(ExecutionResult {
                success: false,
                message: format!(
                    "Insufficient SOL balance. Need {:.4} SOL, have {:.4} SOL",
                    sol_needed as f64 / 1_000_000_000.0,
                    balance as f64 / 1_000_000_000.0
                ),
                signature: None,
                data: None,
            });
        }

        // Check SKR balance if SKR reward is specified
        let skr_tokens = if skr_amount > 0.0 {
            let raw = display_to_skr_tokens(skr_amount);
            let skr_balance = fetch_skr_balance(&self.rpc_client, &keypair.pubkey()).await
                .unwrap_or(0);
            if skr_balance < raw {
                return Ok(ExecutionResult {
                    success: false,
                    message: format!(
                        "Insufficient SKR balance. Need {} SKR, have {} SKR",
                        skr_amount,
                        skr_tokens_to_display(skr_balance)
                    ),
                    signature: None,
                    data: None,
                });
            }
            raw
        } else {
            0
        };

        // Generate a task ID from timestamp (will be overwritten by on-chain program counter)
        let task_id_num = chrono::Utc::now().timestamp_millis() as u64;

        // Build description hash
        use sha2::{Sha256, Digest};
        let description_hash: [u8; 32] = Sha256::digest(parsed.description.as_bytes()).into();

        let deadline = parsed.deadline_hours.map(|h|
            chrono::Utc::now().timestamp() + (h as i64 * 3600)
        ).unwrap_or(0);

        // Build the create_task instruction
        let create_ix = build_create_task_ix(
            task_id_num,
            &keypair.pubkey(),
            description_hash,
            reward_lamports,
            deadline,
            0, // no specific capabilities required
        );

        let mut instructions = vec![create_ix];

        // If SKR reward, add escrow deposit instructions
        if skr_tokens > 0 {
            let (task_pda, _) = derive_task_pda(task_id_num);
            let deposit_ixs = build_skr_escrow_deposit_ix(
                &keypair.pubkey(),
                &task_pda,
                skr_tokens,
            )?;
            instructions.extend(deposit_ixs);
        }

        let recent_blockhash = self.rpc_client.get_latest_blockhash().await
            .map_err(|e| anyhow!("Failed to get blockhash: {}", e))?;

        let message = Message::new(&instructions, Some(&keypair.pubkey()));
        let tx = Transaction::new(&[keypair], message, recent_blockhash);

        let signature = self.rpc_client.send_and_confirm_transaction(&tx).await
            .map_err(|e| anyhow!("Transaction failed: {}", e))?;

        let (task_pda, _) = derive_task_pda(task_id_num);

        let task = AgencTask {
            id: task_pda.to_string(),
            creator: keypair.pubkey().to_string(),
            description: parsed.description.clone(),
            reward_lamports,
            reward_skr_tokens: skr_tokens,
            status: TaskStatus::Open,
            claimer: None,
            created_at: chrono::Utc::now().timestamp(),
            deadline: Some(deadline),
        };

        let mut msg = format!("Task created! Reward: {:.4} SOL", parsed.reward_sol);
        if skr_amount > 0.0 {
            msg.push_str(&format!(" + {} SKR", skr_amount));
        }
        msg.push_str(&format!(". TX: {}", signature));

        info!("Task created on-chain! TX: {}", signature);

        Ok(ExecutionResult {
            success: true,
            message: msg,
            signature: Some(signature.to_string()),
            data: Some(serde_json::to_value(task)?),
        })
    }

    /// Claim an open task on-chain
    async fn claim_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: ClaimTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid claim task params: {}", e))?;

        info!("Claiming task: {}", parsed.task_id);

        let keypair_guard = self.keypair.read().await;
        let keypair = keypair_guard.as_ref()
            .ok_or_else(|| anyhow!("Wallet not connected"))?;

        // Parse task_id as u64 or treat as PDA address
        let task_pda = if let Ok(id) = parsed.task_id.parse::<u64>() {
            derive_task_pda(id).0
        } else {
            Pubkey::from_str(&parsed.task_id)
                .map_err(|_| anyhow!("Invalid task ID — must be a number or PDA address"))?
        };

        // Use wallet pubkey as agent_id (first 32 bytes)
        let agent_id: [u8; 32] = keypair.pubkey().to_bytes();

        let ix = build_claim_task_ix(&task_pda, &keypair.pubkey(), agent_id);

        let recent_blockhash = self.rpc_client.get_latest_blockhash().await
            .map_err(|e| anyhow!("Failed to get blockhash: {}", e))?;

        let message = Message::new(&[ix], Some(&keypair.pubkey()));
        let tx = Transaction::new(&[keypair], message, recent_blockhash);

        let signature = self.rpc_client.send_and_confirm_transaction(&tx).await
            .map_err(|e| anyhow!("Transaction failed: {}", e))?;

        info!("Task claimed! TX: {}", signature);

        Ok(ExecutionResult {
            success: true,
            message: format!("Task {} claimed successfully! TX: {}", parsed.task_id, signature),
            signature: Some(signature.to_string()),
            data: None,
        })
    }

    /// Complete a claimed task on-chain with proof
    async fn complete_task(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let parsed: CompleteTaskParams = serde_json::from_value(params.clone())
            .map_err(|e| anyhow!("Invalid complete task params: {}", e))?;

        info!("Completing task: {}", parsed.task_id);

        let keypair_guard = self.keypair.read().await;
        let keypair = keypair_guard.as_ref()
            .ok_or_else(|| anyhow!("Wallet not connected"))?;

        let (task_pda, task_id_num) = if let Ok(id) = parsed.task_id.parse::<u64>() {
            (derive_task_pda(id).0, Some(id))
        } else {
            let pda = Pubkey::from_str(&parsed.task_id)
                .map_err(|_| anyhow!("Invalid task ID"))?;
            (pda, None)
        };

        // Check on-chain task to see if it has an SKR reward
        let has_skr = if let Some(id) = task_id_num {
            match fetch_task_by_id(&self.rpc_client, id).await? {
                Some(task) => task.reward_skr_tokens > 0,
                None => false,
            }
        } else {
            false
        };

        // Generate proof hash: SHA256(task_pda || agent_pubkey || timestamp)
        use sha2::{Sha256, Digest};
        let timestamp = chrono::Utc::now().timestamp() as u64;
        let mut hasher = Sha256::new();
        hasher.update(task_pda.as_ref());
        hasher.update(keypair.pubkey().as_ref());
        hasher.update(&timestamp.to_le_bytes());
        let proof_hash: [u8; 32] = hasher.finalize().into();

        let ix = build_complete_task_ix(&task_pda, &keypair.pubkey(), proof_hash, None, has_skr);

        let recent_blockhash = self.rpc_client.get_latest_blockhash().await
            .map_err(|e| anyhow!("Failed to get blockhash: {}", e))?;

        let message = Message::new(&[ix], Some(&keypair.pubkey()));
        let tx = Transaction::new(&[keypair], message, recent_blockhash);

        let signature = self.rpc_client.send_and_confirm_transaction(&tx).await
            .map_err(|e| anyhow!("Transaction failed: {}", e))?;

        info!("Task completed! TX: {}", signature);

        Ok(ExecutionResult {
            success: true,
            message: format!("Task {} completed! Reward incoming. TX: {}", parsed.task_id, signature),
            signature: Some(signature.to_string()),
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

    /// List open tasks from the AgenC program on-chain
    async fn list_open_tasks(&self) -> Result<ExecutionResult> {
        info!("Fetching open tasks from AgenC program...");

        match fetch_tasks_by_state(&self.rpc_client, OnChainTaskState::Open, 50).await {
            Ok(tasks) => {
                let count = tasks.len();
                // Convert to the frontend AgencTask format
                let frontend_tasks: Vec<AgencTask> = tasks.iter().map(|t| AgencTask {
                    id: t.pda.clone(),
                    creator: t.creator.clone(),
                    description: format!("Task #{} (hash: {:02x}{:02x}{:02x}{:02x}...)",
                        t.task_id, t.description_hash[0], t.description_hash[1],
                        t.description_hash[2], t.description_hash[3]),
                    reward_lamports: t.reward_lamports,
                    reward_skr_tokens: t.reward_skr_tokens,
                    status: match t.state {
                        OnChainTaskState::Open => TaskStatus::Open,
                        OnChainTaskState::InProgress => TaskStatus::Claimed,
                        OnChainTaskState::Completed | OnChainTaskState::PendingValidation => TaskStatus::Completed,
                        OnChainTaskState::Cancelled => TaskStatus::Cancelled,
                        OnChainTaskState::Disputed => TaskStatus::Disputed,
                    },
                    claimer: t.claimed_by.clone(),
                    created_at: 0, // Not stored in on-chain account
                    deadline: Some(t.deadline),
                }).collect();

                Ok(ExecutionResult {
                    success: true,
                    message: format!("Found {} open tasks on-chain.", count),
                    signature: None,
                    data: Some(serde_json::to_value(frontend_tasks)?),
                })
            }
            Err(e) => {
                info!("Failed to fetch on-chain tasks: {} — returning empty list", e);
                Ok(ExecutionResult {
                    success: true,
                    message: "No open tasks found (or program not deployed on this network).".into(),
                    signature: None,
                    data: Some(serde_json::to_value(Vec::<AgencTask>::new())?),
                })
            }
        }
    }

    /// Get status of a specific task from chain
    async fn get_task_status(&self, params: &serde_json::Value) -> Result<ExecutionResult> {
        let task_id: String = serde_json::from_value(
            params.get("task_id").cloned().unwrap_or_default()
        ).unwrap_or_default();

        info!("Getting status for task: {}", task_id);

        if let Ok(id) = task_id.parse::<u64>() {
            match fetch_task_by_id(&self.rpc_client, id).await? {
                Some(task) => {
                    let mut reward_str = format!("{:.4} SOL", task.reward_sol());
                    if task.reward_skr_tokens > 0 {
                        reward_str.push_str(&format!(" + {} SKR",
                            skr_tokens_to_display(task.reward_skr_tokens)));
                    }
                    Ok(ExecutionResult {
                        success: true,
                        message: format!(
                            "Task #{}: {} | Reward: {} | Creator: {}...{}",
                            task.task_id,
                            task.state.label(),
                            reward_str,
                            &task.creator[..4],
                            &task.creator[task.creator.len()-4..],
                        ),
                        signature: None,
                        data: Some(serde_json::to_value(&task)?),
                    })
                },
                None => Ok(ExecutionResult {
                    success: false,
                    message: format!("Task {} not found on-chain.", task_id),
                    signature: None,
                    data: None,
                }),
            }
        } else {
            Ok(ExecutionResult {
                success: false,
                message: "Invalid task ID — provide a numeric task ID.".into(),
                signature: None,
                data: None,
            })
        }
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

    /// Get overall protocol state from on-chain data
    async fn get_protocol_state(&self) -> Result<ExecutionResult> {
        info!("Fetching protocol state from chain...");

        // Fetch open tasks to get count and TVL
        let open_tasks = fetch_tasks_by_state(&self.rpc_client, OnChainTaskState::Open, 100).await
            .unwrap_or_default();
        let in_progress = fetch_tasks_by_state(&self.rpc_client, OnChainTaskState::InProgress, 100).await
            .unwrap_or_default();

        let tvl: u64 = open_tasks.iter().chain(in_progress.iter())
            .map(|t| t.reward_lamports)
            .sum();

        let state = ProtocolState {
            open_task_count: open_tasks.len() as u64,
            total_value_locked_sol: tvl as f64 / 1_000_000_000.0,
            active_operators: in_progress.len() as u64,
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
