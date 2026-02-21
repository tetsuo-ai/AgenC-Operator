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
import { MODEL_CONFIG } from '../config/modelConfig';
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
import { FacsMorphController } from '../utils/dazMorphMap';

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
  maxJawRotation: 0.15, // ~8.5 degrees — natural speech range
  jawRotationAxis: 'x',
  jawRotationDirection: -1, // Negative X opens jaw on Genesis 9
  debug: false,
  forceTest: -1, // Set to 0.9 to test if rig works
  useJawBone: true, // Use jaw bone for additional realism
  jawBoneContribution: 0.3, // Reduced — morphs handle most jaw shaping, bone adds subtle reinforcement
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
  /** Set the FACS morph controller for morph-driven visemes */
  setMorphController: (controller: FacsMorphController) => void;
  /** Get lip bone references for debug/testing */
  getLipBones: () => LipBoneRefs;
  /** Get lip bone rest poses for debug/testing */
  getLipRestPoses: () => LipBoneRestPoses;
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

const face = MODEL_CONFIG.skeleton.face;
const LIP_BONE_PATTERNS: Record<keyof LipBoneRefs, RegExp[]> = {
  centerUpper: face.lipUpperCenter,
  centerLower: face.lipLowerCenter,
  upperL: face.lipUpperL,
  upperR: face.lipUpperR,
  lowerL: face.lipLowerL,
  lowerR: face.lipLowerR,
  cornerL: face.lipCornerL,
  cornerR: face.lipCornerR,
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
  // Lip bone debug counter
  const lipDebugCounterRef = useRef<number>(0);
  // FACS morph controller for morph-driven visemes
  const morphControllerRef = useRef<FacsMorphController | null>(null);

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
      // Log rest rotations for all axes to determine correct rotation axis
      for (const [slot, bone] of Object.entries(lipBones)) {
        if (bone) {
          const r = bone.rotation;
          log.info(`[MouthAnimation] Lip rest "${slot}" (${bone.name}): x=${r.x.toFixed(4)} y=${r.y.toFixed(4)} z=${r.z.toFixed(4)} order=${r.order}`);
          // Log world quaternion to understand bone orientation
          const worldQ = new THREE.Quaternion();
          bone.getWorldQuaternion(worldQ);
          const euler = new THREE.Euler().setFromQuaternion(worldQ);
          log.info(`[MouthAnimation] Lip world "${slot}": x=${euler.x.toFixed(4)} y=${euler.y.toFixed(4)} z=${euler.z.toFixed(4)}`);
        }
      }
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
    const lerpSpeed = mouthOpen > prev ? 0.6 : 0.3; // fast open, moderate close
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
    const morphCtrl = morphControllerRef.current;

    if (viseme && morphCtrl) {
      // === FACS MORPH VISEME MODE: Drive morphs directly from viseme weights ===
      // Intensity scales with audio amplitude — higher base + velocity emphasis boost
      const velocityBoost = Math.min(0.3, velocity * 30); // rapid mouth opening adds up to +0.3
      const intensity = Math.min(1.0, Math.max(0.15, finalMouth * 1.2) + velocityBoost);

      // --- Core mouth shapes ---

      // Jaw opening
      morphCtrl.setMorph('jawOpen', viseme.jawOpen * intensity);

      // Lip stretch / spread (E, I, S sounds — horizontal widening, teeth showing)
      morphCtrl.setSymmetric('mouthSmileWiden', viseme.lipStretch * intensity);
      morphCtrl.setSymmetric('mouthWiden', viseme.lipStretch * intensity * 0.4);

      // Lip rounding / pucker (O, U, R, CH sounds — forward protrusion)
      morphCtrl.setQuad('mouthPurse', viseme.lipPucker * intensity);
      morphCtrl.setQuad('mouthFunnel', viseme.lipPucker * intensity * 0.5);
      morphCtrl.setQuad('mouthForward', viseme.lipPucker * intensity * 0.3);

      // Lip press / close (P, B, M sounds — lips together)
      // Active when pucker is high but jaw is nearly closed
      const isLipPress = viseme.lipPucker > 0.15 && viseme.jawOpen < 0.15;
      morphCtrl.setQuad('mouthClose', isLipPress ? viseme.lipPucker * intensity * 0.6 : 0);
      morphCtrl.setQuad('mouthCompress', isLipPress ? viseme.lipPucker * intensity * 0.3 : 0);

      // Upper/lower lip movement (reduced ~30%)
      // lipStretch adds teeth-showing for E/I sounds via upperUp
      const upperUp = viseme.lipUpperRaise * 0.7 + viseme.lipStretch * 0.2;
      morphCtrl.setSymmetric('mouthUpperUp', upperUp * intensity);
      morphCtrl.setSymmetric('mouthLowerDown', viseme.lipLowerDrop * intensity * 0.7);

      // Tongue
      morphCtrl.setMorph('tongueOut', viseme.tongueOut * intensity);

      // Natural lip separation proportional to jaw (reduced ~40%)
      morphCtrl.setMorph('mouthLipsPartCenter', viseme.jawOpen * intensity * 0.4);
      morphCtrl.setSymmetric('mouthLipsPart', viseme.jawOpen * intensity * 0.3);

      // --- Secondary facial animation for expressiveness ---

      // Subtle smile avoids dead/robotic look during speech
      morphCtrl.setSymmetric('mouthSmile', 0.06 + viseme.lipStretch * 0.04);

      // Cheek engagement — slight squint correlates with speech effort
      morphCtrl.setSymmetric('cheekSquint', 0.08 + finalMouth * 0.08);

      // Volume-reactive brow emphasis on louder moments
      const browLift = velocity > 0.008 && finalMouth > 0.35
        ? Math.min(0.2, (finalMouth - 0.35) * 0.3)
        : 0;
      morphCtrl.setSymmetric('browInnerUp', browLift);
      morphCtrl.setSymmetric('browOuterUp', browLift * 0.5);

      // Jaw bone contribution (scaled by jawBoneContribution to avoid double-dipping with morphs)
      if (jawBoneRef.current && jawRestRotationRef.current) {
        const jawAmount = viseme.jawOpen * intensity * cfg.maxJawRotation * cfg.jawRotationDirection * cfg.jawBoneContribution;
        const bone = jawBoneRef.current.bone;
        const rest = jawRestRotationRef.current;
        switch (cfg.jawRotationAxis) {
          case 'x': bone.rotation.x = rest.x + jawAmount; break;
          case 'y': bone.rotation.y = rest.y + jawAmount; break;
          case 'z': bone.rotation.z = rest.z + jawAmount; break;
        }
      }

      // Lip bones: Y-axis drives lip parting (Genesis 9 bone orientations)
      // Lower lips (rest x≈0.41): +Y opens downward
      // Upper lips (rest x≈-1.58, z≈3.14): -Y opens upward (flipped 180°)
      if (Object.keys(lips).length > 0) {
        // Lower lip: +Y to drop open, proportional to jawOpen + lipLowerDrop
        const lowerOpen = (viseme.lipLowerDrop + viseme.jawOpen * 0.5) * intensity * 0.30;
        if (lips.centerLower && lipRest.centerLower) {
          lips.centerLower.rotation.y = lipRest.centerLower.y + lowerOpen;
        }
        if (lips.lowerL && lipRest.lowerL) {
          lips.lowerL.rotation.y = lipRest.lowerL.y + lowerOpen * 0.8;
        }
        if (lips.lowerR && lipRest.lowerR) {
          lips.lowerR.rotation.y = lipRest.lowerR.y + lowerOpen * 0.8;
        }

        // Upper lip: -Y to raise open, proportional to lipUpperRaise + jawOpen
        const upperOpen = (viseme.lipUpperRaise + viseme.jawOpen * 0.3) * intensity * 0.22;
        if (lips.centerUpper && lipRest.centerUpper) {
          lips.centerUpper.rotation.y = lipRest.centerUpper.y - upperOpen;
        }
        if (lips.upperL && lipRest.upperL) {
          lips.upperL.rotation.y = lipRest.upperL.y - upperOpen * 0.7;
        }
        if (lips.upperR && lipRest.upperR) {
          lips.upperR.rotation.y = lipRest.upperR.y - upperOpen * 0.7;
        }

        // Corners: Y for spread, X for pucker
        const stretchAmount = viseme.lipStretch * intensity * 0.20;
        const puckerAmount = viseme.lipPucker * intensity * 0.18;
        if (lips.cornerL && lipRest.cornerL) {
          lips.cornerL.rotation.y = lipRest.cornerL.y + stretchAmount;
          lips.cornerL.rotation.x = lipRest.cornerL.x + puckerAmount;
        }
        if (lips.cornerR && lipRest.cornerR) {
          lips.cornerR.rotation.y = lipRest.cornerR.y + stretchAmount;
          lips.cornerR.rotation.x = lipRest.cornerR.x + puckerAmount;
        }
      }
    } else if (Object.keys(lips).length > 0) {
      if (viseme) {
        // === BONE-ONLY VISEME MODE: No morph controller, full bone contribution ===
        // Y-axis drives lip parting (Genesis 9 bone orientations)
        // Lower lips (rest x≈0.41): +Y opens downward
        // Upper lips (rest x≈-1.58, z≈3.14): -Y opens upward (flipped 180°)
        const intensity = Math.max(0.3, finalMouth * 1.5);

        // Jaw open: driven by viseme jawOpen weight
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

        // Lower lip: +Y to drop open
        const lowerOpen = (viseme.lipLowerDrop + viseme.jawOpen * 0.5) * intensity * 0.30;
        if (lips.centerLower && lipRest.centerLower) {
          lips.centerLower.rotation.y = lipRest.centerLower.y + lowerOpen;
        }
        if (lips.lowerL && lipRest.lowerL) {
          lips.lowerL.rotation.y = lipRest.lowerL.y + lowerOpen * 0.8;
        }
        if (lips.lowerR && lipRest.lowerR) {
          lips.lowerR.rotation.y = lipRest.lowerR.y + lowerOpen * 0.8;
        }

        // Upper lip: -Y to raise open
        const upperOpen = (viseme.lipUpperRaise + viseme.jawOpen * 0.3) * intensity * 0.22;
        if (lips.centerUpper && lipRest.centerUpper) {
          lips.centerUpper.rotation.y = lipRest.centerUpper.y - upperOpen;
        }
        if (lips.upperL && lipRest.upperL) {
          lips.upperL.rotation.y = lipRest.upperL.y - upperOpen * 0.7;
        }
        if (lips.upperR && lipRest.upperR) {
          lips.upperR.rotation.y = lipRest.upperR.y - upperOpen * 0.7;
        }

        // Corners: Y for spread, X for pucker
        const stretchAmount = viseme.lipStretch * intensity * 0.20;
        const puckerAmount = viseme.lipPucker * intensity * 0.18;
        if (lips.cornerL && lipRest.cornerL) {
          lips.cornerL.rotation.y = lipRest.cornerL.y + stretchAmount;
          lips.cornerL.rotation.x = lipRest.cornerL.x + puckerAmount;
        }
        if (lips.cornerR && lipRest.cornerR) {
          lips.cornerR.rotation.y = lipRest.cornerR.y + stretchAmount;
          lips.cornerR.rotation.x = lipRest.cornerR.x + puckerAmount;
        }
      } else {
        // === AMPLITUDE MODE: Lip bones driven by audio level ===
        // Y-axis drives lip parting (Genesis 9 bone orientations)
        // Lower lips (rest x≈0.41): +Y opens downward
        // Upper lips (rest x≈-1.58, z≈3.14): -Y opens upward (flipped 180°)

        // Lower lip: +Y to drop open proportional to mouth open
        const lowerOpen = finalMouth * 0.20;
        if (lips.centerLower && lipRest.centerLower) {
          lips.centerLower.rotation.y = lipRest.centerLower.y + lowerOpen;
        }
        if (lips.lowerL && lipRest.lowerL) {
          lips.lowerL.rotation.y = lipRest.lowerL.y + lowerOpen * 0.8;
        }
        if (lips.lowerR && lipRest.lowerR) {
          lips.lowerR.rotation.y = lipRest.lowerR.y + lowerOpen * 0.8;
        }

        // Upper lip: -Y to raise open during speech
        const upperOpen = finalMouth * 0.15;
        if (lips.centerUpper && lipRest.centerUpper) {
          lips.centerUpper.rotation.y = lipRest.centerUpper.y - upperOpen;
        }
        if (lips.upperL && lipRest.upperL) {
          lips.upperL.rotation.y = lipRest.upperL.y - upperOpen * 0.7;
        }
        if (lips.upperR && lipRest.upperR) {
          lips.upperR.rotation.y = lipRest.upperR.y - upperOpen * 0.7;
        }

        // Lip corners: Y for spread when mouth opens wide
        const cornerSpread = finalMouth * 0.12;
        if (lips.cornerL && lipRest.cornerL) {
          lips.cornerL.rotation.y = lipRest.cornerL.y + cornerSpread;
        }
        if (lips.cornerR && lipRest.cornerR) {
          lips.cornerR.rotation.y = lipRest.cornerR.y + cornerSpread;
        }

        // Debug: log lip bone Y rotations during speech (every 60 frames)
        if (finalMouth > 0.1) {
          lipDebugCounterRef.current++;
          if (lipDebugCounterRef.current >= 60) {
            lipDebugCounterRef.current = 0;
            const lL = lips.lowerL;
            const uL = lips.upperL;
            log.debug(`[MouthAnimation] Lips amplitude: finalMouth=${finalMouth.toFixed(3)}, lowerOpen=${lowerOpen.toFixed(3)}, upperOpen=${upperOpen.toFixed(3)}`);
            if (lL) log.debug(`[MouthAnimation]   lowerL y: rest=${lipRest.lowerL?.y.toFixed(4)} now=${lL.rotation.y.toFixed(4)}`);
            if (uL) log.debug(`[MouthAnimation]   upperL y: rest=${lipRest.upperL?.y.toFixed(4)} now=${uL.rotation.y.toFixed(4)}`);
          }
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

  // Set the FACS morph controller
  const setMorphController = useCallback((controller: FacsMorphController) => {
    morphControllerRef.current = controller;
    log.info(`[MouthAnimation] FACS morph controller set (${controller.morphCount} morphs)`);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Get lip bone references for debug/testing
  const getLipBones = useCallback((): LipBoneRefs => {
    return lipBonesRef.current;
  }, []);

  // Get lip bone rest poses for debug/testing
  const getLipRestPoses = useCallback((): LipBoneRestPoses => {
    return lipRestPosesRef.current;
  }, []);

  return {
    initialize,
    getState,
    applyMouthAnimation,
    setVisemeTarget,
    connectAudioSource,
    getAudioContext,
    getMouthDriver,
    reset,
    setMorphController,
    getLipBones,
    getLipRestPoses,
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
