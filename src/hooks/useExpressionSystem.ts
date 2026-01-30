/**
 * ============================================================================
 * useExpressionSystem - Bone-Based Facial Expression Animation System
 * ============================================================================
 * Provides procedural facial expressions using Genesis 9 facial bones:
 *   - Smile via lip corner + cheek bones
 *   - Brow raise/knit via brow bones
 *   - Eye gaze shifts via eye bones
 *   - Nostril flare on speech emphasis
 *   - Eyelid widen for surprise/emphasis
 *   - Speech-reactive brow movement
 *   - Micro-expressions during idle
 *
 * All animations are additive and designed to layer with idle + talking systems.
 * Lip corners are animated additively on top of useMouthAnimation's speech spread.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';
import { MODEL_CONFIG } from '../config/modelConfig';

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
  /** Eye widen amount on emphasis (radians for eyelid bones) */
  eyeWidenOnEmphasis: number;
  /** Slight happy-eye squint during speech (radians for eyelid bones) */
  happyEyesDuringSpeech: number;
}

const DEFAULT_CONFIG: ExpressionConfig = {
  mouthOpenMultiplier: 0,
  smileChancePerMinute: 6,
  smileDuration: 2.0,
  smileIntensity: 0.4,
  browEmphasisAmount: 0.3,
  eyeWidenOnEmphasis: 0.06,
  happyEyesDuringSpeech: 0.03,
};

// ============================================================================
// Bone References (expanded Genesis 9 facial rig)
// ============================================================================

interface ExpressionBoneRefs {
  // Brow bones
  browInnerL?: THREE.Bone;
  browInnerR?: THREE.Bone;
  browOuterL?: THREE.Bone;
  browOuterR?: THREE.Bone;
  // Lip corner bones (for bone-based smile)
  lipCornerL?: THREE.Bone;
  lipCornerR?: THREE.Bone;
  // Cheek bones (for Duchenne smile)
  cheekL?: THREE.Bone;
  cheekR?: THREE.Bone;
  // Nostril bones (for emphasis flare)
  nostrilL?: THREE.Bone;
  nostrilR?: THREE.Bone;
  // Center lip bones (for pout/press)
  lipUpperCenter?: THREE.Bone;
  lipLowerCenter?: THREE.Bone;
  // Eye bones (for gaze shifts)
  eyeL?: THREE.Bone;
  eyeR?: THREE.Bone;
  // Eyelid bones (for widen/squint via bones)
  eyelidUpperL?: THREE.Bone;
  eyelidUpperR?: THREE.Bone;
  eyelidLowerL?: THREE.Bone;
  eyelidLowerR?: THREE.Bone;
}

interface ExpressionRestPoses {
  [boneName: string]: THREE.Euler;
}

// ============================================================================
// Morph Refs (used if available, but most Victoria 9 models lack them)
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

type ExpressionType = 'happy' | 'thinking' | 'emphasis' | 'curious' | 'attentive' | 'surprised' | 'concerned';

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
  // Speech-reactive brow
  speechBrowTarget: number;
  speechBrowCurrent: number;
  prevAmplitude: number;
  amplitudeAccum: number;
  lastBrowPulseTime: number;
  // Micro-expressions during idle
  nextMicroExprTime: number;
  microExprType: 'brow_twitch' | 'lip_press' | 'none';
  microExprStart: number;
  microExprDuration: number;
  // Eye gaze
  gazeTargetX: number;
  gazeTargetY: number;
  gazeCurrentX: number;
  gazeCurrentY: number;
  nextGazeShiftTime: number;
  // Nostril flare
  nostrilFlareCurrent: number;
  nostrilFlareTarget: number;
  // Debug
  debugLogTime: number;
}

// ============================================================================
// Return Type
// ============================================================================

export interface UseExpressionSystemReturn {
  /** Initialize with loaded scene - finds bones for expressions */
  initialize: (scene: THREE.Object3D) => void;
  /** Update expressions each frame. mouthOpen (0-1) enables speech-reactive brows. */
  update: (delta: number, isSpeaking: boolean, mouthOpen?: number) => void;
  /** Trigger a specific expression */
  triggerExpression: (type: ExpressionType, duration: number) => void;
}

// ============================================================================
// Bone Name Patterns (Genesis 9)
// ============================================================================

const face = MODEL_CONFIG.skeleton.face;
const FACE_BONE_PATTERNS: Record<keyof ExpressionBoneRefs, RegExp[]> = {
  // Brow bones
  browInnerL: face.browInnerL,
  browInnerR: face.browInnerR,
  browOuterL: face.browOuterL,
  browOuterR: face.browOuterR,
  // Lip corners
  lipCornerL: face.lipCornerL,
  lipCornerR: face.lipCornerR,
  // Cheeks
  cheekL: face.cheekL,
  cheekR: face.cheekR,
  // Nostrils
  nostrilL: face.nostrilL,
  nostrilR: face.nostrilR,
  // Center lips
  lipUpperCenter: face.lipUpperCenter,
  lipLowerCenter: face.lipLowerCenter,
  // Eyes
  eyeL: MODEL_CONFIG.skeleton.eyes.left,
  eyeR: MODEL_CONFIG.skeleton.eyes.right,
  // Eyelids (for widen/squint)
  eyelidUpperL: MODEL_CONFIG.skeleton.eyelids.upperL,
  eyelidUpperR: MODEL_CONFIG.skeleton.eyelids.upperR,
  eyelidLowerL: MODEL_CONFIG.skeleton.eyelids.lowerL,
  eyelidLowerR: MODEL_CONFIG.skeleton.eyelids.lowerR,
};

// Morph target patterns (used if available)
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
    speechBrowTarget: 0,
    speechBrowCurrent: 0,
    prevAmplitude: 0,
    amplitudeAccum: 0,
    lastBrowPulseTime: 0,
    nextMicroExprTime: Math.random() * 15 + 8,
    microExprType: 'none',
    microExprStart: 0,
    microExprDuration: 0,
    gazeTargetX: 0,
    gazeTargetY: 0,
    gazeCurrentX: 0,
    gazeCurrentY: 0,
    nextGazeShiftTime: Math.random() * 5 + 3,
    nostrilFlareCurrent: 0,
    nostrilFlareTarget: 0,
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

    // Find all facial bones
    const bones: ExpressionBoneRefs = {};
    const foundBones: string[] = [];
    const missingBones: string[] = [];

    for (const [key, patterns] of Object.entries(FACE_BONE_PATTERNS)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        bones[key as keyof ExpressionBoneRefs] = bone;
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      } else {
        missingBones.push(key);
      }
    }
    bonesRef.current = bones;

    if (foundBones.length > 0) {
      log.info(`[ExpressionSystem] Found ${foundBones.length} facial bones:`);
      foundBones.forEach(b => log.debug(`[ExpressionSystem]   + ${b}`));
    }
    if (missingBones.length > 0) {
      log.debug(`[ExpressionSystem] Missing ${missingBones.length} bones: ${missingBones.join(', ')}`);
    }

    // Log capabilities
    const hasBrows = !!(bones.browInnerL || bones.browOuterL);
    const hasLipCorners = !!(bones.lipCornerL && bones.lipCornerR);
    const hasCheeks = !!(bones.cheekL && bones.cheekR);
    const hasNostrils = !!(bones.nostrilL && bones.nostrilR);
    const hasEyes = !!(bones.eyeL && bones.eyeR);
    const hasEyelids = !!(bones.eyelidUpperL && bones.eyelidUpperR);
    log.info(`[ExpressionSystem] Capabilities: brows=${hasBrows}, lipCorners=${hasLipCorners}, cheeks=${hasCheeks}, nostrils=${hasNostrils}, eyes=${hasEyes}, eyelids=${hasEyelids}`);

    // Find morph targets for expressions (optional — most Victoria 9 models lack them)
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

          if (smileIdx !== undefined || browIdx !== undefined || eyeWideIdx !== undefined) {
            morphRef.current = {
              mesh: child,
              smileIndex: smileIdx,
              browRaiseIndex: browIdx,
              eyeWideIndex: eyeWideIdx,
              eyeSquintLIndex: squintLIdx,
              eyeSquintRIndex: squintRIdx,
            };
            log.info(`[ExpressionSystem] Found expression morphs on "${child.name}"`);
          }
        }
      }
    });

    if (!morphRef.current) {
      log.info('[ExpressionSystem] No expression morphs found — using bone-based expressions only');
    }

    initializedRef.current = true;
    log.info('[ExpressionSystem] Initialization complete');
  }, [findBone, findMorphIndex]);

  // ============================================================================
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking: boolean, mouthOpen: number = 0) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const state = stateRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;

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
    // Smile Animation (with varied curve)
    // ========================================
    if (state.isSmiling) {
      const smileProgress = (t - state.smileStartTime) / config.smileDuration;

      if (smileProgress >= 1) {
        state.isSmiling = false;
        state.smileIntensityCurrent = 0;
        const interval = 60 / Math.max(1, config.smileChancePerMinute);
        state.nextSmileTime = t + interval * (0.3 + Math.random() * 1.2);
      } else {
        // Asymmetric curve: quicker onset, longer hold, gentle fade
        const curve = smileProgress < 0.3
          ? Math.sin((smileProgress / 0.3) * Math.PI * 0.5)
          : Math.sin(0.5 * Math.PI + ((smileProgress - 0.3) / 0.7) * Math.PI * 0.5);
        state.smileIntensityCurrent = curve * config.smileIntensity;
      }
    } else {
      state.smileIntensityCurrent = THREE.MathUtils.lerp(state.smileIntensityCurrent, 0, delta * 3);
    }

    // ========================================
    // Speech-reactive Brow Movement
    // ========================================
    if (isSpeaking && mouthOpen > 0) {
      const ampDelta = mouthOpen - state.prevAmplitude;
      state.prevAmplitude = mouthOpen;

      if (ampDelta > 0.03) {
        state.amplitudeAccum += ampDelta;
      } else {
        state.amplitudeAccum *= 0.9;
      }

      // Fire a brow pulse on significant amplitude spikes
      if (state.amplitudeAccum > 0.15 && t - state.lastBrowPulseTime > 1.5) {
        state.speechBrowTarget = Math.min(0.5, state.amplitudeAccum) * config.browEmphasisAmount;
        state.lastBrowPulseTime = t;
        state.amplitudeAccum = 0;
      }

      if (t - state.lastBrowPulseTime > 0.4) {
        state.speechBrowTarget *= 0.92;
      }

      // Nostril flare on emphasis spikes
      if (state.amplitudeAccum > 0.1) {
        state.nostrilFlareTarget = Math.min(0.06, state.amplitudeAccum * 0.1);
      }
    } else {
      state.prevAmplitude = 0;
      state.amplitudeAccum = 0;
      state.speechBrowTarget *= 0.9;
      state.nostrilFlareTarget *= 0.85;
    }
    state.speechBrowCurrent = THREE.MathUtils.lerp(state.speechBrowCurrent, state.speechBrowTarget, delta * 5);
    state.nostrilFlareCurrent = THREE.MathUtils.lerp(state.nostrilFlareCurrent, state.nostrilFlareTarget, delta * 6);

    // ========================================
    // Micro-expressions During Idle
    // ========================================
    let microBrowTwitch = 0;
    let microLipPress = 0;
    if (!isSpeaking && t >= state.nextMicroExprTime && state.microExprType === 'none') {
      state.microExprType = Math.random() > 0.5 ? 'brow_twitch' : 'lip_press';
      state.microExprStart = t;
      state.microExprDuration = 0.3 + Math.random() * 0.5;
    }

    if (state.microExprType !== 'none') {
      const mProgress = (t - state.microExprStart) / state.microExprDuration;
      if (mProgress >= 1) {
        state.microExprType = 'none';
        state.nextMicroExprTime = t + 8 + Math.random() * 20;
      } else {
        const mCurve = Math.sin(mProgress * Math.PI);
        if (state.microExprType === 'brow_twitch') {
          microBrowTwitch = mCurve * 0.08;
        } else if (state.microExprType === 'lip_press') {
          microLipPress = mCurve * 0.02;
        }
      }
    }

    // ========================================
    // Eye Gaze Shifts (idle only)
    // ========================================
    if (!isSpeaking && t >= state.nextGazeShiftTime) {
      // Pick a new random gaze target
      state.gazeTargetX = (Math.random() - 0.5) * 0.06; // ±0.03 rad
      state.gazeTargetY = (Math.random() - 0.5) * 0.04; // ±0.02 rad
      state.nextGazeShiftTime = t + 3 + Math.random() * 5;
    }
    if (isSpeaking) {
      // Look at user when speaking (return to rest)
      state.gazeTargetX = 0;
      state.gazeTargetY = 0;
    }
    state.gazeCurrentX = THREE.MathUtils.lerp(state.gazeCurrentX, state.gazeTargetX, delta * 2);
    state.gazeCurrentY = THREE.MathUtils.lerp(state.gazeCurrentY, state.gazeTargetY, delta * 2);

    // ========================================
    // Triggered Expression
    // ========================================
    let browRaiseAmount = 0;
    let eyeWidenAmount = 0;
    let expressionSmileBoost = 0;
    let browKnitAmount = 0; // For 'concerned' — rotate brows inward
    let expressionNostrilFlare = 0;

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
            expressionNostrilFlare = exprIntensity * 0.04;
            break;
          case 'curious':
            browRaiseAmount = exprIntensity * config.browEmphasisAmount * 0.6;
            eyeWidenAmount = exprIntensity * config.eyeWidenOnEmphasis * 0.5;
            break;
          case 'attentive':
            browRaiseAmount = exprIntensity * config.browEmphasisAmount * 0.4;
            eyeWidenAmount = exprIntensity * config.eyeWidenOnEmphasis * 0.3;
            break;
          case 'surprised':
            browRaiseAmount = exprIntensity * config.browEmphasisAmount * 1.2;
            eyeWidenAmount = exprIntensity * config.eyeWidenOnEmphasis * 1.5;
            expressionNostrilFlare = exprIntensity * 0.03;
            break;
          case 'concerned':
            browKnitAmount = exprIntensity * config.browEmphasisAmount * 0.5;
            break;
        }
      }
    }

    // Combine speech-reactive brow with triggered expressions
    browRaiseAmount = Math.min(config.browEmphasisAmount * 1.5, browRaiseAmount + state.speechBrowCurrent);

    // Combine nostril flare sources
    const totalNostrilFlare = state.nostrilFlareCurrent + expressionNostrilFlare;

    // Total smile: random smiles + triggered expression boosts
    const totalSmile = Math.min(1, state.smileIntensityCurrent + expressionSmileBoost);

    // Happy eyes during speech (subtle eyelid squint)
    let eyeSquintAmount = 0;
    if (isSpeaking && config.happyEyesDuringSpeech > 0) {
      eyeSquintAmount = config.happyEyesDuringSpeech;
    }
    // Also squint slightly during smiles (Duchenne effect)
    eyeSquintAmount += totalSmile * 0.02;

    // ========================================
    // Apply Morph Targets (if available)
    // ========================================
    if (morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      const influences = morphRef.current.mesh.morphTargetInfluences;

      if (morphRef.current.smileIndex !== undefined) {
        influences[morphRef.current.smileIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.smileIndex], totalSmile, delta * 6
        );
      }
      if (morphRef.current.browRaiseIndex !== undefined) {
        influences[morphRef.current.browRaiseIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.browRaiseIndex], browRaiseAmount, delta * 5
        );
      }
      if (morphRef.current.eyeWideIndex !== undefined) {
        influences[morphRef.current.eyeWideIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeWideIndex], eyeWidenAmount, delta * 5
        );
      }
      if (morphRef.current.eyeSquintLIndex !== undefined) {
        influences[morphRef.current.eyeSquintLIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeSquintLIndex], eyeSquintAmount, delta * 3
        );
      }
      if (morphRef.current.eyeSquintRIndex !== undefined) {
        influences[morphRef.current.eyeSquintRIndex] = THREE.MathUtils.lerp(
          influences[morphRef.current.eyeSquintRIndex], eyeSquintAmount, delta * 3
        );
      }
    }

    // ========================================
    // Apply Brow Bone Rotations
    // ========================================
    const totalBrowRaise = browRaiseAmount + microBrowTwitch;

    if (totalBrowRaise > 0.001 || browKnitAmount > 0.001) {
      if (bones.browInnerL && rest.browInnerL) {
        // Concerned knit: rotate inward (positive X). Raise: negative X.
        const target = browKnitAmount > 0
          ? rest.browInnerL.x + browKnitAmount
          : rest.browInnerL.x - totalBrowRaise;
        bones.browInnerL.rotation.x = THREE.MathUtils.lerp(
          bones.browInnerL.rotation.x, target, delta * 5
        );
      }
      if (bones.browInnerR && rest.browInnerR) {
        const rightAmount = microBrowTwitch > 0 ? totalBrowRaise * 0.4 : totalBrowRaise;
        const target = browKnitAmount > 0
          ? rest.browInnerR.x + browKnitAmount
          : rest.browInnerR.x - rightAmount;
        bones.browInnerR.rotation.x = THREE.MathUtils.lerp(
          bones.browInnerR.rotation.x, target, delta * 5
        );
      }
      if (bones.browOuterL && rest.browOuterL) {
        bones.browOuterL.rotation.x = THREE.MathUtils.lerp(
          bones.browOuterL.rotation.x,
          rest.browOuterL.x - totalBrowRaise * 0.5,
          delta * 5
        );
      }
      if (bones.browOuterR && rest.browOuterR) {
        const rightOuter = microBrowTwitch > 0 ? totalBrowRaise * 0.2 : totalBrowRaise * 0.5;
        bones.browOuterR.rotation.x = THREE.MathUtils.lerp(
          bones.browOuterR.rotation.x,
          rest.browOuterR.x - rightOuter,
          delta * 5
        );
      }
    } else {
      // Lerp brow bones back to rest
      if (bones.browInnerL && rest.browInnerL) {
        bones.browInnerL.rotation.x = THREE.MathUtils.lerp(bones.browInnerL.rotation.x, rest.browInnerL.x, delta * 3);
      }
      if (bones.browInnerR && rest.browInnerR) {
        bones.browInnerR.rotation.x = THREE.MathUtils.lerp(bones.browInnerR.rotation.x, rest.browInnerR.x, delta * 3);
      }
      if (bones.browOuterL && rest.browOuterL) {
        bones.browOuterL.rotation.x = THREE.MathUtils.lerp(bones.browOuterL.rotation.x, rest.browOuterL.x, delta * 3);
      }
      if (bones.browOuterR && rest.browOuterR) {
        bones.browOuterR.rotation.x = THREE.MathUtils.lerp(bones.browOuterR.rotation.x, rest.browOuterR.x, delta * 3);
      }
    }

    // ========================================
    // Apply Bone-Based Smile (lip corners + cheeks)
    // ========================================
    // Lip corners: additive on top of useMouthAnimation's speech spread
    // useMouthAnimation sets cornerL/R.rotation.z for lip spread
    // Here we add rotation on X (upward = smile) additively
    if (totalSmile > 0.001) {
      const smileCornerAmount = totalSmile * 0.12; // lip corner rotation for smile
      const smileCheekAmount = totalSmile * 0.04;  // cheek raise for Duchenne

      if (bones.lipCornerL && rest.lipCornerL) {
        // Additive: read current rotation (may include mouth spread), add smile offset
        const targetX = rest.lipCornerL.x - smileCornerAmount; // negative X = upward
        bones.lipCornerL.rotation.x = THREE.MathUtils.lerp(
          bones.lipCornerL.rotation.x, targetX, delta * 5
        );
      }
      if (bones.lipCornerR && rest.lipCornerR) {
        const targetX = rest.lipCornerR.x - smileCornerAmount;
        bones.lipCornerR.rotation.x = THREE.MathUtils.lerp(
          bones.lipCornerR.rotation.x, targetX, delta * 5
        );
      }
      if (bones.cheekL && rest.cheekL) {
        bones.cheekL.rotation.x = THREE.MathUtils.lerp(
          bones.cheekL.rotation.x, rest.cheekL.x - smileCheekAmount, delta * 4
        );
      }
      if (bones.cheekR && rest.cheekR) {
        bones.cheekR.rotation.x = THREE.MathUtils.lerp(
          bones.cheekR.rotation.x, rest.cheekR.x - smileCheekAmount, delta * 4
        );
      }
    } else {
      // Lerp lip corners and cheeks back to rest (only X axis — Z is managed by mouth animation)
      if (bones.lipCornerL && rest.lipCornerL) {
        bones.lipCornerL.rotation.x = THREE.MathUtils.lerp(bones.lipCornerL.rotation.x, rest.lipCornerL.x, delta * 3);
      }
      if (bones.lipCornerR && rest.lipCornerR) {
        bones.lipCornerR.rotation.x = THREE.MathUtils.lerp(bones.lipCornerR.rotation.x, rest.lipCornerR.x, delta * 3);
      }
      if (bones.cheekL && rest.cheekL) {
        bones.cheekL.rotation.x = THREE.MathUtils.lerp(bones.cheekL.rotation.x, rest.cheekL.x, delta * 3);
      }
      if (bones.cheekR && rest.cheekR) {
        bones.cheekR.rotation.x = THREE.MathUtils.lerp(bones.cheekR.rotation.x, rest.cheekR.x, delta * 3);
      }
    }

    // ========================================
    // Apply Micro-Expression Lip Press
    // ========================================
    if (microLipPress > 0.001) {
      // Slight upward push of lower center lip (lip press)
      if (bones.lipLowerCenter && rest.lipLowerCenter) {
        bones.lipLowerCenter.rotation.x = THREE.MathUtils.lerp(
          bones.lipLowerCenter.rotation.x,
          rest.lipLowerCenter.x - microLipPress,
          delta * 5
        );
      }
    } else if (bones.lipLowerCenter && rest.lipLowerCenter) {
      bones.lipLowerCenter.rotation.x = THREE.MathUtils.lerp(
        bones.lipLowerCenter.rotation.x, rest.lipLowerCenter.x, delta * 3
      );
    }

    // ========================================
    // Apply Eye Gaze
    // ========================================
    if (bones.eyeL && rest.eyeL) {
      bones.eyeL.rotation.x = THREE.MathUtils.lerp(
        bones.eyeL.rotation.x, rest.eyeL.x + state.gazeCurrentY, delta * 4
      );
      bones.eyeL.rotation.y = THREE.MathUtils.lerp(
        bones.eyeL.rotation.y, rest.eyeL.y + state.gazeCurrentX, delta * 4
      );
    }
    if (bones.eyeR && rest.eyeR) {
      bones.eyeR.rotation.x = THREE.MathUtils.lerp(
        bones.eyeR.rotation.x, rest.eyeR.x + state.gazeCurrentY, delta * 4
      );
      bones.eyeR.rotation.y = THREE.MathUtils.lerp(
        bones.eyeR.rotation.y, rest.eyeR.y + state.gazeCurrentX, delta * 4
      );
    }

    // ========================================
    // Apply Nostril Flare
    // ========================================
    if (totalNostrilFlare > 0.001) {
      if (bones.nostrilL && rest.nostrilL) {
        bones.nostrilL.rotation.z = THREE.MathUtils.lerp(
          bones.nostrilL.rotation.z, rest.nostrilL.z + totalNostrilFlare, delta * 8
        );
      }
      if (bones.nostrilR && rest.nostrilR) {
        bones.nostrilR.rotation.z = THREE.MathUtils.lerp(
          bones.nostrilR.rotation.z, rest.nostrilR.z - totalNostrilFlare, delta * 8
        );
      }
    } else {
      if (bones.nostrilL && rest.nostrilL) {
        bones.nostrilL.rotation.z = THREE.MathUtils.lerp(bones.nostrilL.rotation.z, rest.nostrilL.z, delta * 4);
      }
      if (bones.nostrilR && rest.nostrilR) {
        bones.nostrilR.rotation.z = THREE.MathUtils.lerp(bones.nostrilR.rotation.z, rest.nostrilR.z, delta * 4);
      }
    }

    // ========================================
    // Apply Eyelid Widen / Squint (bone-based)
    // ========================================
    // Positive eyeWidenAmount = open wider (eyelid up), negative = squint
    const eyelidOffset = eyeWidenAmount > 0
      ? -eyeWidenAmount  // Widen: rotate upper eyelid up (negative X)
      : eyeSquintAmount; // Squint: rotate upper eyelid down (positive X)

    if (Math.abs(eyelidOffset) > 0.001) {
      if (bones.eyelidUpperL && rest.eyelidUpperL) {
        bones.eyelidUpperL.rotation.x = THREE.MathUtils.lerp(
          bones.eyelidUpperL.rotation.x,
          rest.eyelidUpperL.x + eyelidOffset,
          delta * 5
        );
      }
      if (bones.eyelidUpperR && rest.eyelidUpperR) {
        bones.eyelidUpperR.rotation.x = THREE.MathUtils.lerp(
          bones.eyelidUpperR.rotation.x,
          rest.eyelidUpperR.x + eyelidOffset,
          delta * 5
        );
      }
      // Lower eyelids: subtle counter-movement
      const lowerLidOffset = eyelidOffset * 0.3;
      if (bones.eyelidLowerL && rest.eyelidLowerL) {
        bones.eyelidLowerL.rotation.x = THREE.MathUtils.lerp(
          bones.eyelidLowerL.rotation.x,
          rest.eyelidLowerL.x - lowerLidOffset,
          delta * 4
        );
      }
      if (bones.eyelidLowerR && rest.eyelidLowerR) {
        bones.eyelidLowerR.rotation.x = THREE.MathUtils.lerp(
          bones.eyelidLowerR.rotation.x,
          rest.eyelidLowerR.x - lowerLidOffset,
          delta * 4
        );
      }
    }

    // ========================================
    // Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(
        `[ExpressionSystem] smile=${totalSmile.toFixed(2)}, ` +
        `browRaise=${browRaiseAmount.toFixed(2)}, ` +
        `eyeWiden=${eyeWidenAmount.toFixed(2)}, ` +
        `gaze=(${state.gazeCurrentX.toFixed(3)},${state.gazeCurrentY.toFixed(3)}), ` +
        `nostril=${totalNostrilFlare.toFixed(3)}, ` +
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
