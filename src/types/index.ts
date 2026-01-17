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
  // Code Operations (Pro tier)
  | 'code_fix'
  | 'code_review'
  | 'code_generate'
  | 'code_explain'
  // Trading Operations (Basic tier)
  | 'swap_tokens'
  | 'get_swap_quote'
  | 'get_token_price'
  // Social Operations (Pro tier)
  | 'post_tweet'
  | 'post_thread'
  // Discord Operations (Pro tier)
  | 'post_discord'
  | 'post_discord_embed'
  // Email Operations (Pro tier)
  | 'send_email'
  | 'send_bulk_email'
  // Image Generation (Pro tier)
  | 'generate_image'
  // System
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
  qdrant_url?: string;
  openai_api_key?: string;
  // Twitter OAuth 2.0 client ID (public, for PKCE flow)
  twitter_client_id?: string;
  // Phase 3: Discord, Email, Image config
  discord_bot_token?: string;
  discord_default_guild_id?: string;
  resend_api_key?: string;
  email_from_address?: string;
  email_from_name?: string;
}

// ============================================================================
// Trading Types (Jupiter Swap)
// ============================================================================

export interface SwapQuote {
  in_amount: string;
  out_amount: string;
  price_impact_pct: string;
  other_amount_threshold: string;
  swap_mode: string;
}

export interface TokenPrice {
  mint: string;
  price_usd: number;
}

export interface SwapParams {
  input_mint: string;
  output_mint: string;
  amount: number;
  slippage_bps?: number;
}

// Common token symbols -> mint addresses
export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
} as const;

// ============================================================================
// Twitter Types
// ============================================================================

export interface TweetResult {
  tweet_id: string;
  url: string;
}

// ============================================================================
// Discord Types (Phase 3)
// ============================================================================

export interface DiscordResult {
  message_id: string;
  channel_id: string;
}

export interface DiscordMessageParams {
  channel_name: string;
  content: string;
  server_id?: string;
}

export interface DiscordEmbedParams {
  channel_name: string;
  title: string;
  description: string;
  color?: number;
  server_id?: string;
}

// ============================================================================
// Email Types (Phase 3)
// ============================================================================

export interface EmailResult {
  id: string;
}

export interface BulkEmailResult {
  success: number;
  failed: number;
}

export interface EmailParams {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
}

export interface BulkEmailParams {
  recipients: string[];
  subject: string;
  body: string;
}

// ============================================================================
// Image Generation Types (Phase 3)
// ============================================================================

export interface ImageGenResult {
  path: string;
}

export interface ImageGenParams {
  prompt: string;
  save_path?: string;
}

// ============================================================================
// Code Operation Types
// ============================================================================

export interface CodeFixParams {
  file_path: string;
  issue_description: string;
  auto_apply?: boolean;
}

export interface CodeReviewParams {
  file_path: string;
}

export interface CodeGenerateParams {
  description: string;
  language: string;
  output_path?: string;
}

export interface CodeResult {
  code?: string;
  explanation?: string;
  suggestions: string[];
}

// ============================================================================
// Access Tier Types (Token Gating)
// ============================================================================

export type AccessTier = 'none' | 'basic' | 'pro' | 'whale' | 'diamond';

export interface AccessTierInfo {
  tier: AccessTier;
  balance: number;
  balance_formatted: string;
  next_tier?: AccessTier;
  tokens_to_next_tier?: number;
}

export type Feature =
  | 'voice'
  | 'trading'
  | 'social'
  | 'email'
  | 'code'
  | 'image_gen'
  | 'spawn'
  | 'priority_queue'
  | 'custom_personality'
  | 'api_access'
  | 'memory';

// Tier thresholds in tokens
export const TIER_THRESHOLDS = {
  basic: 10_000,    // 10K TETSUO
  pro: 100_000,     // 100K TETSUO
  whale: 1_000_000, // 1M TETSUO
};

// Features available per tier
export const TIER_FEATURES: Record<AccessTier, Feature[]> = {
  none: [],
  basic: ['voice', 'trading', 'memory'],
  pro: ['voice', 'trading', 'memory', 'social', 'email', 'code', 'image_gen', 'api_access'],
  whale: ['voice', 'trading', 'memory', 'social', 'email', 'code', 'image_gen', 'api_access', 'spawn', 'priority_queue', 'custom_personality'],
  diamond: ['voice', 'trading', 'memory', 'social', 'email', 'code', 'image_gen', 'api_access', 'spawn', 'priority_queue', 'custom_personality'],
};

// Helper to check if a tier can use a feature
export const canUseFeature = (tier: AccessTier, feature: Feature): boolean => {
  return TIER_FEATURES[tier]?.includes(feature) ?? false;
};

// ============================================================================
// Memory Types
// ============================================================================

export type MemoryType = 'user_fact' | 'goal' | 'event' | 'summary' | 'preference' | 'task';

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  memory_type: MemoryType;
  importance: number;
  created_at: number;
  last_accessed: number;
  access_count: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface UserContext {
  user_id: string;
  wallet_pubkey: string;
  tetsuo_balance: number;
  access_tier: AccessTier;
  recent_turns: ConversationTurn[];
  relevant_memories: Memory[];
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
  // x.ai sends delta as either a string (for audio/transcript) or an object
  delta?: string | {
    audio?: string;
    text?: string;
    transcript?: string;
  };
  // For response.output_audio_transcript.done
  transcript?: string;
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
 * Default appearance configuration - black and white.
 */
export const DEFAULT_APPEARANCE: AgentAppearance = {
  nameplate: 'TETSUO',
  accentColor: '#ffffff',
  hairColor: '#ffffff',
  eyeGlowColor: '#ffffff',
  effects: {
    scanlines: true,
    noise: true,
    rgbSplit: false,
    vignette: true,
    bloom: true,
  },
  effectsIntensity: 0.7,
};
