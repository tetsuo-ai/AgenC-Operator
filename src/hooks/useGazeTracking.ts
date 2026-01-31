/**
 * ============================================================================
 * useGazeTracking - Head & Eye Cursor Tracking System
 * ============================================================================
 * Tracks the user's mouse cursor and rotates head/neck/eye bones to follow.
 *
 * Architecture:
 *   - Mouse position on Canvas → normalized coordinates (-1 to 1)
 *   - Convert to yaw/pitch angles
 *   - Distribute rotation across neck (lower + upper) and head bones
 *   - Eyes track the remainder + micro-saccades
 *
 * Gaze modes:
 *   - 'user': follow cursor position (default)
 *   - 'camera': look straight at camera (rest position)
 *   - 'wander': slow random drift for idle variety
 *
 * Designed to layer additively with other animation systems.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';

// ============================================================================
// Configuration
// ============================================================================

export interface GazeTrackingConfig {
  /** Maximum horizontal head rotation in radians */
  maxHeadYaw: number;
  /** Maximum vertical head rotation in radians */
  maxHeadPitch: number;
  /** Maximum horizontal eye rotation in radians */
  maxEyeYaw: number;
  /** Maximum vertical eye rotation in radians */
  maxEyePitch: number;
  /** Head interpolation speed (lower = smoother) */
  headLerpSpeed: number;
  /** Eye interpolation speed (faster than head) */
  eyeLerpSpeed: number;
  /** Saccade interval range [min, max] in seconds */
  saccadeIntervalMin: number;
  saccadeIntervalMax: number;
  /** Saccade magnitude in radians */
  saccadeAmount: number;
}

const DEFAULT_CONFIG: GazeTrackingConfig = {
  maxHeadYaw: 0.35,      // ~20 degrees
  maxHeadPitch: 0.2,     // ~11 degrees
  maxEyeYaw: 0.25,       // ~14 degrees
  maxEyePitch: 0.15,     // ~8 degrees
  headLerpSpeed: 2.0,
  eyeLerpSpeed: 6.0,
  saccadeIntervalMin: 0.5,
  saccadeIntervalMax: 2.0,
  saccadeAmount: 0.03,
};

// ============================================================================
// Types
// ============================================================================

export type GazeMode = 'user' | 'camera' | 'wander';

interface GazeBoneRefs {
  neckLower?: THREE.Bone;
  neckUpper?: THREE.Bone;
  head?: THREE.Bone;
  eyeL?: THREE.Bone;
  eyeR?: THREE.Bone;
}

interface GazeRestPoses {
  [boneName: string]: THREE.Euler;
}

interface GazeState {
  mode: GazeMode;
  // Normalized cursor position (-1 to 1)
  cursorX: number;
  cursorY: number;
  // Target angles (computed from cursor or wander)
  targetYaw: number;
  targetPitch: number;
  // Current smoothed angles for head chain
  currentHeadYaw: number;
  currentHeadPitch: number;
  // Current smoothed angles for eyes
  currentEyeYaw: number;
  currentEyePitch: number;
  // Saccade state
  saccadeOffsetX: number;
  saccadeOffsetY: number;
  nextSaccadeTime: number;
  // Wander state
  wanderTargetYaw: number;
  wanderTargetPitch: number;
  nextWanderTime: number;
  // Time accumulator
  time: number;
  // Debug
  debugTimer: number;
}

export interface UseGazeTrackingReturn {
  /** Initialize with loaded scene - finds neck/head/eye bones */
  initialize: (scene: THREE.Object3D) => void;
  /** Update gaze tracking each frame */
  update: (delta: number) => void;
  /** Set the gaze mode */
  setMode: (mode: GazeMode) => void;
  /** Update cursor position from mouse event (normalized -1 to 1) */
  setCursorPosition: (x: number, y: number) => void;
  /** Get current mode */
  getMode: () => GazeMode;
}

// ============================================================================
// Bone Name Patterns (Genesis 9)
// ============================================================================

const GAZE_BONE_PATTERNS: Record<keyof GazeBoneRefs, RegExp[]> = {
  neckLower: [/^neck_lower$/i, /^necklower$/i, /^neck1$/i, /^neck$/i],
  neckUpper: [/^neck_upper$/i, /^neckupper$/i, /^neck2$/i],
  head: [/^head$/i],
  eyeL: [/^l_eye$/i, /^eyeL$/i, /^eye_left$/i],
  eyeR: [/^r_eye$/i, /^eyeR$/i, /^eye_right$/i],
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useGazeTracking(
  initialConfig: Partial<GazeTrackingConfig> = {}
): UseGazeTrackingReturn {
  const configRef = useRef<GazeTrackingConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const bonesRef = useRef<GazeBoneRefs>({});
  const restPosesRef = useRef<GazeRestPoses>({});
  const initializedRef = useRef(false);

  const stateRef = useRef<GazeState>({
    mode: 'user',
    cursorX: 0,
    cursorY: 0,
    targetYaw: 0,
    targetPitch: 0,
    currentHeadYaw: 0,
    currentHeadPitch: 0,
    currentEyeYaw: 0,
    currentEyePitch: 0,
    saccadeOffsetX: 0,
    saccadeOffsetY: 0,
    nextSaccadeTime: Math.random() * 1 + 0.5,
    wanderTargetYaw: 0,
    wanderTargetPitch: 0,
    nextWanderTime: Math.random() * 3 + 2,
    time: 0,
    debugTimer: 0,
  });

  // ========================================
  // Find bone by patterns
  // ========================================

  const findBone = useCallback((scene: THREE.Object3D, patterns: RegExp[]): THREE.Bone | undefined => {
    let foundBone: THREE.Bone | undefined;
    scene.traverse((child) => {
      if (foundBone) return;
      if (child instanceof THREE.Bone) {
        for (const pattern of patterns) {
          if (pattern.test(child.name)) {
            foundBone = child;
            return;
          }
        }
      }
    });
    return foundBone;
  }, []);

  // ========================================
  // Initialize
  // ========================================

  const initialize = useCallback((scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    log.info('[GazeTracking] ========== INITIALIZING ==========');

    const bones: GazeBoneRefs = {};
    const foundBones: string[] = [];

    for (const [key, patterns] of Object.entries(GAZE_BONE_PATTERNS)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        bones[key as keyof GazeBoneRefs] = bone;
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      }
    }
    bonesRef.current = bones;

    if (foundBones.length > 0) {
      log.info(`[GazeTracking] Found ${foundBones.length} gaze bones:`);
      foundBones.forEach(b => log.debug(`[GazeTracking]   + ${b}`));
    }

    const hasHead = !!(bones.head);
    const hasEyes = !!(bones.eyeL && bones.eyeR);
    const hasNeck = !!(bones.neckLower || bones.neckUpper);
    log.info(`[GazeTracking] Capabilities: head=${hasHead}, eyes=${hasEyes}, neck=${hasNeck}`);

    initializedRef.current = true;
    log.info('[GazeTracking] Initialization complete');
  }, [findBone]);

  // ========================================
  // Set cursor position
  // ========================================

  const setCursorPosition = useCallback((x: number, y: number) => {
    stateRef.current.cursorX = Math.max(-1, Math.min(1, x));
    stateRef.current.cursorY = Math.max(-1, Math.min(1, y));
  }, []);

  // ========================================
  // Set gaze mode
  // ========================================

  const setMode = useCallback((mode: GazeMode) => {
    stateRef.current.mode = mode;
  }, []);

  const getMode = useCallback((): GazeMode => {
    return stateRef.current.mode;
  }, []);

  // ========================================
  // Update (call every frame)
  // ========================================

  const update = useCallback((delta: number) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const state = stateRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;

    state.time += delta;

    // ==============================
    // Compute target based on mode
    // ==============================

    switch (state.mode) {
      case 'user':
        // Cursor position → head rotation angles
        state.targetYaw = state.cursorX * config.maxHeadYaw;
        state.targetPitch = -state.cursorY * config.maxHeadPitch; // Invert Y for natural look
        break;

      case 'camera':
        // Look straight at camera = rest position
        state.targetYaw = 0;
        state.targetPitch = 0;
        break;

      case 'wander':
        // Slow random drift
        if (state.time >= state.nextWanderTime) {
          state.wanderTargetYaw = (Math.random() - 0.5) * config.maxHeadYaw * 0.4;
          state.wanderTargetPitch = (Math.random() - 0.5) * config.maxHeadPitch * 0.3;
          state.nextWanderTime = state.time + 3 + Math.random() * 5;
        }
        state.targetYaw = state.wanderTargetYaw;
        state.targetPitch = state.wanderTargetPitch;
        break;
    }

    // ==============================
    // Saccades (micro eye movements)
    // ==============================

    if (state.time >= state.nextSaccadeTime) {
      state.saccadeOffsetX = (Math.random() - 0.5) * config.saccadeAmount * 2;
      state.saccadeOffsetY = (Math.random() - 0.5) * config.saccadeAmount * 2;
      state.nextSaccadeTime = state.time + config.saccadeIntervalMin +
        Math.random() * (config.saccadeIntervalMax - config.saccadeIntervalMin);
    }
    // Saccade offset decays quickly
    state.saccadeOffsetX *= (1 - delta * 8);
    state.saccadeOffsetY *= (1 - delta * 8);

    // ==============================
    // Smooth interpolation
    // ==============================

    // Head: 60% of target, smoothed
    const headTargetYaw = state.targetYaw * 0.6;
    const headTargetPitch = state.targetPitch * 0.6;

    state.currentHeadYaw += (headTargetYaw - state.currentHeadYaw) * delta * config.headLerpSpeed;
    state.currentHeadPitch += (headTargetPitch - state.currentHeadPitch) * delta * config.headLerpSpeed;

    // Eyes: remaining 40% + saccades, smoothed faster
    const eyeTargetYaw = (state.targetYaw - state.currentHeadYaw) + state.saccadeOffsetX;
    const eyeTargetPitch = (state.targetPitch - state.currentHeadPitch) + state.saccadeOffsetY;

    // Clamp eye angles
    const clampedEyeYaw = Math.max(-config.maxEyeYaw, Math.min(config.maxEyeYaw, eyeTargetYaw));
    const clampedEyePitch = Math.max(-config.maxEyePitch, Math.min(config.maxEyePitch, eyeTargetPitch));

    state.currentEyeYaw += (clampedEyeYaw - state.currentEyeYaw) * delta * config.eyeLerpSpeed;
    state.currentEyePitch += (clampedEyePitch - state.currentEyePitch) * delta * config.eyeLerpSpeed;

    // ==============================
    // Apply to bones
    // ==============================

    // Distribute head rotation across neck chain:
    // neckLower: 20%, neckUpper: 30%, head: 50%
    if (bones.neckLower && rest.neckLower) {
      const neckLowerYaw = state.currentHeadYaw * 0.2;
      const neckLowerPitch = state.currentHeadPitch * 0.2;
      bones.neckLower.rotation.y = THREE.MathUtils.lerp(
        bones.neckLower.rotation.y,
        rest.neckLower.y + neckLowerYaw,
        delta * config.headLerpSpeed * 2
      );
      bones.neckLower.rotation.x = THREE.MathUtils.lerp(
        bones.neckLower.rotation.x,
        rest.neckLower.x + neckLowerPitch,
        delta * config.headLerpSpeed * 2
      );
    }

    if (bones.neckUpper && rest.neckUpper) {
      const neckUpperYaw = state.currentHeadYaw * 0.3;
      const neckUpperPitch = state.currentHeadPitch * 0.3;
      bones.neckUpper.rotation.y = THREE.MathUtils.lerp(
        bones.neckUpper.rotation.y,
        rest.neckUpper.y + neckUpperYaw,
        delta * config.headLerpSpeed * 2
      );
      bones.neckUpper.rotation.x = THREE.MathUtils.lerp(
        bones.neckUpper.rotation.x,
        rest.neckUpper.x + neckUpperPitch,
        delta * config.headLerpSpeed * 2
      );
    }

    if (bones.head && rest.head) {
      const headYaw = state.currentHeadYaw * 0.5;
      const headPitch = state.currentHeadPitch * 0.5;
      bones.head.rotation.y = THREE.MathUtils.lerp(
        bones.head.rotation.y,
        rest.head.y + headYaw,
        delta * config.headLerpSpeed * 2
      );
      bones.head.rotation.x = THREE.MathUtils.lerp(
        bones.head.rotation.x,
        rest.head.x + headPitch,
        delta * config.headLerpSpeed * 2
      );
    }

    // Eyes
    if (bones.eyeL && rest.eyeL) {
      bones.eyeL.rotation.y = THREE.MathUtils.lerp(
        bones.eyeL.rotation.y,
        rest.eyeL.y + state.currentEyeYaw,
        delta * config.eyeLerpSpeed
      );
      bones.eyeL.rotation.x = THREE.MathUtils.lerp(
        bones.eyeL.rotation.x,
        rest.eyeL.x + state.currentEyePitch,
        delta * config.eyeLerpSpeed
      );
    }
    if (bones.eyeR && rest.eyeR) {
      bones.eyeR.rotation.y = THREE.MathUtils.lerp(
        bones.eyeR.rotation.y,
        rest.eyeR.y + state.currentEyeYaw,
        delta * config.eyeLerpSpeed
      );
      bones.eyeR.rotation.x = THREE.MathUtils.lerp(
        bones.eyeR.rotation.x,
        rest.eyeR.x + state.currentEyePitch,
        delta * config.eyeLerpSpeed
      );
    }

    // Debug logging every 10 seconds
    state.debugTimer += delta;
    if (state.debugTimer >= 10.0) {
      state.debugTimer = 0;
      log.debug(
        `[GazeTracking] mode=${state.mode} ` +
        `cursor=(${state.cursorX.toFixed(2)},${state.cursorY.toFixed(2)}) ` +
        `headYaw=${state.currentHeadYaw.toFixed(3)} headPitch=${state.currentHeadPitch.toFixed(3)} ` +
        `eyeYaw=${state.currentEyeYaw.toFixed(3)} eyePitch=${state.currentEyePitch.toFixed(3)}`
      );
    }
  }, []);

  return {
    initialize,
    update,
    setMode,
    setCursorPosition,
    getMode,
  };
}
