/**
 * ============================================================================
 * Render Quality Presets
 * ============================================================================
 * Configures DPR, anti-aliasing, post-processing, and environment quality
 * for different hardware capabilities. Persisted via avatarStore.
 * ============================================================================
 */

export type RenderQualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface RenderQualityConfig {
  label: string;
  /** Device pixel ratio range [min, max] */
  dpr: [number, number];
  /** Enable MSAA anti-aliasing on the Canvas */
  antialias: boolean;
  /** Enable post-processing (bloom, vignette) */
  postProcessing: boolean;
  /** Bloom intensity (0 = disabled) */
  bloomIntensity: number;
  /** Bloom luminance threshold */
  bloomThreshold: number;
  /** Vignette darkness (0 = disabled) */
  vignetteDarkness: number;
  /** Vignette offset */
  vignetteOffset: number;
  /** Enable SMAA pass */
  smaa: boolean;
  /** Enable environment map */
  environmentMap: boolean;
}

export const QUALITY_PRESETS: Record<RenderQualityLevel, RenderQualityConfig> = {
  low: {
    label: 'Low',
    dpr: [1, 1],
    antialias: false,
    postProcessing: false,
    bloomIntensity: 0,
    bloomThreshold: 1.0,
    vignetteDarkness: 0,
    vignetteOffset: 0,
    smaa: false,
    environmentMap: true,
  },
  medium: {
    label: 'Medium',
    dpr: [1, 1.5],
    antialias: true,
    postProcessing: false,
    bloomIntensity: 0,
    bloomThreshold: 1.0,
    vignetteDarkness: 0,
    vignetteOffset: 0,
    smaa: false,
    environmentMap: true,
  },
  high: {
    label: 'High',
    dpr: [1.5, 2],
    antialias: true,
    postProcessing: true,
    bloomIntensity: 0.08,
    bloomThreshold: 0.95,
    vignetteDarkness: 0.15,
    vignetteOffset: 0.3,
    smaa: true,
    environmentMap: true,
  },
  ultra: {
    label: 'Ultra',
    dpr: [2, 3],
    antialias: true,
    postProcessing: true,
    bloomIntensity: 0.12,
    bloomThreshold: 0.92,
    vignetteDarkness: 0.2,
    vignetteOffset: 0.3,
    smaa: true,
    environmentMap: true,
  },
};

export const DEFAULT_QUALITY: RenderQualityLevel = 'medium';
