/**
 * ============================================================================
 * AccessGateOverlay - Token Gate for App Access
 * ============================================================================
 * Blocks the entire app until the user connects a wallet holding 10K+ $TETSUO.
 * Three states:
 *   1. No wallet connected  → connect prompt
 *   2. Checking balance     → loading spinner
 *   3. Insufficient tokens  → purchase prompt with current balance
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TetsuoAPI } from '../api';
import { hapticMedium } from '../utils/haptics';
import type { AccessTierInfo, WalletInfo } from '../types';

interface AccessGateOverlayProps {
  wallet: WalletInfo | null;
  onMobileConnect: () => void;
  onAccessGranted: (tierInfo: AccessTierInfo) => void;
}

type GateState = 'no-wallet' | 'checking' | 'denied' | 'granted';

export default function AccessGateOverlay({
  wallet,
  onMobileConnect,
  onAccessGranted,
}: AccessGateOverlayProps) {
  const [gateState, setGateState] = useState<GateState>('no-wallet');
  const [tierInfo, setTierInfo] = useState<AccessTierInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check access whenever wallet changes
  useEffect(() => {
    if (!wallet?.is_connected || !wallet.address) {
      setGateState('no-wallet');
      setTierInfo(null);
      return;
    }

    setGateState('checking');
    setError(null);

    TetsuoAPI.access.getAccessTier(wallet.address)
      .then((info) => {
        setTierInfo(info);
        if (info.tier !== 'none') {
          setGateState('granted');
          onAccessGranted(info);
        } else {
          setGateState('denied');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to check access');
        setGateState('denied');
      });
  }, [wallet?.is_connected, wallet?.address, onAccessGranted]);

  // Skip gate entirely in debug mode (VITE_DEBUG=true)
  useEffect(() => {
    if (import.meta.env.VITE_DEBUG === 'true') {
      setGateState('granted');
      onAccessGranted({ tier: 'whale', balance: 0, balance_formatted: '0 (debug)' });
    }
  }, [onAccessGranted]);

  // Don't render if access is granted
  if (gateState === 'granted') return null;

  const handleConnect = useCallback(() => {
    hapticMedium();
    onMobileConnect();
  }, [onMobileConnect]);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: 'rgba(0, 0, 0, 0.95)', backdropFilter: 'blur(20px)' }}
    >
      <motion.div
        className="w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-black/90 p-8 text-center"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <motion.div
            className="w-16 h-16 relative"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            <div className="absolute inset-0 border-2 border-neon-cyan/50 rotate-45" />
            <div className="absolute inset-2 border border-neon-magenta/50 rotate-45" />
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              animate={{ rotate: [0, -360] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            >
              <div className="w-3 h-3 bg-neon-cyan rounded-full" />
            </motion.div>
          </motion.div>
        </div>

        <h1 className="font-display text-lg uppercase tracking-[0.3em] text-white mb-2">
          AGENC OPERATOR
        </h1>

        <AnimatePresence mode="wait">
          {gateState === 'no-wallet' && (
            <motion.div
              key="no-wallet"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <p className="text-sm text-white/50 leading-relaxed mb-6">
                Connect your Solana wallet to access the operator.
                You need to hold <span className="text-neon-cyan font-bold">$TETSUO</span> tokens.
              </p>

              <motion.button
                onClick={handleConnect}
                className="w-full py-3 text-xs font-display uppercase tracking-widest rounded-lg
                  bg-neon-cyan/20 border border-neon-cyan/50 text-neon-cyan
                  hover:bg-neon-cyan/30 transition-colors"
                whileTap={{ scale: 0.97 }}
              >
                Connect Wallet
              </motion.button>
            </motion.div>
          )}

          {gateState === 'checking' && (
            <motion.div
              key="checking"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="py-4"
            >
              <motion.div
                className="w-8 h-8 mx-auto border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
              <p className="text-sm text-white/50 mt-4">
                Checking access...
              </p>
            </motion.div>
          )}

          {gateState === 'denied' && (
            <motion.div
              key="denied"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="mb-4 p-3 rounded-lg border border-white/10 bg-white/5">
                <p className="text-[10px] font-display uppercase tracking-[0.2em] text-white/40 mb-1">
                  Your Balance
                </p>
                <p className="text-xl font-display text-white">
                  {tierInfo?.balance_formatted || '0'} <span className="text-white/40 text-sm">$TETSUO</span>
                </p>
              </div>

              <p className="text-sm text-white/50 leading-relaxed mb-2">
                You need at least <span className="text-neon-cyan font-bold">10,000 $TETSUO</span> to
                access AgenC Operator.
              </p>

              {error && (
                <p className="text-xs text-red-400/70 mb-4">{error}</p>
              )}

              <div className="flex flex-col gap-2 mt-6">
                <motion.a
                  href="https://jup.ag/swap/SOL-8i51XNNpGaKaj4G4nDdmQh95v4FKAxw8mhtaRoKd9tE8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 text-xs font-display uppercase tracking-widest rounded-lg
                    bg-neon-cyan/20 border border-neon-cyan/50 text-neon-cyan
                    hover:bg-neon-cyan/30 transition-colors text-center"
                  whileTap={{ scale: 0.97 }}
                >
                  Buy $TETSUO on Jupiter
                </motion.a>

                <motion.button
                  onClick={() => {
                    // Re-check by triggering wallet effect
                    setGateState('checking');
                    if (wallet?.address) {
                      TetsuoAPI.access.getAccessTier(wallet.address)
                        .then((info) => {
                          setTierInfo(info);
                          if (info.tier !== 'none') {
                            setGateState('granted');
                            onAccessGranted(info);
                          } else {
                            setGateState('denied');
                          }
                        })
                        .catch(() => setGateState('denied'));
                    }
                  }}
                  className="w-full py-2.5 text-xs font-display uppercase tracking-widest rounded-lg
                    border border-white/10 text-white/40
                    hover:border-white/20 hover:text-white/60 transition-colors"
                  whileTap={{ scale: 0.97 }}
                >
                  Refresh
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <p className="text-[10px] text-white/20 mt-6 font-display uppercase tracking-widest">
          Powered by Solana
        </p>
      </motion.div>
    </motion.div>
  );
}
