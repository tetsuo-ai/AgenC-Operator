//! ============================================================================
//! TETSUO - AgenC Operator :: Tauri Backend (Async-First)
//! ============================================================================
//! Non-blocking IPC commands using tokio::spawn for all chain operations.
//! Ensures voice pipeline and HUD updates never stall waiting for RPC calls.
//!
//! Pattern: Clone Arc -> tokio::spawn -> JoinHandle -> await result
//! ============================================================================

use operator_core::{
    AgencTask, ExecutionResult, PolicyCheck, PolicyGate, ProtocolState, SolanaExecutor,
    VoiceIntent, VoiceState, WalletInfo,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use tracing::{info, error, debug};

// ============================================================================
// Application State (Thread-Safe)
// ============================================================================

/// Shared application state - all fields wrapped in Arc<RwLock<T>> for safe
/// concurrent access from multiple tokio tasks
pub struct AppState {
    pub executor: Arc<RwLock<SolanaExecutor>>,
    pub policy: Arc<RwLock<PolicyGate>>,
    pub voice_state: Arc<RwLock<VoiceState>>,
    pub config: Arc<RwLock<AppConfig>>,
}

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub rpc_url: String,
    pub network: String,
    pub whisper_model_path: Option<String>,
    pub grok_api_key: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            rpc_url: "https://api.devnet.solana.com".to_string(),
            network: "devnet".to_string(),
            whisper_model_path: None,
            grok_api_key: None,
        }
    }
}

// ============================================================================
// Async Task Result Type
// ============================================================================

/// Wrapper for async task results to handle spawn errors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> AsyncResult<T> {
    fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }

    fn err(msg: impl Into<String>) -> Self {
        Self { success: false, data: None, error: Some(msg.into()) }
    }
}

// ============================================================================
// Tauri Commands - Wallet Operations (Non-Blocking)
// ============================================================================

/// Load wallet keypair from file path
/// Spawns async task - keys never leave device
#[tauri::command]
async fn load_wallet(
    state: State<'_, AppState>,
    keypair_path: String,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] load_wallet called: {}", keypair_path);

    // Clone Arc for the spawned task
    let executor = Arc::clone(&state.executor);
    let path = keypair_path.clone();

    // Spawn non-blocking task
    let handle = tokio::spawn(async move {
        let exec = executor.read().await;
        exec.load_keypair(&path).await
    });

    // Await the spawned task (non-blocking to other operations)
    match handle.await {
        Ok(Ok(address)) => {
            info!("[IPC] Wallet loaded: {}", address);
            Ok(AsyncResult::ok(address))
        }
        Ok(Err(e)) => {
            error!("[IPC] load_wallet error: {}", e);
            Ok(AsyncResult::err(e.to_string()))
        }
        Err(e) => {
            error!("[IPC] load_wallet task panic: {}", e);
            Ok(AsyncResult::err(format!("Task failed: {}", e)))
        }
    }
}

/// Get wallet information - non-blocking chain query
#[tauri::command]
async fn get_wallet_info(state: State<'_, AppState>) -> Result<AsyncResult<WalletInfo>, String> {
    debug!("[IPC] get_wallet_info called");

    let executor = Arc::clone(&state.executor);

    let handle = tokio::spawn(async move {
        let exec = executor.read().await;
        exec.get_wallet_info().await
    });

    match handle.await {
        Ok(Ok(info)) => Ok(AsyncResult::ok(info)),
        Ok(Err(e)) => Ok(AsyncResult::err(e.to_string())),
        Err(e) => Ok(AsyncResult::err(format!("Task failed: {}", e))),
    }
}

// ============================================================================
// Tauri Commands - Intent Execution (Non-Blocking)
// ============================================================================

/// Execute a voice intent - main command bridging voice -> blockchain
/// Spawns chain operations in background, returns immediately with handle
#[tauri::command]
async fn execute_intent(
    state: State<'_, AppState>,
    intent_json: String,
) -> Result<AsyncResult<ExecutionResult>, String> {
    info!("[IPC] execute_intent: {}", intent_json);

    // Parse intent on main thread (fast, no I/O)
    let intent: VoiceIntent = match serde_json::from_str(&intent_json) {
        Ok(i) => i,
        Err(e) => return Ok(AsyncResult::err(format!("Parse error: {}", e))),
    };

    // Policy check is fast (in-memory), do it synchronously
    let policy_check = {
        let policy = state.policy.read().await;
        policy.check_policy(&intent)
    };

    if !policy_check.allowed {
        return Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: format!("Policy denied: {}", policy_check.reason),
            signature: None,
            data: None,
        }));
    }

    // If confirmation required, return early
    if policy_check.requires_confirmation {
        return Ok(AsyncResult::ok(ExecutionResult {
            success: true,
            message: format!("CONFIRM_REQUIRED:{:?}:{}",
                policy_check.confirmation_type, policy_check.reason),
            signature: None,
            data: Some(serde_json::to_value(&policy_check).unwrap_or_default()),
        }));
    }

    // Clone for spawned task
    let executor = Arc::clone(&state.executor);
    let intent_clone = intent.clone();

    // Spawn the chain operation - this is the slow part
    let handle = tokio::spawn(async move {
        debug!("[SPAWN] Executing intent on chain...");
        let exec = executor.read().await;
        exec.execute_intent(&intent_clone).await
    });

    // Await spawned task
    match handle.await {
        Ok(Ok(result)) => {
            info!("[IPC] Intent executed: success={}", result.success);
            Ok(AsyncResult::ok(result))
        }
        Ok(Err(e)) => {
            error!("[IPC] Intent execution error: {}", e);
            Ok(AsyncResult::err(e.to_string()))
        }
        Err(e) => {
            error!("[IPC] Intent task panic: {}", e);
            Ok(AsyncResult::err(format!("Task failed: {}", e)))
        }
    }
}

/// Execute after confirmation - spawns chain tx in background
#[tauri::command]
async fn execute_confirmed(
    state: State<'_, AppState>,
    intent_json: String,
) -> Result<AsyncResult<ExecutionResult>, String> {
    info!("[IPC] execute_confirmed");

    let intent: VoiceIntent = match serde_json::from_str(&intent_json) {
        Ok(i) => i,
        Err(e) => return Ok(AsyncResult::err(format!("Parse error: {}", e))),
    };

    let executor = Arc::clone(&state.executor);
    let policy = Arc::clone(&state.policy);
    let intent_clone = intent.clone();

    // Spawn chain operation
    let handle = tokio::spawn(async move {
        let exec = executor.read().await;
        let result = exec.execute_intent(&intent_clone).await?;

        // Record spending if successful (also async-safe)
        if result.success {
            if let Some(ref data) = result.data {
                if let Some(lamports) = data.get("reward_lamports").and_then(|v| v.as_u64()) {
                    let mut pol = policy.write().await;
                    pol.record_spending(lamports);
                }
            }
        }

        Ok::<_, anyhow::Error>(result)
    });

    match handle.await {
        Ok(Ok(result)) => Ok(AsyncResult::ok(result)),
        Ok(Err(e)) => Ok(AsyncResult::err(e.to_string())),
        Err(e) => Ok(AsyncResult::err(format!("Task failed: {}", e))),
    }
}

// ============================================================================
// Tauri Commands - Protocol State (Non-Blocking)
// ============================================================================

/// Get protocol state for HUD - spawns RPC query in background
#[tauri::command]
async fn get_protocol_state(state: State<'_, AppState>) -> Result<AsyncResult<ProtocolState>, String> {
    debug!("[IPC] get_protocol_state");

    let executor = Arc::clone(&state.executor);

    let handle = tokio::spawn(async move {
        let exec = executor.read().await;
        let result = exec.execute_intent(&VoiceIntent {
            action: operator_core::IntentAction::GetProtocolState,
            params: serde_json::json!({}),
            raw_transcript: None,
        }).await?;

        if let Some(data) = result.data {
            serde_json::from_value::<ProtocolState>(data)
                .map_err(|e| anyhow::anyhow!("Parse error: {}", e))
        } else {
            Err(anyhow::anyhow!("No protocol state data"))
        }
    });

    match handle.await {
        Ok(Ok(state)) => Ok(AsyncResult::ok(state)),
        Ok(Err(e)) => Ok(AsyncResult::err(e.to_string())),
        Err(e) => Ok(AsyncResult::err(format!("Task failed: {}", e))),
    }
}

/// List open tasks - spawns RPC query in background
#[tauri::command]
async fn list_tasks(state: State<'_, AppState>) -> Result<AsyncResult<Vec<AgencTask>>, String> {
    debug!("[IPC] list_tasks");

    let executor = Arc::clone(&state.executor);

    let handle = tokio::spawn(async move {
        let exec = executor.read().await;
        let result = exec.execute_intent(&VoiceIntent {
            action: operator_core::IntentAction::ListOpenTasks,
            params: serde_json::json!({}),
            raw_transcript: None,
        }).await?;

        if let Some(data) = result.data {
            serde_json::from_value::<Vec<AgencTask>>(data)
                .map_err(|e| anyhow::anyhow!("Parse error: {}", e))
        } else {
            Ok(vec![])
        }
    });

    match handle.await {
        Ok(Ok(tasks)) => Ok(AsyncResult::ok(tasks)),
        Ok(Err(e)) => Ok(AsyncResult::err(e.to_string())),
        Err(e) => Ok(AsyncResult::err(format!("Task failed: {}", e))),
    }
}

// ============================================================================
// Tauri Commands - Policy (Fast, In-Memory)
// ============================================================================

/// Check policy - fast in-memory check, no spawn needed
#[tauri::command]
async fn check_policy(
    state: State<'_, AppState>,
    intent_json: String,
) -> Result<PolicyCheck, String> {
    let intent: VoiceIntent = serde_json::from_str(&intent_json)
        .map_err(|e| format!("Parse error: {}", e))?;

    let policy = state.policy.read().await;
    Ok(policy.check_policy(&intent))
}

/// Get session spending - fast in-memory read
#[tauri::command]
async fn get_session_spending(state: State<'_, AppState>) -> Result<f64, String> {
    let policy = state.policy.read().await;
    Ok(policy.session_spending_sol())
}

// ============================================================================
// Tauri Commands - Voice State (Fast, In-Memory)
// ============================================================================

/// Set voice state - fast in-memory write
#[tauri::command]
async fn set_voice_state(
    state: State<'_, AppState>,
    voice_state: VoiceState,
) -> Result<(), String> {
    *state.voice_state.write().await = voice_state;
    Ok(())
}

/// Get voice state - fast in-memory read
#[tauri::command]
async fn get_voice_state(state: State<'_, AppState>) -> Result<VoiceState, String> {
    Ok(state.voice_state.read().await.clone())
}

// ============================================================================
// Tauri Commands - Configuration (Mixed)
// ============================================================================

/// Update RPC endpoint - spawns executor recreation
#[tauri::command]
async fn set_rpc_url(state: State<'_, AppState>, rpc_url: String) -> Result<(), String> {
    info!("[IPC] set_rpc_url: {}", rpc_url);

    let config = Arc::clone(&state.config);
    let executor = Arc::clone(&state.executor);
    let url = rpc_url.clone();

    // Spawn config update (writes can be slow if contested)
    let handle = tokio::spawn(async move {
        let mut cfg = config.write().await;
        cfg.rpc_url = url.clone();

        let new_executor = SolanaExecutor::new(&url, &cfg.network);
        *executor.write().await = new_executor;
    });

    handle.await.map_err(|e| format!("Task failed: {}", e))?;
    Ok(())
}

/// Get config - fast in-memory read
#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.read().await.clone())
}

// ============================================================================
// Fire-and-Forget Commands (No Response Needed)
// ============================================================================

/// Refresh protocol state in background - fire and forget
/// Call this periodically from frontend without waiting
#[tauri::command]
async fn refresh_state_background(state: State<'_, AppState>) -> Result<(), String> {
    debug!("[IPC] refresh_state_background (fire-and-forget)");

    let executor = Arc::clone(&state.executor);

    // Spawn and detach - we don't wait for result
    tokio::spawn(async move {
        let exec = executor.read().await;
        // Pre-fetch protocol state (warms cache, updates internal state)
        let _ = exec.execute_intent(&VoiceIntent {
            action: operator_core::IntentAction::GetProtocolState,
            params: serde_json::json!({}),
            raw_transcript: None,
        }).await;
        debug!("[SPAWN] Background state refresh complete");
    });

    // Return immediately
    Ok(())
}

// ============================================================================
// Application Setup
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("agenc_operator=debug".parse().unwrap())
                .add_directive("operator_core=debug".parse().unwrap()),
        )
        .init();

    info!("Starting Tetsuo - AgenC Operator (Async-First)");

    // Initialize application state
    let config = AppConfig::default();
    let executor = SolanaExecutor::new(&config.rpc_url, &config.network);

    let state = AppState {
        executor: Arc::new(RwLock::new(executor)),
        policy: Arc::new(RwLock::new(PolicyGate::new())),
        voice_state: Arc::new(RwLock::new(VoiceState::Idle)),
        config: Arc::new(RwLock::new(config)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Wallet (async spawned)
            load_wallet,
            get_wallet_info,
            // Intent execution (async spawned)
            execute_intent,
            execute_confirmed,
            // Protocol state (async spawned)
            get_protocol_state,
            list_tasks,
            refresh_state_background,
            // Policy (fast in-memory)
            check_policy,
            get_session_spending,
            // Voice state (fast in-memory)
            set_voice_state,
            get_voice_state,
            // Config
            set_rpc_url,
            get_config,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Tetsuo");
}
