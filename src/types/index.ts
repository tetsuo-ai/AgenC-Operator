/**
 * ============================================================================
 * TETSUO - TypeScript Types
 * ============================================================================
 * Type definitions that mirror the Rust types for IPC communication.
 * These should stay in sync with operator-core/src/types.rs
 * ============================================================================
 */

// ============================================================================
// Voice Intent Types
// ============================================================================

export type IntentAction =
  | 'create_task'
  | 'claim_task'
  | 'complete_task'
  | 'cancel_task'
  | 'list_open_tasks'
  | 'get_task_status'
  | 'get_balance'
  | 'get_address'
  | 'get_protocol_state'
  | 'help'
  | 'unknown';

export interface VoiceIntent {
  action: IntentAction;
  params: Record<string, unknown>;
  raw_transcript?: string;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled' | 'disputed';

export interface AgencTask {
  id: string;
  creator: string;
  description: string;
  reward_lamports: number;
  status: TaskStatus;
  claimer?: string;
  created_at: number;
  deadline?: number;
}

// Helper to convert lamports to SOL
export const lamportsToSol = (lamports: number): number => lamports / 1_000_000_000;
export const solToLamports = (sol: number): number => sol * 1_000_000_000;

// ============================================================================
// Protocol State
// ============================================================================

export interface ProtocolState {
  open_task_count: number;
  total_value_locked_sol: number;
  active_operators: number;
  last_updated: number;
}

// ============================================================================
// Wallet Types
// ============================================================================

export interface WalletInfo {
  address: string;
  balance_sol: number;
  is_connected: boolean;
}

// ============================================================================
// Policy Types
// ============================================================================

export type ConfirmationType = 'none' | 'verbal' | 'typed' | 'hardware';

export interface PolicyCheck {
  allowed: boolean;
  requires_confirmation: boolean;
  confirmation_type: ConfirmationType;
  reason: string;
}

// ============================================================================
// Execution Result
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  message: string;
  signature?: string;
  data?: unknown;
}

// ============================================================================
// Voice State
// ============================================================================

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

// ============================================================================
// App Configuration
// ============================================================================

export interface AppConfig {
  rpc_url: string;
  network: string;
  whisper_model_path?: string;
  grok_api_key?: string;
}

// ============================================================================
// Grok Voice API Types
// ============================================================================

export interface GrokMessage {
  type: 'session.update' | 'conversation.item.create' | 'response.create' | 'input_audio_buffer.append' | 'input_audio_buffer.commit';
  session?: {
    modalities: string[];
    instructions: string;
    voice?: string;
    input_audio_format?: string;
    output_audio_format?: string;
    turn_detection?: {
      type: string;
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };
  };
  item?: {
    type: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
  };
  response?: {
    modalities: string[];
  };
  audio?: string; // base64 encoded audio
}

export interface GrokResponse {
  type: string;
  event_id?: string;
  session?: unknown;
  item?: {
    id: string;
    object: string;
    status: string;
    role: string;
    content: Array<{
      type: string;
      text?: string;
      audio?: string;
      transcript?: string;
    }>;
  };
  delta?: {
    audio?: string;
    text?: string;
    transcript?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// UI Types
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'tetsuo' | 'system';
  content: string;
  timestamp: number;
  intent?: VoiceIntent;
  result?: ExecutionResult;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  duration?: number;
}

// ============================================================================
// Agent Avatar Types
// ============================================================================

/**
 * Visual appearance configuration for the avatar.
 * Controls colors, effects, and preset management.
 */
export interface AgentAppearance {
  nameplate: string;
  accentColor: string; // hex color
  hairColor: string; // hex color
  eyeGlowColor: string; // hex color
  effects: {
    scanlines: boolean;
    noise: boolean;
    rgbSplit: boolean;
    vignette: boolean;
    bloom: boolean;
  };
  effectsIntensity: number; // 0 to 1
  presetId?: string;
}

/**
 * Runtime status of the agent/avatar.
 * Drives visual state changes and animations.
 */
export interface AgentStatus {
  online: boolean;
  network: 'localnet' | 'devnet' | 'mainnet';
  walletConnected: boolean;
  micActive: boolean;
  lastHeard?: string;
  mode: 'idle' | 'listening' | 'speaking' | 'thinking' | 'error';
}

/**
 * Saved appearance preset for quick loading.
 */
export interface AppearancePreset {
  id: string;
  name: string;
  appearance: AgentAppearance;
  createdAt: number;
}

/**
 * Default appearance configuration.
 */
export const DEFAULT_APPEARANCE: AgentAppearance = {
  nameplate: 'TETSUO',
  accentColor: '#00ffff',
  hairColor: '#ffffff',
  eyeGlowColor: '#00ffff',
  effects: {
    scanlines: true,
    noise: true,
    rgbSplit: false,
    vignette: true,
    bloom: true,
  },
  effectsIntensity: 0.7,
};
