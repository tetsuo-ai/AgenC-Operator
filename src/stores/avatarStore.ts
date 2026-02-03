/**
 * ============================================================================
 * Avatar Store - Zustand State for Camera & Avatar UI
 * ============================================================================
 * Manages camera presets, transition state, and orbit control toggling.
 * ============================================================================
 */

import { create } from 'zustand';
import type { CameraPreset, CameraMode } from '../types';
import type { RenderQualityLevel } from '../config/renderQuality';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../config/renderQuality';

// Quality preset version — bump this to force-reset users to the new default
// when preset values change significantly (e.g. bloom retuning).
const QUALITY_VERSION = '2';

function getInitialQuality(): RenderQualityLevel {
  const version = localStorage.getItem('tetsuo-render-quality-v');
  const cached = localStorage.getItem('tetsuo-render-quality') as RenderQualityLevel | null;
  if (version === QUALITY_VERSION && cached && cached in QUALITY_PRESETS) return cached;
  // Version mismatch or invalid — reset to new default
  localStorage.setItem('tetsuo-render-quality-v', QUALITY_VERSION);
  localStorage.setItem('tetsuo-render-quality', DEFAULT_QUALITY);
  return DEFAULT_QUALITY;
}

// ============================================================================
// Camera Presets for Genesis 9 model
// Model dimensions: Y range 0-171, centered at origin after offset
// ============================================================================

export const CAMERA_PRESETS: Record<CameraMode, CameraPreset> = {
  'face': {
    position: [0, 162, 35],
    target: [0, 160, 0],
    fov: 25,
  },
  'bust': {
    position: [0, 155, 65],
    target: [0, 150, 0],
    fov: 30,
  },
  'closeup': {
    position: [0, 160, 45],
    target: [0, 158, 0],
    fov: 30,
  },
  'waist': {
    position: [0, 130, 155],
    target: [0, 125, 0],
    fov: 34,
  },
  'full-body': {
    position: [0, 90, 280],
    target: [0, 86, 0],
    fov: 35,
  },
  'presentation': {
    position: [40, 142, 100],
    target: [0, 136, 0],
    fov: 32,
  },
  'custom': {
    position: [0, 135, 110],
    target: [0, 130, 0],
    fov: 35,
  },
};

const DEFAULT_PRESET = CAMERA_PRESETS['waist'];

// ============================================================================
// Store Interface
// ============================================================================

interface AvatarState {
  currentPreset: CameraPreset;
  currentMode: CameraMode;
  isTransitioning: boolean;
  orbitEnabled: boolean;
  renderQuality: RenderQualityLevel;

  setPreset: (preset: CameraPreset) => void;
  setCameraMode: (mode: CameraMode) => void;
  setTransitioning: (transitioning: boolean) => void;
  setOrbitEnabled: (enabled: boolean) => void;
  setRenderQuality: (quality: RenderQualityLevel) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useAvatarStore = create<AvatarState>((set) => ({
  currentPreset: DEFAULT_PRESET,
  currentMode: 'waist',
  isTransitioning: false,
  orbitEnabled: false,
  renderQuality: getInitialQuality(),

  setPreset: (preset) => set({ currentPreset: preset, isTransitioning: true }),
  setCameraMode: (mode) => set({
    currentPreset: CAMERA_PRESETS[mode],
    currentMode: mode,
    isTransitioning: true,
  }),
  setTransitioning: (transitioning) => set({ isTransitioning: transitioning }),
  setOrbitEnabled: (enabled) => set({ orbitEnabled: enabled }),
  setRenderQuality: (quality) => {
    localStorage.setItem('tetsuo-render-quality', quality);
    set({ renderQuality: quality });
  },
}));
