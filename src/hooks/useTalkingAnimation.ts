/**
 * ============================================================================
 * useTalkingAnimation - Speech-Driven Body Animation System
 * ============================================================================
 * Provides natural body movement during speech:
 *   - Head nods (rhythmic up/down)
 *   - Hand/arm gestures (amplitude-driven from audio)
 *   - Shoulder shrugs (emphasis moments)
 *   - Spine sway (torso lean during emphasis)
 *
 * Gesture system:
 *   - 5 gesture types: beat, open, point, tilt, shrug
 *   - Amplitude-driven triggering (louder = more gestures)
 *   - Envelope curves: preparation → stroke → hold → retraction
 *   - Dominant hand bias for natural asymmetry
 *
 * All animations activate only when isSpeaking=true and lerp back to rest
 * when idle. Designed to layer with useIdleAnimation and useExpressionSystem.
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
  // Head nod
  headNodSpeed: number;          // Nod oscillation speed
  headNodAmount: number;         // Nod amplitude (radians)
  headTiltAmount: number;        // Side-to-side tilt amplitude

  // Hand gestures
  gestureSpeed: number;          // Gesture oscillation speed
  gestureArmAmount: number;      // Upper arm rotation amplitude
  gestureForearmAmount: number;  // Forearm rotation amplitude
  gestureHandAmount: number;     // Hand rotation during gestures
  gestureChance: number;         // Base chance per second of a gesture burst

  // Shoulder shrugs
  shoulderShrugsPerMinute: number;  // Average shrugs per minute during speech
  shoulderShrugsAmount: number;     // Shoulder raise amount (radians)
  shoulderShruggDuration: number;   // Duration of a single shrug

  // Spine / torso
  spineSwayAmount: number;       // Torso lean during emphasis

  // Gesture behavior
  dominantHandBias: number;      // 0-1: probability of right hand (0.7 = 70% right)
  gestureMinInterval: number;    // Min seconds between gesture starts
  dualArmChance: number;         // Chance both arms gesture together (0-1)

  // Amplitude-driven triggering
  emphasisThreshold: number;     // mouthOpen value that counts as "emphasis"
  emphasisGestureBoost: number;  // Extra gesture chance during emphasis peaks
}

const DEFAULT_CONFIG: TalkingAnimationConfig = {
  headNodSpeed: 2.5,
  headNodAmount: 0.06,
  headTiltAmount: 0.04,

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

  emphasisThreshold: 0.4,
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
}

interface RestPoses {
  [boneName: string]: THREE.Euler;
}

// ============================================================================
// Bone Patterns (sourced from shared modelConfig)
// ============================================================================

const sk = MODEL_CONFIG.skeleton;
const BONE_PATTERNS: Record<keyof TalkingBoneRefs, RegExp[]> = {
  head: sk.head,
  // Neck segments: explicit since modelConfig.neck is a flat array
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
};

// ============================================================================
// Gesture Library
// ============================================================================

type GestureType = 'beat' | 'open' | 'point' | 'tilt' | 'shrug';

interface GestureDef {
  /** Which arms this gesture uses: 'dominant', 'both', 'either' */
  armMode: 'dominant' | 'both' | 'either';
  /** Duration range [min, max] seconds */
  durationRange: [number, number];
  /** Weight for random selection (higher = more frequent) */
  weight: number;
  /** Bone offsets at peak amplitude. Values are multiplied by config amounts. */
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

/**
 * Gesture envelope: maps progress (0-1) to amplitude (0-1).
 * Preparation (0-0.2) → Stroke (0.2-0.5) → Hold (0.5-0.7) → Retraction (0.7-1.0)
 */
function gestureEnvelope(progress: number): number {
  if (progress < 0.2) {
    // Preparation: ease in
    const t = progress / 0.2;
    return t * t; // quadratic ease in
  } else if (progress < 0.5) {
    // Stroke: full power
    return 1.0;
  } else if (progress < 0.7) {
    // Hold: slight decay
    const t = (progress - 0.5) / 0.2;
    return 1.0 - t * 0.15; // decay to 0.85
  } else {
    // Retraction: ease out
    const t = (progress - 0.7) / 0.3;
    return (1.0 - t * 0.15) * (1.0 - t * t); // smooth out
  }
}

/** Helper: lerp a bone rotation axis toward a target */
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
  // Beat: quick up-down emphasis gesture (most common)
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

  // Open: arms spread apart (explanations, emphasis)
  open: {
    armMode: 'both',
    durationRange: [1.2, 2.0],
    weight: 2,
    apply(_progress, envelope, _osc, bones, rest, config, _arm, lerpSpeed) {
      const amp = envelope;
      // Arms spread outward (z-axis for shoulders, x for upper arms)
      lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'z', -amp * config.gestureArmAmount * 1.2, lerpSpeed);
      lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'z', amp * config.gestureArmAmount * 1.2, lerpSpeed);
      lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount, lerpSpeed);
      lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount, lerpSpeed);
      // Hands open slightly
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.5, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.5, lerpSpeed);
      // Slight spine lean back during open gesture
      lerpBoneAxis(bones.spine2, rest.spine2, 'x', -amp * config.spineSwayAmount * 0.5, lerpSpeed);
    },
  },

  // Point: one arm extends forward (references, directions)
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
      // Slight torso turn toward pointing arm
      const spineDir = (arm === 'left') ? 1 : -1;
      lerpBoneAxis(bones.spine2, rest.spine2, 'y', amp * config.spineSwayAmount * spineDir, lerpSpeed);
    },
  },

  // Tilt: head + spine lean (questions, thinking)
  tilt: {
    armMode: 'either',
    durationRange: [1.0, 1.6],
    weight: 2,
    apply(_progress, envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      const amp = envelope;
      const dir = (arm === 'left') ? 1 : -1;
      // Head tilt
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * dir * 1.5, lerpSpeed);
      // Spine lean
      lerpBoneAxis(bones.spine2, rest.spine2, 'z', amp * config.spineSwayAmount * dir, lerpSpeed);
      lerpBoneAxis(bones.spine, rest.spine, 'z', amp * config.spineSwayAmount * dir * 0.5, lerpSpeed);
    },
  },

  // Shrug: both shoulders + hands up (uncertainty)
  shrug: {
    armMode: 'both',
    durationRange: [0.6, 1.0],
    weight: 1,
    apply(_progress, envelope, _osc, bones, rest, config, _arm, lerpSpeed) {
      const amp = envelope;
      // Shoulders up
      lerpBoneAxis(bones.shoulderL, rest.shoulderL, 'z', -amp * config.shoulderShrugsAmount, lerpSpeed);
      lerpBoneAxis(bones.shoulderR, rest.shoulderR, 'z', amp * config.shoulderShrugsAmount, lerpSpeed);
      // Forearms lift
      lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 0.6, lerpSpeed);
      // Hands rotate outward
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.6, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.6, lerpSpeed);
      // Slight head tilt
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * 0.5, lerpSpeed);
    },
  },
};

const GESTURE_TYPES: GestureType[] = ['beat', 'open', 'point', 'tilt', 'shrug'];

/** Pick a random gesture weighted by their weight values */
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
  // Active gesture
  activeGesture: ActiveGesture | null;
  lastGestureEndTime: number;
  // Amplitude tracking
  mouthOpen: number;
  prevMouthOpen: number;
  emphasisAccumulator: number;
  // Head nod state
  headNodPhase: number;
  // Debug
  debugLogTime: number;
  gestureCount: number;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseTalkingAnimationReturn {
  /** Initialize with loaded scene - finds head, neck, shoulder, arm, hand, spine bones */
  initialize: (scene: THREE.Object3D) => void;
  /** Update talking animations each frame */
  update: (delta: number, isSpeaking: boolean) => void;
  /** Feed current mouth open value (0-1) for amplitude-driven gestures */
  setMouthOpen: (value: number) => void;
  /** Force trigger a specific gesture type (for testing via rig API) */
  triggerGesture: (type: GestureType) => void;
  /** Get list of available gesture types */
  getGestureTypes: () => GestureType[];
  /** Set amplitude scale for all gestures (1.0 = default) */
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
    activeGesture: null,
    lastGestureEndTime: -10,
    mouthOpen: 0,
    prevMouthOpen: 0,
    emphasisAccumulator: 0,
    headNodPhase: 0,
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
  // Determine gesture arm from gesture definition
  // ============================================================================

  const resolveArm = useCallback((def: GestureDef): 'left' | 'right' | 'both' => {
    const config = configRef.current;
    if (def.armMode === 'both') return 'both';
    if (def.armMode === 'dominant') {
      // Dominant hand bias with small chance of dual-arm
      if (Math.random() < config.dualArmChance) return 'both';
      return Math.random() < config.dominantHandBias ? 'right' : 'left';
    }
    // 'either' - random
    return Math.random() > 0.5 ? 'right' : 'left';
  }, []);

  // ============================================================================
  // Trigger a gesture
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

    if (isSpeaking) {
      const lerpSpeed = delta * 5;

      // ========================================
      // Head Nod (rhythmic during speech, modulated by amplitude)
      // ========================================
      const ampMod = 0.5 + state.mouthOpen * 0.5; // 0.5-1.0 based on loudness
      const nodCycle = Math.sin(t * config.headNodSpeed * Math.PI * 2);
      const tiltCycle = Math.sin(t * config.headNodSpeed * 0.7 * Math.PI * 2);

      if (bones.head && rest.head) {
        const targetX = rest.head.x + nodCycle * config.headNodAmount * ampMod * scale;
        const targetZ = rest.head.z + tiltCycle * config.headTiltAmount * ampMod * scale;
        bones.head.rotation.x = THREE.MathUtils.lerp(bones.head.rotation.x, targetX, delta * 8);
        bones.head.rotation.z = THREE.MathUtils.lerp(bones.head.rotation.z, targetZ, delta * 6);
      }

      if (bones.neck1 && rest.neck1) {
        bones.neck1.rotation.x = THREE.MathUtils.lerp(
          bones.neck1.rotation.x,
          rest.neck1.x + nodCycle * config.headNodAmount * 0.4 * ampMod * scale,
          delta * 6
        );
      }

      // ========================================
      // Amplitude-Driven Gesture Triggering
      // ========================================
      // Detect emphasis peaks: mouthOpen rising above threshold
      const isEmphasis = state.mouthOpen > config.emphasisThreshold &&
                         state.mouthOpen > state.prevMouthOpen;

      if (!state.activeGesture) {
        const timeSinceLastGesture = t - state.lastGestureEndTime;

        if (timeSinceLastGesture >= config.gestureMinInterval) {
          // Base chance + emphasis boost
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
          // Gesture complete
          state.activeGesture = null;
          state.lastGestureEndTime = t;
        } else {
          const envelope = gestureEnvelope(progress) * scale;
          const osc = Math.sin(t * config.gestureSpeed * Math.PI * 2);

          def.apply(
            progress,
            envelope,
            osc,
            bones,
            rest,
            config,
            gesture.arm,
            lerpSpeed,
          );
        }
      }

      // ========================================
      // Subtle constant spine sway during speech
      // ========================================
      const spineSway = Math.sin(t * 1.1) * config.spineSwayAmount * 0.3 * scale;
      lerpBoneAxis(bones.spine, rest.spine, 'z', spineSway, lerpSpeed * 0.5);
      lerpBoneAxis(bones.spine2, rest.spine2, 'z', spineSway * 0.7, lerpSpeed * 0.5);

      // Store previous mouthOpen for emphasis detection
      state.prevMouthOpen = state.mouthOpen;

    } else {
      // ========================================
      // Lerp all talking bones back to rest when not speaking.
      // Head and shoulders are managed by useTalkingAnimation when speaking,
      // and by useIdleAnimation when not speaking (via isSpeaking flag).
      // ========================================
      const lerpSpeed = delta * 3;

      // Lerp everything back to rest
      const boneKeys: (keyof TalkingBoneRefs)[] = [
        'neck1', 'neck2',
        'upperArmL', 'upperArmR',
        'foreArmL', 'foreArmR',
        'handL', 'handR',
        'spine', 'spine2',
        'shoulderL', 'shoulderR',
        'head',
      ];

      for (const key of boneKeys) {
        const bone = bones[key];
        const restPose = rest[key];
        if (bone && restPose) {
          bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, restPose.x, lerpSpeed);
          bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, restPose.y, lerpSpeed);
          bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, restPose.z, lerpSpeed);
        }
      }

      // Reset gesture state
      state.activeGesture = null;
    }

    // ========================================
    // Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(
        `[TalkingAnimation] speaking=${isSpeaking}, ` +
        `gesture=${state.activeGesture?.type ?? 'none'} ` +
        `(arm=${state.activeGesture?.arm ?? '-'}), ` +
        `mouthOpen=${state.mouthOpen.toFixed(2)}, ` +
        `totalGestures=${state.gestureCount}`
      );
    }
  }, [startGesture]);

  // ============================================================================
  // setMouthOpen - feed audio amplitude for gesture triggering
  // ============================================================================

  const setMouthOpen = useCallback((value: number) => {
    stateRef.current.mouthOpen = value;
  }, []);

  // ============================================================================
  // triggerGesture - force trigger for rig API testing
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
  // getGestureTypes - list available gestures
  // ============================================================================

  const getGestureTypes = useCallback((): GestureType[] => {
    return [...GESTURE_TYPES];
  }, []);

  // ============================================================================
  // setAmplitudeScale - scale all gesture amplitudes
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
