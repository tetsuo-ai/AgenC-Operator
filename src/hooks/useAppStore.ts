/**
 * ============================================================================
 * useAppStore - Global State Management with Zustand
 * ============================================================================
 * Centralized state for the Tetsuo operator application.
 * Manages voice state, wallet info, protocol state, chat messages,
 * and avatar appearance configuration with preset persistence.
 * ============================================================================
 */

import { create } from 'zustand';
import type {
  VoiceState,
  WalletInfo,
  ProtocolState,
  ChatMessage,
  AgentAppearance,
  AppearancePreset,
  AccessTierInfo,
} from '../types';
import { DEFAULT_APPEARANCE } from '../types';

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  APPEARANCE: 'tetsuo-appearance',
  PRESETS: 'tetsuo-appearance-presets',
  AUDIO_ENABLED: 'tetsuo-audio-enabled',
} as const;

// ============================================================================
// Local Storage Helpers
// ============================================================================

function loadAppearanceFromStorage(): AgentAppearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.APPEARANCE);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle any missing fields
      return { ...DEFAULT_APPEARANCE, ...parsed };
    }
  } catch (e) {
    console.warn('[AppStore] Failed to load appearance from storage:', e);
  }
  return DEFAULT_APPEARANCE;
}

function saveAppearanceToStorage(appearance: AgentAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEYS.APPEARANCE, JSON.stringify(appearance));
  } catch (e) {
    console.warn('[AppStore] Failed to save appearance to storage:', e);
  }
}

function loadPresetsFromStorage(): AppearancePreset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PRESETS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[AppStore] Failed to load presets from storage:', e);
  }
  return [];
}

function savePresetsToStorage(presets: AppearancePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(presets));
  } catch (e) {
    console.warn('[AppStore] Failed to save presets to storage:', e);
  }
}

interface AppState {
  // Voice State
  voiceState: VoiceState;
  setVoiceState: (state: VoiceState) => void;

  // Wallet
  wallet: WalletInfo | null;
  setWallet: (wallet: WalletInfo | null) => void;

  // Access Tier (Token Gating)
  accessTier: AccessTierInfo | null;
  setAccessTier: (tier: AccessTierInfo | null) => void;

  // Protocol State
  protocolState: ProtocolState | null;
  setProtocolState: (state: ProtocolState | null) => void;

  // Chat Messages
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;

  // UI State
  isGlitching: boolean;
  setIsGlitching: (glitching: boolean) => void;

  // Pending Intent (awaiting confirmation)
  pendingIntent: string | null;
  setPendingIntent: (intent: string | null) => void;

  // Avatar Appearance
  appearance: AgentAppearance;
  setAppearance: (appearance: AgentAppearance) => void;
  updateAppearance: (partial: Partial<AgentAppearance>) => void;
  resetAppearance: () => void;

  // Appearance Presets
  presets: AppearancePreset[];
  savePreset: (name: string, appearance: AgentAppearance) => string;
  loadPreset: (id: string) => boolean;
  deletePreset: (id: string) => void;
  listPresets: () => AppearancePreset[];

  // Customize Panel State
  isCustomizeOpen: boolean;
  setIsCustomizeOpen: (open: boolean) => void;
  toggleCustomize: () => void;

  // HUD Panel State
  isHudOpen: boolean;
  setIsHudOpen: (open: boolean) => void;
  toggleHud: () => void;

  // Task Marketplace State
  isMarketplaceOpen: boolean;
  setIsMarketplaceOpen: (open: boolean) => void;
  toggleMarketplace: () => void;

  // Audio Output
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Voice State
  voiceState: 'idle',
  setVoiceState: (voiceState) => set({ voiceState }),

  // Wallet
  wallet: null,
  setWallet: (wallet) => set({ wallet }),

  // Access Tier (Token Gating)
  accessTier: null,
  setAccessTier: (accessTier) => set({ accessTier }),

  // Protocol State
  protocolState: null,
  setProtocolState: (protocolState) => set({ protocolState }),

  // Chat Messages
  messages: [],
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages.slice(-50), message], // Keep last 50 messages
    })),
  clearMessages: () => set({ messages: [] }),

  // UI State
  isGlitching: false,
  setIsGlitching: (isGlitching) => set({ isGlitching }),

  // Pending Intent
  pendingIntent: null,
  setPendingIntent: (pendingIntent) => set({ pendingIntent }),

  // Avatar Appearance (loaded from localStorage on init)
  appearance: loadAppearanceFromStorage(),
  setAppearance: (appearance) => {
    saveAppearanceToStorage(appearance);
    set({ appearance });
  },
  updateAppearance: (partial) => {
    const current = get().appearance;
    const updated = { ...current, ...partial };
    saveAppearanceToStorage(updated);
    set({ appearance: updated });
  },
  resetAppearance: () => {
    saveAppearanceToStorage(DEFAULT_APPEARANCE);
    set({ appearance: DEFAULT_APPEARANCE });
  },

  // Appearance Presets (loaded from localStorage on init)
  presets: loadPresetsFromStorage(),
  savePreset: (name, appearance) => {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newPreset: AppearancePreset = {
      id,
      name,
      appearance: { ...appearance, presetId: id },
      createdAt: Date.now(),
    };
    const updatedPresets = [...get().presets, newPreset];
    savePresetsToStorage(updatedPresets);
    set({ presets: updatedPresets });
    return id;
  },
  loadPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (preset) {
      const appearance = { ...preset.appearance, presetId: id };
      saveAppearanceToStorage(appearance);
      set({ appearance });
      return true;
    }
    return false;
  },
  deletePreset: (id) => {
    const updatedPresets = get().presets.filter((p) => p.id !== id);
    savePresetsToStorage(updatedPresets);
    set({ presets: updatedPresets });
  },
  listPresets: () => get().presets,

  // Customize Panel State
  isCustomizeOpen: false,
  setIsCustomizeOpen: (isCustomizeOpen) => set({ isCustomizeOpen }),
  toggleCustomize: () => set((state) => ({ isCustomizeOpen: !state.isCustomizeOpen })),

  // HUD Panel State
  isHudOpen: false,
  setIsHudOpen: (isHudOpen) => set({ isHudOpen }),
  toggleHud: () => set((state) => ({ isHudOpen: !state.isHudOpen })),

  // Task Marketplace State
  isMarketplaceOpen: false,
  setIsMarketplaceOpen: (isMarketplaceOpen) => set({ isMarketplaceOpen }),
  toggleMarketplace: () => set((state) => ({ isMarketplaceOpen: !state.isMarketplaceOpen })),

  // Audio Output (persisted to localStorage)
  audioEnabled: localStorage.getItem(STORAGE_KEYS.AUDIO_ENABLED) !== 'false',
  setAudioEnabled: (audioEnabled) => {
    localStorage.setItem(STORAGE_KEYS.AUDIO_ENABLED, String(audioEnabled));
    set({ audioEnabled });
  },
}));

// ============================================================================
// Selector Hooks for Performance
// ============================================================================

export const useVoiceState = () => useAppStore((state) => state.voiceState);
export const useWallet = () => useAppStore((state) => state.wallet);
export const useAccessTier = () => useAppStore((state) => state.accessTier);
export const useProtocolState = () => useAppStore((state) => state.protocolState);
export const useMessages = () => useAppStore((state) => state.messages);
export const useAppearance = () => useAppStore((state) => state.appearance);
export const usePresets = () => useAppStore((state) => state.presets);
export const useIsCustomizeOpen = () => useAppStore((state) => state.isCustomizeOpen);
export const useIsHudOpen = () => useAppStore((state) => state.isHudOpen);
export const useIsMarketplaceOpen = () => useAppStore((state) => state.isMarketplaceOpen);
export const useAudioEnabled = () => useAppStore((state) => state.audioEnabled);
