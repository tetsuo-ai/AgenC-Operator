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
  onToggleCustomize: () => void;
  isCustomizeOpen: boolean;
}

// ============================================================================
// Loading Fallback
// ============================================================================

function AvatarLoadingFallback({ appearance }: { appearance: AgentAppearance }) {
  return (
    <div className="w-[400px] h-[500px] flex items-center justify-center">
      <div
        className="w-32 h-32 rounded-full animate-pulse"
        style={{
          background: `radial-gradient(circle, ${appearance.accentColor}40 0%, transparent 70%)`,
          boxShadow: `0 0 60px ${appearance.accentColor}40`,
        }}
      />
      <div
        className="absolute text-xs font-display uppercase tracking-widest"
        style={{ color: appearance.accentColor }}
      >
        LOADING
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
  onToggleCustomize,
  isCustomizeOpen,
}: TetsuoAvatarProps) {
  const [has3DError, setHas3DError] = useState(false);

  const handle3DError = useCallback(() => {
    console.warn('[TetsuoAvatar] 3D renderer failed, falling back to 2D');
    setHas3DError(true);
  }, []);

  // Determine which renderer to use
  const shouldUse3D = USE_3D_AVATAR && !has3DError;

  // Click handler for toggling customize panel
  const handleClick = useCallback(() => {
    onToggleCustomize();
  }, [onToggleCustomize]);

  return (
    <div
      className="relative cursor-pointer select-none"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
      aria-label="Toggle avatar customization"
    >
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

      {/* Customize Indicator (shown when panel is open) */}
      {isCustomizeOpen && (
        <div
          className="absolute top-2 right-2 w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: appearance.accentColor }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { AgentAppearance, AgentStatus } from '../../types';
