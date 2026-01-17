/**
 * ============================================================================
 * AccessTierBadge - Displays user's access tier based on $TETSUO holdings
 * ============================================================================
 */

import { motion } from 'framer-motion';
import type { AccessTier, AccessTierInfo } from '../types';

interface AccessTierBadgeProps {
  tierInfo: AccessTierInfo | null;
  compact?: boolean;
  showBalance?: boolean;
  animated?: boolean;
}

// Tier configuration for display
const TIER_CONFIG: Record<AccessTier, {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}> = {
  none: {
    label: 'No Access',
    icon: '🔒',
    color: 'text-gray-500',
    bgColor: 'bg-black',
    borderColor: 'border-gray-700',
    glowColor: '',
  },
  basic: {
    label: 'Basic',
    icon: '⚡',
    color: 'text-white',
    bgColor: 'bg-black',
    borderColor: 'border-white/30',
    glowColor: 'shadow-[0_0_10px_rgba(255,255,255,0.2)]',
  },
  pro: {
    label: 'Pro',
    icon: '💎',
    color: 'text-white',
    bgColor: 'bg-black',
    borderColor: 'border-white/50',
    glowColor: 'shadow-[0_0_15px_rgba(255,255,255,0.3)]',
  },
  whale: {
    label: 'Whale',
    icon: '🐋',
    color: 'text-white',
    bgColor: 'bg-black',
    borderColor: 'border-white/70',
    glowColor: 'shadow-[0_0_20px_rgba(255,255,255,0.4)]',
  },
  diamond: {
    label: 'Diamond',
    icon: '💠',
    color: 'text-white',
    bgColor: 'bg-black',
    borderColor: 'border-white',
    glowColor: 'shadow-[0_0_25px_rgba(255,255,255,0.5)]',
  },
};

export default function AccessTierBadge({
  tierInfo,
  compact = false,
  showBalance = true,
  animated = true,
}: AccessTierBadgeProps) {
  const tier = tierInfo?.tier ?? 'none';
  const config = TIER_CONFIG[tier];

  if (compact) {
    return (
      <motion.div
        className={`
          inline-flex items-center gap-1 px-2 py-0.5 rounded
          font-mono text-xs uppercase tracking-wider
          border ${config.borderColor} ${config.bgColor}
          ${config.glowColor}
        `}
        initial={animated ? { opacity: 0, scale: 0.9 } : undefined}
        animate={animated ? { opacity: 1, scale: 1 } : undefined}
        whileHover={{ scale: 1.05 }}
      >
        <span>{config.icon}</span>
        <span className={config.color}>{config.label}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`
        flex flex-col gap-1 p-3 rounded-lg
        font-mono text-sm
        border ${config.borderColor} ${config.bgColor}
        ${config.glowColor}
      `}
      initial={animated ? { opacity: 0, y: -10 } : undefined}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.3 }}
    >
      {/* Tier row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.span
            className="text-lg"
            animate={animated && tier !== 'none' ? {
              scale: [1, 1.1, 1],
            } : undefined}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatDelay: 3,
            }}
          >
            {config.icon}
          </motion.span>
          <span className={`font-bold uppercase ${config.color}`}>
            {config.label}
          </span>
        </div>
        {tier !== 'none' && (
          <motion.div
            className={`w-2 h-2 rounded-full bg-white`}
            animate={{
              opacity: [1, 0.5, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
            }}
          />
        )}
      </div>

      {/* Balance row */}
      {showBalance && tierInfo && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Balance:</span>
          <span className="text-white">{tierInfo.balance_formatted} $TETSUO</span>
        </div>
      )}

      {/* Next tier info */}
      {tierInfo?.next_tier && tierInfo.tokens_to_next_tier && (
        <div className="flex items-center justify-between text-xs text-gray-500 border-t border-gray-800 pt-1 mt-1">
          <span>Next tier:</span>
          <span>
            {formatNumber(tierInfo.tokens_to_next_tier)} more for{' '}
            <span className="text-gray-300">{tierInfo.next_tier.toUpperCase()}</span>
          </span>
        </div>
      )}
    </motion.div>
  );
}

// Compact badge for inline use
export function AccessTierBadgeCompact({ tier }: { tier: AccessTier }) {
  const config = TIER_CONFIG[tier];

  return (
    <span
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded
        text-xs font-mono uppercase
        border ${config.borderColor} ${config.bgColor}
      `}
    >
      <span>{config.icon}</span>
      <span className={config.color}>{config.label}</span>
    </span>
  );
}

// Helper to format numbers with K/M suffix
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toFixed(0);
}
