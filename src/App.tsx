/**
 * ============================================================================
 * TETSUO - AgenC Operator :: Main Application (Non-Blocking)
 * ============================================================================
 * All chain operations use fire-and-forget callbacks.
 * HUD polls state without blocking voice pipeline.
 * Voice keeps humming smooth - mic stream never stalls.
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TetsuoAPI } from './api';

// Components
import TetsuoAvatar from './components/TetsuoAvatar';
import AppearanceMenu from './components/AppearanceMenu';
import GlitchOverlay from './components/GlitchOverlay';
import ChatPanel from './components/ChatPanel';
import TitleBar from './components/TitleBar';
import VoiceButton from './components/VoiceButton';
import StatusBar from './components/StatusBar';
import WalletDropdown from './components/WalletDropdown';
import HudPanel from './components/HudPanel';
import TaskMarketplace from './components/TaskMarketplace';

// Hooks
import { useVoicePipeline } from './hooks/useVoicePipeline';
import { useAppStore } from './hooks/useAppStore';
import { useAvatarStore, CAMERA_PRESETS } from './stores/avatarStore';
import { getGlobalVisemeDriver } from './hooks/useVisemeDriver';
import { getGlobalExpressionSystem } from './hooks/useExpressionSystem';
import type { EmotionType } from './hooks/useExpressionSystem';

// Types
import type { VoiceState, WalletInfo, ProtocolState, AgentStatus, CameraMode } from './types';

// ============================================================================
// Constants
// ============================================================================

const HUD_POLL_INTERVAL = 10000; // 10 seconds - don't hammer RPC
const WALLET_POLL_INTERVAL = 30000; // 30 seconds

// ============================================================================
// Main App Component
// ============================================================================

function App() {
  // ============================================================================
  // State
  // ============================================================================

  const {
    voiceState,
    setVoiceState,
    wallet,
    setWallet,
    protocolState,
    setProtocolState,
    messages,
    addMessage,
    isGlitching,
    setIsGlitching,
    appearance,
    isCustomizeOpen,
    setIsCustomizeOpen,
    toggleCustomize,
    isHudOpen,
    toggleHud,
    isMarketplaceOpen,
    toggleMarketplace,
  } = useAppStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Camera state
  const currentCameraMode = useAvatarStore((s) => s.currentMode);
  const setCameraMode = useAvatarStore((s) => s.setCameraMode);

  const CAMERA_MODES: { mode: CameraMode; label: string }[] = [
    { mode: 'closeup', label: 'Close-Up' },
    { mode: 'waist', label: 'Waist' },
    { mode: 'full-body', label: 'Full Body' },
    { mode: 'presentation', label: '3/4 View' },
  ];

  const cycleCameraMode = useCallback(() => {
    const modes: CameraMode[] = ['closeup', 'waist', 'full-body', 'presentation'];
    const currentIdx = modes.indexOf(currentCameraMode);
    const nextIdx = (currentIdx + 1) % modes.length;
    setCameraMode(modes[nextIdx]);
  }, [currentCameraMode, setCameraMode]);

  // ============================================================================
  // Derive AgentStatus from App State
  // ============================================================================

  const agentStatus: AgentStatus = useMemo(() => {
    // Map VoiceState to AgentStatus mode
    const modeMap: Record<VoiceState, AgentStatus['mode']> = {
      idle: 'idle',
      listening: 'listening',
      processing: 'thinking',
      speaking: 'speaking',
      error: 'error',
      reconnecting: 'error',
    };

    return {
      online: true,
      network: (protocolState ? 'devnet' : 'localnet') as AgentStatus['network'],
      walletConnected: wallet?.is_connected ?? false,
      micActive: voiceState === 'listening',
      lastHeard: messages.length > 0 ? messages[messages.length - 1].content : undefined,
      mode: modeMap[voiceState],
    };
  }, [voiceState, wallet, protocolState, messages]);

  // Refs for polling intervals and init guard
  const hudPollRef = useRef<NodeJS.Timeout | null>(null);
  const walletPollRef = useRef<NodeJS.Timeout | null>(null);
  const initializedRef = useRef(false);

  // ============================================================================
  // Voice Pipeline Hook
  // ============================================================================

  const {
    isConnected: isVoiceConnected,
    startListening,
    stopListening,
    sendTextMessage,
  } = useVoicePipeline({
    onVoiceStateChange: setVoiceState,
    onMessage: addMessage,
    onError: (err) => {
      setError(err);
      setVoiceState('error');
      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    },
    onGlitch: () => {
      setIsGlitching(true);
      setTimeout(() => setIsGlitching(false), 200);
    },
    // Feed transcript text to viseme driver for lip sync
    onTranscriptDelta: (text) => {
      getGlobalVisemeDriver()?.pushText(text);
    },
    // Feed audio chunk duration to viseme driver for timing sync
    onAudioChunkDuration: (duration) => {
      getGlobalVisemeDriver()?.pushAudioDuration(duration);
    },
    // Feed detected emotions to expression system for facial blending
    onEmotionDetected: (emotion, intensity) => {
      // Map voice pipeline emotion strings to EmotionType
      const emotionMap: Record<string, EmotionType> = {
        'happy': 'happy',
        'sad': 'sad',
        'angry': 'angry',
        'surprised': 'surprised',
        'thinking': 'thinking',
        'concerned': 'concerned',
        'attentive': 'listening',
        'curious': 'thinking',
        'neutral': 'neutral',
      };
      const mapped = emotionMap[emotion] ?? 'neutral';
      getGlobalExpressionSystem()?.setEmotion(mapped, intensity);
    },
  });

  // ============================================================================
  // Non-Blocking State Polling
  // ============================================================================

  /**
   * Poll wallet info - fire and forget with callback
   * Never blocks the main thread or voice pipeline
   */
  const pollWalletNonBlocking = useCallback(() => {
    TetsuoAPI.wallet.getWalletInfoNonBlocking(
      (info: WalletInfo) => {
        setWallet(info);
      },
      (err: Error) => {
        console.warn('[Poll] Wallet fetch failed:', err.message);
        // Don't update state on error - keep stale data
      }
    );
  }, [setWallet]);

  /**
   * Poll protocol state - fire and forget with callback
   */
  const pollProtocolStateNonBlocking = useCallback(() => {
    TetsuoAPI.protocol.getProtocolStateAsync(
      (state: ProtocolState) => {
        setProtocolState(state);
      },
      (err: Error) => {
        console.warn('[Poll] Protocol state fetch failed:', err.message);
      }
    );
  }, [setProtocolState]);

  /**
   * Trigger background refresh in Rust (truly fire-and-forget)
   */
  const triggerBackgroundRefresh = useCallback(() => {
    TetsuoAPI.protocol.refreshInBackground();
  }, []);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // C toggles the appearance customization menu
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        toggleCustomize();
      }

      // H toggles the HUD panel
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        toggleHud();
      }

      // M toggles the Task Marketplace
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMarketplace();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCustomize, toggleHud, toggleMarketplace]);

  // ============================================================================
  // Initialization (Non-Blocking)
  // ============================================================================

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    console.log('[App] Initializing...');

    // Add welcome message immediately
    addMessage({
      id: 'welcome',
      role: 'tetsuo',
      content: 'Systems online. I am Tetsuo, your AgenC operator. Click the voice button or say "Hey Tetsuo" to begin.',
      timestamp: Date.now(),
    });

    // Initialize memory system (non-blocking, fire-and-forget)
    TetsuoAPI.memory.initialize().then((ok) => {
      if (ok) console.log('[Init] Memory system initialized');
      else console.warn('[Init] Memory system unavailable');
    });

    // Fetch initial data with callbacks (non-blocking)
    TetsuoAPI.wallet.getWalletInfoNonBlocking(
      (info) => {
        setWallet(info);
        setIsLoading(false);
      },
      () => {
        // On error, still mark as loaded with disconnected wallet
        setWallet({ address: '', balance_sol: 0, is_connected: false });
        setIsLoading(false);
      }
    );

    // Fetch protocol state in parallel (non-blocking)
    TetsuoAPI.protocol.getProtocolStateAsync(
      (state) => setProtocolState(state),
      () => console.warn('[Init] Could not fetch protocol state')
    );

    // Start polling intervals
    hudPollRef.current = setInterval(pollProtocolStateNonBlocking, HUD_POLL_INTERVAL);
    walletPollRef.current = setInterval(pollWalletNonBlocking, WALLET_POLL_INTERVAL);

    // Also trigger background refresh periodically
    const bgRefreshInterval = setInterval(triggerBackgroundRefresh, HUD_POLL_INTERVAL * 2);

    return () => {
      if (hudPollRef.current) clearInterval(hudPollRef.current);
      if (walletPollRef.current) clearInterval(walletPollRef.current);
      clearInterval(bgRefreshInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // Voice Control
  // ============================================================================

  const handleVoiceToggle = useCallback(() => {
    if (voiceState === 'listening') {
      stopListening();
    } else if (voiceState === 'idle' || voiceState === 'error') {
      startListening();
    }
  }, [voiceState, startListening, stopListening]);

  // ============================================================================
  // Render
  // ============================================================================

  if (isLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-white text-2xl font-display animate-pulse-glow">
            INITIALIZING TETSUO
          </div>
          <div className="mt-4 text-white/70 text-sm font-mono">
            Connecting to the net...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-transparent flex flex-col overflow-hidden">
      {/* Glitch Overlay - Always on top */}
      <GlitchOverlay active={isGlitching || voiceState === 'processing'} />

      {/* Custom Title Bar */}
      <TitleBar />

      {/* Top Bar - Camera, Appearance & Wallet Dropdowns */}
      <div className="absolute top-12 right-4 z-50 flex items-center gap-3">
        {/* Camera Cycle Button */}
        <button
          onClick={cycleCameraMode}
          className="flex items-center gap-2 px-3 py-2 rounded border bg-cyber-dark/80 border-cyber-light text-holo-silver hover:border-neon-cyan hover:text-neon-cyan transition-all"
          aria-label="Cycle camera view"
          title={`Camera: ${CAMERA_MODES.find(m => m.mode === currentCameraMode)?.label}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-display uppercase tracking-wider">
            {CAMERA_MODES.find(m => m.mode === currentCameraMode)?.label}
          </span>
        </button>
        {/* Appearance Dropdown */}
        <AppearanceMenu
          isOpen={isCustomizeOpen}
          onClose={() => setIsCustomizeOpen(false)}
          onToggle={toggleCustomize}
        />
        {/* Wallet Dropdown */}
        <WalletDropdown wallet={wallet} />
      </div>

      {/* HUD Panel Overlay (toggle with H) */}
      {isHudOpen && (
        <div className="absolute top-12 left-4 z-40 w-80">
          <HudPanel
            title="SYSTEM STATUS"
            color="cyan"
            protocolState={protocolState}
            wallet={wallet}
          />
        </div>
      )}

      {/* Task Marketplace Overlay (toggle with M) */}
      {isMarketplaceOpen && (
        <div className="absolute top-12 left-1/2 transform -translate-x-1/2 z-40 max-h-[80vh] overflow-y-auto">
          <TaskMarketplace
            wallet={wallet}
            onTaskAction={(action, taskId) => {
              addMessage({
                id: `task-${Date.now()}`,
                role: 'system',
                content: `Task ${action}: ${taskId.slice(0, 8)}...`,
                timestamp: Date.now(),
              });
            }}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-cyber-grid opacity-30" />

        {/* Center - Tetsuo Avatar (Main Focus) */}
        <div className="flex-1 flex items-center justify-center relative">
          <TetsuoAvatar
            appearance={appearance}
            status={agentStatus}
          />

          {/* Voice Button - Overlaid at bottom center */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
            <VoiceButton
              voiceState={voiceState}
              isConnected={isVoiceConnected}
              onClick={handleVoiceToggle}
            />
          </div>
        </div>

        {/* Right Panel - Chat */}
        <div className="w-96 p-4 flex flex-col gap-4 z-10">
          <ChatPanel
            messages={messages}
            voiceState={voiceState}
            onSendMessage={sendTextMessage}
          />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        voiceState={voiceState}
        isConnected={isVoiceConnected}
        error={error}
        network={agentStatus.network.toUpperCase()}
      />

      {/* Vignette Effect */}
      <div className="absolute inset-0 pointer-events-none vignette" />
    </div>
  );
}

export default App;
