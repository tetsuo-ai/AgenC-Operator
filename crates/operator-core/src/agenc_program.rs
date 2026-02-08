//! ============================================================================
//! AgenC Protocol — On-Chain Program Integration
//! ============================================================================
//! Constants, PDA derivation, account deserialization, and instruction builders
//! for the AgenC Solana coordination program.
//!
//! Program ID: EopUaCV2svxj9j4hd7KjbrWfdjkspmm2BCBe7jGpKzKZ
//!
//! Ported from the Python SDK at:
//!   https://github.com/tetsuo-ai/AgenC_Moltbook_Agent/agenc_agent/clients/solana.py
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

// System program ID — avoid deprecated solana_sdk::system_program
const SYSTEM_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("11111111111111111111111111111111");
use std::str::FromStr;

// ============================================================================
// Constants
// ============================================================================

/// AgenC protocol program ID (same on devnet and mainnet)
pub const PROGRAM_ID: &str = "EopUaCV2svxj9j4hd7KjbrWfdjkspmm2BCBe7jGpKzKZ";

/// SKR privacy cash token mint
pub const SKR_MINT: &str = "9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD";

/// Task account discriminator — first 8 bytes of SHA256("global:Task")
pub const TASK_DISCRIMINATOR: [u8; 8] = [0x4f, 0x22, 0xe5, 0x37, 0x58, 0x5a, 0x37, 0x54];

/// Offset of the status/state byte within a Task account
pub const TASK_STATUS_OFFSET: usize = 154;

/// Default protocol fee percentage
pub const DEFAULT_FEE_PERCENT: f64 = 1.0;

/// Lamports per SOL
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

pub fn program_id() -> Pubkey {
    Pubkey::from_str(PROGRAM_ID).expect("Invalid AgenC program ID")
}

pub fn skr_mint() -> Pubkey {
    Pubkey::from_str(SKR_MINT).expect("Invalid SKR mint")
}

// ============================================================================
// Task State Enum
// ============================================================================

/// On-chain task state — matches the program's enum discriminant values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnChainTaskState {
    Open = 0,
    InProgress = 1,
    PendingValidation = 2,
    Completed = 3,
    Cancelled = 4,
    Disputed = 5,
}

impl OnChainTaskState {
    pub fn from_byte(b: u8) -> Result<Self> {
        match b {
            0 => Ok(Self::Open),
            1 => Ok(Self::InProgress),
            2 => Ok(Self::PendingValidation),
            3 => Ok(Self::Completed),
            4 => Ok(Self::Cancelled),
            5 => Ok(Self::Disputed),
            _ => Err(anyhow!("Invalid task state byte: {}", b)),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::InProgress => "in_progress",
            Self::PendingValidation => "pending_validation",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Disputed => "disputed",
        }
    }
}

// ============================================================================
// On-Chain Task Account
// ============================================================================

/// Deserialized AgenC task from on-chain account data.
///
/// Account layout (311+ bytes):
///   [0..8]     discriminator
///   [8..16]    task_id (u64 LE)
///   [16..48]   creator (Pubkey, 32 bytes)
///   [48..80]   escrow_account (Pubkey, 32 bytes)
///   [80..88]   required_capabilities (u64 LE)
///   [88..120]  description_hash (32 bytes)
///   [120..152] constraint_hash (32 bytes)
///   [152..153] reward (first byte — actually at different offset, see below)
///   [154]      state (TaskState enum byte)
///
/// NOTE: The exact layout may vary. The Python SDK uses offset 154 for state,
/// and we keep that consistent here. Field offsets for reward/deadline/etc
/// are derived from the Anchor account struct ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnChainTask {
    pub task_id: u64,
    pub pda: String,
    pub creator: String,
    pub escrow_account: String,
    pub required_capabilities: u64,
    pub description_hash: [u8; 32],
    pub constraint_hash: [u8; 32],
    pub state: OnChainTaskState,
    pub reward_lamports: u64,
    pub deadline: i64,
    pub claimed_by: Option<String>,
}

impl OnChainTask {
    /// Deserialize from raw account data bytes.
    /// Returns None if the discriminator doesn't match.
    pub fn from_account_data(data: &[u8], pda: &Pubkey) -> Result<Self> {
        if data.len() < 160 {
            return Err(anyhow!("Account data too short: {} bytes", data.len()));
        }

        // Verify discriminator
        if data[0..8] != TASK_DISCRIMINATOR {
            return Err(anyhow!("Discriminator mismatch"));
        }

        // Parse fields
        let task_id = u64::from_le_bytes(data[8..16].try_into()?);
        let creator = Pubkey::try_from(&data[16..48])
            .map_err(|e| anyhow!("Invalid creator pubkey: {}", e))?;
        let escrow_account = Pubkey::try_from(&data[48..80])
            .map_err(|e| anyhow!("Invalid escrow pubkey: {}", e))?;
        let required_capabilities = u64::from_le_bytes(data[80..88].try_into()?);

        let mut description_hash = [0u8; 32];
        description_hash.copy_from_slice(&data[88..120]);

        let mut constraint_hash = [0u8; 32];
        constraint_hash.copy_from_slice(&data[120..152]);

        // State byte at offset 154
        let state = OnChainTaskState::from_byte(data[TASK_STATUS_OFFSET])?;

        // Reward: u64 LE at offset 155..163
        let reward_lamports = if data.len() >= 163 {
            u64::from_le_bytes(data[155..163].try_into().unwrap_or([0; 8]))
        } else {
            0
        };

        // Deadline: i64 LE at offset 163..171
        let deadline = if data.len() >= 171 {
            i64::from_le_bytes(data[163..171].try_into().unwrap_or([0; 8]))
        } else {
            0
        };

        // Claimed by: Option<Pubkey> at offset 171..204 (1 byte option tag + 32 bytes)
        let claimed_by = if data.len() >= 204 && data[171] == 1 {
            Pubkey::try_from(&data[172..204])
                .ok()
                .map(|pk| pk.to_string())
        } else {
            None
        };

        Ok(Self {
            task_id,
            pda: pda.to_string(),
            creator: creator.to_string(),
            escrow_account: escrow_account.to_string(),
            required_capabilities,
            description_hash,
            constraint_hash,
            state,
            reward_lamports,
            deadline,
            claimed_by,
        })
    }

    pub fn reward_sol(&self) -> f64 {
        self.reward_lamports as f64 / LAMPORTS_PER_SOL as f64
    }
}

// ============================================================================
// PDA Derivation
// ============================================================================

pub fn derive_task_pda(task_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"task", &task_id.to_le_bytes()],
        &program_id(),
    )
}

pub fn derive_claim_pda(task_pda: &Pubkey, agent: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"claim", task_pda.as_ref(), agent.as_ref()],
        &program_id(),
    )
}

pub fn derive_escrow_pda(task_pda: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"escrow", task_pda.as_ref()],
        &program_id(),
    )
}

pub fn derive_agent_pda(agent: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"agent", agent.as_ref()],
        &program_id(),
    )
}

pub fn derive_protocol_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"protocol"],
        &program_id(),
    )
}

// ============================================================================
// Instruction Discriminators
// ============================================================================

/// Compute the 8-byte Anchor instruction discriminator.
/// Format: SHA256("global:<instruction_name>")[0..8]
pub fn instruction_discriminator(name: &str) -> [u8; 8] {
    let input = format!("global:{}", name);
    let hash = Sha256::digest(input.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

// ============================================================================
// Instruction Builders
// ============================================================================

/// Build a `claim_task` instruction.
///
/// Accounts:
///   0. [writable] Task PDA
///   1. [writable] Claim PDA (derived from task + agent)
///   2. [writable] Agent PDA
///   3. [signer]   Authority (wallet)
///   4. []         System program
pub fn build_claim_task_ix(
    task_pda: &Pubkey,
    agent_pubkey: &Pubkey,
    agent_id: [u8; 32],
) -> Instruction {
    let (claim_pda, _) = derive_claim_pda(task_pda, agent_pubkey);
    let (agent_pda, _) = derive_agent_pda(agent_pubkey);

    let disc = instruction_discriminator("claim_task");

    // Data: discriminator (8) + agent_id (32) = 40 bytes
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&disc);
    data.extend_from_slice(&agent_id);

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*task_pda, false),
            AccountMeta::new(claim_pda, false),
            AccountMeta::new(agent_pda, false),
            AccountMeta::new(*agent_pubkey, true), // signer
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

/// Build a `complete_task` instruction.
///
/// Accounts:
///   0. [writable] Task PDA
///   1. [writable] Claim PDA
///   2. [writable] Escrow PDA
///   3. [writable] Worker (receives reward)
///   4. []         Protocol config PDA
///   5. [writable] Treasury
///   6. []         System program
pub fn build_complete_task_ix(
    task_pda: &Pubkey,
    agent_pubkey: &Pubkey,
    proof_hash: [u8; 32],
    result_data: Option<[u8; 64]>,
) -> Instruction {
    let (claim_pda, _) = derive_claim_pda(task_pda, agent_pubkey);
    let (escrow_pda, _) = derive_escrow_pda(task_pda);
    let (protocol_pda, _) = derive_protocol_pda();

    let disc = instruction_discriminator("complete_task");

    // Data: discriminator (8) + proof_hash (32) + result_data (64) = 104 bytes
    let mut data = Vec::with_capacity(104);
    data.extend_from_slice(&disc);
    data.extend_from_slice(&proof_hash);
    data.extend_from_slice(&result_data.unwrap_or([0u8; 64]));

    // Treasury address — this should come from protocol config in production.
    // For now use the protocol PDA as a placeholder.
    let treasury = protocol_pda;

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*task_pda, false),
            AccountMeta::new(claim_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(*agent_pubkey, true), // signer + reward recipient
            AccountMeta::new_readonly(protocol_pda, false),
            AccountMeta::new(treasury, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    }
}

// ============================================================================
// RPC Query Helpers
// ============================================================================

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_sdk::commitment_config::CommitmentConfig;

/// Fetch all tasks in a given state from the AgenC program.
pub async fn fetch_tasks_by_state(
    rpc: &RpcClient,
    state: OnChainTaskState,
    limit: usize,
) -> Result<Vec<OnChainTask>> {
    let filters = vec![
        // Filter by discriminator (first 8 bytes)
        RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
            0,
            TASK_DISCRIMINATOR.to_vec(),
        )),
        // Filter by state byte at offset 154
        RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
            TASK_STATUS_OFFSET,
            vec![state as u8],
        )),
    ];

    let config = RpcProgramAccountsConfig {
        filters: Some(filters),
        account_config: RpcAccountInfoConfig {
            commitment: Some(CommitmentConfig::confirmed()),
            ..Default::default()
        },
        ..Default::default()
    };

    let accounts = rpc
        .get_program_accounts_with_config(&program_id(), config)
        .await
        .map_err(|e| anyhow!("Failed to fetch program accounts: {}", e))?;

    let mut tasks = Vec::new();
    for (pubkey, account) in accounts.iter().take(limit) {
        match OnChainTask::from_account_data(&account.data, pubkey) {
            Ok(task) => tasks.push(task),
            Err(e) => tracing::warn!("Failed to deserialize task {}: {}", pubkey, e),
        }
    }

    // Sort by reward descending
    tasks.sort_by(|a, b| b.reward_lamports.cmp(&a.reward_lamports));

    Ok(tasks)
}

/// Fetch a single task by its ID.
pub async fn fetch_task_by_id(rpc: &RpcClient, task_id: u64) -> Result<Option<OnChainTask>> {
    let (pda, _) = derive_task_pda(task_id);

    match rpc.get_account(&pda).await {
        Ok(account) => {
            let task = OnChainTask::from_account_data(&account.data, &pda)?;
            Ok(Some(task))
        }
        Err(_) => Ok(None),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_program_id_parses() {
        let pk = program_id();
        assert_eq!(pk.to_string(), PROGRAM_ID);
    }

    #[test]
    fn test_discriminator_computation() {
        // The discriminator for "claim_task" should be deterministic
        let disc = instruction_discriminator("claim_task");
        assert_eq!(disc.len(), 8);
        // Verify it's the SHA256 of "global:claim_task" truncated to 8 bytes
        let hash = Sha256::digest(b"global:claim_task");
        assert_eq!(&disc, &hash[..8]);
    }

    #[test]
    fn test_task_pda_derivation() {
        let (pda, bump) = derive_task_pda(42);
        // PDA should be a valid pubkey
        assert_ne!(pda, Pubkey::default());
        assert!(bump <= 255);
    }

    #[test]
    fn test_task_state_roundtrip() {
        for state_byte in 0u8..=5 {
            let state = OnChainTaskState::from_byte(state_byte).unwrap();
            assert_eq!(state as u8, state_byte);
        }
        assert!(OnChainTaskState::from_byte(6).is_err());
    }
}
