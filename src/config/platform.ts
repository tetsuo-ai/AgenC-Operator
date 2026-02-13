/**
 * ============================================================================
 * Build-Time Platform Constants
 * ============================================================================
 * Set via VITE_PLATFORM env variable (see .env.desktop / .env.mobile).
 * Use these for feature gating that enables dead-code elimination.
 * For runtime layout/responsive checks, continue using isMobile() from
 * src/hooks/usePlatform.ts.
 * ============================================================================
 */

import type { RenderQualityLevel } from './renderQuality';

export const PLATFORM = (import.meta.env.VITE_PLATFORM || 'desktop') as 'desktop' | 'mobile';
export const IS_DESKTOP_BUILD = PLATFORM === 'desktop';
export const IS_MOBILE_BUILD = PLATFORM === 'mobile';

/**
 * Build-time feature flags. Vite replaces these with literal booleans
 * at compile time, enabling tree-shaking of unused platform code.
 */
export const FEATURES = {
  /** Desktop frameless window title bar */
  titleBar: IS_DESKTOP_BUILD,
  /** Mobile bottom navigation tabs */
  bottomNav: IS_MOBILE_BUILD,
  /** Solana Mobile Wallet Adapter */
  mobileWallet: IS_MOBILE_BUILD,
  /** Desktop keyboard shortcuts (D, T, Escape, etc.) */
  keyboardShortcuts: IS_DESKTOP_BUILD,
  /** Default render quality per platform */
  defaultQuality: (IS_MOBILE_BUILD ? 'low' : 'medium') as RenderQualityLevel,
} as const;
