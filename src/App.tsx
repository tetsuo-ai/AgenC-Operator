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
import HudPanel from './components/HudPanel';
import ChatPanel from './components/ChatPanel';
import TitleBar from './components/TitleBar';
import VoiceButton from './components/VoiceButton';
import StatusBar from './components/StatusBar';

// Hooks
import { useVoicePipeline } from './hooks/useVoicePipeline';
import { useAppStore } from './hooks/useAppStore';

// Types
import type { VoiceState, WalletInfo, ProtocolState, AgentStatus } from './types';

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
  } = useAppStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Refs for polling intervals
  const hudPollRef = useRef<NodeJS.Timeout | null>(null);
  const walletPollRef = useRef<NodeJS.Timeout | null>(null);

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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCustomize]);

  // ============================================================================
  // Initialization (Non-Blocking)
  // ============================================================================

  useEffect(() => {
    console.log('[App] Initializing...');

    // Add welcome message immediately
    addMessage({
      id: 'welcome',
      role: 'tetsuo',
      content: 'Systems online. I am Tetsuo, your AgenC operator. Click the voice button or say "Hey Tetsuo" to begin.',
      timestamp: Date.now(),
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
  }, [
    addMessage,
    setWallet,
    setProtocolState,
    pollProtocolStateNonBlocking,
    pollWalletNonBlocking,
    triggerBackgroundRefresh,
  ]);

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
  // Manual Refresh (User-Triggered)
  // ============================================================================

  const handleManualRefresh = useCallback(() => {
    console.log('[App] Manual refresh triggered');
    setIsGlitching(true);

    // Fire both polls
    pollWalletNonBlocking();
    pollProtocolStateNonBlocking();

    setTimeout(() => setIsGlitching(false), 300);
  }, [pollWalletNonBlocking, pollProtocolStateNonBlocking, setIsGlitching]);

  // ============================================================================
  // Render
  // ============================================================================

  if (isLoading) {
    return (
      <div className="w-full h-full bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="text-neon-cyan text-2xl font-display animate-pulse-glow">
            INITIALIZING TETSUO
          </div>
          <div className="mt-4 text-holo-silver text-sm font-mono">
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-cyber-grid opacity-50" />

        {/* Left Panel - Protocol HUD */}
        <div className="w-80 p-4 flex flex-col gap-4 z-10">
          <HudPanel
            title="PROTOCOL STATUS"
            color="cyan"
            protocolState={protocolState}
            wallet={wallet}
          />

          {/* Refresh Button */}
          <button
            onClick={handleManualRefresh}
            className="cyber-btn text-xs w-full"
          >
            REFRESH DATA
          </button>
        </div>

        {/* Center - Tetsuo Avatar */}
        <div className="flex-1 flex items-center justify-center relative">
          <TetsuoAvatar
            appearance={appearance}
            status={agentStatus}
            onToggleCustomize={toggleCustomize}
            isCustomizeOpen={isCustomizeOpen}
          />

          {/* Voice Button - Overlaid at bottom center */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
            <VoiceButton
              voiceState={voiceState}
              isConnected={isVoiceConnected}
              onClick={handleVoiceToggle}
            />
          </div>

          {/* Appearance Customization Menu */}
          <AppearanceMenu
            isOpen={isCustomizeOpen}
            onClose={() => setIsCustomizeOpen(false)}
          />
        </div>

        {/* Right Panel - Chat & Tasks */}
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
        wallet={wallet}
        error={error}
      />

      {/* Vignette Effect */}
      <div className="absolute inset-0 pointer-events-none vignette" />
    </div>
  );
}

export default App;
