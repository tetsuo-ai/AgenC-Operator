/**
 * ============================================================================
 * TetsuoAvatar - Public Avatar Interface
 * ============================================================================
 * Single entry point for the avatar system.
 * Supports both 2.5D (SVG/Canvas) and 3D (Three.js/GLB) rendering.
 *
 * Toggle USE_3D_AVATAR to switch between renderers.
 * The 3D renderer will automatically fall back to 2D if loading fails.
 * ============================================================================
 */

import { useState, useCallback, Suspense, lazy } from 'react';
import { useProgress } from '@react-three/drei';
import { ErrorBoundary } from './ErrorBoundary';
import type { AgentAppearance, AgentStatus } from '../../types';
import TetsuoAvatar2D from './TetsuoAvatar2D';

// ============================================================================
// Configuration Flag
// ============================================================================

/**
 * Master switch for 3D avatar rendering.
 * Set to true to use the GLB model with Three.js.
 * Set to false to use the 2.5D SVG/Canvas fallback.
 */
export const USE_3D_AVATAR = true;

// ============================================================================
// Props Interface
// ============================================================================

export interface TetsuoAvatarProps {
  appearance: AgentAppearance;
  status: AgentStatus;
}

// ============================================================================
// Loading Progress Component
// ============================================================================

/**
 * Progress-aware loading indicator for the 129MB avatar model.
 * Shows circular progress ring with percentage and status text.
 */
function AvatarLoadingFallback({ appearance }: { appearance: AgentAppearance }) {
  const { progress, active } = useProgress();
  const displayProgress = Math.round(progress);

  // SVG circle parameters
  const size = 120;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="w-[800px] h-[900px] flex flex-col items-center justify-center gap-4">
      {/* Progress Ring */}
      <div className="relative">
        <svg
          width={size}
          height={size}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`${appearance.accentColor}20`}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={appearance.accentColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 0.3s ease-out',
              filter: `drop-shadow(0 0 8px ${appearance.accentColor}80)`,
            }}
          />
        </svg>

        {/* Center content */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
        >
          <span
            className="text-2xl font-display font-bold tabular-nums"
            style={{ color: appearance.accentColor }}
          >
            {displayProgress}%
          </span>
        </div>

        {/* Glow effect */}
        <div
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: `radial-gradient(circle, ${appearance.accentColor}40 0%, transparent 70%)`,
            animation: active ? 'pulse 2s ease-in-out infinite' : 'none',
          }}
        />
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-1">
        <span
          className="text-xs font-display uppercase tracking-[0.3em]"
          style={{ color: appearance.accentColor }}
        >
          {active ? 'Loading Avatar' : 'Initializing'}
        </span>
        <span
          className="text-[10px] uppercase tracking-wider opacity-50"
          style={{ color: appearance.accentColor }}
        >
          {active ? 'Please wait...' : 'Preparing renderer'}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Lazy 3D Component Wrapper
// ============================================================================

const LazyTetsuoAvatar3D = lazy(() => import('./TetsuoAvatar3D'));

// ============================================================================
// Main Component
// ============================================================================

export default function TetsuoAvatar({
  appearance,
  status,
}: TetsuoAvatarProps) {
  const [has3DError, setHas3DError] = useState(false);

  const handle3DError = useCallback(() => {
    console.warn('[TetsuoAvatar] 3D renderer failed, falling back to 2D');
    setHas3DError(true);
  }, []);

  // Determine which renderer to use
  const shouldUse3D = USE_3D_AVATAR && !has3DError;

  return (
    <div className="relative select-none">
      {shouldUse3D ? (
        <ErrorBoundary onError={handle3DError} fallback={
          <TetsuoAvatar2D
            appearance={appearance}
            status={status}
          />
        }>
          <Suspense fallback={<AvatarLoadingFallback appearance={appearance} />}>
            <LazyTetsuoAvatar3D
              appearance={appearance}
              status={status}
              onLoadError={handle3DError}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <TetsuoAvatar2D
          appearance={appearance}
          status={status}
        />
      )}

      {/* Nameplate */}
      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2">
        <div
          className="font-display text-sm uppercase tracking-[0.3em] px-4 py-1"
          style={{
            color: appearance.accentColor,
            textShadow: `0 0 10px ${appearance.accentColor}80`,
          }}
        >
          {appearance.nameplate}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { AgentAppearance, AgentStatus } from '../../types';
