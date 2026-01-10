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
   * List open tasks
   */
  listTasks(): Promise<AgencTask[]> {
    return invoke<AsyncResult<AgencTask[]>>('list_tasks')
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
// Unified API Export
// ============================================================================

export const TetsuoAPI = {
  wallet: WalletAPI,
  intent: IntentAPI,
  protocol: ProtocolAPI,
  policy: PolicyAPI,
  voice: VoiceAPI,
  config: ConfigAPI,
};

export default TetsuoAPI;
