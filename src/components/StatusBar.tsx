/**
 * ============================================================================
 * StatusBar - Bottom Status Bar
 * ============================================================================
 * Shows system status, network info, wallet address, and errors.
 * Always visible at the bottom of the window.
 * ============================================================================
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { VoiceState, WalletInfo } from '../types';

interface StatusBarProps {
  voiceState: VoiceState;
  isConnected: boolean;
  wallet: WalletInfo | null;
  error: string | null;
}

export default function StatusBar({
  voiceState,
  isConnected,
  wallet,
  error,
}: StatusBarProps) {
  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 10) return 'Not Connected';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="h-7 bg-cyber-darker/90 border-t border-neon-cyan/10 flex items-center justify-between px-4 text-[10px] font-mono">
      {/* Left - System Status */}
      <div className="flex items-center gap-4">
        {/* Voice API Status */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-neon-green' : 'bg-red-500'
            }`}
            animate={{
              opacity: isConnected ? [1, 0.5, 1] : 1,
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-holo-silver/60 uppercase tracking-wider">
            VOICE {isConnected ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        {/* Voice State */}
        <div className="flex items-center gap-1.5">
          <VoiceStateIndicator state={voiceState} />
        </div>

        {/* Network */}
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-neon-purple" />
          <span className="text-holo-silver/60 uppercase tracking-wider">
            DEVNET
          </span>
        </div>
      </div>

      {/* Center - Error Messages */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-center gap-2 text-red-400"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <span className="text-red-500">⚠</span>
            <span className="truncate max-w-md">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right - Wallet & Time */}
      <div className="flex items-center gap-4">
        {/* Wallet Address */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className={`w-1.5 h-1.5 rounded-full ${
              wallet?.is_connected ? 'bg-neon-cyan' : 'bg-holo-silver/30'
            }`}
            animate={{
              opacity: wallet?.is_connected ? [1, 0.6, 1] : 0.3,
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-neon-cyan/80">
            {truncateAddress(wallet?.address || '')}
          </span>
        </div>

        {/* Balance */}
        {wallet?.is_connected && (
          <div className="text-holo-silver/60">
            {wallet.balance_sol.toFixed(4)} SOL
          </div>
        )}

        {/* Time */}
        <Clock />
      </div>
    </div>
  );
}

// ============================================================================
// Voice State Indicator
// ============================================================================

function VoiceStateIndicator({ state }: { state: VoiceState }) {
  const stateConfig = {
    idle: { color: 'bg-holo-silver/40', label: 'IDLE' },
    listening: { color: 'bg-neon-green', label: 'LISTEN' },
    processing: { color: 'bg-neon-magenta', label: 'PROC' },
    speaking: { color: 'bg-neon-cyan', label: 'SPEAK' },
    error: { color: 'bg-red-500', label: 'ERR' },
  };

  const config = stateConfig[state];

  return (
    <>
      <motion.div
        className={`w-1.5 h-1.5 rounded-full ${config.color}`}
        animate={
          state !== 'idle'
            ? {
                scale: [1, 1.3, 1],
                opacity: [1, 0.7, 1],
              }
            : {}
        }
        transition={{ duration: 0.5, repeat: Infinity }}
      />
      <span className="text-holo-silver/60 uppercase tracking-wider">
        {config.label}
      </span>
    </>
  );
}

// ============================================================================
// Clock Component
// ============================================================================

import { useState, useEffect } from 'react';

function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="text-holo-silver/40 tabular-nums">
      {time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })}
    </span>
  );
}
