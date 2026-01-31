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

/** Continuous emotion type for blending (setEmotion) */
export type EmotionType = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'listening' | 'concerned';

/** Emotion preset: defines bone offsets and morph weights for each emotion */
interface EmotionPreset {
  browRaise: number;       // Positive = raise, negative = knit
  eyeWiden: number;        // Positive = widen, negative = squint
  smileBoost: number;      // Smile intensity boost (0-1)
  nostrilFlare: number;    // Nostril flare (0-1)
  headPitchOffset: number; // Head tilt: positive = down
  headRollOffset: number;  // Head tilt: positive = right
}

const EMOTION_PRESETS: Record<EmotionType, EmotionPreset> = {
  neutral:   { browRaise: 0,     eyeWiden: 0,     smileBoost: 0,   nostrilFlare: 0,    headPitchOffset: 0,     headRollOffset: 0 },
  happy:     { browRaise: 0.1,   eyeWiden: -0.02, smileBoost: 0.6, nostrilFlare: 0,    headPitchOffset: -0.02, headRollOffset: 0 },
  sad:       { browRaise: -0.2,  eyeWiden: 0,     smileBoost: 0,   nostrilFlare: 0,    headPitchOffset: 0.06,  headRollOffset: 0 },
  angry:     { browRaise: -0.35, eyeWiden: 0.02,  smileBoost: 0,   nostrilFlare: 0.05, headPitchOffset: 0.03,  headRollOffset: 0 },
  surprised: { browRaise: 0.4,   eyeWiden: 0.08,  smileBoost: 0,   nostrilFlare: 0.03, headPitchOffset: -0.03, headRollOffset: 0 },
  thinking:  { browRaise: 0.15,  eyeWiden: 0,     smileBoost: 0,   nostrilFlare: 0,    headPitchOffset: 0.03,  headRollOffset: 0.03 },
  listening: { browRaise: 0.08,  eyeWiden: 0.02,  smileBoost: 0.1, nostrilFlare: 0,    headPitchOffset: 0.02,  headRollOffset: 0.03 },
  concerned: { browRaise: -0.15, eyeWiden: 0,     smileBoost: 0,   nostrilFlare: 0,    headPitchOffset: 0.04,  headRollOffset: -0.02 },
};

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
  // Nostril flare
  nostrilFlareCurrent: number;
  nostrilFlareTarget: number;
  // Emotion blending
  currentEmotion: EmotionType;
  targetEmotion: EmotionType;
  emotionIntensity: number;
  emotionBlendProgress: number; // 0 = at fromPreset, 1 = fully at targetEmotion
  emotionBlendFrom: EmotionPreset;   // snapshot of visual state when blend started
  emotionBlendedPreset: EmotionPreset;
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
  /** Trigger a specific expression (timed, auto-fades) */
  triggerExpression: (type: ExpressionType, duration: number) => void;
  /** Set a continuous emotion with smooth blending transition */
  setEmotion: (emotion: EmotionType, intensity?: number) => void;
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
    nostrilFlareCurrent: 0,
    nostrilFlareTarget: 0,
    currentEmotion: 'neutral',
    targetEmotion: 'neutral',
    emotionIntensity: 1.0,
    emotionBlendProgress: 1.0,
    emotionBlendFrom: { ...EMOTION_PRESETS.neutral },
    emotionBlendedPreset: { ...EMOTION_PRESETS.neutral },
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
    // Emotion Blending (continuous emotions set via setEmotion)
    // ========================================
    if (state.emotionBlendProgress < 1.0) {
      state.emotionBlendProgress = Math.min(1.0, state.emotionBlendProgress + delta * 2.0); // ~0.5s transition
      const fromPreset = state.emotionBlendFrom;
      const toPreset = EMOTION_PRESETS[state.targetEmotion];
      const t2 = state.emotionBlendProgress;
      // Smooth step for natural easing
      const s = t2 * t2 * (3 - 2 * t2);
      state.emotionBlendedPreset = {
        browRaise: fromPreset.browRaise + (toPreset.browRaise - fromPreset.browRaise) * s,
        eyeWiden: fromPreset.eyeWiden + (toPreset.eyeWiden - fromPreset.eyeWiden) * s,
        smileBoost: fromPreset.smileBoost + (toPreset.smileBoost - fromPreset.smileBoost) * s,
        nostrilFlare: fromPreset.nostrilFlare + (toPreset.nostrilFlare - fromPreset.nostrilFlare) * s,
        headPitchOffset: fromPreset.headPitchOffset + (toPreset.headPitchOffset - fromPreset.headPitchOffset) * s,
        headRollOffset: fromPreset.headRollOffset + (toPreset.headRollOffset - fromPreset.headRollOffset) * s,
      };
      if (state.emotionBlendProgress >= 1.0) {
        state.currentEmotion = state.targetEmotion;
      }
    }
    const emo = state.emotionBlendedPreset;
    const emoIntensity = state.emotionIntensity;

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

    // NOTE: Eye gaze shifts removed — useGazeTracking is sole authority
    // over eyeL/eyeR bone rotation (cursor tracking, saccades, wander).

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

    // ========================================
    // Add Emotion Preset Contributions
    // ========================================
    if (emo.browRaise >= 0) {
      browRaiseAmount += emo.browRaise * emoIntensity;
    } else {
      browKnitAmount += Math.abs(emo.browRaise) * emoIntensity;
    }
    eyeWidenAmount += emo.eyeWiden * emoIntensity;
    expressionSmileBoost += emo.smileBoost * emoIntensity;
    expressionNostrilFlare += emo.nostrilFlare * emoIntensity;

    // Combine speech-reactive brow with triggered expressions + emotion
    browRaiseAmount = Math.min(config.browEmphasisAmount * 1.5, browRaiseAmount + state.speechBrowCurrent);

    // Combine nostril flare sources
    const totalNostrilFlare = state.nostrilFlareCurrent + expressionNostrilFlare;

    // Total smile: random smiles + triggered expression boosts + emotion
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

    // NOTE: Eye gaze application removed — useGazeTracking handles eye bones

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
        `nostril=${totalNostrilFlare.toFixed(3)}, ` +
        `emotion=${state.currentEmotion}(${emoIntensity.toFixed(2)}), ` +
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

  // ============================================================================
  // Set Emotion (continuous blending)
  // ============================================================================

  const setEmotion = useCallback((emotion: EmotionType, intensity: number = 1.0) => {
    const state = stateRef.current;
    // Don't restart blend if already targeting the same emotion
    if (state.targetEmotion === emotion && Math.abs(state.emotionIntensity - intensity) < 0.01) {
      return;
    }
    // Snapshot current visual state as the blend-from point
    state.emotionBlendFrom = { ...state.emotionBlendedPreset };
    state.targetEmotion = emotion;
    state.emotionIntensity = intensity;
    state.emotionBlendProgress = 0; // restart blend
    log.debug(`[ExpressionSystem] Emotion → ${emotion} (intensity=${intensity.toFixed(2)})`);
  }, []);

  // Register this instance as the global expression system so the voice pipeline
  // (which lives in a different component tree) can push emotions.
  globalExpressionSystemRef = { setEmotion, triggerExpression };

  return {
    initialize,
    update,
    triggerExpression,
    setEmotion,
  };
}

// ============================================================================
// Global Bridge (connects voice pipeline in App.tsx to expression system in avatar)
// ============================================================================

interface GlobalExpressionSystem {
  setEmotion: (emotion: EmotionType, intensity?: number) => void;
  triggerExpression: (type: ExpressionType, duration: number) => void;
}

let globalExpressionSystemRef: GlobalExpressionSystem | null = null;

/** Get the global expression system instance (set by the first useExpressionSystem hook) */
export function getGlobalExpressionSystem(): GlobalExpressionSystem | null {
  return globalExpressionSystemRef;
}
