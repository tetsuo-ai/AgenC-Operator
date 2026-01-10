/**
 * ============================================================================
 * HudPanel - Cyberpunk Heads-Up Display Panel
 * ============================================================================
 * Displays protocol state, wallet info, and system status.
 * Features neon borders, animated data, and holographic styling.
 * ============================================================================
 */

import { motion } from 'framer-motion';
import type { ProtocolState, WalletInfo } from '../types';

interface HudPanelProps {
  title: string;
  color?: 'cyan' | 'magenta' | 'purple';
  protocolState?: ProtocolState | null;
  wallet?: WalletInfo | null;
}

export default function HudPanel({
  title,
  color = 'cyan',
  protocolState,
  wallet,
}: HudPanelProps) {
  // Color variants
  const colors = {
    cyan: {
      border: 'border-neon-cyan/30',
      glow: 'shadow-neon-cyan',
      text: 'text-neon-cyan',
      bg: 'from-neon-cyan/5 to-transparent',
    },
    magenta: {
      border: 'border-neon-magenta/30',
      glow: 'shadow-neon-magenta',
      text: 'text-neon-magenta',
      bg: 'from-neon-magenta/5 to-transparent',
    },
    purple: {
      border: 'border-neon-purple/30',
      glow: 'shadow-neon-purple',
      text: 'text-neon-purple',
      bg: 'from-neon-purple/5 to-transparent',
    },
  };

  const c = colors[color];

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(2);
  };

  // Truncate address
  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 10) return addr || 'Not Connected';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  return (
    <motion.div
      className={`cyber-panel overflow-hidden ${c.border}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Header */}
      <div className={`px-4 py-2 border-b ${c.border} bg-gradient-to-r ${c.bg}`}>
        <div className="flex items-center gap-2">
          {/* Status Dot */}
          <motion.div
            className={`w-2 h-2 rounded-full ${c.text}`}
            style={{ backgroundColor: 'currentColor' }}
            animate={{
              opacity: [1, 0.5, 1],
              scale: [1, 0.9, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
            }}
          />

          {/* Title */}
          <h3 className={`font-display text-xs uppercase tracking-widest ${c.text}`}>
            {title}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Wallet Section */}
        {wallet !== undefined && (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-holo-silver/60 uppercase tracking-wider">Wallet</span>
              <motion.span
                className={wallet?.is_connected ? 'text-neon-green' : 'text-holo-silver/40'}
                animate={{
                  opacity: wallet?.is_connected ? [1, 0.7, 1] : 0.4,
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {wallet?.is_connected ? 'CONNECTED' : 'OFFLINE'}
              </motion.span>
            </div>

            {/* Address */}
            <div className="font-mono text-sm text-holo-white/80 bg-cyber-darker/50 px-2 py-1 rounded">
              {truncateAddress(wallet?.address || '')}
            </div>

            {/* Balance */}
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-holo-silver/60">Balance</span>
              <div className="flex items-baseline gap-1">
                <motion.span
                  className="font-mono text-lg text-neon-cyan"
                  key={wallet?.balance_sol}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {wallet?.balance_sol?.toFixed(4) || '0.0000'}
                </motion.span>
                <span className="text-xs text-holo-silver/60">SOL</span>
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        {wallet !== undefined && protocolState !== undefined && (
          <div className={`h-px bg-gradient-to-r from-transparent via-${color === 'cyan' ? 'cyan' : color}-500/30 to-transparent`} />
        )}

        {/* Protocol State Section */}
        {protocolState !== undefined && (
          <div className="space-y-3">
            {/* Open Tasks */}
            <StatRow
              label="Open Tasks"
              value={protocolState?.open_task_count?.toString() || '--'}
              color={color}
            />

            {/* TVL */}
            <StatRow
              label="Total Value Locked"
              value={protocolState ? `${formatNumber(protocolState.total_value_locked_sol)} SOL` : '--'}
              color={color}
            />

            {/* Active Operators */}
            <StatRow
              label="Active Operators"
              value={protocolState?.active_operators?.toString() || '--'}
              color={color}
            />

            {/* Last Updated */}
            <div className="text-xs text-holo-silver/40 text-right">
              Updated: {protocolState?.last_updated
                ? new Date(protocolState.last_updated * 1000).toLocaleTimeString()
                : '--'}
            </div>
          </div>
        )}
      </div>

      {/* Decorative Corner Lines */}
      <div className={`absolute top-0 left-0 w-3 h-3 border-l border-t ${c.border}`} />
      <div className={`absolute top-0 right-0 w-3 h-3 border-r border-t ${c.border}`} />
      <div className={`absolute bottom-0 left-0 w-3 h-3 border-l border-b ${c.border}`} />
      <div className={`absolute bottom-0 right-0 w-3 h-3 border-r border-b ${c.border}`} />
    </motion.div>
  );
}

// ============================================================================
// Stat Row Component
// ============================================================================

interface StatRowProps {
  label: string;
  value: string;
  color: 'cyan' | 'magenta' | 'purple';
}

function StatRow({ label, value, color }: StatRowProps) {
  const textColors = {
    cyan: 'text-neon-cyan',
    magenta: 'text-neon-magenta',
    purple: 'text-neon-purple',
  };

  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-holo-silver/60 uppercase tracking-wider">{label}</span>
      <motion.span
        className={`font-mono text-sm ${textColors[color]}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        key={value}
      >
        {value}
      </motion.span>
    </div>
  );
}
