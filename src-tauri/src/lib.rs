//! ============================================================================
//! TETSUO - AgenC Operator :: Tauri Backend (Async-First)
//! ============================================================================
//! Non-blocking IPC commands using tokio::spawn for all chain operations.
//! Ensures voice pipeline and HUD updates never stall waiting for RPC calls.
//!
//! Pattern: Clone Arc -> tokio::spawn -> JoinHandle -> await result
//! ============================================================================

use operator_core::{
    AgencTask, ExecutionResult, IntentAction, PolicyCheck, PolicyGate, ProtocolState, SolanaExecutor,
    VoiceIntent, VoiceState, WalletInfo,
    // Access control
    AccessGate, AccessTier, AccessTierInfo, Feature,
    // Memory system
    ConversationTurn, EmbeddingService, Memory, MemoryManager, MemoryType, UserContext,
    // Executors
    DiscordExecutor, EmailExecutor, GitHubExecutor, GrokCodeExecutor, ImageExecutor,
    JupiterSwapExecutor, TwitterExecutor,
    // Types for executors
    SwapParams, SwapQuote, TokenPrice, TweetResult,
    DiscordResult, EmailResult, BulkEmailResult, ImageGenResult,
    GistResult, IssueResult, CommentResult, WorkflowResult,
    // Param types for intent routing
    CodeFixParams, CodeReviewParams, CodeGenerateParams, CodeExplainParams,
    TweetParams, ThreadParams, DiscordMessageParams, DiscordEmbedParams,
    EmailParams, BulkEmailParams, ImageGenParams,
    CreateGistParams, CreateGitHubIssueParams, AddGitHubCommentParams, TriggerGitHubWorkflowParams,
    // Auth
    auth::{TwitterOAuth, TwitterTokens},
    // Database
    OperatorDb, TaskRecord, DbTaskStatus,
};
use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use tracing::{info, error, debug, warn};

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
    pub access_gate: Arc<RwLock<Option<AccessGate>>>,
    pub memory_manager: Arc<RwLock<Option<MemoryManager>>>,
    // Phase 2: Specialized executors
    pub code_executor: Arc<RwLock<Option<GrokCodeExecutor>>>,
    pub swap_executor: Arc<RwLock<Option<JupiterSwapExecutor>>>,
    pub twitter_executor: Arc<RwLock<Option<TwitterExecutor>>>,
    // Phase 3: Discord, Email, Image executors
    pub discord_executor: Arc<RwLock<Option<DiscordExecutor>>>,
    pub email_executor: Arc<RwLock<Option<EmailExecutor>>>,
    pub image_executor: Arc<RwLock<Option<ImageExecutor>>>,
    // Phase 4: GitHub executor
    pub github_executor: Arc<RwLock<Option<GitHubExecutor>>>,
    // Phase 5: Embedded database
    pub db: Arc<RwLock<Option<OperatorDb>>>,
}

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub rpc_url: String,
    pub network: String,
    pub whisper_model_path: Option<String>,
    pub grok_api_key: Option<String>,
    pub qdrant_url: Option<String>,
    pub openai_api_key: Option<String>,
    // Twitter OAuth 2.0 client ID (public, for PKCE flow)
    pub twitter_client_id: Option<String>,
    // Phase 3: Discord, Email, Image config
    pub discord_bot_token: Option<String>,
    pub discord_default_guild_id: Option<String>,
    pub resend_api_key: Option<String>,
    pub email_from_address: Option<String>,
    pub email_from_name: Option<String>,
    // Phase 4: GitHub config
    pub github_token: Option<String>,
    pub github_default_owner: Option<String>,
    pub github_default_repo: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            rpc_url: "https://api.devnet.solana.com".to_string(),
            network: "devnet".to_string(),
            whisper_model_path: None,
            grok_api_key: std::env::var("VITE_XAI_API_KEY").ok(),
            qdrant_url: std::env::var("QDRANT_URL").ok(),
            openai_api_key: std::env::var("OPENAI_API_KEY").ok(),
            twitter_client_id: std::env::var("TWITTER_CLIENT_ID").ok(),
            // Phase 3 config
            discord_bot_token: std::env::var("DISCORD_BOT_TOKEN").ok(),
            discord_default_guild_id: std::env::var("DISCORD_DEFAULT_GUILD_ID").ok(),
            resend_api_key: std::env::var("RESEND_API_KEY").ok(),
            email_from_address: std::env::var("EMAIL_FROM_ADDRESS").ok(),
            email_from_name: std::env::var("EMAIL_FROM_NAME").ok(),
            // Phase 4: GitHub config
            github_token: std::env::var("GITHUB_TOKEN").ok(),
            github_default_owner: std::env::var("GITHUB_DEFAULT_OWNER").ok(),
            github_default_repo: std::env::var("GITHUB_DEFAULT_REPO").ok(),
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

/// Detect programming language from file extension
fn detect_language(file_path: &str) -> &'static str {
    std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| match ext {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "go" => "go",
            "sol" => "solidity",
            "java" => "java",
            "cpp" | "cc" | "cxx" => "cpp",
            "c" | "h" => "c",
            "rb" => "ruby",
            "swift" => "swift",
            "kt" => "kotlin",
            "sh" => "bash",
            "sql" => "sql",
            "html" | "htm" => "html",
            "css" => "css",
            "json" => "json",
            "yaml" | "yml" => "yaml",
            "toml" => "toml",
            "md" => "markdown",
            _ => "text",
        })
        .unwrap_or("text")
}

/// Execute a voice intent - main command bridging voice -> blockchain
/// Routes to appropriate executor based on intent action type
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

    // Access tier gating - check if this action requires a specific feature
    if let Some(feature) = intent.action.required_feature() {
        let access_gate = state.access_gate.read().await;
        if let Some(gate) = access_gate.as_ref() {
            // Get wallet pubkey from executor
            let wallet_pubkey = {
                let executor = state.executor.read().await;
                executor.get_wallet_pubkey()
            };

            if let Some(pubkey) = wallet_pubkey {
                if let Err(e) = gate.gate_feature(&pubkey, feature).await {
                    return Ok(AsyncResult::ok(ExecutionResult {
                        success: false,
                        message: format!("Access denied: {}", e),
                        signature: None,
                        data: None,
                    }));
                }
            }
        }
    }

    // Route to appropriate executor based on intent action
    match &intent.action {
        // Code operations -> GrokCodeExecutor
        IntentAction::CodeFix => route_code_fix(&state, &intent).await,
        IntentAction::CodeReview => route_code_review(&state, &intent).await,
        IntentAction::CodeGenerate => route_code_generate(&state, &intent).await,
        IntentAction::CodeExplain => route_code_explain(&state, &intent).await,

        // Trading operations -> JupiterSwapExecutor
        IntentAction::SwapTokens => route_swap(&state, &intent).await,
        IntentAction::GetSwapQuote => route_quote(&state, &intent).await,
        IntentAction::GetTokenPrice => route_price(&state, &intent).await,

        // Twitter operations -> TwitterExecutor
        IntentAction::PostTweet => route_tweet(&state, &intent).await,
        IntentAction::PostThread => route_thread(&state, &intent).await,

        // Discord operations -> DiscordExecutor
        IntentAction::PostDiscord => route_discord(&state, &intent).await,
        IntentAction::PostDiscordEmbed => route_discord_embed(&state, &intent).await,

        // Email operations -> EmailExecutor
        IntentAction::SendEmail => route_email(&state, &intent).await,
        IntentAction::SendBulkEmail => route_bulk_email(&state, &intent).await,

        // Image generation -> ImageExecutor
        IntentAction::GenerateImage => route_image(&state, &intent).await,

        // GitHub operations -> GitHubExecutor
        IntentAction::CreateGist => route_create_gist(&state, &intent).await,
        IntentAction::CreateGitHubIssue => route_create_github_issue(&state, &intent).await,
        IntentAction::AddGitHubComment => route_add_github_comment(&state, &intent).await,
        IntentAction::TriggerGitHubWorkflow => route_trigger_github_workflow(&state, &intent).await,

        // Blockchain operations -> SolanaExecutor (existing behavior)
        _ => route_solana(&state, &intent).await,
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
// Intent Router Functions
// ============================================================================

/// Route code fix intent to GrokCodeExecutor
async fn route_code_fix(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            // Parse params
            let params: CodeFixParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid code_fix params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            // Read file content
            let code = match std::fs::read_to_string(&params.file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Failed to read file: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let language = detect_language(&params.file_path);

            match executor.fix_code(&code, &params.issue_description, language).await {
                Ok(fixed_code) => {
                    if params.auto_apply {
                        if let Err(e) = std::fs::write(&params.file_path, &fixed_code) {
                            return Ok(AsyncResult::ok(ExecutionResult {
                                success: false,
                                message: format!("Failed to write fix: {}", e),
                                signature: None,
                                data: None,
                            }));
                        }
                    }
                    Ok(AsyncResult::ok(ExecutionResult {
                        success: true,
                        message: if params.auto_apply {
                            format!("Code fix applied to {}", params.file_path)
                        } else {
                            "Code fix generated".into()
                        },
                        signature: None,
                        data: Some(serde_json::json!({ "fixed_code": fixed_code })),
                    }))
                }
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Code executor not initialized. Set VITE_XAI_API_KEY in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route code review intent to GrokCodeExecutor
async fn route_code_review(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            let params: CodeReviewParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid code_review params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let code = match std::fs::read_to_string(&params.file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Failed to read file: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let language = detect_language(&params.file_path);

            match executor.review_code(&code, language).await {
                Ok(review) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: review.clone(),
                    signature: None,
                    data: Some(serde_json::json!({ "review": review })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Code executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route code generate intent to GrokCodeExecutor
async fn route_code_generate(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            let params: CodeGenerateParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid code_generate params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.generate_code(&params.description, &params.language).await {
                Ok(code) => {
                    if let Some(ref path) = params.output_path {
                        if let Err(e) = std::fs::write(path, &code) {
                            return Ok(AsyncResult::ok(ExecutionResult {
                                success: false,
                                message: format!("Failed to write file: {}", e),
                                signature: None,
                                data: None,
                            }));
                        }
                    }
                    Ok(AsyncResult::ok(ExecutionResult {
                        success: true,
                        message: if params.output_path.is_some() {
                            format!("Code generated and saved to {}", params.output_path.as_ref().unwrap())
                        } else {
                            "Code generated".into()
                        },
                        signature: None,
                        data: Some(serde_json::json!({ "code": code })),
                    }))
                }
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Code executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route code explain intent to GrokCodeExecutor
async fn route_code_explain(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            let params: CodeExplainParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid code_explain params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let code = match std::fs::read_to_string(&params.file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Failed to read file: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let language = detect_language(&params.file_path);

            match executor.explain_code(&code, language).await {
                Ok(explanation) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: explanation.clone(),
                    signature: None,
                    data: Some(serde_json::json!({ "explanation": explanation })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Code executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route swap intent to JupiterSwapExecutor
async fn route_swap(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            let params: SwapParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid swap params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            // Resolve token symbols to mint addresses
            let input_mint = executor.resolve_token(&params.input_mint)
                .map(|s| s.to_string())
                .unwrap_or(params.input_mint.clone());
            let output_mint = executor.resolve_token(&params.output_mint)
                .map(|s| s.to_string())
                .unwrap_or(params.output_mint.clone());

            let resolved_params = SwapParams {
                input_mint,
                output_mint,
                amount: params.amount,
                slippage_bps: params.slippage_bps,
            };

            match executor.execute_swap(resolved_params).await {
                Ok(signature) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Swap executed successfully"),
                    signature: Some(signature),
                    data: None,
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Swap executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route quote intent to JupiterSwapExecutor
async fn route_quote(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            let params: SwapParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid quote params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let input_mint = executor.resolve_token(&params.input_mint)
                .map(|s| s.to_string())
                .unwrap_or(params.input_mint.clone());
            let output_mint = executor.resolve_token(&params.output_mint)
                .map(|s| s.to_string())
                .unwrap_or(params.output_mint.clone());

            let resolved_params = SwapParams {
                input_mint,
                output_mint,
                amount: params.amount,
                slippage_bps: params.slippage_bps,
            };

            match executor.get_quote(&resolved_params).await {
                Ok(quote) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Quote: {} -> {}", quote.in_amount, quote.out_amount),
                    signature: None,
                    data: Some(serde_json::to_value(&quote).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Swap executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route price intent to JupiterSwapExecutor
async fn route_price(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            // Extract token from params - could be { token: "SOL" } or just a string
            let token: String = intent.params.get("token")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| serde_json::from_value(intent.params.clone()).ok())
                .unwrap_or_else(|| "SOL".to_string());

            let mint = executor.resolve_token(&token)
                .map(|s| s.to_string())
                .unwrap_or(token.clone());

            match executor.get_price(&mint).await {
                Ok(price) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("{} price: ${:.4}", token.to_uppercase(), price.price_usd),
                    signature: None,
                    data: Some(serde_json::to_value(&price).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Swap executor not initialized".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route tweet intent to TwitterExecutor
async fn route_tweet(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let twitter_executor = state.twitter_executor.read().await;

    match twitter_executor.as_ref() {
        Some(executor) => {
            let params: TweetParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid tweet params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.post_tweet(&params.text, params.reply_to_id.as_deref()).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Tweet posted: {}", result.url),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Twitter not connected. Use 'Login with X' to connect.".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route thread intent to TwitterExecutor
async fn route_thread(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let twitter_executor = state.twitter_executor.read().await;

    match twitter_executor.as_ref() {
        Some(executor) => {
            let params: ThreadParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid thread params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.post_thread(params.tweets).await {
                Ok(results) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Thread posted: {} tweets", results.len()),
                    signature: None,
                    data: Some(serde_json::to_value(&results).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Twitter not connected".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route discord message intent to DiscordExecutor
async fn route_discord(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let discord_executor = state.discord_executor.read().await;

    match discord_executor.as_ref() {
        Some(executor) => {
            let params: DiscordMessageParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid discord params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let guild_id = match executor.get_guild_id(params.server_id.as_deref()) {
                Ok(id) => id,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            };

            match executor.post_message(&guild_id, &params.channel_name, &params.content).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Discord message posted to #{}", params.channel_name),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Discord not configured. Set DISCORD_BOT_TOKEN in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route discord embed intent to DiscordExecutor
async fn route_discord_embed(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let discord_executor = state.discord_executor.read().await;

    match discord_executor.as_ref() {
        Some(executor) => {
            let params: DiscordEmbedParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid discord embed params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let guild_id = match executor.get_guild_id(params.server_id.as_deref()) {
                Ok(id) => id,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            };

            match executor.post_embed(&guild_id, &params.channel_name, &params.title, &params.description, params.color).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Discord embed posted to #{}", params.channel_name),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Discord not configured".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route email intent to EmailExecutor
async fn route_email(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let email_executor = state.email_executor.read().await;

    match email_executor.as_ref() {
        Some(executor) => {
            let params: EmailParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid email params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.send(&params.to, &params.subject, &params.body, params.html).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Email sent to {}", params.to),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Email not configured. Set RESEND_API_KEY in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route bulk email intent to EmailExecutor
async fn route_bulk_email(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let email_executor = state.email_executor.read().await;

    match email_executor.as_ref() {
        Some(executor) => {
            let params: BulkEmailParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid bulk email params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.send_bulk(params.recipients.clone(), &params.subject, &params.body).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Bulk email complete: {} sent, {} failed", result.success, result.failed),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Email not configured".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route image generation intent to ImageExecutor
async fn route_image(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let image_executor = state.image_executor.read().await;

    match image_executor.as_ref() {
        Some(executor) => {
            let params: ImageGenParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid image params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let path = params.save_path.unwrap_or_else(|| {
                format!("generated/{}.png", chrono::Utc::now().timestamp())
            });

            match executor.generate_and_save(&params.prompt, &path).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Image generated: {}", result.path),
                    signature: None,
                    data: Some(serde_json::to_value(&result).unwrap_or_default()),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "Image generator not configured. Set VITE_XAI_API_KEY in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

// ============================================================================
// GitHub Intent Routers
// ============================================================================

/// Route gist creation to GitHubExecutor
async fn route_create_gist(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let params: CreateGistParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid gist params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            match executor.create_gist(&params.description, &params.filename, &params.content, params.public).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Gist created: {}", result.url),
                    signature: None,
                    data: Some(serde_json::json!({
                        "gist_id": result.gist_id,
                        "url": result.url,
                        "raw_url": result.raw_url
                    })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "GitHub not configured. Set GITHUB_TOKEN in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route issue creation to GitHubExecutor
async fn route_create_github_issue(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let params: CreateGitHubIssueParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid issue params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let (owner, repo) = match executor.get_repo_info(params.owner.as_deref(), params.repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            };

            match executor.create_issue(&owner, &repo, &params.title, &params.body, params.labels).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Issue #{} created: {}", result.issue_number, result.url),
                    signature: None,
                    data: Some(serde_json::json!({
                        "issue_number": result.issue_number,
                        "url": result.url
                    })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "GitHub not configured. Set GITHUB_TOKEN in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route comment addition to GitHubExecutor
async fn route_add_github_comment(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let params: AddGitHubCommentParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid comment params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let (owner, repo) = match executor.get_repo_info(params.owner.as_deref(), params.repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            };

            match executor.add_comment(&owner, &repo, params.issue_number, &params.body).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Comment added: {}", result.url),
                    signature: None,
                    data: Some(serde_json::json!({
                        "comment_id": result.comment_id,
                        "url": result.url
                    })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "GitHub not configured. Set GITHUB_TOKEN in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route workflow trigger to GitHubExecutor
async fn route_trigger_github_workflow(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let params: TriggerGitHubWorkflowParams = match serde_json::from_value(intent.params.clone()) {
                Ok(p) => p,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: format!("Invalid workflow params: {}", e),
                    signature: None,
                    data: None,
                })),
            };

            let (owner, repo) = match executor.get_repo_info(params.owner.as_deref(), params.repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            };

            match executor.trigger_workflow(&owner, &repo, &params.workflow_id, &params.ref_name, params.inputs).await {
                Ok(result) => Ok(AsyncResult::ok(ExecutionResult {
                    success: true,
                    message: format!("Workflow {} triggered on {}/{}", params.workflow_id, owner, repo),
                    signature: None,
                    data: Some(serde_json::json!({
                        "triggered": result.triggered
                    })),
                })),
                Err(e) => Ok(AsyncResult::ok(ExecutionResult {
                    success: false,
                    message: e.to_string(),
                    signature: None,
                    data: None,
                })),
            }
        }
        None => Ok(AsyncResult::ok(ExecutionResult {
            success: false,
            message: "GitHub not configured. Set GITHUB_TOKEN in .env".into(),
            signature: None,
            data: None,
        })),
    }
}

/// Route blockchain operations to SolanaExecutor (fallback)
async fn route_solana(
    state: &State<'_, AppState>,
    intent: &VoiceIntent,
) -> Result<AsyncResult<ExecutionResult>, String> {
    let executor = Arc::clone(&state.executor);
    let db = Arc::clone(&state.db);
    let intent_clone = intent.clone();
    let action = intent.action.clone();

    // Spawn the chain operation - this is the slow part
    let handle = tokio::spawn(async move {
        debug!("[SPAWN] Executing intent on chain...");
        let exec = executor.read().await;
        let result = exec.execute_intent(&intent_clone).await?;

        // Wire database persistence for task operations
        if result.success {
            let db_guard = db.read().await;
            if let Some(db) = db_guard.as_ref() {
                match &action {
                    IntentAction::ClaimTask => {
                        if let Ok(params) = serde_json::from_value::<operator_core::ClaimTaskParams>(intent_clone.params.clone()) {
                            let task_record = TaskRecord {
                                task_id: params.task_id.clone(),
                                payload: serde_json::to_vec(&intent_clone.params).unwrap_or_default(),
                                status: DbTaskStatus::Claimed,
                                claimed_at: chrono::Utc::now().timestamp(),
                                completed_at: None,
                                on_chain_signature: result.signature.clone(),
                                description: None,
                                reward_lamports: None,
                                creator: None,
                            };
                            if let Err(e) = db.store_task(&task_record) {
                                warn!("Failed to store claimed task in DB: {}", e);
                            } else {
                                info!("Task {} stored in local database", params.task_id);
                            }
                        }
                    }
                    IntentAction::CompleteTask => {
                        if let Ok(params) = serde_json::from_value::<operator_core::CompleteTaskParams>(intent_clone.params.clone()) {
                            if let Err(e) = db.update_task_status(&params.task_id, DbTaskStatus::Completed) {
                                warn!("Failed to update task status in DB: {}", e);
                            } else {
                                info!("Task {} marked completed in local database", params.task_id);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok::<_, anyhow::Error>(result)
    });

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
// Tauri Commands - Voice Token (Ephemeral Token for WebSocket)
// ============================================================================

/// Response from x.ai client_secrets endpoint
/// Supports both nested format: { "client_secret": { "value": "...", "expires_at": ... } }
/// and flat format: { "value": "...", "expires_at": ... }
#[derive(Debug, Deserialize)]
struct ClientSecretResponse {
    #[serde(default)]
    client_secret: Option<ClientSecret>,
    // Flat format fields (fallback)
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ClientSecret {
    value: String,
    expires_at: i64,
}

impl ClientSecretResponse {
    fn get_token(&self) -> Option<(String, i64)> {
        // Try nested format first
        if let Some(ref cs) = self.client_secret {
            return Some((cs.value.clone(), cs.expires_at));
        }
        // Fall back to flat format
        if let (Some(value), Some(expires)) = (&self.value, self.expires_at) {
            return Some((value.clone(), expires));
        }
        None
    }
}

/// Get ephemeral token for voice WebSocket connection
/// This keeps the API key secure on the backend
#[tauri::command]
async fn get_voice_token() -> Result<AsyncResult<String>, String> {
    info!("[IPC] get_voice_token called");

    // Get API key from environment
    let api_key = match std::env::var("VITE_XAI_API_KEY") {
        Ok(key) if !key.is_empty() && !key.contains("your_") => key,
        _ => {
            error!("[IPC] VITE_XAI_API_KEY not set or invalid");
            return Ok(AsyncResult::err(
                "XAI API key not configured. Set VITE_XAI_API_KEY in .env"
            ));
        }
    };

    // Request ephemeral token from x.ai
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.x.ai/v1/realtime/client_secrets")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "expires_after": { "seconds": 300 }
        }))
        .send()
        .await;

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                // SECURITY: Don't log the raw body — it contains the ephemeral token
                debug!("[IPC] Token response received ({} bytes)", body.len());

                match serde_json::from_str::<ClientSecretResponse>(&body) {
                    Ok(data) => {
                        if let Some((token, expires_at)) = data.get_token() {
                            info!("[IPC] Got ephemeral token ({} chars), expires at {}", token.len(), expires_at);
                            Ok(AsyncResult::ok(token))
                        } else {
                            error!("[IPC] Token response missing value field (response had {} bytes)", body.len());
                            Ok(AsyncResult::err("Token response missing value field"))
                        }
                    }
                    Err(e) => {
                        error!("[IPC] Failed to parse token response: {} ({} bytes)", e, body.len());
                        Ok(AsyncResult::err(format!("Failed to parse token: {}", e)))
                    }
                }
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                error!("[IPC] Token request failed: {} - {}", status, body);
                Ok(AsyncResult::err(format!("Token request failed ({}): {}", status, body)))
            }
        }
        Err(e) => {
            error!("[IPC] Token request error: {}", e);
            Ok(AsyncResult::err(format!("Network error: {}", e)))
        }
    }
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
// Tauri Commands - Access Control (Token Gating)
// ============================================================================

/// Get user's access tier based on $TETSUO holdings
#[tauri::command]
async fn get_access_tier(
    state: State<'_, AppState>,
    wallet_pubkey: String,
) -> Result<AsyncResult<AccessTierInfo>, String> {
    debug!("[IPC] get_access_tier for {}", wallet_pubkey);

    let access_gate = state.access_gate.read().await;

    match access_gate.as_ref() {
        Some(gate) => {
            let wallet = Pubkey::from_str(&wallet_pubkey)
                .map_err(|e| format!("Invalid pubkey: {}", e))?;

            match gate.get_access_tier_info(&wallet).await {
                Ok(info) => {
                    info!("[IPC] Access tier for {}: {:?}", wallet_pubkey, info.tier);
                    Ok(AsyncResult::ok(info))
                }
                Err(e) => {
                    warn!("[IPC] Failed to get access tier: {}", e);
                    Ok(AsyncResult::err(e.to_string()))
                }
            }
        }
        None => {
            warn!("[IPC] Access gate not initialized");
            Ok(AsyncResult::err("Access gate not initialized"))
        }
    }
}

/// Check if wallet can use a specific feature
#[tauri::command]
async fn check_feature_access(
    state: State<'_, AppState>,
    wallet_pubkey: String,
    feature: String,
) -> Result<AsyncResult<bool>, String> {
    debug!("[IPC] check_feature_access: {} for {}", feature, wallet_pubkey);

    let access_gate = state.access_gate.read().await;

    match access_gate.as_ref() {
        Some(gate) => {
            let wallet = Pubkey::from_str(&wallet_pubkey)
                .map_err(|e| format!("Invalid pubkey: {}", e))?;

            // Parse feature string to enum
            let feature_enum = match feature.to_lowercase().as_str() {
                "voice" => Feature::Voice,
                "trading" => Feature::Trading,
                "social" => Feature::Social,
                "email" => Feature::Email,
                "code" => Feature::Code,
                "imagegen" | "image_gen" => Feature::ImageGen,
                "spawn" => Feature::Spawn,
                "priorityqueue" | "priority_queue" => Feature::PriorityQueue,
                "custompersonality" | "custom_personality" => Feature::CustomPersonality,
                "apiaccess" | "api_access" => Feature::ApiAccess,
                "memory" => Feature::Memory,
                _ => return Ok(AsyncResult::err(format!("Unknown feature: {}", feature))),
            };

            match gate.can_use_feature(&wallet, feature_enum).await {
                Ok(can_use) => Ok(AsyncResult::ok(can_use)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Access gate not initialized")),
    }
}

/// Invalidate cached access tier for a wallet
#[tauri::command]
async fn invalidate_access_cache(
    state: State<'_, AppState>,
    wallet_pubkey: String,
) -> Result<(), String> {
    debug!("[IPC] invalidate_access_cache for {}", wallet_pubkey);

    let access_gate = state.access_gate.read().await;

    if let Some(gate) = access_gate.as_ref() {
        let wallet = Pubkey::from_str(&wallet_pubkey)
            .map_err(|e| format!("Invalid pubkey: {}", e))?;
        gate.invalidate_cache(&wallet).await;
    }

    Ok(())
}

// ============================================================================
// Tauri Commands - Memory System
// ============================================================================

/// Get memories for a user
#[tauri::command]
async fn get_user_memories(
    state: State<'_, AppState>,
    user_id: String,
    limit: Option<u64>,
) -> Result<AsyncResult<Vec<Memory>>, String> {
    debug!("[IPC] get_user_memories for {}", user_id);

    let memory_manager = state.memory_manager.read().await;

    match memory_manager.as_ref() {
        Some(manager) => {
            match manager.get_user_memories(&user_id, limit.unwrap_or(10)).await {
                Ok(memories) => {
                    debug!("[IPC] Retrieved {} memories", memories.len());
                    Ok(AsyncResult::ok(memories))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Memory system not initialized")),
    }
}

/// Search memories by semantic similarity
#[tauri::command]
async fn search_memories(
    state: State<'_, AppState>,
    user_id: String,
    query: String,
    limit: Option<u64>,
) -> Result<AsyncResult<Vec<Memory>>, String> {
    debug!("[IPC] search_memories for {} with query: {}", user_id, query);

    let memory_manager = state.memory_manager.read().await;

    match memory_manager.as_ref() {
        Some(manager) => {
            match manager.search_memories(&user_id, &query, limit.unwrap_or(5)).await {
                Ok(memories) => {
                    debug!("[IPC] Found {} relevant memories", memories.len());
                    Ok(AsyncResult::ok(memories))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Memory system not initialized")),
    }
}

/// Store a new memory
#[tauri::command]
async fn store_memory(
    state: State<'_, AppState>,
    user_id: String,
    content: String,
    memory_type: String,
    importance: Option<f32>,
) -> Result<AsyncResult<Memory>, String> {
    debug!("[IPC] store_memory for {}: {}", user_id, memory_type);

    let memory_manager = state.memory_manager.read().await;

    match memory_manager.as_ref() {
        Some(manager) => {
            let mem_type: MemoryType = memory_type.parse()
                .unwrap_or(MemoryType::UserFact);

            match manager.store_memory(&user_id, &content, mem_type, importance.unwrap_or(0.5)).await {
                Ok(memory) => {
                    info!("[IPC] Stored memory {} for user {}", memory.id, user_id);
                    Ok(AsyncResult::ok(memory))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Memory system not initialized")),
    }
}

/// Build voice context for a user (memories + access tier)
#[tauri::command]
async fn build_voice_context(
    state: State<'_, AppState>,
    user_id: String,
    current_message: String,
) -> Result<AsyncResult<UserContext>, String> {
    debug!("[IPC] build_voice_context for {}", user_id);

    let memory_manager = state.memory_manager.read().await;
    let access_gate = state.access_gate.read().await;

    match (memory_manager.as_ref(), access_gate.as_ref()) {
        (Some(manager), Some(gate)) => {
            match manager.build_context(&user_id, &current_message, vec![], gate).await {
                Ok(context) => {
                    debug!("[IPC] Built context with {} memories", context.relevant_memories.len());
                    Ok(AsyncResult::ok(context))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        (None, _) => Ok(AsyncResult::err("Memory system not initialized")),
        (_, None) => Ok(AsyncResult::err("Access gate not initialized")),
    }
}

/// Delete all memories for a user
#[tauri::command]
async fn delete_user_memories(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<AsyncResult<u64>, String> {
    info!("[IPC] delete_user_memories for {}", user_id);

    let memory_manager = state.memory_manager.read().await;

    match memory_manager.as_ref() {
        Some(manager) => {
            match manager.delete_user_memories(&user_id).await {
                Ok(count) => {
                    info!("[IPC] Deleted memories for user {}", user_id);
                    Ok(AsyncResult::ok(count))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Memory system not initialized")),
    }
}

/// Check if memory system is healthy
#[tauri::command]
async fn memory_health_check(state: State<'_, AppState>) -> Result<AsyncResult<bool>, String> {
    let memory_manager = state.memory_manager.read().await;

    match memory_manager.as_ref() {
        Some(manager) => {
            match manager.health_check().await {
                Ok(healthy) => Ok(AsyncResult::ok(healthy)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::ok(false)),
    }
}

// ============================================================================
// Tauri Commands - Code Operations (Grok Code Executor)
// ============================================================================

/// Fix code using Grok
#[tauri::command]
async fn execute_code_fix(
    state: State<'_, AppState>,
    file_path: String,
    issue: String,
    auto_apply: bool,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] execute_code_fix: {} - {}", file_path, issue);

    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            // Read the file content
            let code = match std::fs::read_to_string(&file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::err(format!("Failed to read file: {}", e))),
            };

            // Detect language from extension
            let language = std::path::Path::new(&file_path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|ext| match ext {
                    "rs" => "rust",
                    "ts" | "tsx" => "typescript",
                    "js" | "jsx" => "javascript",
                    "py" => "python",
                    "go" => "go",
                    "sol" => "solidity",
                    _ => ext,
                })
                .unwrap_or("text");

            match executor.fix_code(&code, &issue, language).await {
                Ok(fixed_code) => {
                    if auto_apply {
                        if let Err(e) = std::fs::write(&file_path, &fixed_code) {
                            return Ok(AsyncResult::err(format!("Failed to write file: {}", e)));
                        }
                        info!("[IPC] Code fix applied to {}", file_path);
                    }
                    Ok(AsyncResult::ok(fixed_code))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Code executor not initialized. Set VITE_XAI_API_KEY.")),
    }
}

/// Review code using Grok
#[tauri::command]
async fn execute_code_review(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] execute_code_review: {}", file_path);

    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            let code = match std::fs::read_to_string(&file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::err(format!("Failed to read file: {}", e))),
            };

            let language = std::path::Path::new(&file_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("text");

            match executor.review_code(&code, language).await {
                Ok(review) => Ok(AsyncResult::ok(review)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Code executor not initialized")),
    }
}

/// Generate code using Grok
#[tauri::command]
async fn execute_code_generate(
    state: State<'_, AppState>,
    description: String,
    language: String,
    output_path: Option<String>,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] execute_code_generate: {} in {}", description, language);

    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            match executor.generate_code(&description, &language).await {
                Ok(code) => {
                    if let Some(path) = output_path {
                        if let Err(e) = std::fs::write(&path, &code) {
                            return Ok(AsyncResult::err(format!("Failed to write file: {}", e)));
                        }
                        info!("[IPC] Generated code written to {}", path);
                    }
                    Ok(AsyncResult::ok(code))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Code executor not initialized")),
    }
}

/// Explain code using Grok
#[tauri::command]
async fn execute_code_explain(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] execute_code_explain: {}", file_path);

    let code_executor = state.code_executor.read().await;

    match code_executor.as_ref() {
        Some(executor) => {
            let code = match std::fs::read_to_string(&file_path) {
                Ok(content) => content,
                Err(e) => return Ok(AsyncResult::err(format!("Failed to read file: {}", e))),
            };

            let language = std::path::Path::new(&file_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("text");

            match executor.explain_code(&code, language).await {
                Ok(explanation) => Ok(AsyncResult::ok(explanation)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Code executor not initialized")),
    }
}

// ============================================================================
// Tauri Commands - Trading Operations (Jupiter Swap Executor)
// ============================================================================

/// Get swap quote from Jupiter
#[tauri::command]
async fn get_swap_quote(
    state: State<'_, AppState>,
    from_token: String,
    to_token: String,
    amount: u64,
) -> Result<AsyncResult<SwapQuote>, String> {
    debug!("[IPC] get_swap_quote: {} {} -> {}", amount, from_token, to_token);

    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            // Resolve token symbols to mint addresses
            let input_mint = executor.resolve_token(&from_token)
                .map(|s| s.to_string())
                .unwrap_or(from_token);
            let output_mint = executor.resolve_token(&to_token)
                .map(|s| s.to_string())
                .unwrap_or(to_token);

            let params = SwapParams {
                input_mint,
                output_mint,
                amount,
                slippage_bps: 50, // 0.5% default
            };

            match executor.get_quote(&params).await {
                Ok(quote) => Ok(AsyncResult::ok(quote)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Swap executor not initialized")),
    }
}

/// Execute a token swap via Jupiter
#[tauri::command]
async fn execute_swap(
    state: State<'_, AppState>,
    from_token: String,
    to_token: String,
    amount: u64,
    slippage_bps: Option<u16>,
) -> Result<AsyncResult<String>, String> {
    info!("[IPC] execute_swap: {} {} -> {}", amount, from_token, to_token);

    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            let input_mint = executor.resolve_token(&from_token)
                .map(|s| s.to_string())
                .unwrap_or(from_token);
            let output_mint = executor.resolve_token(&to_token)
                .map(|s| s.to_string())
                .unwrap_or(to_token);

            let params = SwapParams {
                input_mint,
                output_mint,
                amount,
                slippage_bps: slippage_bps.unwrap_or(50),
            };

            match executor.execute_swap(params).await {
                Ok(signature) => {
                    info!("[IPC] Swap executed: {}", signature);
                    Ok(AsyncResult::ok(signature))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Swap executor not initialized")),
    }
}

/// Get token price from Jupiter
#[tauri::command]
async fn get_token_price(
    state: State<'_, AppState>,
    token: String,
) -> Result<AsyncResult<TokenPrice>, String> {
    debug!("[IPC] get_token_price: {}", token);

    let swap_executor = state.swap_executor.read().await;

    match swap_executor.as_ref() {
        Some(executor) => {
            let mint = executor.resolve_token(&token)
                .map(|s| s.to_string())
                .unwrap_or(token);

            match executor.get_price(&mint).await {
                Ok(price) => Ok(AsyncResult::ok(price)),
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Swap executor not initialized")),
    }
}

// ============================================================================
// Tauri Commands - Twitter Operations (OAuth 2.0)
// ============================================================================

/// Keyring service name for Twitter tokens
const TWITTER_KEYRING_SERVICE: &str = "tetsuo-twitter";
const TWITTER_KEYRING_USER: &str = "oauth2-tokens";

/// Start Twitter OAuth 2.0 + PKCE flow
/// Opens browser and waits for callback
#[tauri::command]
async fn twitter_start_auth(state: State<'_, AppState>) -> Result<AsyncResult<bool>, String> {
    info!("[IPC] twitter_start_auth");

    // Get client ID from config
    let client_id = {
        let config = state.config.read().await;
        config.twitter_client_id.clone()
    };

    let client_id = match client_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            return Ok(AsyncResult::err(
                "TWITTER_CLIENT_ID not set. Configure in .env or Developer Portal.",
            ));
        }
    };

    // Create OAuth client and get auth URL
    let oauth = TwitterOAuth::new(client_id);
    let (auth_url, verifier, expected_state) = oauth.get_auth_url();

    // Open browser
    if let Err(e) = open::that(&auth_url) {
        error!("[IPC] Failed to open browser: {}", e);
        return Ok(AsyncResult::err(format!("Failed to open browser: {}", e)));
    }

    info!("[IPC] Opened browser for Twitter auth, waiting for callback...");

    // Wait for callback (blocking but in a spawned task context)
    let code = match TwitterOAuth::wait_for_callback(&expected_state) {
        Ok(code) => code,
        Err(e) => {
            error!("[IPC] OAuth callback failed: {}", e);
            return Ok(AsyncResult::err(format!("OAuth failed: {}", e)));
        }
    };

    // Exchange code for tokens
    let tokens = match oauth.exchange_code(&code, &verifier).await {
        Ok(tokens) => tokens,
        Err(e) => {
            error!("[IPC] Token exchange failed: {}", e);
            return Ok(AsyncResult::err(format!("Token exchange failed: {}", e)));
        }
    };

    // Store tokens securely in keyring
    let tokens_json = serde_json::to_string(&tokens)
        .map_err(|e| format!("Failed to serialize tokens: {}", e))?;

    let entry = keyring::Entry::new(TWITTER_KEYRING_SERVICE, TWITTER_KEYRING_USER)
        .map_err(|e| format!("Keyring error: {}", e))?;

    entry
        .set_password(&tokens_json)
        .map_err(|e| format!("Failed to store tokens: {}", e))?;

    // Create and store TwitterExecutor
    let executor = TwitterExecutor::new(tokens.access_token.clone());
    *state.twitter_executor.write().await = Some(executor);

    info!("[IPC] Twitter OAuth complete, tokens stored securely");
    Ok(AsyncResult::ok(true))
}

/// Check if Twitter is connected (has valid tokens)
#[tauri::command]
async fn twitter_check_connected(
    state: State<'_, AppState>,
) -> Result<AsyncResult<bool>, String> {
    debug!("[IPC] twitter_check_connected");

    // First check if executor is already initialized
    {
        let executor = state.twitter_executor.read().await;
        if executor.is_some() {
            return Ok(AsyncResult::ok(true));
        }
    }

    // Try to load from keyring
    let entry = match keyring::Entry::new(TWITTER_KEYRING_SERVICE, TWITTER_KEYRING_USER) {
        Ok(e) => e,
        Err(_) => return Ok(AsyncResult::ok(false)),
    };

    let tokens_json = match entry.get_password() {
        Ok(json) => json,
        Err(_) => return Ok(AsyncResult::ok(false)),
    };

    let tokens: TwitterTokens = match serde_json::from_str(&tokens_json) {
        Ok(t) => t,
        Err(_) => return Ok(AsyncResult::ok(false)),
    };

    // Check if tokens are expired
    if tokens.is_expired() {
        // Try to refresh if we have a refresh token
        if let Some(refresh_token) = &tokens.refresh_token {
            let client_id = {
                let config = state.config.read().await;
                config.twitter_client_id.clone()
            };

            if let Some(client_id) = client_id {
                let oauth = TwitterOAuth::new(client_id);
                match oauth.refresh_tokens(refresh_token).await {
                    Ok(new_tokens) => {
                        // Store refreshed tokens
                        if let Ok(tokens_json) = serde_json::to_string(&new_tokens) {
                            if let Ok(entry) =
                                keyring::Entry::new(TWITTER_KEYRING_SERVICE, TWITTER_KEYRING_USER)
                            {
                                let _ = entry.set_password(&tokens_json);
                            }
                        }

                        // Update executor
                        let executor = TwitterExecutor::new(new_tokens.access_token);
                        *state.twitter_executor.write().await = Some(executor);

                        info!("[IPC] Twitter tokens refreshed");
                        return Ok(AsyncResult::ok(true));
                    }
                    Err(e) => {
                        warn!("[IPC] Failed to refresh Twitter tokens: {}", e);
                        return Ok(AsyncResult::ok(false));
                    }
                }
            }
        }
        return Ok(AsyncResult::ok(false));
    }

    // Initialize executor with stored tokens
    let executor = TwitterExecutor::new(tokens.access_token);
    *state.twitter_executor.write().await = Some(executor);

    Ok(AsyncResult::ok(true))
}

/// Disconnect Twitter (remove stored tokens)
#[tauri::command]
async fn twitter_disconnect(state: State<'_, AppState>) -> Result<AsyncResult<bool>, String> {
    info!("[IPC] twitter_disconnect");

    // Clear executor
    *state.twitter_executor.write().await = None;

    // Remove from keyring
    if let Ok(entry) = keyring::Entry::new(TWITTER_KEYRING_SERVICE, TWITTER_KEYRING_USER) {
        let _ = entry.delete_password();
    }

    info!("[IPC] Twitter disconnected, tokens removed");
    Ok(AsyncResult::ok(true))
}

/// Post a tweet
#[tauri::command]
async fn post_tweet(
    state: State<'_, AppState>,
    content: String,
    reply_to: Option<String>,
) -> Result<AsyncResult<TweetResult>, String> {
    info!("[IPC] post_tweet: {}...", &content[..content.len().min(50)]);

    let twitter_executor = state.twitter_executor.read().await;

    match twitter_executor.as_ref() {
        Some(executor) => {
            match executor.post_tweet(&content, reply_to.as_deref()).await {
                Ok(result) => {
                    info!("[IPC] Tweet posted: {}", result.url);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err(
            "Twitter not connected. Use 'Login with X' to connect.",
        )),
    }
}

/// Post a thread of tweets
#[tauri::command]
async fn post_thread(
    state: State<'_, AppState>,
    tweets: Vec<String>,
) -> Result<AsyncResult<Vec<TweetResult>>, String> {
    info!("[IPC] post_thread: {} tweets", tweets.len());

    let twitter_executor = state.twitter_executor.read().await;

    match twitter_executor.as_ref() {
        Some(executor) => {
            match executor.post_thread(tweets).await {
                Ok(results) => {
                    info!("[IPC] Thread posted: {} tweets", results.len());
                    Ok(AsyncResult::ok(results))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Twitter not connected")),
    }
}

// ============================================================================
// Tauri Commands - Discord Operations (Bot Token)
// ============================================================================

/// Post a message to a Discord channel
#[tauri::command]
async fn post_discord(
    state: State<'_, AppState>,
    channel_name: String,
    content: String,
    server_id: Option<String>,
) -> Result<AsyncResult<DiscordResult>, String> {
    info!("[IPC] post_discord to #{}: {}...", channel_name, &content[..content.len().min(50)]);

    let discord_executor = state.discord_executor.read().await;

    match discord_executor.as_ref() {
        Some(executor) => {
            let guild_id = match executor.get_guild_id(server_id.as_deref()) {
                Ok(id) => id,
                Err(e) => return Ok(AsyncResult::err(e.to_string())),
            };

            match executor.post_message(&guild_id, &channel_name, &content).await {
                Ok(result) => {
                    info!("[IPC] Discord message posted: {}", result.message_id);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err(
            "Discord not configured. Set DISCORD_BOT_TOKEN in .env",
        )),
    }
}

/// Post an embed to a Discord channel
#[tauri::command]
async fn post_discord_embed(
    state: State<'_, AppState>,
    channel_name: String,
    title: String,
    description: String,
    color: Option<u32>,
    server_id: Option<String>,
) -> Result<AsyncResult<DiscordResult>, String> {
    info!("[IPC] post_discord_embed to #{}: {}", channel_name, title);

    let discord_executor = state.discord_executor.read().await;

    match discord_executor.as_ref() {
        Some(executor) => {
            let guild_id = match executor.get_guild_id(server_id.as_deref()) {
                Ok(id) => id,
                Err(e) => return Ok(AsyncResult::err(e.to_string())),
            };

            match executor.post_embed(&guild_id, &channel_name, &title, &description, color).await {
                Ok(result) => {
                    info!("[IPC] Discord embed posted: {}", result.message_id);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Discord not configured")),
    }
}

// ============================================================================
// Tauri Commands - Email Operations (Resend API)
// ============================================================================

/// Send a single email
#[tauri::command]
async fn send_email(
    state: State<'_, AppState>,
    to: String,
    subject: String,
    body: String,
    html: Option<bool>,
) -> Result<AsyncResult<EmailResult>, String> {
    info!("[IPC] send_email to {}: {}", to, subject);

    let email_executor = state.email_executor.read().await;

    match email_executor.as_ref() {
        Some(executor) => {
            match executor.send(&to, &subject, &body, html.unwrap_or(false)).await {
                Ok(result) => {
                    info!("[IPC] Email sent: {}", result.id);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err(
            "Email not configured. Set RESEND_API_KEY in .env",
        )),
    }
}

/// Send bulk emails to multiple recipients
#[tauri::command]
async fn send_bulk_email(
    state: State<'_, AppState>,
    recipients: Vec<String>,
    subject: String,
    body: String,
) -> Result<AsyncResult<BulkEmailResult>, String> {
    info!("[IPC] send_bulk_email to {} recipients: {}", recipients.len(), subject);

    let email_executor = state.email_executor.read().await;

    match email_executor.as_ref() {
        Some(executor) => {
            match executor.send_bulk(recipients, &subject, &body).await {
                Ok(result) => {
                    info!("[IPC] Bulk email complete: {} success, {} failed", result.success, result.failed);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Email not configured")),
    }
}

// ============================================================================
// Tauri Commands - Image Generation (Grok Image API)
// ============================================================================

/// Generate an image from a text prompt
#[tauri::command]
async fn generate_image(
    state: State<'_, AppState>,
    prompt: String,
    save_path: Option<String>,
) -> Result<AsyncResult<ImageGenResult>, String> {
    info!("[IPC] generate_image: {}...", &prompt[..prompt.len().min(50)]);

    let image_executor = state.image_executor.read().await;

    match image_executor.as_ref() {
        Some(executor) => {
            let path = save_path.unwrap_or_else(|| {
                format!("generated/{}.png", chrono::Utc::now().timestamp())
            });

            match executor.generate_and_save(&prompt, &path).await {
                Ok(result) => {
                    info!("[IPC] Image generated: {}", result.path);
                    Ok(AsyncResult::ok(result))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err(
            "Image generator not configured. Set VITE_XAI_API_KEY in .env",
        )),
    }
}

// ============================================================================
// GitHub Commands
// ============================================================================

/// Create a gist with code
#[tauri::command]
async fn create_gist(
    state: State<'_, AppState>,
    description: String,
    filename: String,
    content: String,
    public: bool,
) -> Result<AsyncResult<serde_json::Value>, String> {
    info!("[IPC] create_gist: {} ({})", description, filename);

    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            match executor.create_gist(&description, &filename, &content, public).await {
                Ok(result) => {
                    info!("[IPC] Gist created: {}", result.url);
                    Ok(AsyncResult::ok(serde_json::json!({
                        "gist_id": result.gist_id,
                        "url": result.url,
                        "raw_url": result.raw_url
                    })))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("GitHub not configured. Set GITHUB_TOKEN in .env")),
    }
}

/// Create an issue in a GitHub repository
#[tauri::command]
async fn create_github_issue(
    state: State<'_, AppState>,
    title: String,
    body: String,
    owner: Option<String>,
    repo: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<AsyncResult<serde_json::Value>, String> {
    info!("[IPC] create_github_issue: {}", title);

    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let (owner, repo) = match executor.get_repo_info(owner.as_deref(), repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::err(e.to_string())),
            };

            match executor.create_issue(&owner, &repo, &title, &body, labels).await {
                Ok(result) => {
                    info!("[IPC] Issue created: #{} - {}", result.issue_number, result.url);
                    Ok(AsyncResult::ok(serde_json::json!({
                        "issue_number": result.issue_number,
                        "url": result.url
                    })))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("GitHub not configured. Set GITHUB_TOKEN in .env")),
    }
}

/// Add a comment to an issue or PR
#[tauri::command]
async fn add_github_comment(
    state: State<'_, AppState>,
    issue_number: u64,
    body: String,
    owner: Option<String>,
    repo: Option<String>,
) -> Result<AsyncResult<serde_json::Value>, String> {
    info!("[IPC] add_github_comment: #{}", issue_number);

    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let (owner, repo) = match executor.get_repo_info(owner.as_deref(), repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::err(e.to_string())),
            };

            match executor.add_comment(&owner, &repo, issue_number, &body).await {
                Ok(result) => {
                    info!("[IPC] Comment added: {}", result.url);
                    Ok(AsyncResult::ok(serde_json::json!({
                        "comment_id": result.comment_id,
                        "url": result.url
                    })))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("GitHub not configured. Set GITHUB_TOKEN in .env")),
    }
}

/// Trigger a workflow dispatch
#[tauri::command]
async fn trigger_github_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
    ref_name: String,
    owner: Option<String>,
    repo: Option<String>,
    inputs: Option<serde_json::Value>,
) -> Result<AsyncResult<serde_json::Value>, String> {
    info!("[IPC] trigger_github_workflow: {} on {}", workflow_id, ref_name);

    let github_executor = state.github_executor.read().await;

    match github_executor.as_ref() {
        Some(executor) => {
            let (owner, repo) = match executor.get_repo_info(owner.as_deref(), repo.as_deref()) {
                Ok(info) => info,
                Err(e) => return Ok(AsyncResult::err(e.to_string())),
            };

            match executor.trigger_workflow(&owner, &repo, &workflow_id, &ref_name, inputs).await {
                Ok(result) => {
                    info!("[IPC] Workflow triggered: {}/{} -> {}", owner, repo, workflow_id);
                    Ok(AsyncResult::ok(serde_json::json!({
                        "triggered": result.triggered
                    })))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("GitHub not configured. Set GITHUB_TOKEN in .env")),
    }
}

/// Initialize the memory system (connects to Qdrant)
#[tauri::command]
async fn init_memory_system(state: State<'_, AppState>) -> Result<AsyncResult<bool>, String> {
    info!("[IPC] init_memory_system called");

    // Check if already initialized
    {
        let existing = state.memory_manager.read().await;
        if existing.is_some() {
            debug!("[IPC] Memory system already initialized");
            return Ok(AsyncResult::ok(true));
        }
    }

    // Get Qdrant URL from config or environment
    let qdrant_url = {
        let config = state.config.read().await;
        config.qdrant_url.clone()
            .or_else(|| std::env::var("QDRANT_URL").ok())
            .unwrap_or_else(|| "http://localhost:6333".to_string())
    };

    // Get API key for embeddings
    let xai_api_key = std::env::var("VITE_XAI_API_KEY").ok();
    let openai_api_key = {
        let config = state.config.read().await;
        config.openai_api_key.clone()
    };

    // Create embedding service
    let embedding_service = match operator_core::memory::create_embedding_service(xai_api_key, openai_api_key) {
        Ok(service) => service,
        Err(e) => {
            error!("[IPC] Failed to create embedding service: {}", e);
            return Ok(AsyncResult::err(format!("Embedding service error: {}", e)));
        }
    };

    // Create memory manager
    match MemoryManager::new(&qdrant_url, embedding_service).await {
        Ok(manager) => {
            let mut memory_manager = state.memory_manager.write().await;
            *memory_manager = Some(manager);
            info!("[IPC] Memory system initialized successfully (Qdrant: {})", qdrant_url);
            Ok(AsyncResult::ok(true))
        }
        Err(e) => {
            error!("[IPC] Failed to initialize memory system: {}", e);
            Ok(AsyncResult::err(format!("Memory initialization failed: {}", e)))
        }
    }
}

// ============================================================================
// Tauri Commands - Frontend Logging (for debugging)
// ============================================================================

/// Log a message from the frontend to the terminal
#[tauri::command]
fn frontend_log(level: String, message: String) {
    match level.as_str() {
        "error" => error!("[Frontend] {}", message),
        "warn" => info!("[Frontend] {}", message),
        "info" => info!("[Frontend] {}", message),
        _ => debug!("[Frontend] {}", message),
    }
}

// ============================================================================
// Database Commands (Phase 5)
// ============================================================================

/// List tasks from the local database
#[tauri::command]
async fn db_list_tasks(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<AsyncResult<Vec<serde_json::Value>>, String> {
    debug!("[IPC] db_list_tasks (status={:?})", status);

    let db = state.db.read().await;
    match db.as_ref() {
        Some(db) => {
            let status_filter = status.as_deref().and_then(|s| match s {
                "claimed" => Some(DbTaskStatus::Claimed),
                "in_progress" => Some(DbTaskStatus::InProgress),
                "completed" => Some(DbTaskStatus::Completed),
                "disputed" => Some(DbTaskStatus::Disputed),
                "resolved" => Some(DbTaskStatus::Resolved),
                _ => None,
            });

            match db.list_tasks(status_filter.as_ref()) {
                Ok(tasks) => {
                    let json_tasks: Vec<serde_json::Value> = tasks
                        .iter()
                        .map(|t| serde_json::to_value(t).unwrap_or_default())
                        .collect();
                    Ok(AsyncResult::ok(json_tasks))
                }
                Err(e) => Ok(AsyncResult::err(e.to_string())),
            }
        }
        None => Ok(AsyncResult::err("Database not initialized".to_string())),
    }
}

/// Get a specific task from the local database
#[tauri::command]
async fn db_get_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<AsyncResult<serde_json::Value>, String> {
    debug!("[IPC] db_get_task: {}", task_id);

    let db = state.db.read().await;
    match db.as_ref() {
        Some(db) => match db.get_task(&task_id) {
            Ok(Some(task)) => Ok(AsyncResult::ok(
                serde_json::to_value(&task).unwrap_or_default(),
            )),
            Ok(None) => Ok(AsyncResult::err(format!("Task not found: {}", task_id))),
            Err(e) => Ok(AsyncResult::err(e.to_string())),
        },
        None => Ok(AsyncResult::err("Database not initialized".to_string())),
    }
}

// ============================================================================
// Application Setup
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file
    if let Err(e) = dotenvy::dotenv() {
        eprintln!("Warning: Could not load .env file: {}", e);
    }

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

    // Initialize access gate (token gating)
    let access_gate = match AccessGate::new(&config.rpc_url) {
        Ok(gate) => {
            info!("Access gate initialized for token gating");
            Some(gate)
        }
        Err(e) => {
            warn!("Failed to initialize access gate: {} - token gating disabled", e);
            None
        }
    };

    // Note: Memory manager requires async initialization, done lazily on first use
    // or can be initialized via a separate command
    info!("Memory system will be initialized on first use (requires Qdrant)");

    // Initialize Phase 2 executors
    let code_executor = config.grok_api_key.as_ref().map(|key| {
        info!("Code executor initialized with Grok API");
        GrokCodeExecutor::new(key.clone())
    });

    let swap_executor = Some(JupiterSwapExecutor::new(&config.rpc_url));
    info!("Swap executor initialized for Jupiter");

    // Try to load Twitter tokens from keyring (OAuth 2.0)
    let twitter_executor: Option<TwitterExecutor> = {
        match keyring::Entry::new(TWITTER_KEYRING_SERVICE, TWITTER_KEYRING_USER) {
            Ok(entry) => match entry.get_password() {
                Ok(tokens_json) => match serde_json::from_str::<TwitterTokens>(&tokens_json) {
                    Ok(tokens) if !tokens.is_expired() => {
                        info!("Twitter executor initialized from stored OAuth 2.0 tokens");
                        Some(TwitterExecutor::new(tokens.access_token))
                    }
                    Ok(_) => {
                        info!("Stored Twitter tokens expired, will need re-auth");
                        None
                    }
                    Err(_) => None,
                },
                Err(_) => {
                    info!("No stored Twitter tokens (use 'Login with X' to connect)");
                    None
                }
            },
            Err(_) => None,
        }
    };

    // Phase 3: Initialize Discord executor
    let discord_executor = config.discord_bot_token.as_ref().map(|token| {
        info!("Discord executor initialized with bot token");
        DiscordExecutor::new(token.clone(), config.discord_default_guild_id.clone())
    });

    // Phase 3: Initialize Email executor
    let email_executor = config.resend_api_key.as_ref().map(|api_key| {
        let from_address = config.email_from_address.clone().unwrap_or_else(|| "noreply@tetsuo.ai".to_string());
        let from_name = config.email_from_name.clone().unwrap_or_else(|| "Tetsuo".to_string());
        info!("Email executor initialized with Resend API");
        EmailExecutor::new(api_key.clone(), from_address, from_name)
    });

    // Phase 3: Initialize Image executor (uses same Grok API key)
    let image_executor = config.grok_api_key.as_ref().map(|api_key| {
        info!("Image executor initialized with Grok API");
        ImageExecutor::new(api_key.clone())
    });

    // Phase 4: Initialize GitHub executor
    let github_executor = config.github_token.as_ref().map(|token| {
        info!("GitHub executor initialized with PAT");
        GitHubExecutor::new(
            token.clone(),
            config.github_default_owner.clone(),
            config.github_default_repo.clone(),
        )
    });

    // Phase 5: Initialize embedded database
    let operator_db = match OperatorDb::open(None) {
        Ok(db) => {
            info!("Operator database initialized at: {}", db.path().display());
            match db.list_tasks(Some(&DbTaskStatus::Claimed)) {
                Ok(pending) => {
                    if !pending.is_empty() {
                        info!("Loaded {} pending tasks from database", pending.len());
                    }
                }
                Err(e) => warn!("Failed to load pending tasks: {}", e),
            }
            Some(db)
        }
        Err(e) => {
            warn!("Failed to init operator database: {} - running without persistence", e);
            None
        }
    };

    let state = AppState {
        executor: Arc::new(RwLock::new(executor)),
        policy: Arc::new(RwLock::new(PolicyGate::new())),
        voice_state: Arc::new(RwLock::new(VoiceState::Idle)),
        config: Arc::new(RwLock::new(config)),
        access_gate: Arc::new(RwLock::new(access_gate)),
        memory_manager: Arc::new(RwLock::new(None)), // Initialized lazily
        // Phase 2 executors
        code_executor: Arc::new(RwLock::new(code_executor)),
        swap_executor: Arc::new(RwLock::new(swap_executor)),
        twitter_executor: Arc::new(RwLock::new(twitter_executor)),
        // Phase 3 executors
        discord_executor: Arc::new(RwLock::new(discord_executor)),
        email_executor: Arc::new(RwLock::new(email_executor)),
        image_executor: Arc::new(RwLock::new(image_executor)),
        // Phase 4: GitHub executor
        github_executor: Arc::new(RwLock::new(github_executor)),
        // Phase 5: Embedded database
        db: Arc::new(RwLock::new(operator_db)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // TODO: Generate signing keypair and set pubkey in tauri.conf.json before release
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // Voice token (ephemeral for WebSocket)
            get_voice_token,
            // Access control (token gating)
            get_access_tier,
            check_feature_access,
            invalidate_access_cache,
            // Memory system
            init_memory_system,
            get_user_memories,
            search_memories,
            store_memory,
            build_voice_context,
            delete_user_memories,
            memory_health_check,
            // Code operations (Grok)
            execute_code_fix,
            execute_code_review,
            execute_code_generate,
            execute_code_explain,
            // Trading operations (Jupiter)
            get_swap_quote,
            execute_swap,
            get_token_price,
            // Twitter operations (OAuth 2.0)
            twitter_start_auth,
            twitter_check_connected,
            twitter_disconnect,
            post_tweet,
            post_thread,
            // Discord operations (Phase 3)
            post_discord,
            post_discord_embed,
            // Email operations (Phase 3)
            send_email,
            send_bulk_email,
            // Image generation (Phase 3)
            generate_image,
            // GitHub operations (Phase 4)
            create_gist,
            create_github_issue,
            add_github_comment,
            trigger_github_workflow,
            // Config
            set_rpc_url,
            get_config,
            // Database (Phase 5)
            db_list_tasks,
            db_get_task,
            // Debug
            frontend_log,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Tetsuo");
}
