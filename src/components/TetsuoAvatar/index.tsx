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
 * CSS-only loading indicator for the avatar model.
 * Uses accent color theming with spinning ring animation.
 * Does not depend on Three.js internals (no useProgress hook).
 */
function AvatarLoadingFallback({ appearance }: { appearance: AgentAppearance }) {
  return (
    <div className="w-[800px] h-[900px] flex flex-col items-center justify-center gap-4">
      {/* Spinner rings */}
      <div className="relative w-[120px] h-[120px]">
        {/* Outer ring */}
        <div
          className="absolute inset-0 rounded-full border-2 animate-spin"
          style={{
            borderColor: `${appearance.accentColor}20`,
            borderTopColor: appearance.accentColor,
            animationDuration: '1.5s',
            filter: `drop-shadow(0 0 8px ${appearance.accentColor}80)`,
          }}
        />
        {/* Inner ring (counter-rotate) */}
        <div
          className="absolute inset-3 rounded-full border border-dashed animate-spin"
          style={{
            borderColor: `${appearance.accentColor}40`,
            animationDuration: '3s',
            animationDirection: 'reverse',
          }}
        />
        {/* Center glow */}
        <div
          className="absolute inset-0 rounded-full opacity-30 animate-pulse"
          style={{
            background: `radial-gradient(circle, ${appearance.accentColor}40 0%, transparent 70%)`,
          }}
        />
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-1">
        <span
          className="text-xs font-display uppercase tracking-[0.3em] animate-pulse"
          style={{ color: appearance.accentColor }}
        >
          Loading Avatar
        </span>
        <span
          className="text-[10px] uppercase tracking-wider opacity-50"
          style={{ color: appearance.accentColor }}
        >
          Please wait...
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
