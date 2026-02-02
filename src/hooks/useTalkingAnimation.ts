/**
 * ============================================================================
 * useTalkingAnimation - Speech-Driven Body Animation System
 * ============================================================================
 * Provides natural body movement during speech:
 *   - Head nods driven by amplitude peaks (not pure sine)
 *   - Side-to-side tilts during longer phrases
 *   - Hand/arm gestures with envelope curves
 *   - Continuous shoulder micro-movement
 *   - Spine sway tied to speech rhythm
 *   - Smooth idle↔talking blend (~300ms ramp)
 *
 * Gesture system:
 *   5 types: beat, open, point, tilt, shrug
 *   Amplitude-driven triggering (louder = more gestures)
 *   Envelope curves: preparation → stroke → hold → retraction
 *   Dominant hand bias for natural asymmetry
 *
 * All animations scale by a speakingBlend value (0→1 over ~300ms)
 * so idle→talking never snaps. Designed to layer with
 * useIdleAnimation and useExpressionSystem.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';
import { MODEL_CONFIG } from '../config/modelConfig';

// ============================================================================
// Configuration
// ============================================================================

export interface TalkingAnimationConfig {
  headNodSpeed: number;
  headNodAmount: number;
  headTiltAmount: number;

  gestureSpeed: number;
  gestureArmAmount: number;
  gestureForearmAmount: number;
  gestureHandAmount: number;
  gestureChance: number;

  shoulderShrugsPerMinute: number;
  shoulderShrugsAmount: number;
  shoulderShruggDuration: number;

  spineSwayAmount: number;

  dominantHandBias: number;
  gestureMinInterval: number;
  dualArmChance: number;

  emphasisThreshold: number;
  emphasisGestureBoost: number;
}

const DEFAULT_CONFIG: TalkingAnimationConfig = {
  headNodSpeed: 2.0,            // Slightly slower for organic feel
  headNodAmount: 0.07,          // ~4° nod range
  headTiltAmount: 0.05,         // ~3° tilt range

  gestureSpeed: 1.8,
  gestureArmAmount: 0.08,
  gestureForearmAmount: 0.12,
  gestureHandAmount: 0.15,
  gestureChance: 0.5,

  shoulderShrugsPerMinute: 4,
  shoulderShrugsAmount: 0.06,
  shoulderShruggDuration: 0.6,

  spineSwayAmount: 0.03,

  dominantHandBias: 0.7,
  gestureMinInterval: 0.8,
  dualArmChance: 0.2,

  emphasisThreshold: 0.35,      // Slightly lower threshold for more reactive gestures
  emphasisGestureBoost: 0.8,
};

// ============================================================================
// Bone References
// ============================================================================

interface TalkingBoneRefs {
  head?: THREE.Bone;
  neck1?: THREE.Bone;
  neck2?: THREE.Bone;
  shoulderL?: THREE.Bone;
  shoulderR?: THREE.Bone;
  upperArmL?: THREE.Bone;
  upperArmR?: THREE.Bone;
  foreArmL?: THREE.Bone;
  foreArmR?: THREE.Bone;
  handL?: THREE.Bone;
  handR?: THREE.Bone;
  spine?: THREE.Bone;
  spine2?: THREE.Bone;
  chest?: THREE.Bone;
}

interface RestPoses {
  [boneName: string]: THREE.Euler;
}

// ============================================================================
// Bone Patterns
// ============================================================================

const sk = MODEL_CONFIG.skeleton;
const BONE_PATTERNS: Record<keyof TalkingBoneRefs, RegExp[]> = {
  head: sk.head,
  neck1: [/^neck1$/i, /^neck$/i],
  neck2: [/^neck2$/i, /^neckUpper$/i],
  shoulderL: sk.shoulders.left,
  shoulderR: sk.shoulders.right,
  upperArmL: sk.upperArms.left,
  upperArmR: sk.upperArms.right,
  foreArmL: sk.forearms.left,
  foreArmR: sk.forearms.right,
  handL: [/^l_hand$/i, /^lHand$/i, /^hand[_]?l$/i],
  handR: [/^r_hand$/i, /^rHand$/i, /^hand[_]?r$/i],
  spine: [/^spine1$/i, /^spine$/i],
  spine2: [/^spine2$/i, /^spine3$/i],
  chest: [/^spine4$/i, /^chest$/i],
};

// ============================================================================
// Gesture Library
// ============================================================================

type GestureType = 'beat' | 'open' | 'point' | 'tilt' | 'shrug';

interface GestureDef {
  armMode: 'dominant' | 'both' | 'either';
  durationRange: [number, number];
  weight: number;
  apply: (
    _progress: number,
    envelope: number,
    osc: number,
    bones: TalkingBoneRefs,
    rest: RestPoses,
    config: TalkingAnimationConfig,
    arm: 'left' | 'right' | 'both',
    lerpSpeed: number,
  ) => void;
}

function gestureEnvelope(progress: number): number {
  if (progress < 0.2) {
    const t = progress / 0.2;
    return t * t;
  } else if (progress < 0.5) {
    return 1.0;
  } else if (progress < 0.7) {
    const t = (progress - 0.5) / 0.2;
    return 1.0 - t * 0.15;
  } else {
    const t = (progress - 0.7) / 0.3;
    return (1.0 - t * 0.15) * (1.0 - t * t);
  }
}

function lerpBoneAxis(
  bone: THREE.Bone | undefined,
  rest: THREE.Euler | undefined,
  axis: 'x' | 'y' | 'z',
  offset: number,
  speed: number,
): void {
  if (!bone || !rest) return;
  const target = rest[axis] + offset;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, speed);
}

const GESTURE_LIBRARY: Record<GestureType, GestureDef> = {
  beat: {
    armMode: 'dominant',
    durationRange: [0.8, 1.4],
    weight: 4,
    apply(_progress, envelope, osc, bones, rest, config, arm, lerpSpeed) {
      const amp = envelope;
      if (arm === 'right' || arm === 'both') {
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'x', osc * config.gestureArmAmount * amp, lerpSpeed);
        lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 0.8, lerpSpeed);
        lerpBoneAxis(bones.handR, rest.handR, 'x', osc * config.gestureHandAmount * amp, lerpSpeed);
      }
      if (arm === 'left' || arm === 'both') {
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'x', osc * config.gestureArmAmount * amp, lerpSpeed);
        lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 0.8, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'x', osc * config.gestureHandAmount * amp, lerpSpeed);
      }
    },
  },

  open: {
    armMode: 'both',
    durationRange: [1.2, 2.0],
    weight: 2,
    apply(_progress, envelope, _osc, bones, rest, config, _arm, lerpSpeed) {
      const amp = envelope;
      lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'z', -amp * config.gestureArmAmount * 1.2, lerpSpeed);
      lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'z', amp * config.gestureArmAmount * 1.2, lerpSpeed);
      lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount, lerpSpeed);
      lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount, lerpSpeed);
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.5, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.5, lerpSpeed);
      lerpBoneAxis(bones.spine2, rest.spine2, 'x', -amp * config.spineSwayAmount * 0.5, lerpSpeed);
    },
  },

  point: {
    armMode: 'dominant',
    durationRange: [1.0, 1.8],
    weight: 1.5,
    apply(_progress, envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      const amp = envelope;
      if (arm === 'right' || arm === 'both') {
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'x', amp * config.gestureArmAmount * 1.5, lerpSpeed);
        lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 1.3, lerpSpeed);
        lerpBoneAxis(bones.handR, rest.handR, 'x', amp * config.gestureHandAmount * 0.8, lerpSpeed);
      }
      if (arm === 'left' || arm === 'both') {
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'x', amp * config.gestureArmAmount * 1.5, lerpSpeed);
        lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 1.3, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'x', amp * config.gestureHandAmount * 0.8, lerpSpeed);
      }
      const spineDir = (arm === 'left') ? 1 : -1;
      lerpBoneAxis(bones.spine2, rest.spine2, 'y', amp * config.spineSwayAmount * spineDir, lerpSpeed);
    },
  },

  tilt: {
    armMode: 'either',
    durationRange: [1.0, 1.6],
    weight: 2,
    apply(_progress, envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      const amp = envelope;
      const dir = (arm === 'left') ? 1 : -1;
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * dir * 1.5, lerpSpeed);
      lerpBoneAxis(bones.spine2, rest.spine2, 'z', amp * config.spineSwayAmount * dir, lerpSpeed);
      lerpBoneAxis(bones.spine, rest.spine, 'z', amp * config.spineSwayAmount * dir * 0.5, lerpSpeed);
    },
  },

  shrug: {
    armMode: 'both',
    durationRange: [0.6, 1.0],
    weight: 1,
    apply(_progress, envelope, _osc, bones, rest, config, _arm, lerpSpeed) {
      const amp = envelope;
      lerpBoneAxis(bones.shoulderL, rest.shoulderL, 'z', -amp * config.shoulderShrugsAmount, lerpSpeed);
      lerpBoneAxis(bones.shoulderR, rest.shoulderR, 'z', amp * config.shoulderShrugsAmount, lerpSpeed);
      lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * 0.5, lerpSpeed);
    },
  },
};

const GESTURE_TYPES: GestureType[] = ['beat', 'open', 'point', 'tilt', 'shrug'];

function pickRandomGesture(): GestureType {
  const totalWeight = GESTURE_TYPES.reduce((sum, g) => sum + GESTURE_LIBRARY[g].weight, 0);
  let roll = Math.random() * totalWeight;
  for (const type of GESTURE_TYPES) {
    roll -= GESTURE_LIBRARY[type].weight;
    if (roll <= 0) return type;
  }
  return 'beat';
}

// ============================================================================
// State
// ============================================================================

interface ActiveGesture {
  type: GestureType;
  startTime: number;
  duration: number;
  arm: 'left' | 'right' | 'both';
}

interface TalkingAnimationState {
  time: number;
  // Smooth blend: 0 = fully idle, 1 = fully talking
  speakingBlend: number;
  // Active gesture
  activeGesture: ActiveGesture | null;
  lastGestureEndTime: number;
  // Amplitude tracking
  mouthOpen: number;
  prevMouthOpen: number;
  emphasisAccumulator: number;
  // Head emphasis tracking
  headNodPhase: number;
  headNodTarget: number;      // target nod offset from emphasis
  headNodCurrent: number;     // lerped nod offset
  headTiltTarget: number;     // directional tilt target
  headTiltCurrent: number;
  lastHeadDirectionChange: number;
  headDirection: number;      // -1 or 1 — which way head is leaning
  // Debug
  debugLogTime: number;
  gestureCount: number;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseTalkingAnimationReturn {
  initialize: (scene: THREE.Object3D) => void;
  update: (delta: number, isSpeaking: boolean) => void;
  setMouthOpen: (value: number) => void;
  triggerGesture: (type: GestureType) => void;
  getGestureTypes: () => GestureType[];
  setAmplitudeScale: (scale: number) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useTalkingAnimation(
  initialConfig: Partial<TalkingAnimationConfig> = {}
): UseTalkingAnimationReturn {
  const configRef = useRef<TalkingAnimationConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const bonesRef = useRef<TalkingBoneRefs>({});
  const restPosesRef = useRef<RestPoses>({});
  const initializedRef = useRef(false);
  const amplitudeScaleRef = useRef(1.0);

  const stateRef = useRef<TalkingAnimationState>({
    time: 0,
    speakingBlend: 0,
    activeGesture: null,
    lastGestureEndTime: -10,
    mouthOpen: 0,
    prevMouthOpen: 0,
    emphasisAccumulator: 0,
    headNodPhase: 0,
    headNodTarget: 0,
    headNodCurrent: 0,
    headTiltTarget: 0,
    headTiltCurrent: 0,
    lastHeadDirectionChange: 0,
    headDirection: 1,
    debugLogTime: 0,
    gestureCount: 0,
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
  // Initialize
  // ============================================================================

  const initialize = useCallback((scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    log.info('[TalkingAnimation] ========== INITIALIZING ==========');

    const bones: TalkingBoneRefs = {};
    const foundBones: string[] = [];
    const missingBones: string[] = [];

    for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        bones[key as keyof TalkingBoneRefs] = bone;
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      } else {
        missingBones.push(key);
      }
    }
    bonesRef.current = bones;

    if (foundBones.length > 0) {
      log.info(`[TalkingAnimation] Found ${foundBones.length} bones:`);
      foundBones.forEach(b => log.debug(`[TalkingAnimation]   + ${b}`));
    }
    if (missingBones.length > 0) {
      log.warn(`[TalkingAnimation] Missing ${missingBones.length} bones: ${missingBones.join(', ')}`);
    }

    initializedRef.current = true;
    log.info('[TalkingAnimation] Initialization complete');
  }, [findBone]);

  // ============================================================================
  // Resolve gesture arm
  // ============================================================================

  const resolveArm = useCallback((def: GestureDef): 'left' | 'right' | 'both' => {
    const config = configRef.current;
    if (def.armMode === 'both') return 'both';
    if (def.armMode === 'dominant') {
      if (Math.random() < config.dualArmChance) return 'both';
      return Math.random() < config.dominantHandBias ? 'right' : 'left';
    }
    return Math.random() > 0.5 ? 'right' : 'left';
  }, []);

  // ============================================================================
  // Start gesture
  // ============================================================================

  const startGesture = useCallback((type: GestureType) => {
    const state = stateRef.current;
    const def = GESTURE_LIBRARY[type];
    const [minDur, maxDur] = def.durationRange;
    const duration = minDur + Math.random() * (maxDur - minDur);

    state.activeGesture = {
      type,
      startTime: state.time,
      duration,
      arm: resolveArm(def),
    };
    state.gestureCount++;
  }, [resolveArm]);

  // ============================================================================
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking: boolean) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;
    const state = stateRef.current;
    const scale = amplitudeScaleRef.current;

    state.time += delta;
    const t = state.time;

    // ========================================
    // Speaking Blend (smooth idle↔talking ramp)
    // ========================================
    // ~300ms ramp up, ~400ms ramp down — never snaps
    const blendTarget = isSpeaking ? 1 : 0;
    const blendRate = isSpeaking ? delta * 4 : delta * 2.5;
    state.speakingBlend = THREE.MathUtils.lerp(state.speakingBlend, blendTarget, blendRate);
    const blend = state.speakingBlend;

    // Skip all talking animation if blend is negligible
    if (blend < 0.01) {
      state.activeGesture = null;
      state.prevMouthOpen = state.mouthOpen;
      return;
    }

    // Softer lerp speeds for organic movement
    const lerpSpeed = delta * 3.5;

    // ========================================
    // Head Movement (amplitude-driven, not pure sine)
    // ========================================
    // Emphasis detection: amplitude peaks drive nod impulses
    const ampDelta = state.mouthOpen - state.prevMouthOpen;
    if (ampDelta > 0.04 && state.mouthOpen > 0.3) {
      // Volume spike → nod impulse (downward emphasis)
      state.headNodTarget = Math.min(0.12, state.mouthOpen * 0.14) * scale;
    }
    // Nod target decays smoothly
    state.headNodTarget *= 0.92;
    state.headNodCurrent = THREE.MathUtils.lerp(state.headNodCurrent, state.headNodTarget, delta * 6);

    // Continuous gentle oscillation underneath the emphasis nods
    const nodBase = Math.sin(t * config.headNodSpeed * Math.PI * 2) * config.headNodAmount * 0.4;
    // Slower tilt oscillation with irrational ratio to avoid repetition
    const tiltBase = Math.sin(t * config.headNodSpeed * 0.53 * Math.PI * 2) * config.headTiltAmount;

    // Directional head "lead" — shifts side-to-side every 3-7 seconds
    if (t - state.lastHeadDirectionChange > 3 + Math.random() * 4) {
      state.headDirection = -state.headDirection;
      state.headTiltTarget = state.headDirection * (0.03 + Math.random() * 0.04) * scale;
      state.lastHeadDirectionChange = t;
    }
    state.headTiltCurrent = THREE.MathUtils.lerp(state.headTiltCurrent, state.headTiltTarget, delta * 1.5);

    if (bones.head && rest.head) {
      const targetX = rest.head.x + (nodBase + state.headNodCurrent) * blend;
      const targetZ = rest.head.z + (tiltBase + state.headTiltCurrent) * blend;
      const targetY = rest.head.y + state.headTiltCurrent * 0.3 * blend; // Slight Y-rotation for "lead"
      bones.head.rotation.x = THREE.MathUtils.lerp(bones.head.rotation.x, targetX, delta * 5);
      bones.head.rotation.y = THREE.MathUtils.lerp(bones.head.rotation.y, targetY, delta * 3);
      bones.head.rotation.z = THREE.MathUtils.lerp(bones.head.rotation.z, targetZ, delta * 4);
    }

    // Neck follows head at reduced amplitude
    if (bones.neck1 && rest.neck1) {
      const neckNod = (nodBase * 0.3 + state.headNodCurrent * 0.4) * blend;
      bones.neck1.rotation.x = THREE.MathUtils.lerp(
        bones.neck1.rotation.x, rest.neck1.x + neckNod, delta * 4
      );
    }

    // ========================================
    // Continuous Shoulder Micro-Movement
    // ========================================
    // Subtle breathing-synced shoulder movement during speech
    const shoulderMicro = Math.sin(t * 1.3) * 0.005 * blend;
    const shoulderBreath = Math.sin(t * 0.8) * 0.003 * blend;
    lerpBoneAxis(bones.shoulderL, rest.shoulderL, 'z', (shoulderMicro + shoulderBreath) * scale, lerpSpeed * 0.5);
    lerpBoneAxis(bones.shoulderR, rest.shoulderR, 'z', (-shoulderMicro * 0.7 + shoulderBreath) * scale, lerpSpeed * 0.5);

    // ========================================
    // Chest Breathing Visibility
    // ========================================
    if (bones.chest && rest.chest) {
      const chestBreath = Math.sin(t * 0.9) * 0.008 * blend;
      lerpBoneAxis(bones.chest, rest.chest, 'x', chestBreath * scale, lerpSpeed * 0.4);
    }

    // ========================================
    // Amplitude-Driven Gesture Triggering
    // ========================================
    const isEmphasis = state.mouthOpen > config.emphasisThreshold &&
                       state.mouthOpen > state.prevMouthOpen;

    if (!state.activeGesture) {
      const timeSinceLastGesture = t - state.lastGestureEndTime;

      if (timeSinceLastGesture >= config.gestureMinInterval) {
        let chance = config.gestureChance * delta;
        if (isEmphasis) {
          chance += config.emphasisGestureBoost * delta;
        }

        if (Math.random() < chance) {
          startGesture(pickRandomGesture());
        }
      }
    }

    // ========================================
    // Active Gesture Animation
    // ========================================
    if (state.activeGesture) {
      const gesture = state.activeGesture;
      const def = GESTURE_LIBRARY[gesture.type];
      const progress = (t - gesture.startTime) / gesture.duration;

      if (progress >= 1) {
        state.activeGesture = null;
        state.lastGestureEndTime = t;
      } else {
        const envelope = gestureEnvelope(progress) * scale * blend;
        const osc = Math.sin(t * config.gestureSpeed * Math.PI * 2);

        def.apply(progress, envelope, osc, bones, rest, config, gesture.arm, lerpSpeed);
      }
    }

    // ========================================
    // Spine Sway (tied to speech rhythm)
    // ========================================
    // Two slow oscillators for organic feel
    const spineSwayZ = Math.sin(t * 0.9) * config.spineSwayAmount * 0.4 * blend * scale;
    const spineSwayX = Math.sin(t * 0.6) * config.spineSwayAmount * 0.2 * blend * scale;
    lerpBoneAxis(bones.spine, rest.spine, 'z', spineSwayZ, lerpSpeed * 0.5);
    lerpBoneAxis(bones.spine2, rest.spine2, 'z', spineSwayZ * 0.7, lerpSpeed * 0.5);
    lerpBoneAxis(bones.spine2, rest.spine2, 'x', spineSwayX, lerpSpeed * 0.4);

    // Store previous mouthOpen for emphasis detection
    state.prevMouthOpen = state.mouthOpen;

    // ========================================
    // Return-to-rest when blend is fading out (not speaking)
    // ========================================
    if (!isSpeaking && blend > 0.01) {
      const restLerp = delta * 2.5;
      const boneKeys: (keyof TalkingBoneRefs)[] = [
        'neck1', 'neck2',
        'upperArmL', 'upperArmR',
        'foreArmL', 'foreArmR',
        'handL', 'handR',
        'spine', 'spine2', 'chest',
        'shoulderL', 'shoulderR',
        'head',
      ];

      for (const key of boneKeys) {
        const bone = bones[key];
        const restPose = rest[key];
        if (bone && restPose) {
          bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, restPose.x, restLerp);
          bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, restPose.y, restLerp);
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, restPose.z, restLerp);
        }
      }

      state.activeGesture = null;
    }

    // ========================================
    // Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(
        `[TalkingAnimation] speaking=${isSpeaking}, blend=${blend.toFixed(2)}, ` +
        `gesture=${state.activeGesture?.type ?? 'none'} ` +
        `(arm=${state.activeGesture?.arm ?? '-'}), ` +
        `mouthOpen=${state.mouthOpen.toFixed(2)}, ` +
        `totalGestures=${state.gestureCount}`
      );
    }
  }, [startGesture]);

  // ============================================================================
  // setMouthOpen
  // ============================================================================

  const setMouthOpen = useCallback((value: number) => {
    stateRef.current.mouthOpen = value;
  }, []);

  // ============================================================================
  // triggerGesture
  // ============================================================================

  const triggerGesture = useCallback((type: GestureType) => {
    if (!GESTURE_LIBRARY[type]) {
      log.warn(`[TalkingAnimation] Unknown gesture type: ${type}`);
      return;
    }
    startGesture(type);
    log.info(`[TalkingAnimation] Force triggered gesture: ${type}`);
  }, [startGesture]);

  // ============================================================================
  // getGestureTypes
  // ============================================================================

  const getGestureTypes = useCallback((): GestureType[] => {
    return [...GESTURE_TYPES];
  }, []);

  // ============================================================================
  // setAmplitudeScale
  // ============================================================================

  const setAmplitudeScale = useCallback((scale: number) => {
    amplitudeScaleRef.current = Math.max(0, scale);
    log.info(`[TalkingAnimation] Amplitude scale set to ${scale.toFixed(2)}`);
  }, []);

  return {
    initialize,
    update,
    setMouthOpen,
    triggerGesture,
    getGestureTypes,
    setAmplitudeScale,
  };
}
