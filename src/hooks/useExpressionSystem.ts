/**
 * ============================================================================
 * useExpressionSystem - Facial Expression Animation System
 * ============================================================================
 * Provides procedural facial expressions that layer on top of other animations:
 *   - Random smiles during idle and speech
 *   - Brow raise on emphasis / thinking
 *   - Eye widening for surprise / emphasis
 *   - Happy eyes (slight squint) during speech
 *
 * All animations are additive and designed to layer with idle + talking systems.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';

// ============================================================================
// Configuration
// ============================================================================

export interface ExpressionConfig {
  /** Multiplier for mouth-open driven expressions (0 = disabled) */
  mouthOpenMultiplier: number;
  /** Average smiles per minute (random trigger) */
  smileChancePerMinute: number;
  /** How long a smile lasts in seconds */
  smileDuration: number;
  /** Peak smile intensity (0-1) */
  smileIntensity: number;
  /** Brow raise amount for emphasis (radians) */
  browEmphasisAmount: number;
  /** Eye widen amount on emphasis (0-1 morph weight) */
  eyeWidenOnEmphasis: number;
  /** Slight happy-eye squint during speech (0-1) */
  happyEyesDuringSpeech: number;
}

const DEFAULT_CONFIG: ExpressionConfig = {
  mouthOpenMultiplier: 0,
  smileChancePerMinute: 6,
  smileDuration: 2.0,
  smileIntensity: 0.4,
  browEmphasisAmount: 0.3,
  eyeWidenOnEmphasis: 0.15,
  happyEyesDuringSpeech: 0.1,
};

// ============================================================================
// Bone References
// ============================================================================

interface ExpressionBoneRefs {
  browInnerL?: THREE.Bone;
  browInnerR?: THREE.Bone;
  browOuterL?: THREE.Bone;
  browOuterR?: THREE.Bone;
}

interface ExpressionRestPoses {
  [boneName: string]: THREE.Euler;
}

// ============================================================================
// Morph Refs
// ============================================================================

interface ExpressionMorphRefs {
  mesh: THREE.SkinnedMesh | THREE.Mesh;
  smileIndex?: number;
  browRaiseIndex?: number;
  eyeWideIndex?: number;
  eyeSquintLIndex?: number;
  eyeSquintRIndex?: number;
}

// ============================================================================
// Expression State
// ============================================================================

type ExpressionType = 'happy' | 'thinking' | 'emphasis';

interface ActiveExpression {
  type: ExpressionType;
  startTime: number;
  duration: number;
  intensity: number;
}

interface ExpressionState {
  time: number;
  // Smile
  isSmiling: boolean;
  smileStartTime: number;
  smileIntensityCurrent: number;
  nextSmileTime: number;
  // Triggered expression
  activeExpression: ActiveExpression | null;
  // Debug
  debugLogTime: number;
}

// ============================================================================
// Return Type
// ============================================================================

export interface UseExpressionSystemReturn {
  /** Initialize with loaded scene - finds morph targets and bones for expressions */
  initialize: (scene: THREE.Object3D) => void;
  /** Update expressions each frame */
  update: (delta: number, isSpeaking: boolean) => void;
  /** Trigger a specific expression */
  triggerExpression: (type: ExpressionType, duration: number) => void;
}

// ============================================================================
// Bone Name Patterns (Genesis 9)
// ============================================================================

const BROW_BONE_PATTERNS: Record<keyof ExpressionBoneRefs, RegExp[]> = {
  browInnerL: [/^l_browinner$/i, /^browInnerL$/i, /^l_brow_inner$/i],
  browInnerR: [/^r_browinner$/i, /^browInnerR$/i, /^r_brow_inner$/i],
  browOuterL: [/^l_browouter$/i, /^browOuterL$/i, /^l_brow_outer$/i],
  browOuterR: [/^r_browouter$/i, /^browOuterR$/i, /^r_brow_outer$/i],
};

// Morph target patterns for expression morphs
const MORPH_PATTERNS = {
  smile: [/smile/i, /mouthSmile/i, /happy/i, /facs_bs_MouthSmile/i, /facs_ctrl_Smile/i],
  browRaise: [/browRaise/i, /browUp/i, /browInnerUp/i, /facs_bs_BrowInnerUp/i, /facs_ctrl_BrowRaise/i],
  eyeWide: [/eyeWide/i, /eyeOpen/i, /facs_bs_EyeWide/i, /facs_ctrl_EyeWide/i],
  eyeSquintL: [/eyeSquint.*L/i, /facs_bs_EyeSquintL/i, /squintL/i, /cheekSquintL/i],
  eyeSquintR: [/eyeSquint.*R/i, /facs_bs_EyeSquintR/i, /squintR/i, /cheekSquintR/i],
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useExpressionSystem(
  initialConfig: Partial<ExpressionConfig> = {}
): UseExpressionSystemReturn {
  const configRef = useRef<ExpressionConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const bonesRef = useRef<ExpressionBoneRefs>({});
  const restPosesRef = useRef<ExpressionRestPoses>({});
  const morphRef = useRef<ExpressionMorphRefs | null>(null);
  const initializedRef = useRef(false);

  const stateRef = useRef<ExpressionState>({
    time: 0,
    isSmiling: false,
    smileStartTime: 0,
    smileIntensityCurrent: 0,
    nextSmileTime: Math.random() * 10 + 5,
    activeExpression: null,
    debugLogTime: 0,
  });

  // ============================================================================
  // Find bone by patterns
  // ============================================================================

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

  // ============================================================================
  // Find morph target by patterns
  // ============================================================================

  const findMorphIndex = useCallback((
    dict: Record<string, number>,
    patterns: RegExp[]
  ): number | undefined => {
    for (const [name, index] of Object.entries(dict)) {
      for (const pattern of patterns) {
        if (pattern.test(name)) {
          return index as number;
        }
      }
    }
    return undefined;
  }, []);

  // ============================================================================
  // Initialize
  // ============================================================================

  const initialize = useCallback((scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    log.info('[ExpressionSystem] ========== INITIALIZING ==========');

    // Find brow bones
    const bones: ExpressionBoneRefs = {};
    const foundBones: string[] = [];

    for (const [key, patterns] of Object.entries(BROW_BONE_PATTERNS)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        bones[key as keyof ExpressionBoneRefs] = bone;
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      }
    }
    bonesRef.current = bones;

    if (foundBones.length > 0) {
      log.info(`[ExpressionSystem] Found ${foundBones.length} brow bones:`);
      foundBones.forEach(b => log.debug(`[ExpressionSystem]   + ${b}`));
    } else {
      log.warn('[ExpressionSystem] No brow bones found - brow animations disabled');
    }

    // Find morph targets for expressions
    scene.traverse((child) => {
      if (morphRef.current) return;
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        const dict = child.morphTargetDictionary;
        if (dict) {
          const smileIdx = findMorphIndex(dict, MORPH_PATTERNS.smile);
          const browIdx = findMorphIndex(dict, MORPH_PATTERNS.browRaise);
          const eyeWideIdx = findMorphIndex(dict, MORPH_PATTERNS.eyeWide);
          const squintLIdx = findMorphIndex(dict, MORPH_PATTERNS.eyeSquintL);
          const squintRIdx = findMorphIndex(dict, MORPH_PATTERNS.eyeSquintR);

          // Accept mesh if we found at least one expression morph
          if (smileIdx !== undefined || browIdx !== undefined || eyeWideIdx !== undefined) {
            morphRef.current = {
              mesh: child,
              smileIndex: smileIdx,
              browRaiseIndex: browIdx,
              eyeWideIndex: eyeWideIdx,
              eyeSquintLIndex: squintLIdx,
              eyeSquintRIndex: squintRIdx,
            };

            log.info(`[ExpressionSystem] Found expression morphs on "${child.name}":`);
            if (smileIdx !== undefined) log.debug(`[ExpressionSystem]   + smile (index ${smileIdx})`);
            if (browIdx !== undefined) log.debug(`[ExpressionSystem]   + browRaise (index ${browIdx})`);
            if (eyeWideIdx !== undefined) log.debug(`[ExpressionSystem]   + eyeWide (index ${eyeWideIdx})`);
            if (squintLIdx !== undefined) log.debug(`[ExpressionSystem]   + eyeSquintL (index ${squintLIdx})`);
            if (squintRIdx !== undefined) log.debug(`[ExpressionSystem]   + eyeSquintR (index ${squintRIdx})`);
          }
        }
      }
    });

    if (!morphRef.current) {
      log.warn('[ExpressionSystem] No expression morph targets found - morph-based expressions disabled');
    }

    initializedRef.current = true;
    log.info('[ExpressionSystem] Initialization complete');
  }, [findBone, findMorphIndex]);

  // ============================================================================
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking: boolean) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const state = stateRef.current;

    state.time += delta;
    const t = state.time;

    // ========================================
    // Random Smile Trigger
    // ========================================
    const smileChancePerFrame = (config.smileChancePerMinute / 60) * delta;
    if (!state.isSmiling && t >= state.nextSmileTime && Math.random() < smileChancePerFrame * 60) {
      state.isSmiling = true;
      state.smileStartTime = t;
      log.debug('[ExpressionSystem] Random smile triggered');
    }

    // ========================================
    // Smile Animation
    // ========================================
    if (state.isSmiling) {
      const smileProgress = (t - state.smileStartTime) / config.smileDuration;

      if (smileProgress >= 1) {
        state.isSmiling = false;
        state.smileIntensityCurrent = 0;
        // Schedule next smile
        const interval = 60 / Math.max(1, config.smileChancePerMinute);
        state.nextSmileTime = t + interval * (0.5 + Math.random());
      } else {
        // Smooth bell curve: ease in, hold, ease out
        const curve = Math.sin(smileProgress * Math.PI);
        state.smileIntensityCurrent = curve * config.smileIntensity;
      }
    } else {
      // Decay smile smoothly
      state.smileIntensityCurrent = THREE.MathUtils.lerp(state.smileIntensityCurrent, 0, delta * 5);
    }

    // ========================================
    // Triggered Expression
    // ========================================
    let browRaiseAmount = 0;
    let eyeWidenAmount = 0;
    let expressionSmileBoost = 0;

    if (state.activeExpression) {
      const expr = state.activeExpression;
      const exprProgress = (t - expr.startTime) / expr.duration;

      if (exprProgress >= 1) {
        state.activeExpression = null;
      } else {
        const exprCurve = Math.sin(exprProgress * Math.PI);
        const exprIntensity = exprCurve * expr.intensity;

        switch (expr.type) {
          case 'happy':
            expressionSmileBoost = exprIntensity * config.smileIntensity;
            break;
          case 'thinking':
            browRaiseAmount = exprIntensity * config.browEmphasisAmount;
            break;
          case 'emphasis':
            browRaiseAmount = exprIntensity * config.browEmphasisAmount * 0.7;
            eyeWidenAmount = exprIntensity * config.eyeWidenOnEmphasis;
            break;
        }
      }
    }

    // ========================================
    // Happy eyes during speech
    // ========================================
    let eyeSquintAmount = 0;
    if (isSpeaking && config.happyEyesDuringSpeech > 0) {
      eyeSquintAmount = config.happyEyesDuringSpeech;
    }

    // ========================================
    // Apply Morph Targets
    // ========================================
    if (morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      const influences = morphRef.current.mesh.morphTargetInfluences;

      // Smile morph
      if (morphRef.current.smileIndex !== undefined) {
        const targetSmile = Math.min(1, state.smileIntensityCurrent + expressionSmileBoost);
        influences[morphRef.current.smileIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.smileIndex],
          targetSmile,
          delta * 8
        );
      }

      // Brow raise morph
      if (morphRef.current.browRaiseIndex !== undefined) {
        influences[morphRef.current.browRaiseIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.browRaiseIndex],
          browRaiseAmount,
          delta * 6
        );
      }

      // Eye wide morph
      if (morphRef.current.eyeWideIndex !== undefined) {
        influences[morphRef.current.eyeWideIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeWideIndex],
          eyeWidenAmount,
          delta * 6
        );
      }

      // Eye squint morphs (happy eyes)
      if (morphRef.current.eyeSquintLIndex !== undefined) {
        influences[morphRef.current.eyeSquintLIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeSquintLIndex],
          eyeSquintAmount,
          delta * 4
        );
      }
      if (morphRef.current.eyeSquintRIndex !== undefined) {
        influences[morphRef.current.eyeSquintRIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeSquintRIndex],
          eyeSquintAmount,
          delta * 4
        );
      }
    }

    // ========================================
    // Apply Brow Bone Rotations
    // ========================================
    const bones = bonesRef.current;
    const rest = restPosesRef.current;

    if (browRaiseAmount > 0) {
      if (bones.browInnerL && rest.browInnerL) {
        bones.browInnerL.rotation.x = THREE.MathUtils.lerp(
          bones.browInnerL.rotation.x,
          rest.browInnerL.x - browRaiseAmount,
          delta * 6
        );
      }
      if (bones.browInnerR && rest.browInnerR) {
        bones.browInnerR.rotation.x = THREE.MathUtils.lerp(
          bones.browInnerR.rotation.x,
          rest.browInnerR.x - browRaiseAmount,
          delta * 6
        );
      }
      if (bones.browOuterL && rest.browOuterL) {
        bones.browOuterL.rotation.x = THREE.MathUtils.lerp(
          bones.browOuterL.rotation.x,
          rest.browOuterL.x - browRaiseAmount * 0.5,
          delta * 6
        );
      }
      if (bones.browOuterR && rest.browOuterR) {
        bones.browOuterR.rotation.x = THREE.MathUtils.lerp(
          bones.browOuterR.rotation.x,
          rest.browOuterR.x - browRaiseAmount * 0.5,
          delta * 6
        );
      }
    } else {
      // Lerp brow bones back to rest
      if (bones.browInnerL && rest.browInnerL) {
        bones.browInnerL.rotation.x = THREE.MathUtils.lerp(bones.browInnerL.rotation.x, rest.browInnerL.x, delta * 4);
      }
      if (bones.browInnerR && rest.browInnerR) {
        bones.browInnerR.rotation.x = THREE.MathUtils.lerp(bones.browInnerR.rotation.x, rest.browInnerR.x, delta * 4);
      }
      if (bones.browOuterL && rest.browOuterL) {
        bones.browOuterL.rotation.x = THREE.MathUtils.lerp(bones.browOuterL.rotation.x, rest.browOuterL.x, delta * 4);
      }
      if (bones.browOuterR && rest.browOuterR) {
        bones.browOuterR.rotation.x = THREE.MathUtils.lerp(bones.browOuterR.rotation.x, rest.browOuterR.x, delta * 4);
      }
    }

    // ========================================
    // Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(
        `[ExpressionSystem] smile=${state.smileIntensityCurrent.toFixed(2)}, ` +
        `browRaise=${browRaiseAmount.toFixed(2)}, ` +
        `eyeWiden=${eyeWidenAmount.toFixed(2)}, ` +
        `speaking=${isSpeaking}`
      );
    }
  }, []);

  // ============================================================================
  // Trigger Expression
  // ============================================================================

  const triggerExpression = useCallback((type: ExpressionType, duration: number) => {
    const state = stateRef.current;
    state.activeExpression = {
      type,
      startTime: state.time,
      duration,
      intensity: 1.0,
    };
    log.debug(`[ExpressionSystem] Triggered expression: ${type} (${duration}s)`);
  }, []);

  return {
    initialize,
    update,
    triggerExpression,
  };
}
