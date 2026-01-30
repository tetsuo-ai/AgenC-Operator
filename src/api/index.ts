/**
 * ============================================================================
 * TETSUO - Async-First API Layer
 * ============================================================================
 * Non-blocking wrappers around Tauri IPC commands.
 * All methods return Promises with .then/.catch for clean async handling.
 * Chain operations never block the voice pipeline or HUD updates.
 * ============================================================================
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  WalletInfo,
  ProtocolState,
  AgencTask,
  ExecutionResult,
  VoiceIntent,
  PolicyCheck,
  VoiceState,
  AppConfig,
  AccessTierInfo,
  Memory,
  UserContext,
  Feature,
} from '../types';

// ============================================================================
// AsyncResult Type (matches Rust)
// ============================================================================

interface AsyncResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// ============================================================================
// Error Handling Helpers
// ============================================================================

class TetsuoAPIError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'TetsuoAPIError';
  }
}

/**
 * Unwrap AsyncResult<T> to T or throw
 */
function unwrapResult<T>(result: AsyncResult<T>): T {
  if (!result.success || result.data === null) {
    throw new TetsuoAPIError(result.error || 'Unknown error');
  }
  return result.data;
}

// ============================================================================
// Wallet API (Non-Blocking Chain Queries)
// ============================================================================

export const WalletAPI = {
  /**
   * Load wallet from keypair file path
   * Returns: Promise<string> - wallet address
   */
  loadWallet(keypairPath: string): Promise<string> {
    return invoke<AsyncResult<string>>('load_wallet', { keypairPath })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] loadWallet failed:', err);
        throw new TetsuoAPIError(`Failed to load wallet: ${err}`);
      });
  },

  /**
   * Get wallet info (address, balance)
   * Non-blocking RPC call
   */
  getWalletInfo(): Promise<WalletInfo> {
    return invoke<AsyncResult<WalletInfo>>('get_wallet_info')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getWalletInfo failed:', err);
        // Return disconnected state on error instead of throwing
        return {
          address: '',
          balance_sol: 0,
          is_connected: false,
        };
      });
  },

  /**
   * Get wallet info without blocking - fire and forget style
   * Useful for background polling
   */
  getWalletInfoNonBlocking(
    onSuccess: (info: WalletInfo) => void,
    onError?: (err: Error) => void
  ): void {
    invoke<AsyncResult<WalletInfo>>('get_wallet_info')
      .then((result) => {
        if (result.success && result.data) {
          onSuccess(result.data);
        }
      })
      .catch((err) => {
        console.warn('[API] Background wallet fetch failed:', err);
        onError?.(err);
      });
  },
};

// ============================================================================
// Intent Execution API (Non-Blocking Chain Transactions)
// ============================================================================

export const IntentAPI = {
  /**
   * Execute a voice intent
   * Spawns chain operation in Rust - doesn't block JS main thread
   */
  executeIntent(intent: VoiceIntent): Promise<ExecutionResult> {
    const intentJson = JSON.stringify(intent);

    return invoke<AsyncResult<ExecutionResult>>('execute_intent', { intentJson })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] executeIntent failed:', err);
        return {
          success: false,
          message: `Execution failed: ${err}`,
          signature: undefined,
          data: undefined,
        };
      });
  },

  /**
   * Execute intent with callback pattern (non-blocking)
   * Voice pipeline can continue while chain tx processes
   */
  executeIntentAsync(
    intent: VoiceIntent,
    onResult: (result: ExecutionResult) => void,
    onError?: (err: Error) => void
  ): void {
    const intentJson = JSON.stringify(intent);

    invoke<AsyncResult<ExecutionResult>>('execute_intent', { intentJson })
      .then((result) => {
        if (result.success && result.data) {
          onResult(result.data);
        } else {
          onResult({
            success: false,
            message: result.error || 'Unknown error',
            signature: undefined,
            data: undefined,
          });
        }
      })
      .catch((err) => {
        console.error('[API] executeIntentAsync failed:', err);
        onError?.(err);
      });
  },

  /**
   * Execute after user confirmation
   */
  executeConfirmed(intent: VoiceIntent): Promise<ExecutionResult> {
    const intentJson = JSON.stringify(intent);

    return invoke<AsyncResult<ExecutionResult>>('execute_confirmed', { intentJson })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] executeConfirmed failed:', err);
        return {
          success: false,
          message: `Confirmation failed: ${err}`,
          signature: undefined,
          data: undefined,
        };
      });
  },
};

// ============================================================================
// Protocol State API (Non-Blocking)
// ============================================================================

export const ProtocolAPI = {
  /**
   * Get protocol state for HUD
   * Non-blocking RPC query
   */
  getProtocolState(): Promise<ProtocolState> {
    return invoke<AsyncResult<ProtocolState>>('get_protocol_state')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getProtocolState failed:', err);
        // Return stale/empty state on error
        return {
          open_task_count: 0,
          total_value_locked_sol: 0,
          active_operators: 0,
          last_updated: Date.now() / 1000,
        };
      });
  },

  /**
   * Get protocol state with callback (non-blocking)
   * HUD can keep updating while this fetches
   */
  getProtocolStateAsync(
    onSuccess: (state: ProtocolState) => void,
    onError?: (err: Error) => void
  ): void {
    invoke<AsyncResult<ProtocolState>>('get_protocol_state')
      .then((result) => {
        if (result.success && result.data) {
          onSuccess(result.data);
        }
      })
      .catch((err) => {
        console.warn('[API] Background protocol state fetch failed:', err);
        onError?.(err);
      });
  },

  /**
   * List tasks with optional status filter
   * @param status - Optional filter by status (open, claimed, completed, cancelled)
   */
  listTasks(status?: string): Promise<AgencTask[]> {
    return invoke<AsyncResult<AgencTask[]>>('list_tasks', { status })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] listTasks failed:', err);
        return [];
      });
  },

  /**
   * List tasks with callback (non-blocking)
   */
  listTasksAsync(
    onSuccess: (tasks: AgencTask[]) => void,
    onError?: (err: Error) => void
  ): void {
    invoke<AsyncResult<AgencTask[]>>('list_tasks')
      .then((result) => {
        if (result.success && result.data) {
          onSuccess(result.data);
        }
      })
      .catch((err) => {
        console.warn('[API] Background task fetch failed:', err);
        onError?.(err);
      });
  },

  /**
   * Trigger background state refresh (fire-and-forget)
   * Returns immediately, refresh happens in Rust
   */
  refreshInBackground(): void {
    invoke('refresh_state_background').catch((err) => {
      console.warn('[API] Background refresh failed:', err);
    });
  },
};

// ============================================================================
// Policy API (Fast, In-Memory)
// ============================================================================

export const PolicyAPI = {
  /**
   * Check policy for intent (fast, no spawn needed)
   */
  checkPolicy(intent: VoiceIntent): Promise<PolicyCheck> {
    const intentJson = JSON.stringify(intent);
    return invoke<PolicyCheck>('check_policy', { intentJson });
  },

  /**
   * Get current session spending
   */
  getSessionSpending(): Promise<number> {
    return invoke<number>('get_session_spending');
  },
};

// ============================================================================
// Voice State API (Fast, In-Memory)
// ============================================================================

export const VoiceAPI = {
  /**
   * Set voice state (fast write)
   */
  setVoiceState(voiceState: VoiceState): Promise<void> {
    return invoke('set_voice_state', { voiceState });
  },

  /**
   * Get voice state (fast read)
   */
  getVoiceState(): Promise<VoiceState> {
    return invoke<VoiceState>('get_voice_state');
  },

  /**
   * Get ephemeral token for voice WebSocket connection.
   * The Rust backend exchanges the real API key for a short-lived session
   * token so the raw key never reaches the browser. The token is passed
   * via the Sec-WebSocket-Protocol header (required by x.ai realtime API)
   * and expires after ~5 minutes. Request a new one before expiry.
   *
   * SECURITY: Never log the returned token value — log only its length.
   */
  getVoiceToken(): Promise<string> {
    return invoke<AsyncResult<string>>('get_voice_token')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getVoiceToken failed:', err);
        throw new TetsuoAPIError(`Failed to get voice token: ${err}`);
      });
  },
};

// ============================================================================
// Config API
// ============================================================================

export const ConfigAPI = {
  /**
   * Set RPC URL (spawns executor recreation)
   */
  setRpcUrl(rpcUrl: string): Promise<void> {
    return invoke('set_rpc_url', { rpcUrl });
  },

  /**
   * Get current config
   */
  getConfig(): Promise<AppConfig> {
    return invoke<AppConfig>('get_config');
  },
};

// ============================================================================
// Access Control API (Token Gating)
// ============================================================================

export const AccessAPI = {
  /**
   * Get user's access tier based on $TETSUO holdings
   */
  getAccessTier(walletPubkey: string): Promise<AccessTierInfo> {
    return invoke<AsyncResult<AccessTierInfo>>('get_access_tier', { walletPubkey })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getAccessTier failed:', err);
        // Return default tier on error
        return {
          tier: 'none' as const,
          balance: 0,
          balance_formatted: '0',
          next_tier: 'basic' as const,
          tokens_to_next_tier: 10_000,
        };
      });
  },

  /**
   * Get access tier with callback (non-blocking)
   */
  getAccessTierAsync(
    walletPubkey: string,
    onSuccess: (info: AccessTierInfo) => void,
    onError?: (err: Error) => void
  ): void {
    invoke<AsyncResult<AccessTierInfo>>('get_access_tier', { walletPubkey })
      .then((result) => {
        if (result.success && result.data) {
          onSuccess(result.data);
        }
      })
      .catch((err) => {
        console.warn('[API] Background access tier fetch failed:', err);
        onError?.(err);
      });
  },

  /**
   * Check if wallet can use a specific feature
   */
  checkFeatureAccess(walletPubkey: string, feature: Feature): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('check_feature_access', { walletPubkey, feature })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] checkFeatureAccess failed:', err);
        return false; // Deny on error
      });
  },

  /**
   * Invalidate cached access tier (call after token transfer)
   */
  invalidateCache(walletPubkey: string): Promise<void> {
    return invoke('invalidate_access_cache', { walletPubkey });
  },
};

// ============================================================================
// Memory API (Conversation Memory)
// ============================================================================

export const MemoryAPI = {
  /**
   * Initialize the memory system (connects to Qdrant)
   * Call this once at app startup if you want memory features
   */
  initialize(): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('init_memory_system')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] initMemorySystem failed:', err);
        return false;
      });
  },

  /**
   * Check if memory system is healthy/connected
   */
  healthCheck(): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('memory_health_check')
      .then(unwrapResult)
      .catch(() => false);
  },

  /**
   * Get memories for a user
   */
  getUserMemories(userId: string, limit?: number): Promise<Memory[]> {
    return invoke<AsyncResult<Memory[]>>('get_user_memories', { userId, limit })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getUserMemories failed:', err);
        return [];
      });
  },

  /**
   * Search memories by semantic similarity
   */
  searchMemories(userId: string, query: string, limit?: number): Promise<Memory[]> {
    return invoke<AsyncResult<Memory[]>>('search_memories', { userId, query, limit })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] searchMemories failed:', err);
        return [];
      });
  },

  /**
   * Store a new memory
   */
  storeMemory(
    userId: string,
    content: string,
    memoryType: string,
    importance?: number
  ): Promise<Memory | null> {
    return invoke<AsyncResult<Memory>>('store_memory', {
      userId,
      content,
      memoryType,
      importance,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] storeMemory failed:', err);
        return null;
      });
  },

  /**
   * Build complete voice context (memories + access tier)
   * Use this before starting a voice session
   */
  buildVoiceContext(userId: string, currentMessage?: string): Promise<UserContext | null> {
    return invoke<AsyncResult<UserContext>>('build_voice_context', {
      userId,
      currentMessage: currentMessage ?? '',
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] buildVoiceContext failed:', err);
        return null;
      });
  },

  /**
   * Delete all memories for a user
   */
  deleteUserMemories(userId: string): Promise<number> {
    return invoke<AsyncResult<number>>('delete_user_memories', { userId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] deleteUserMemories failed:', err);
        return 0;
      });
  },
};

// ============================================================================
// Debug Logging API (logs to terminal)
// ============================================================================

export const DebugAPI = {
  /**
   * Log a message to the Rust backend terminal
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    invoke('frontend_log', { level, message }).catch(() => {
      // Fallback to console if IPC fails
      console.log(`[${level}] ${message}`);
    });
  },

  debug(message: string): void {
    this.log('debug', message);
  },

  info(message: string): void {
    this.log('info', message);
  },

  warn(message: string): void {
    this.log('warn', message);
  },

  error(message: string): void {
    this.log('error', message);
  },
};

// ============================================================================
// Code API (Grok Code Operations)
// ============================================================================

export const CodeAPI = {
  /**
   * Fix code in a file using Grok
   * @param filePath - Path to the file to fix
   * @param issue - Description of the issue to fix
   * @param autoApply - If true, writes the fix directly to the file
   */
  fixCode(filePath: string, issue: string, autoApply = false): Promise<string> {
    return invoke<AsyncResult<string>>('execute_code_fix', { filePath, issue, autoApply })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] fixCode failed:', err);
        throw new TetsuoAPIError(`Code fix failed: ${err}`);
      });
  },

  /**
   * Review code in a file
   */
  reviewCode(filePath: string): Promise<string> {
    return invoke<AsyncResult<string>>('execute_code_review', { filePath })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] reviewCode failed:', err);
        throw new TetsuoAPIError(`Code review failed: ${err}`);
      });
  },

  /**
   * Generate code from description
   * @param description - What to generate
   * @param language - Target language (rust, typescript, python, etc.)
   * @param outputPath - Optional path to write the generated code
   */
  generateCode(description: string, language: string, outputPath?: string): Promise<string> {
    return invoke<AsyncResult<string>>('execute_code_generate', { description, language, outputPath })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] generateCode failed:', err);
        throw new TetsuoAPIError(`Code generation failed: ${err}`);
      });
  },

  /**
   * Explain code in a file
   */
  explainCode(filePath: string): Promise<string> {
    return invoke<AsyncResult<string>>('execute_code_explain', { filePath })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] explainCode failed:', err);
        throw new TetsuoAPIError(`Code explanation failed: ${err}`);
      });
  },
};

// ============================================================================
// Swap API (Jupiter Trading)
// ============================================================================

import type { SwapQuote, TokenPrice, TweetResult, DiscordResult, EmailResult, BulkEmailResult, ImageGenResult } from '../types';

export const SwapAPI = {
  /**
   * Get a quote for a token swap
   * @param fromToken - Token symbol or mint address to sell
   * @param toToken - Token symbol or mint address to buy
   * @param amount - Amount in smallest denomination (lamports for SOL)
   */
  getQuote(fromToken: string, toToken: string, amount: number): Promise<SwapQuote> {
    return invoke<AsyncResult<SwapQuote>>('get_swap_quote', { fromToken, toToken, amount })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getSwapQuote failed:', err);
        throw new TetsuoAPIError(`Quote failed: ${err}`);
      });
  },

  /**
   * Execute a token swap
   * @param fromToken - Token symbol or mint address to sell
   * @param toToken - Token symbol or mint address to buy
   * @param amount - Amount in smallest denomination
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  executeSwap(fromToken: string, toToken: string, amount: number, slippageBps?: number): Promise<string> {
    return invoke<AsyncResult<string>>('execute_swap', { fromToken, toToken, amount, slippageBps })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] executeSwap failed:', err);
        throw new TetsuoAPIError(`Swap failed: ${err}`);
      });
  },

  /**
   * Get current price of a token
   * @param token - Token symbol or mint address
   */
  getPrice(token: string): Promise<TokenPrice> {
    return invoke<AsyncResult<TokenPrice>>('get_token_price', { token })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getTokenPrice failed:', err);
        throw new TetsuoAPIError(`Price fetch failed: ${err}`);
      });
  },
};

// ============================================================================
// Twitter API (OAuth 2.0)
// ============================================================================

export const TwitterAPI = {
  /**
   * Start OAuth 2.0 + PKCE authentication flow
   * Opens browser for Twitter login
   * @returns Promise<boolean> - true if auth succeeded
   */
  startAuth(): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('twitter_start_auth')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] startAuth failed:', err);
        throw new TetsuoAPIError(`Twitter login failed: ${err}`);
      });
  },

  /**
   * Check if Twitter is connected (has valid tokens)
   * @returns Promise<boolean> - true if connected
   */
  checkConnected(): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('twitter_check_connected')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] checkConnected failed:', err);
        return false;
      });
  },

  /**
   * Disconnect Twitter (remove stored tokens)
   * @returns Promise<boolean> - true if disconnected
   */
  disconnect(): Promise<boolean> {
    return invoke<AsyncResult<boolean>>('twitter_disconnect')
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] disconnect failed:', err);
        throw new TetsuoAPIError(`Twitter disconnect failed: ${err}`);
      });
  },

  /**
   * Post a tweet
   * @param content - Tweet text (max 280 chars)
   * @param replyTo - Optional tweet ID to reply to
   */
  postTweet(content: string, replyTo?: string): Promise<TweetResult> {
    return invoke<AsyncResult<TweetResult>>('post_tweet', { content, replyTo })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] postTweet failed:', err);
        throw new TetsuoAPIError(`Tweet failed: ${err}`);
      });
  },

  /**
   * Post a thread of tweets
   * @param tweets - Array of tweet texts
   */
  postThread(tweets: string[]): Promise<TweetResult[]> {
    return invoke<AsyncResult<TweetResult[]>>('post_thread', { tweets })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] postThread failed:', err);
        throw new TetsuoAPIError(`Thread post failed: ${err}`);
      });
  },
};

// ============================================================================
// Discord API (Bot Token)
// ============================================================================

export const DiscordAPI = {
  /**
   * Post a message to a Discord channel
   * @param channelName - Name of the channel (e.g., "general")
   * @param content - Message content
   * @param serverId - Optional server/guild ID (uses default if not specified)
   */
  postMessage(channelName: string, content: string, serverId?: string): Promise<DiscordResult> {
    return invoke<AsyncResult<DiscordResult>>('post_discord', { channelName, content, serverId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] postDiscord failed:', err);
        throw new TetsuoAPIError(`Discord post failed: ${err}`);
      });
  },

  /**
   * Post an embed to a Discord channel
   * @param channelName - Name of the channel
   * @param title - Embed title
   * @param description - Embed description
   * @param color - Optional color as hex number (e.g., 0xff0000 for red)
   * @param serverId - Optional server/guild ID
   */
  postEmbed(
    channelName: string,
    title: string,
    description: string,
    color?: number,
    serverId?: string
  ): Promise<DiscordResult> {
    return invoke<AsyncResult<DiscordResult>>('post_discord_embed', {
      channelName,
      title,
      description,
      color,
      serverId,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] postDiscordEmbed failed:', err);
        throw new TetsuoAPIError(`Discord embed failed: ${err}`);
      });
  },
};

// ============================================================================
// Email API (Resend)
// ============================================================================

export const EmailAPI = {
  /**
   * Send a single email
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param body - Email body (plain text or HTML)
   * @param html - If true, body is treated as HTML
   */
  send(to: string, subject: string, body: string, html = false): Promise<EmailResult> {
    return invoke<AsyncResult<EmailResult>>('send_email', { to, subject, body, html })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] sendEmail failed:', err);
        throw new TetsuoAPIError(`Email send failed: ${err}`);
      });
  },

  /**
   * Send bulk emails to multiple recipients
   * @param recipients - Array of email addresses
   * @param subject - Email subject
   * @param body - Email body (plain text)
   */
  sendBulk(recipients: string[], subject: string, body: string): Promise<BulkEmailResult> {
    return invoke<AsyncResult<BulkEmailResult>>('send_bulk_email', { recipients, subject, body })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] sendBulkEmail failed:', err);
        throw new TetsuoAPIError(`Bulk email failed: ${err}`);
      });
  },
};

// ============================================================================
// Image Generation API (Grok)
// ============================================================================

export const ImageAPI = {
  /**
   * Generate an image from a text prompt
   * @param prompt - Description of the image to generate
   * @param savePath - Optional path to save the image (default: generated/<timestamp>.png)
   */
  generate(prompt: string, savePath?: string): Promise<ImageGenResult> {
    return invoke<AsyncResult<ImageGenResult>>('generate_image', { prompt, savePath })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] generateImage failed:', err);
        throw new TetsuoAPIError(`Image generation failed: ${err}`);
      });
  },
};

// ============================================================================
// GitHub API (Push Code to GitHub)
// ============================================================================

export interface GistResult {
  gist_id: string;
  url: string;
  raw_url?: string;
}

export interface IssueResult {
  issue_number: number;
  url: string;
}

export interface CommentResult {
  comment_id: number;
  url: string;
}

export interface WorkflowResult {
  triggered: boolean;
}

export const GitHubAPI = {
  /**
   * Create a gist with code
   * @param description - Description of the gist
   * @param filename - Filename for the gist (e.g., "code.ts")
   * @param content - The code content
   * @param isPublic - If true, gist is public (default: false for secret)
   */
  createGist(
    description: string,
    filename: string,
    content: string,
    isPublic = false
  ): Promise<GistResult> {
    return invoke<AsyncResult<GistResult>>('create_gist', {
      description,
      filename,
      content,
      public: isPublic,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] createGist failed:', err);
        throw new TetsuoAPIError(`Gist creation failed: ${err}`);
      });
  },

  /**
   * Create an issue in a GitHub repository
   * @param title - Issue title
   * @param body - Issue body (markdown supported)
   * @param options - Optional owner, repo, and labels
   */
  createIssue(
    title: string,
    body: string,
    options?: {
      owner?: string;
      repo?: string;
      labels?: string[];
    }
  ): Promise<IssueResult> {
    return invoke<AsyncResult<IssueResult>>('create_github_issue', {
      title,
      body,
      owner: options?.owner,
      repo: options?.repo,
      labels: options?.labels,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] createIssue failed:', err);
        throw new TetsuoAPIError(`Issue creation failed: ${err}`);
      });
  },

  /**
   * Add a comment to an issue or PR
   * @param issueNumber - Issue or PR number
   * @param body - Comment body (markdown supported)
   * @param options - Optional owner and repo
   */
  addComment(
    issueNumber: number,
    body: string,
    options?: {
      owner?: string;
      repo?: string;
    }
  ): Promise<CommentResult> {
    return invoke<AsyncResult<CommentResult>>('add_github_comment', {
      issue_number: issueNumber,
      body,
      owner: options?.owner,
      repo: options?.repo,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] addComment failed:', err);
        throw new TetsuoAPIError(`Comment failed: ${err}`);
      });
  },

  /**
   * Trigger a workflow dispatch
   * @param workflowId - Workflow filename or ID (e.g., "deploy.yml")
   * @param refName - Git ref to run on (e.g., "main")
   * @param options - Optional owner, repo, and workflow inputs
   */
  triggerWorkflow(
    workflowId: string,
    refName: string,
    options?: {
      owner?: string;
      repo?: string;
      inputs?: Record<string, unknown>;
    }
  ): Promise<WorkflowResult> {
    return invoke<AsyncResult<WorkflowResult>>('trigger_github_workflow', {
      workflow_id: workflowId,
      ref_name: refName,
      owner: options?.owner,
      repo: options?.repo,
      inputs: options?.inputs,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] triggerWorkflow failed:', err);
        throw new TetsuoAPIError(`Workflow trigger failed: ${err}`);
      });
  },
};

// ============================================================================
// Task API (Task Marketplace Operations)
// ============================================================================

export const TaskAPI = {
  /**
   * List tasks with optional status filter
   * @param status - Optional filter by status (open, claimed, completed, cancelled)
   */
  listTasks(status?: string): Promise<AgencTask[]> {
    return ProtocolAPI.listTasks(status);
  },

  /**
   * Claim a task
   * @param taskId - ID of the task to claim
   */
  claimTask(taskId: string): Promise<ExecutionResult> {
    return invoke<AsyncResult<ExecutionResult>>('claim_task', { taskId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] claimTask failed:', err);
        throw new TetsuoAPIError(`Failed to claim task: ${err}`);
      });
  },

  /**
   * Complete a claimed task
   * @param taskId - ID of the task to complete
   */
  completeTask(taskId: string): Promise<ExecutionResult> {
    return invoke<AsyncResult<ExecutionResult>>('complete_task', { taskId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] completeTask failed:', err);
        throw new TetsuoAPIError(`Failed to complete task: ${err}`);
      });
  },

  /**
   * Cancel a task (owner only)
   * @param taskId - ID of the task to cancel
   */
  cancelTask(taskId: string): Promise<ExecutionResult> {
    return invoke<AsyncResult<ExecutionResult>>('cancel_task', { taskId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] cancelTask failed:', err);
        throw new TetsuoAPIError(`Failed to cancel task: ${err}`);
      });
  },

  /**
   * Create a new task
   * @param description - Task description
   * @param rewardSol - Reward amount in SOL
   * @param deadline - Optional deadline timestamp
   */
  createTask(description: string, rewardSol: number, deadline?: number): Promise<ExecutionResult> {
    return invoke<AsyncResult<ExecutionResult>>('create_task', {
      description,
      rewardSol,
      deadline,
    })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] createTask failed:', err);
        throw new TetsuoAPIError(`Failed to create task: ${err}`);
      });
  },

  /**
   * Get task status
   * @param taskId - ID of the task
   */
  getTaskStatus(taskId: string): Promise<AgencTask> {
    return invoke<AsyncResult<AgencTask>>('get_task_status', { taskId })
      .then(unwrapResult)
      .catch((err) => {
        console.error('[API] getTaskStatus failed:', err);
        throw new TetsuoAPIError(`Failed to get task status: ${err}`);
      });
  },
};

export const TetsuoAPI = {
  wallet: WalletAPI,
  intent: IntentAPI,
  protocol: ProtocolAPI,
  policy: PolicyAPI,
  voice: VoiceAPI,
  config: ConfigAPI,
  access: AccessAPI,
  memory: MemoryAPI,
  debug: DebugAPI,
  // Task Marketplace
  task: TaskAPI,
  // Phase 2 APIs
  code: CodeAPI,
  swap: SwapAPI,
  twitter: TwitterAPI,
  // Phase 3 APIs
  discord: DiscordAPI,
  email: EmailAPI,
  image: ImageAPI,
  // Phase 4 APIs
  github: GitHubAPI,
};

export default TetsuoAPI;
