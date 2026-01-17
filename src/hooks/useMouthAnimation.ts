/**
 * ============================================================================
 * useMouthAnimation - React Hook for Audio-Driven Mouth Animation
 * ============================================================================
 * Provides a mouthOpen value (0..1) driven by audio playback.
 * Also provides appliers for morph targets and jaw bones.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import {
  MouthDriver,
  getGlobalMouthDriver,
  getGlobalAudioContext,
} from '../utils/mouthDriver';
import {
  inspectGLB,
  logGLBInspection,
  type GLBInspectionResult,
  type MorphTargetInfo,
  type BoneInfo,
} from '../utils/glbInspector';
import { DebugAPI } from '../api';

// Helper to log to terminal
const log = {
  debug: (msg: string) => { console.log(msg); DebugAPI.debug(msg); },
  info: (msg: string) => { console.log(msg); DebugAPI.info(msg); },
  warn: (msg: string) => { console.warn(msg); DebugAPI.log('warn', msg); },
};

// ============================================================================
// Configuration
// ============================================================================

export interface MouthAnimationConfig {
  /** Max jaw rotation in radians (for bone fallback) */
  maxJawRotation: number;
  /** Axis to rotate jaw around: 'x', 'y', or 'z' */
  jawRotationAxis: 'x' | 'y' | 'z';
  /** Direction of rotation: 1 or -1 */
  jawRotationDirection: 1 | -1;
  /** Enable debug logging */
  debug: boolean;
  /** Force mouth open to this value (0-1) for testing. Set to -1 to disable. */
  forceTest: number;
}

const DEFAULT_CONFIG: MouthAnimationConfig = {
  maxJawRotation: 0.15, // ~8.5 degrees
  jawRotationAxis: 'x',
  jawRotationDirection: 1,
  debug: false,
  forceTest: -1, // Set to 0.9 to test if rig works
};

// ============================================================================
// Hook Return Type
// ============================================================================

export interface MouthAnimationState {
  /** Current mouth open value (0..1) */
  mouthOpen: number;
  /** Whether using morph targets (true) or jaw bone (false) */
  useMorphTargets: boolean;
  /** The morph target being used (if any) */
  morphTarget: MorphTargetInfo | null;
  /** The jaw bone being used (if any) */
  jawBone: BoneInfo | null;
  /** Inspection results from the GLB */
  inspection: GLBInspectionResult | null;
}

export interface UseMouthAnimationReturn {
  /** Initialize with a loaded GLB scene */
  initialize: (scene: THREE.Object3D) => void;
  /** Get current state (call in useFrame) */
  getState: () => MouthAnimationState;
  /** Apply mouth animation to the model (call in useFrame) */
  applyMouthAnimation: () => void;
  /** Connect an AudioBufferSourceNode to the analyser */
  connectAudioSource: (source: AudioBufferSourceNode) => void;
  /** Get the AudioContext for creating sources */
  getAudioContext: () => AudioContext;
  /** Get the MouthDriver for direct access */
  getMouthDriver: () => MouthDriver;
  /** Reset animation state */
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useMouthAnimation(
  config: Partial<MouthAnimationConfig> = {}
): UseMouthAnimationReturn {
  const configRef = useRef<MouthAnimationConfig>({ ...DEFAULT_CONFIG, ...config });
  const driverRef = useRef<MouthDriver | null>(null);
  const inspectionRef = useRef<GLBInspectionResult | null>(null);
  const morphTargetRef = useRef<MorphTargetInfo | null>(null);
  const jawBoneRef = useRef<BoneInfo | null>(null);
  const jawRestRotationRef = useRef<THREE.Euler | null>(null);
  const useMorphTargetsRef = useRef<boolean>(false);
  const initializedRef = useRef<boolean>(false);

  // Get or create the global audio context and mouth driver
  const getAudioContext = useCallback((): AudioContext => {
    return getGlobalAudioContext();
  }, []);

  const getMouthDriver = useCallback((): MouthDriver => {
    if (!driverRef.current) {
      driverRef.current = getGlobalMouthDriver(getAudioContext());
    }
    return driverRef.current;
  }, [getAudioContext]);

  // Initialize with a GLB scene
  const initialize = useCallback((scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    const cfg = configRef.current;

    // Inspect the GLB
    const inspection = inspectGLB(scene);
    inspectionRef.current = inspection;

    if (cfg.debug) {
      logGLBInspection(inspection);
    }

    // Determine animation method
    if (inspection.bestMouthMorph) {
      // Use morph targets
      useMorphTargetsRef.current = true;
      morphTargetRef.current = inspection.bestMouthMorph;
      log.info(
        `[MouthAnimation] Using morph target: "${inspection.bestMouthMorph.targetName}" on "${inspection.bestMouthMorph.meshName}"`
      );
    } else if (inspection.bestJawBone) {
      // Fall back to jaw bone
      useMorphTargetsRef.current = false;
      jawBoneRef.current = inspection.bestJawBone;
      // Store rest rotation
      jawRestRotationRef.current = inspection.bestJawBone.bone.rotation.clone();
      log.info(`[MouthAnimation] Using jaw bone: "${inspection.bestJawBone.name}"`);
    } else {
      log.warn('[MouthAnimation] No suitable morph targets or jaw bones found');
    }

    // Ensure driver is initialized
    getMouthDriver();

    initializedRef.current = true;
  }, [getMouthDriver]);

  // Get current state
  const getState = useCallback((): MouthAnimationState => {
    const driver = driverRef.current;
    return {
      mouthOpen: driver ? driver.getMouthOpen() : 0,
      useMorphTargets: useMorphTargetsRef.current,
      morphTarget: morphTargetRef.current,
      jawBone: jawBoneRef.current,
      inspection: inspectionRef.current,
    };
  }, []);

  // Debug log counter
  const debugCounterRef = useRef(0);

  // Apply mouth animation (call every frame)
  const applyMouthAnimation = useCallback(() => {
    const cfg = configRef.current;

    // Get mouthOpen value - either from driver or force test
    let mouthOpen: number;
    if (cfg.forceTest >= 0) {
      mouthOpen = cfg.forceTest;
    } else {
      const driver = driverRef.current;
      if (!driver) {
        // Log warning once
        if (debugCounterRef.current === 0 && cfg.debug) {
          log.warn('[MouthAnimation] applyMouthAnimation called but driver not initialized');
        }
        return;
      }
      mouthOpen = driver.getMouthOpen();
    }

    // Debug logging (every 60 frames)
    if (cfg.debug && ++debugCounterRef.current >= 60) {
      debugCounterRef.current = 0;
      const hasMorph = useMorphTargetsRef.current && morphTargetRef.current;
      const hasJaw = jawBoneRef.current && jawRestRotationRef.current;
      log.debug(`[MouthAnimation] mouthOpen=${mouthOpen.toFixed(3)} hasMorph=${hasMorph} hasJaw=${hasJaw}`);
    }

    if (useMorphTargetsRef.current && morphTargetRef.current) {
      // Apply to morph target
      const { mesh, index } = morphTargetRef.current;
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = mouthOpen;
      }
    } else if (jawBoneRef.current && jawRestRotationRef.current) {
      // Apply to jaw bone
      const bone = jawBoneRef.current.bone;
      const restRotation = jawRestRotationRef.current;
      const rotation = mouthOpen * cfg.maxJawRotation * cfg.jawRotationDirection;

      // Apply rotation on the configured axis
      switch (cfg.jawRotationAxis) {
        case 'x':
          bone.rotation.x = restRotation.x + rotation;
          break;
        case 'y':
          bone.rotation.y = restRotation.y + rotation;
          break;
        case 'z':
          bone.rotation.z = restRotation.z + rotation;
          break;
      }
    }
  }, []);

  // Connect an audio source to the analyser
  const connectAudioSource = useCallback((source: AudioBufferSourceNode) => {
    const driver = getMouthDriver();
    source.connect(driver.inputNode);
  }, [getMouthDriver]);

  // Reset animation state
  const reset = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.reset();
    }
    // Reset morph target
    if (morphTargetRef.current) {
      const { mesh, index } = morphTargetRef.current;
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = 0;
      }
    }
    // Reset jaw bone
    if (jawBoneRef.current && jawRestRotationRef.current) {
      jawBoneRef.current.bone.rotation.copy(jawRestRotationRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  return {
    initialize,
    getState,
    applyMouthAnimation,
    connectAudioSource,
    getAudioContext,
    getMouthDriver,
    reset,
  };
}

// ============================================================================
// Simple 2D Hook for SVG/Canvas Avatars
// ============================================================================

interface UseMouthOpen2DOptions {
  /** Whether animation should be active (e.g., when speaking) */
  enabled: boolean;
  /** Update rate in ms (default 33ms = ~30fps) */
  updateRate?: number;
}

/**
 * Simple hook that provides a 0-1 mouth open value for 2D avatars.
 * Polls the global MouthDriver to get mouth open value driven by audio amplitude.
 */
export function useMouthOpen2D({ enabled, updateRate = 33 }: UseMouthOpen2DOptions): number {
  const [mouthOpen, setMouthOpen] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setMouthOpen(0);
      return;
    }

    const mouthDriver = getGlobalMouthDriver();

    const update = (timestamp: number) => {
      // Throttle updates to updateRate
      if (timestamp - lastUpdateRef.current >= updateRate) {
        const value = mouthDriver.getMouthOpen();
        setMouthOpen(value);
        lastUpdateRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setMouthOpen(0);
    };
  }, [enabled, updateRate]);

  return mouthOpen;
}
