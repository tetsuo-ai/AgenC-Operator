/**
 * ============================================================================
 * useMouthAnimation - React Hook for Audio-Driven Mouth Animation
 * ============================================================================
 * Provides a mouthOpen value (0..1) driven by audio playback.
 * Also provides appliers for morph targets and jaw bones.
 *
 * Integrates with the animation system:
 *   - useIdleAnimation (breathing, blinks)
 *   - useTalkingAnimation (gestures, head movement)
 *   - useExpressionSystem (facial expressions)
 *
 * This hook handles the core lip sync mechanism while the expression system
 * handles higher-level facial animation.
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
  isExcludedMorph,
  type GLBInspectionResult,
  type MorphTargetInfo,
  type BoneInfo,
} from '../utils/glbInspector';
import { log } from '../utils/log';
import type { VisemeWeights } from '../constants/visemeMap';

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
  /** Use jaw bone in addition to morph targets */
  useJawBone: boolean;
  /** Jaw bone contribution when using morph targets (0-1) */
  jawBoneContribution: number;
}

const DEFAULT_CONFIG: MouthAnimationConfig = {
  maxJawRotation: 0.15, // ~8.5 degrees
  jawRotationAxis: 'x',
  jawRotationDirection: 1,
  debug: false,
  forceTest: -1, // Set to 0.9 to test if rig works
  useJawBone: true, // Use jaw bone for additional realism
  jawBoneContribution: 0.3, // 30% jaw bone when morph targets available
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
  /** Set viseme target weights (call before applyMouthAnimation). Pass null to disable viseme mode. */
  setVisemeTarget: (weights: VisemeWeights | null) => void;
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
// Lip Bone References (Genesis 9 facial rig)
// ============================================================================

interface LipBoneRefs {
  centerUpper?: THREE.Bone;
  centerLower?: THREE.Bone;
  upperL?: THREE.Bone;
  upperR?: THREE.Bone;
  lowerL?: THREE.Bone;
  lowerR?: THREE.Bone;
  cornerL?: THREE.Bone;
  cornerR?: THREE.Bone;
}

interface LipBoneRestPoses {
  [key: string]: THREE.Euler;
}

const LIP_BONE_PATTERNS: Record<keyof LipBoneRefs, RegExp[]> = {
  centerUpper: [/^center_lipupper$/i, /^centerlipupper$/i, /^mid_lipupper$/i],
  centerLower: [/^center_liplower$/i, /^centerliplower$/i, /^mid_liplower$/i],
  upperL: [/^l_lipupper$/i, /^lipUpperL$/i],
  upperR: [/^r_lipupper$/i, /^lipUpperR$/i],
  lowerL: [/^l_liplower$/i, /^lipLowerL$/i],
  lowerR: [/^r_liplower$/i, /^lipLowerR$/i],
  cornerL: [/^l_lipcorner$/i, /^lipCornerL$/i],
  cornerR: [/^r_lipcorner$/i, /^lipCornerR$/i],
};

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
  // Secondary smoothing for more natural mouth movement
  const smoothedMouthRef = useRef<number>(0);
  const prevMouthRef = useRef<number>(0);
  // Lip bone refs for Genesis 9 facial rig
  const lipBonesRef = useRef<LipBoneRefs>({});
  const lipRestPosesRef = useRef<LipBoneRestPoses>({});
  // Viseme target: when non-null, lip bones are driven by viseme shapes
  const visemeTargetRef = useRef<VisemeWeights | null>(null);

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
    // Check if morph target is valid (not an asymmetry/proportion sculpting morph)
    const hasValidMorph = inspection.bestMouthMorph &&
      !isExcludedMorph(inspection.bestMouthMorph.targetName);

    if (hasValidMorph && inspection.bestMouthMorph) {
      // Use morph targets as primary (only if it's a real animation morph)
      useMorphTargetsRef.current = true;
      morphTargetRef.current = inspection.bestMouthMorph;
      log.info(
        `[MouthAnimation] Using morph target: "${inspection.bestMouthMorph.targetName}" on "${inspection.bestMouthMorph.meshName}"`
      );

      // Also store jaw bone for hybrid animation if available
      if (inspection.bestJawBone && cfg.useJawBone) {
        jawBoneRef.current = inspection.bestJawBone;
        jawRestRotationRef.current = inspection.bestJawBone.bone.rotation.clone();
        log.info(`[MouthAnimation] Also using jaw bone for hybrid animation: "${inspection.bestJawBone.name}"`);
      }
    } else if (inspection.bestJawBone) {
      // Use jaw bone as PRIMARY (no valid morph targets available)
      // This handles models like Victoria 9 HD that only have sculpting morphs
      useMorphTargetsRef.current = false;
      jawBoneRef.current = inspection.bestJawBone;
      // Store rest rotation
      jawRestRotationRef.current = inspection.bestJawBone.bone.rotation.clone();

      if (inspection.bestMouthMorph && isExcludedMorph(inspection.bestMouthMorph.targetName)) {
        log.warn(`[MouthAnimation] Skipping excluded morph: "${inspection.bestMouthMorph.targetName}" (asymmetry/proportion morph, not animation)`);
      }

      log.info(`[MouthAnimation] Using jaw bone only: "${inspection.bestJawBone.name}"`);
      log.info(`[MouthAnimation] Jaw bone rest rotation: x=${jawRestRotationRef.current.x.toFixed(4)}, y=${jawRestRotationRef.current.y.toFixed(4)}, z=${jawRestRotationRef.current.z.toFixed(4)}`);
    } else {
      log.warn('[MouthAnimation] No suitable morph targets or jaw bones found');
      // List all bones found for debugging
      if (inspection.bones.length > 0) {
        const boneNames = inspection.bones.map(b => b.name).join(', ');
        log.warn(`[MouthAnimation] Available bones: ${boneNames.slice(0, 200)}...`);
      }
    }

    // ======================================================================
    // Discover lip bones for Genesis 9 facial rig
    // ======================================================================
    const lipBones: LipBoneRefs = {};
    const foundLipBones: string[] = [];

    scene.traverse((child) => {
      if (!(child instanceof THREE.Bone)) return;
      for (const [slot, patterns] of Object.entries(LIP_BONE_PATTERNS)) {
        if (lipBones[slot as keyof LipBoneRefs]) continue; // already found
        for (const pattern of patterns) {
          if (pattern.test(child.name)) {
            lipBones[slot as keyof LipBoneRefs] = child;
            lipRestPosesRef.current[slot] = child.rotation.clone();
            foundLipBones.push(`${slot} -> "${child.name}"`);
            break;
          }
        }
      }
    });

    lipBonesRef.current = lipBones;

    if (foundLipBones.length > 0) {
      log.info(`[MouthAnimation] Found ${foundLipBones.length} lip bones:`);
      foundLipBones.forEach(b => log.info(`[MouthAnimation]   + ${b}`));
    } else {
      log.warn('[MouthAnimation] No lip bones found - lip deformation disabled');
    }

    // Ensure driver is initialized
    getMouthDriver();

    initializedRef.current = true;
  }, [getMouthDriver]);

  // Set viseme target weights (call before applyMouthAnimation each frame)
  const setVisemeTarget = useCallback((weights: VisemeWeights | null) => {
    visemeTargetRef.current = weights;
  }, []);

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
      const jawRotation = jawBoneRef.current?.bone?.rotation;
      log.debug(`[MouthAnimation] mouthOpen=${mouthOpen.toFixed(3)} hasMorph=${hasMorph} hasJaw=${hasJaw} jawX=${jawRotation?.x?.toFixed(4) ?? 'N/A'}`);
    }

    // Secondary smoothing: lerp toward target for more natural, flowing movement
    const prev = smoothedMouthRef.current;
    const lerpSpeed = mouthOpen > prev ? 0.4 : 0.25; // faster open, gentler close
    const smoothed = prev + (mouthOpen - prev) * lerpSpeed;
    smoothedMouthRef.current = smoothed;

    // Velocity-based micro-variation: add subtle wobble when mouth is moving
    const velocity = Math.abs(smoothed - prevMouthRef.current);
    prevMouthRef.current = smoothed;
    const microVariation = velocity > 0.005 ? Math.sin(Date.now() * 0.02) * 0.02 * velocity * 10 : 0;
    const finalMouth = Math.min(1, Math.max(0, smoothed + microVariation));

    // Apply to morph target if available
    if (useMorphTargetsRef.current && morphTargetRef.current) {
      const { mesh, index } = morphTargetRef.current;
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[index] = finalMouth;
      }
    }

    // Apply to jaw bone (either as primary or secondary animation)
    if (jawBoneRef.current && jawRestRotationRef.current) {
      const bone = jawBoneRef.current.bone;
      const restRotation = jawRestRotationRef.current;

      // Calculate jaw contribution based on whether morph targets are being used
      const jawContribution = useMorphTargetsRef.current
        ? (cfg.useJawBone ? cfg.jawBoneContribution : 0)
        : 1.0;

      if (jawContribution > 0) {
        const rotation = finalMouth * cfg.maxJawRotation * cfg.jawRotationDirection * jawContribution;

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
    }

    // ======================================================================
    // Apply lip bone animation (Genesis 9 facial rig)
    // ======================================================================
    const lips = lipBonesRef.current;
    const lipRest = lipRestPosesRef.current;
    const viseme = visemeTargetRef.current;

    if (Object.keys(lips).length > 0) {
      if (viseme) {
        // === VISEME MODE: Drive lips from viseme shape weights ===
        // Amplitude modulates the overall intensity of the viseme shape
        const intensity = Math.max(0.3, finalMouth * 1.5); // Minimum 0.3 so shapes are visible even at low amplitude

        // Jaw open: driven by viseme jawOpen weight, modulated by amplitude
        // (jaw bone was already set above from amplitude — override with viseme-aware value)
        if (jawBoneRef.current && jawRestRotationRef.current) {
          const jawAmount = viseme.jawOpen * intensity * cfg.maxJawRotation * cfg.jawRotationDirection;
          const bone = jawBoneRef.current.bone;
          const rest = jawRestRotationRef.current;
          switch (cfg.jawRotationAxis) {
            case 'x': bone.rotation.x = rest.x + jawAmount; break;
            case 'y': bone.rotation.y = rest.y + jawAmount; break;
            case 'z': bone.rotation.z = rest.z + jawAmount; break;
          }
        }

        // Lower lip: drop amount from viseme
        const lipLowerDrop = viseme.lipLowerDrop * intensity * 0.1;
        if (lips.centerLower && lipRest.centerLower) {
          lips.centerLower.rotation.x = lipRest.centerLower.x + lipLowerDrop;
        }
        if (lips.lowerL && lipRest.lowerL) {
          lips.lowerL.rotation.x = lipRest.lowerL.x + lipLowerDrop * 0.7;
        }
        if (lips.lowerR && lipRest.lowerR) {
          lips.lowerR.rotation.x = lipRest.lowerR.x + lipLowerDrop * 0.7;
        }

        // Upper lip: raise amount from viseme
        const lipUpperRaise = viseme.lipUpperRaise * intensity * 0.06;
        if (lips.centerUpper && lipRest.centerUpper) {
          lips.centerUpper.rotation.x = lipRest.centerUpper.x - lipUpperRaise;
        }
        if (lips.upperL && lipRest.upperL) {
          lips.upperL.rotation.x = lipRest.upperL.x - lipUpperRaise * 0.6;
        }
        if (lips.upperR && lipRest.upperR) {
          lips.upperR.rotation.x = lipRest.upperR.x - lipUpperRaise * 0.6;
        }

        // Lip corners: stretch (spread outward) vs pucker (push forward)
        // Stretch uses Z rotation (outward), pucker uses Y rotation (forward)
        const stretchAmount = viseme.lipStretch * intensity * 0.06;
        const puckerAmount = viseme.lipPucker * intensity * 0.05;
        if (lips.cornerL && lipRest.cornerL) {
          lips.cornerL.rotation.z = lipRest.cornerL.z + stretchAmount;
          lips.cornerL.rotation.y = lipRest.cornerL.y + puckerAmount;
        }
        if (lips.cornerR && lipRest.cornerR) {
          lips.cornerR.rotation.z = lipRest.cornerR.z - stretchAmount;
          lips.cornerR.rotation.y = lipRest.cornerR.y - puckerAmount;
        }
      } else {
        // === AMPLITUDE MODE: Original simple lip animation ===

        // Lower lip follows jaw opening (rotate downward = positive X)
        const lipLowerAmount = finalMouth * 0.08;
        if (lips.centerLower && lipRest.centerLower) {
          lips.centerLower.rotation.x = lipRest.centerLower.x + lipLowerAmount;
        }
        if (lips.lowerL && lipRest.lowerL) {
          lips.lowerL.rotation.x = lipRest.lowerL.x + lipLowerAmount * 0.7;
        }
        if (lips.lowerR && lipRest.lowerR) {
          lips.lowerR.rotation.x = lipRest.lowerR.x + lipLowerAmount * 0.7;
        }

        // Upper lip lifts slightly during speech (negative X = upward)
        const lipUpperAmount = finalMouth * 0.03;
        if (lips.centerUpper && lipRest.centerUpper) {
          lips.centerUpper.rotation.x = lipRest.centerUpper.x - lipUpperAmount;
        }
        if (lips.upperL && lipRest.upperL) {
          lips.upperL.rotation.x = lipRest.upperL.x - lipUpperAmount * 0.6;
        }
        if (lips.upperR && lipRest.upperR) {
          lips.upperR.rotation.x = lipRest.upperR.x - lipUpperAmount * 0.6;
        }

        // Lip corners spread slightly when mouth opens wide (positive Z = outward)
        const lipCornerAmount = finalMouth * 0.04;
        if (lips.cornerL && lipRest.cornerL) {
          lips.cornerL.rotation.z = lipRest.cornerL.z + lipCornerAmount;
        }
        if (lips.cornerR && lipRest.cornerR) {
          lips.cornerR.rotation.z = lipRest.cornerR.z - lipCornerAmount;
        }
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
    smoothedMouthRef.current = 0;
    prevMouthRef.current = 0;
    visemeTargetRef.current = null;
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
    // Reset lip bones
    const lips = lipBonesRef.current;
    const lipRest = lipRestPosesRef.current;
    for (const [key, bone] of Object.entries(lips)) {
      if (bone && lipRest[key]) {
        bone.rotation.copy(lipRest[key]);
      }
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
    setVisemeTarget,
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
