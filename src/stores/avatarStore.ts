/**
 * ============================================================================
 * Avatar Store - Zustand State for Camera & Avatar UI
 * ============================================================================
 * Manages camera presets, transition state, and orbit control toggling.
 * ============================================================================
 */

import { create } from 'zustand';
import type { CameraPreset, CameraMode } from '../types';

// ============================================================================
// Camera Presets for Genesis 9 model
// Model dimensions: Y range 0-171, centered at origin after offset
// ============================================================================

export const CAMERA_PRESETS: Record<CameraMode, CameraPreset> = {
  'closeup': {
    position: [0, 160, 45],
    target: [0, 158, 0],
    fov: 30,
  },
  'waist': {
    position: [0, 135, 110],
    target: [0, 130, 0],
    fov: 35,
  },
  'full-body': {
    position: [0, 86, 250],
    target: [0, 86, 0],
    fov: 40,
  },
  'presentation': {
    position: [30, 140, 90],
    target: [0, 135, 0],
    fov: 35,
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

  setPreset: (preset: CameraPreset) => void;
  setCameraMode: (mode: CameraMode) => void;
  setTransitioning: (transitioning: boolean) => void;
  setOrbitEnabled: (enabled: boolean) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useAvatarStore = create<AvatarState>((set) => ({
  currentPreset: DEFAULT_PRESET,
  currentMode: 'waist',
  isTransitioning: false,
  orbitEnabled: false,

  setPreset: (preset) => set({ currentPreset: preset, isTransitioning: true }),
  setCameraMode: (mode) => set({
    currentPreset: CAMERA_PRESETS[mode],
    currentMode: mode,
    isTransitioning: true,
  }),
  setTransitioning: (transitioning) => set({ isTransitioning: transitioning }),
  setOrbitEnabled: (enabled) => set({ orbitEnabled: enabled }),
}));
