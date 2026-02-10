/**
 * ============================================================================
 * WalletDropdown - Compact Wallet Connection Button
 * ============================================================================
 * Small dropdown button in the top corner for wallet connection.
 * ============================================================================
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WalletInfo } from '../types';
import { TwitterConnectCompact } from './TwitterConnect';
import { isMobile } from '../hooks/usePlatform';
import { hapticLight, hapticMedium } from '../utils/haptics';

interface WalletDropdownProps {
  wallet: WalletInfo | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  /** MWA connect handler for mobile */
  onMobileConnect?: () => void;
  /** MWA disconnect handler for mobile */
  onMobileDisconnect?: () => void;
}

export default function WalletDropdown({
  wallet,
  onConnect,
  onDisconnect,
  onMobileConnect,
  onMobileDisconnect,
}: WalletDropdownProps) {
  const mobile = isMobile();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 10) return '';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const isConnected = wallet?.is_connected ?? false;

  return (
    <div ref={dropdownRef} className={`relative z-50 ${mobile ? 'flex-1' : ''}`}>
      {/* Trigger Button */}
      <button
        onClick={() => { hapticLight(); setIsOpen(!isOpen); }}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded border border-white/20 bg-black/80 hover:bg-white/10 transition-colors min-w-0 ${mobile ? 'w-full justify-center py-2' : ''}`}
      >
        {/* Status Dot */}
        <motion.div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isConnected ? 'bg-green-400' : 'bg-white/30'
          }`}
          animate={isConnected ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* Wallet Icon */}
        <svg
          width={mobile ? "12" : "14"}
          height={mobile ? "12" : "14"}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-white/80 shrink-0"
        >
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
        </svg>

        {/* Address or Connect text */}
        <span className={`font-mono text-white/80 truncate ${mobile ? 'text-[10px]' : 'text-xs'}`}>
          {isConnected ? truncateAddress(wallet?.address || '') : 'Connect'}
        </span>

        {/* Chevron — desktop only */}
        {!mobile && (
          <motion.svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/50"
            animate={{ rotate: isOpen ? 180 : 0 }}
          >
            <path d="M6 9l6 6 6-6" />
          </motion.svg>
        )}
      </button>

      {/* Wallet Menu — centered popup on mobile, dropdown on desktop */}
      <AnimatePresence>
        {isOpen && mobile && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={() => setIsOpen(false)}
          />
        )}
        {isOpen && (
          <motion.div
            className={mobile
              ? 'fixed left-4 right-4 top-1/2 -translate-y-1/2 z-[70] rounded-xl border border-white/15 bg-black/95 backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/50'
              : 'absolute top-full left-0 mt-2 w-56 rounded border border-white/20 bg-black/95 backdrop-blur-sm overflow-hidden'
            }
            initial={mobile ? { opacity: 0, scale: 0.85, y: 20 } : { opacity: 0, y: -10 }}
            animate={mobile ? { opacity: 1, scale: 1, y: 0 } : { opacity: 1, y: 0 }}
            exit={mobile ? { opacity: 0, scale: 0.9, y: 10 } : { opacity: 0, y: -10 }}
            transition={mobile
              ? { type: 'spring', damping: 25, stiffness: 350, mass: 0.7 }
              : { duration: 0.2, ease: [0.32, 0.72, 0, 1] }
            }
          >
            {isConnected ? (
              <>
                {/* Connected State */}
                <div className="p-3 border-b border-white/10">
                  <div className="text-[10px] text-white/50 uppercase tracking-wider mb-1">
                    Connected Wallet
                  </div>
                  <div className="font-mono text-xs text-white/90 break-all">
                    {wallet?.address}
                  </div>
                </div>

                <div className="p-3 border-b border-white/10">
                  <div className="text-[10px] text-white/50 uppercase tracking-wider mb-1">
                    Balance
                  </div>
                  <div className="font-mono text-sm text-white">
                    {wallet?.balance_sol?.toFixed(4) || '0.0000'} SOL
                  </div>
                </div>

                {/* Social Connections */}
                <div className="p-3 border-b border-white/10">
                  <div className="text-[10px] text-white/50 uppercase tracking-wider mb-2">
                    Social Connections
                  </div>
                  <TwitterConnectCompact />
                </div>

                <button
                  onClick={() => {
                    hapticMedium();
                    if (mobile) onMobileDisconnect?.();
                    else onDisconnect?.();
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                {/* Disconnected State */}
                <div className="p-3 border-b border-white/10">
                  <div className="text-xs text-white/60">
                    No wallet connected
                  </div>
                </div>

                <button
                  onClick={() => {
                    hapticMedium();
                    if (mobile) onMobileConnect?.();
                    else onConnect?.();
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10 transition-colors"
                >
                  {mobile ? 'Connect Mobile Wallet' : 'Load Keypair File'}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
