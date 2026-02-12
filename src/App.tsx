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
import { motion, AnimatePresence } from 'framer-motion';
import { TetsuoAPI } from './api';
import { hapticLight, hapticMedium } from './utils/haptics';

// Components
import TetsuoAvatar from './components/TetsuoAvatar';
import AppearanceMenu from './components/AppearanceMenu';
import ChatPanel from './components/ChatPanel';
import TitleBar from './components/TitleBar';
import VoiceButton from './components/VoiceButton';
import StatusBar from './components/StatusBar';
import WalletDropdown from './components/WalletDropdown';
import HudPanel from './components/HudPanel';
import TaskMarketplace from './components/TaskMarketplace';
import DevicePairingPanel from './components/DevicePairingPanel';
import ToastContainer from './components/ToastContainer';
import BottomNav from './components/BottomNav';
import OnboardingOverlay, { hasSeenOnboarding } from './components/OnboardingOverlay';
import type { Tab } from './components/BottomNav';

// Hooks
import { useVoicePipeline } from './hooks/useVoicePipeline';
import { isMobile } from './hooks/usePlatform';
import { useMobileWallet } from './hooks/useMobileWallet';
import { useAppStore } from './hooks/useAppStore';
import { useAvatarStore } from './stores/avatarStore';
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
    setIsGlitching,
    appearance,
    isCustomizeOpen,
    setIsCustomizeOpen,
    toggleCustomize,
    isHudOpen,
    toggleHud,
    isMarketplaceOpen,
    setIsMarketplaceOpen,
    toggleMarketplace,
    setIsHudOpen,
  } = useAppStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mobile navigation state
  const [mobileTab, setMobileTab] = useState<Tab>('chat');
  const [taskCount, setTaskCount] = useState(0);
  const mobile = isMobile();
  const [isFeedOpen, setIsFeedOpen] = useState(false);
  const [isDevicesOpen, setIsDevicesOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());

  // Mobile Wallet Adapter (MWA) — only active on Android
  const mobileWallet = useMobileWallet();

  // Camera state
  const currentCameraMode = useAvatarStore((s) => s.currentMode);
  const setCameraMode = useAvatarStore((s) => s.setCameraMode);

  const CAMERA_MODES: { mode: CameraMode; label: string }[] = [
    { mode: 'face', label: 'Face' },
    { mode: 'bust', label: 'Bust' },
    { mode: 'closeup', label: 'Close-Up' },
    { mode: 'waist', label: 'Waist' },
    { mode: 'full-body', label: 'Full Body' },
    { mode: 'presentation', label: '3/4 View' },
  ];

  const cycleCameraMode = useCallback(() => {
    hapticLight();
    const modes: CameraMode[] = ['face', 'bust', 'closeup', 'waist', 'full-body', 'presentation'];
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
    if (mobile && mobileWallet.isConnected) {
      // On mobile: refresh balance via web3.js directly
      mobileWallet.refreshBalance().then(() => {
        setWallet(mobileWallet.toWalletInfo());
      }).catch(() => {});
    } else {
      // On desktop: poll via Tauri IPC
      TetsuoAPI.wallet.getWalletInfoNonBlocking(
        (info: WalletInfo) => {
          setWallet(info);
        },
        (err: Error) => {
          console.warn('[Poll] Wallet fetch failed:', err.message);
        }
      );
    }
  }, [mobile, mobileWallet, setWallet]);

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

  // Desktop keyboard shortcuts (C/H/M) — skipped on mobile
  useEffect(() => {
    if (mobile) return;

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

      // D toggles the Device Pairing panel
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setIsDevicesOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobile, toggleCustomize, toggleHud, toggleMarketplace]);

  // Mobile tab handler — sets panels directly (no toggles, avoids double-flip)
  const handleMobileTabChange = useCallback((tab: Tab) => {
    setMobileTab(tab);
    setIsCustomizeOpen(tab === 'settings');
    setIsMarketplaceOpen(tab === 'tasks');
    setIsDevicesOpen(tab === 'devices');
    setIsHudOpen(false);
  }, [setIsCustomizeOpen, setIsMarketplaceOpen, setIsHudOpen]);

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
  // Mobile Wallet Handlers
  // ============================================================================

  const handleMobileWalletConnect = useCallback(async () => {
    try {
      const info = await mobileWallet.connect();
      setWallet(info);
      addMessage({
        id: `wallet-${Date.now()}`,
        role: 'system',
        content: `Wallet connected: ${info.address.slice(0, 4)}...${info.address.slice(-4)}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[MWA] Connect failed:', err);
      addMessage({
        id: `wallet-err-${Date.now()}`,
        role: 'system',
        content: `Wallet connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      });
    }
  }, [mobileWallet, setWallet, addMessage]);

  const handleMobileWalletDisconnect = useCallback(() => {
    mobileWallet.disconnect();
    setWallet({ address: '', balance_sol: 0, is_connected: false });
  }, [mobileWallet, setWallet]);

  // ============================================================================
  // Voice Control
  // ============================================================================

  const handleVoiceToggle = useCallback(() => {
    hapticMedium();
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
      {/* Glitch Overlay - Disabled for clean rendering */}

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Custom Title Bar */}
      <TitleBar />

      {/* Top Bar - Camera, Appearance & Wallet Dropdowns */}
      <motion.div
        className={`absolute z-50 flex items-center ${mobile ? 'left-4 right-4 gap-2' : 'right-4 top-12 gap-3'}`}
        style={mobile ? { top: 'calc(env(safe-area-inset-top, 0px) + 28px)' } : undefined}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Camera Cycle Button */}
        <motion.button
          onClick={cycleCameraMode}
          className={`flex items-center gap-1.5 rounded border bg-black/80 border-white/20 text-white/60 hover:border-white/40 hover:text-white transition-colors backdrop-blur-sm ${mobile ? 'flex-1 min-w-0 justify-center px-2 py-2' : 'px-3 py-2'}`}
          aria-label="Cycle camera view"
          title={`Camera: ${CAMERA_MODES.find(m => m.mode === currentCameraMode)?.label}`}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.1 }}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className={`font-display uppercase tracking-wider truncate ${mobile ? 'text-[10px]' : 'text-xs'}`}>
            {CAMERA_MODES.find(m => m.mode === currentCameraMode)?.label}
          </span>
        </motion.button>
        {/* Appearance Dropdown — desktop only (mobile uses Settings tab overlay below) */}
        {!mobile && (
          <AppearanceMenu
            isOpen={isCustomizeOpen}
            onClose={() => setIsCustomizeOpen(false)}
            onToggle={toggleCustomize}
          />
        )}
        {/* Wallet Dropdown */}
        <WalletDropdown
          wallet={wallet}
          onMobileConnect={handleMobileWalletConnect}
          onMobileDisconnect={handleMobileWalletDisconnect}
        />
      </motion.div>

      {/* Mobile Settings — AppearanceMenu sidebar overlay */}
      {mobile && isCustomizeOpen && (
        <AppearanceMenu
          isOpen={true}
          onClose={() => setIsCustomizeOpen(false)}
          onToggle={toggleCustomize}
        />
      )}

      {/* HUD Panel Overlay (toggle with H) */}
      {isHudOpen && (
        <div
          className={`absolute z-40 ${mobile ? 'inset-x-2' : 'top-12 left-4 w-80'}`}
          style={mobile ? { top: 'calc(env(safe-area-inset-top, 0px) + 8px)' } : undefined}
        >
          <HudPanel
            title="SYSTEM STATUS"
            color="cyan"
            protocolState={protocolState}
            wallet={wallet}
          />
        </div>
      )}

      {/* Task Marketplace Overlay (toggle with M on desktop, Tasks tab on mobile) */}
      {isMarketplaceOpen && (
        <div
          className={`absolute z-40 overflow-y-auto ${
            mobile
              ? 'inset-0 bottom-14 p-2 bg-black/95'
              : 'top-12 left-1/2 transform -translate-x-1/2 max-h-[80vh]'
          }`}
          style={mobile ? { top: 'calc(env(safe-area-inset-top, 0px) + 72px)' } : undefined}
        >
          <TaskMarketplace
            wallet={wallet}
            onTaskCountChange={setTaskCount}
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

      {/* Device Pairing Overlay (toggle with D on desktop, Devices tab on mobile) */}
      {isDevicesOpen && (
        <div
          className={`absolute z-40 overflow-y-auto ${
            mobile
              ? 'inset-0 bottom-14 p-2 bg-black/95'
              : 'top-12 left-1/2 transform -translate-x-1/2 max-h-[80vh]'
          }`}
          style={mobile ? { top: 'calc(env(safe-area-inset-top, 0px) + 72px)' } : undefined}
        >
          <DevicePairingPanel walletAddress={wallet?.address || ''} />
        </div>
      )}

      {/* Main Content — avatar fills viewport, chat overlays on right */}
      <div className="flex-1 relative overflow-hidden">
        {/* Background Grid - Disabled for clean rendering */}
        {/* <div className="absolute inset-0 bg-cyber-grid opacity-30" /> */}

        {/* Avatar — fills entire viewport */}
        <div className="absolute inset-0">
          <TetsuoAvatar
            appearance={appearance}
            status={agentStatus}
          />
        </div>

        {/* Voice Button — bottom center, above chat panel and BottomNav */}
        {/* Hidden on mobile when Tasks or Settings tab is active to avoid overlap */}
        {(!mobile || mobileTab === 'chat') && (
          <div className={`absolute left-1/2 transform -translate-x-1/2 z-40 ${mobile ? 'bottom-28' : 'bottom-8'}`}>
            <VoiceButton
              voiceState={voiceState}
              isConnected={isVoiceConnected}
              onClick={handleVoiceToggle}
            />
          </div>
        )}

        {/* Chat Panel — full-width on mobile (hidden by default, toggle with button), fixed sidebar on desktop */}
        {(!mobile || (mobileTab === 'chat' && isFeedOpen)) && (
          <div
            className={`absolute right-0 bottom-0 z-30 flex flex-col p-4 ${
              mobile ? 'left-0 w-full pb-36' : 'top-0 w-[420px]'
            }`}
            style={mobile ? { top: 'calc(env(safe-area-inset-top, 0px) + 72px)' } : undefined}
          >
            <ChatPanel
              messages={messages}
              voiceState={voiceState}
              onSendMessage={sendTextMessage}
            />
          </div>
        )}

        {/* Mobile Feed Toggle Button — bottom-left, shows/hides operator feed */}
        {mobile && mobileTab === 'chat' && (
          <motion.button
            onClick={() => { hapticLight(); setIsFeedOpen(prev => !prev); }}
            className={`absolute bottom-32 left-4 z-40 flex items-center gap-1.5 rounded-full border px-3 py-2 backdrop-blur-sm transition-colors ${
              isFeedOpen
                ? 'bg-white/10 border-white/30 text-white/80'
                : 'bg-black/60 border-white/20 text-white/50 hover:border-white/40'
            }`}
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.1 }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-[10px] font-display uppercase tracking-wider">
              {isFeedOpen ? 'Hide' : 'Feed'}
            </span>
          </motion.button>
        )}
      </div>

      {/* Status Bar — hidden on mobile (BottomNav replaces it) */}
      {!mobile && (
        <StatusBar
          voiceState={voiceState}
          isConnected={isVoiceConnected}
          error={error}
          network={agentStatus.network.toUpperCase()}
        />
      )}

      {/* Mobile Bottom Navigation */}
      <BottomNav activeTab={mobileTab} onTabChange={handleMobileTabChange} taskCount={taskCount} />

      {/* First-time onboarding */}
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
