/**
 * ============================================================================
 * TwitterConnect - OAuth 2.0 Login with X button
 * ============================================================================
 * Provides "Login with X" button for Twitter OAuth 2.0 + PKCE authentication.
 * Shows connection status and allows disconnecting.
 * ============================================================================
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TwitterAPI } from '../api';

interface TwitterConnectProps {
  compact?: boolean;
  onConnectionChange?: (connected: boolean) => void;
}

export default function TwitterConnect({
  compact = false,
  onConnectionChange,
}: TwitterConnectProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check connection status on mount
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const connected = await TwitterAPI.checkConnected();
      setIsConnected(connected);
      onConnectionChange?.(connected);
    } catch (err) {
      console.error('[TwitterConnect] Check failed:', err);
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  };

  const handleConnect = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await TwitterAPI.startAuth();
      if (success) {
        setIsConnected(true);
        onConnectionChange?.(true);
      }
    } catch (err) {
      console.error('[TwitterConnect] Auth failed:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await TwitterAPI.disconnect();
      setIsConnected(false);
      onConnectionChange?.(false);
    } catch (err) {
      console.error('[TwitterConnect] Disconnect failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state during initial check
  if (isChecking) {
    return (
      <div className={`
        flex items-center gap-2 font-mono text-xs text-gray-500
        ${compact ? '' : 'p-3 border border-gray-800 rounded-lg'}
      `}>
        <motion.div
          className="w-3 h-3 border border-gray-500 rounded-sm"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <span>Checking Twitter...</span>
      </div>
    );
  }

  // Compact mode
  if (compact) {
    return (
      <motion.button
        onClick={isConnected ? handleDisconnect : handleConnect}
        disabled={isLoading}
        className={`
          inline-flex items-center gap-2 px-3 py-1.5 rounded
          font-mono text-xs uppercase tracking-wider
          border transition-all duration-200
          ${isConnected
            ? 'border-white/30 bg-black text-white hover:border-white/50'
            : 'border-gray-700 bg-black text-gray-400 hover:text-white hover:border-white/30'
          }
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {isLoading ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            ⟳
          </motion.span>
        ) : (
          <span className="text-sm">{isConnected ? '✓' : '𝕏'}</span>
        )}
        <span>{isConnected ? 'Connected' : 'Connect X'}</span>
      </motion.button>
    );
  }

  // Full mode
  return (
    <motion.div
      className={`
        flex flex-col gap-3 p-4 rounded-lg
        font-mono text-sm
        border ${isConnected ? 'border-white/30' : 'border-gray-800'} bg-black
        ${isConnected ? 'shadow-[0_0_10px_rgba(255,255,255,0.1)]' : ''}
      `}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">𝕏</span>
          <span className="font-bold uppercase text-white">Twitter</span>
        </div>
        {isConnected && (
          <motion.div
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <motion.div
              className="w-2 h-2 rounded-full bg-white"
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-xs text-white/70">Connected</span>
          </motion.div>
        )}
      </div>

      {/* Status / Button */}
      <AnimatePresence mode="wait">
        {isConnected ? (
          <motion.div
            key="connected"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-gray-400">
              Your Twitter account is linked. Tetsuo can post on your behalf.
            </p>
            <button
              onClick={handleDisconnect}
              disabled={isLoading}
              className={`
                px-4 py-2 rounded border border-gray-700
                text-xs uppercase tracking-wider
                text-gray-400 hover:text-white hover:border-gray-500
                transition-colors duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {isLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-gray-400">
              Link your Twitter account to enable social features.
            </p>
            {error && (
              <p className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
                {error}
              </p>
            )}
            <motion.button
              onClick={handleConnect}
              disabled={isLoading}
              className={`
                flex items-center justify-center gap-2
                px-4 py-2.5 rounded border border-white/30
                text-sm font-bold uppercase tracking-wider
                text-white bg-black
                hover:bg-white/5 hover:border-white/50
                hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isLoading ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    ⟳
                  </motion.span>
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <span className="text-base">𝕏</span>
                  <span>Login with X</span>
                </>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Compact version for use in navigation/status bars
 */
export function TwitterConnectCompact({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
}) {
  return <TwitterConnect compact onConnectionChange={onConnectionChange} />;
}
