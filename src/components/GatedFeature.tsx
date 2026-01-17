/**
 * ============================================================================
 * GatedFeature - Conditionally renders content based on access tier
 * ============================================================================
 */

import { motion } from 'framer-motion';
import type { AccessTier, Feature } from '../types';
import { canUseFeature, TIER_THRESHOLDS } from '../types';

interface GatedFeatureProps {
  /** The feature being gated */
  feature: Feature;
  /** User's current access tier */
  currentTier: AccessTier;
  /** Content to show if user has access */
  children: React.ReactNode;
  /** Custom fallback when access denied (optional) */
  fallback?: React.ReactNode;
  /** Show upgrade prompt in fallback */
  showUpgradePrompt?: boolean;
}

// Feature display names
const FEATURE_NAMES: Record<Feature, string> = {
  voice: 'Voice Interface',
  trading: 'Trading',
  social: 'Social Media',
  email: 'Email',
  code: 'Code Operations',
  image_gen: 'Image Generation',
  spawn: 'Agent Spawning',
  priority_queue: 'Priority Queue',
  custom_personality: 'Custom Personality',
  api_access: 'API Access',
  memory: 'Memory',
};

// Required tier per feature
const FEATURE_REQUIREMENTS: Record<Feature, AccessTier> = {
  voice: 'basic',
  trading: 'basic',
  memory: 'basic',
  social: 'pro',
  email: 'pro',
  code: 'pro',
  image_gen: 'pro',
  api_access: 'pro',
  spawn: 'whale',
  priority_queue: 'whale',
  custom_personality: 'whale',
};

export default function GatedFeature({
  feature,
  currentTier,
  children,
  fallback,
  showUpgradePrompt = true,
}: GatedFeatureProps) {
  const hasAccess = canUseFeature(currentTier, feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (!showUpgradePrompt) {
    return null;
  }

  const requiredTier = FEATURE_REQUIREMENTS[feature];
  const requiredAmount = TIER_THRESHOLDS[requiredTier as keyof typeof TIER_THRESHOLDS] || 0;

  return (
    <motion.div
      className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-700 bg-black/50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="text-2xl mb-2">🔒</div>
      <div className="text-sm font-mono text-white mb-1">
        {FEATURE_NAMES[feature]}
      </div>
      <div className="text-xs text-gray-400 text-center">
        Requires <span className="text-white font-bold uppercase">{requiredTier}</span> tier
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Hold {formatNumber(requiredAmount)}+ $TETSUO to unlock
      </div>
    </motion.div>
  );
}

// Simpler inline gated wrapper
export function GatedInline({
  feature,
  currentTier,
  children,
}: {
  feature: Feature;
  currentTier: AccessTier;
  children: React.ReactNode;
}) {
  const hasAccess = canUseFeature(currentTier, feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <span className="inline-flex items-center gap-1 text-gray-500 cursor-not-allowed">
      <span className="text-xs">🔒</span>
      <span className="line-through opacity-50">{children}</span>
    </span>
  );
}

// HOC for gating entire components
export function withGate<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  feature: Feature
) {
  return function GatedComponent(props: P & { currentTier: AccessTier }) {
    const { currentTier, ...rest } = props;

    if (canUseFeature(currentTier, feature)) {
      return <WrappedComponent {...(rest as P)} />;
    }

    return (
      <GatedFeature
        feature={feature}
        currentTier={currentTier}
        showUpgradePrompt={true}
      >
        {null}
      </GatedFeature>
    );
  };
}

// Helper to format numbers
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(0)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(0)}K`;
  }
  return num.toString();
}
