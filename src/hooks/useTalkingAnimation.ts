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
  gestureChance: 2.5,             // ~2.5 per second base rate (per-frame: 2.5*0.016=0.04 → ~91% in 1s)

  shoulderShrugsPerMinute: 4,
  shoulderShrugsAmount: 0.06,
  shoulderShruggDuration: 0.6,

  spineSwayAmount: 0.03,

  dominantHandBias: 0.7,
  gestureMinInterval: 0.5,        // Reduced from 0.8 — allows faster re-triggering
  dualArmChance: 0.2,

  emphasisThreshold: 0.2,         // Lowered from 0.35 — fire emphasis on softer speech too
  emphasisGestureBoost: 1.2,      // Boosted from 0.8 — stronger emphasis response
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
  handL: sk.hands.left,
  handR: sk.hands.right,
  spine: [/^spine1$/i, /^spine$/i],
  spine2: [/^spine2$/i, /^spine3$/i],
  chest: [/^spine4$/i, /^chest$/i],
};

// ============================================================================
// Gesture Library
// ============================================================================

type GestureType = 'beat' | 'emphasis' | 'openPalm' | 'point' | 'thinking' | 'tilt' | 'shrug' | 'wave';

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

/** Sharper envelope for emphasis gestures — quicker attack, shorter hold */
function emphasisEnvelope(progress: number): number {
  if (progress < 0.12) {
    // Very fast attack
    const t = progress / 0.12;
    return t * t * t;
  } else if (progress < 0.35) {
    return 1.0;
  } else {
    // Quick retraction
    const t = (progress - 0.35) / 0.65;
    return 1.0 - t * t;
  }
}

const GESTURE_LIBRARY: Record<GestureType, GestureDef> = {
  // Common everyday rhythmic gesture
  beat: {
    armMode: 'dominant',
    durationRange: [0.8, 1.4],
    weight: 3,
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

  // Sharp downward beat on stressed words
  emphasis: {
    armMode: 'dominant',
    durationRange: [0.5, 0.9],
    weight: 3,
    apply(progress, _envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      // Use sharper envelope for emphasis
      const amp = emphasisEnvelope(progress);
      if (arm === 'right' || arm === 'both') {
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'x', amp * config.gestureArmAmount * 1.4, lerpSpeed);
        lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 1.2, lerpSpeed);
        lerpBoneAxis(bones.handR, rest.handR, 'x', amp * config.gestureHandAmount * 1.3, lerpSpeed);
        lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.4, lerpSpeed);
      }
      if (arm === 'left' || arm === 'both') {
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'x', amp * config.gestureArmAmount * 1.4, lerpSpeed);
        lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 1.2, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'x', amp * config.gestureHandAmount * 1.3, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.4, lerpSpeed);
      }
    },
  },

  // Both hands out, palms up — presenting / explaining
  openPalm: {
    armMode: 'both',
    durationRange: [1.2, 2.2],
    weight: 2,
    apply(_progress, envelope, _osc, bones, rest, config, _arm, lerpSpeed) {
      const amp = envelope;
      // Arms out to sides
      lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'z', -amp * config.gestureArmAmount * 1.4, lerpSpeed);
      lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'z', amp * config.gestureArmAmount * 1.4, lerpSpeed);
      // Forearms raised slightly
      lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', amp * config.gestureForearmAmount * 1.1, lerpSpeed);
      lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', amp * config.gestureForearmAmount * 1.1, lerpSpeed);
      // Hands rotated palms-up (supination)
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.7, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.7, lerpSpeed);
      lerpBoneAxis(bones.handR, rest.handR, 'y', amp * config.gestureHandAmount * 0.3, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'y', -amp * config.gestureHandAmount * 0.3, lerpSpeed);
      // Spine leans back slightly — "presenting"
      lerpBoneAxis(bones.spine2, rest.spine2, 'x', -amp * config.spineSwayAmount * 0.6, lerpSpeed);
    },
  },

  // Index finger extension toward a direction
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
      // Spine rotates toward pointed direction
      const spineDir = (arm === 'left') ? 1 : -1;
      lerpBoneAxis(bones.spine2, rest.spine2, 'y', amp * config.spineSwayAmount * spineDir, lerpSpeed);
      lerpBoneAxis(bones.spine, rest.spine, 'y', amp * config.spineSwayAmount * spineDir * 0.4, lerpSpeed);
    },
  },

  // Hand toward chin/face — contemplative
  thinking: {
    armMode: 'dominant',
    durationRange: [1.5, 3.0],
    weight: 1.5,
    apply(progress, _envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      // Custom long-hold envelope: slow rise, long hold, slow drop
      let amp: number;
      if (progress < 0.25) {
        const t = progress / 0.25;
        amp = t * t; // ease in
      } else if (progress < 0.65) {
        amp = 1.0; // long hold
      } else {
        const t = (progress - 0.65) / 0.35;
        amp = 1.0 - t * t; // ease out
      }

      if (arm === 'right' || arm === 'both') {
        // Arm raises: upper arm forward+up, forearm bends sharply
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'x', amp * config.gestureArmAmount * 2.0, lerpSpeed);
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'z', -amp * config.gestureArmAmount * 0.8, lerpSpeed);
        lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', -amp * config.gestureForearmAmount * 2.5, lerpSpeed);
        // Hand tilts inward (toward face)
        lerpBoneAxis(bones.handR, rest.handR, 'y', amp * config.gestureHandAmount * 0.6, lerpSpeed);
        lerpBoneAxis(bones.handR, rest.handR, 'x', -amp * config.gestureHandAmount * 0.4, lerpSpeed);
      }
      if (arm === 'left' || arm === 'both') {
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'x', amp * config.gestureArmAmount * 2.0, lerpSpeed);
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'z', amp * config.gestureArmAmount * 0.8, lerpSpeed);
        lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', -amp * config.gestureForearmAmount * 2.5, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'y', -amp * config.gestureHandAmount * 0.6, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'x', -amp * config.gestureHandAmount * 0.4, lerpSpeed);
      }
      // Head tilts toward raised hand
      const headDir = (arm === 'left') ? 1 : -1;
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * headDir * 0.8, lerpSpeed);
      lerpBoneAxis(bones.head, rest.head, 'x', amp * config.headNodAmount * 0.5, lerpSpeed);
    },
  },

  // Head tilt with spine lean
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

  // Shoulders up, palms out — "I don't know"
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
      // Palms out: hand Z rotation for supination
      lerpBoneAxis(bones.handR, rest.handR, 'z', -amp * config.gestureHandAmount * 0.8, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'z', amp * config.gestureHandAmount * 0.8, lerpSpeed);
      lerpBoneAxis(bones.handR, rest.handR, 'y', amp * config.gestureHandAmount * 0.3, lerpSpeed);
      lerpBoneAxis(bones.handL, rest.handL, 'y', -amp * config.gestureHandAmount * 0.3, lerpSpeed);
      lerpBoneAxis(bones.head, rest.head, 'z', amp * config.headTiltAmount * 0.5, lerpSpeed);
    },
  },

  // Greeting wave — hand raised with oscillating wrist
  wave: {
    armMode: 'dominant',
    durationRange: [1.0, 1.5],
    weight: 0.5,
    apply(_progress, envelope, _osc, bones, rest, config, arm, lerpSpeed) {
      const amp = envelope;
      // Use progress for wave oscillation (3 quick back-and-forth)
      const waveOsc = Math.sin(_progress * Math.PI * 6) * amp;

      if (arm === 'right' || arm === 'both') {
        // Arm raises high
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'x', amp * config.gestureArmAmount * 1.8, lerpSpeed);
        lerpBoneAxis(bones.upperArmR, rest.upperArmR, 'z', -amp * config.gestureArmAmount * 1.5, lerpSpeed);
        lerpBoneAxis(bones.foreArmR, rest.foreArmR, 'x', -amp * config.gestureForearmAmount * 1.5, lerpSpeed);
        // Wave motion on hand Z
        lerpBoneAxis(bones.handR, rest.handR, 'z', waveOsc * config.gestureHandAmount * 1.2, lerpSpeed);
      }
      if (arm === 'left' || arm === 'both') {
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'x', amp * config.gestureArmAmount * 1.8, lerpSpeed);
        lerpBoneAxis(bones.upperArmL, rest.upperArmL, 'z', amp * config.gestureArmAmount * 1.5, lerpSpeed);
        lerpBoneAxis(bones.foreArmL, rest.foreArmL, 'x', -amp * config.gestureForearmAmount * 1.5, lerpSpeed);
        lerpBoneAxis(bones.handL, rest.handL, 'z', waveOsc * config.gestureHandAmount * 1.2, lerpSpeed);
      }
    },
  },
};

const GESTURE_TYPES: GestureType[] = ['beat', 'emphasis', 'openPalm', 'point', 'thinking', 'tilt', 'shrug', 'wave'];

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
  scale: number; // 0.6–1.4 varied sizing
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
  // Sentence-level limiting
  gesturesThisSentence: number;
  lastSilenceTime: number;       // last time mouthOpen was near 0
  inSentence: boolean;           // currently in a speech phrase
  restCooldownUntil: number;     // no gestures until this time (post-pause cooldown)
  // Session tracking for wave gesture
  sessionSpeechStartTime: number; // when speaking first started this session
  hasWaved: boolean;              // only wave once per session
  // Sustained loudness tracking for openPalm preference
  sustainedLoudStart: number;     // when mouthOpen exceeded threshold continuously
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
    gesturesThisSentence: 0,
    lastSilenceTime: 0,
    inSentence: false,
    restCooldownUntil: 0,
    sessionSpeechStartTime: -1,
    hasWaved: false,
    sustainedLoudStart: -1,
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

  const startGesture = useCallback((type: GestureType, scaleOverride?: number) => {
    const state = stateRef.current;
    const def = GESTURE_LIBRARY[type];
    const [minDur, maxDur] = def.durationRange;
    const duration = minDur + Math.random() * (maxDur - minDur);

    // Varied gesture sizing: 0.6 to 1.4, biased by current mouth amplitude
    const baseScale = 0.6 + Math.random() * 0.8;
    const ampBoost = Math.min(0.3, state.mouthOpen * 0.4); // louder = bigger
    const scale = scaleOverride ?? Math.min(1.4, baseScale + ampBoost);

    state.activeGesture = {
      type,
      startTime: state.time,
      duration,
      arm: resolveArm(def),
      scale,
    };
    state.gestureCount++;
    state.gesturesThisSentence++;
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
    // Entry-point Debug Logging (every 2 seconds)
    // ========================================
    if ((state as any)._frameCount === undefined) (state as any)._frameCount = 0;
    (state as any)._frameCount++;
    if ((state as any)._frameCount % 120 === 0) {
      log.info(`[GestureEntry] mouthOpen=${state.mouthOpen.toFixed(3)} blend=${state.speakingBlend.toFixed(2)} isSpeaking=${isSpeaking} t=${t.toFixed(1)}`);
    }

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
    // Sentence Boundary Detection
    // ========================================
    // Detect actual pauses (mouthOpen near 0 for >0.8s) to reset gesture counter.
    // Threshold is very low — between-word dips often reach 0.01-0.03.
    const isSilent = state.mouthOpen < 0.02;
    if (isSilent) {
      if (state.inSentence) {
        state.lastSilenceTime = t;
        state.inSentence = false;
      }
      // Silence > 0.8s = true sentence boundary (not just between-word gap)
      if (t - state.lastSilenceTime > 0.8 && state.gesturesThisSentence > 0) {
        state.gesturesThisSentence = 0;
        // Brief rest cooldown so first gesture of new sentence doesn't fire instantly
        state.restCooldownUntil = t + 0.3;
      }
    } else if (!state.inSentence) {
      state.inSentence = true;
    }

    // Track session speech start (for wave gesture)
    if (isSpeaking && state.sessionSpeechStartTime < 0) {
      state.sessionSpeechStartTime = t;
    }
    if (!isSpeaking) {
      // Reset session after silence > 10s
      if (t - state.lastSilenceTime > 10) {
        state.sessionSpeechStartTime = -1;
        state.hasWaved = false;
      }
    }

    // Track sustained loudness (for openPalm preference)
    if (state.mouthOpen > 0.3) {
      if (state.sustainedLoudStart < 0) state.sustainedLoudStart = t;
    } else {
      state.sustainedLoudStart = -1;
    }

    // ========================================
    // Smart Gesture Triggering
    // ========================================
    const isEmphasis = state.mouthOpen > config.emphasisThreshold &&
                       state.mouthOpen > state.prevMouthOpen;

    if (!state.activeGesture && t > state.restCooldownUntil) {
      const timeSinceLastGesture = t - state.lastGestureEndTime;
      const canGesture = timeSinceLastGesture >= config.gestureMinInterval &&
                         state.gesturesThisSentence < 2; // max 2 per sentence

      if (canGesture) {
        let chance = config.gestureChance * delta;
        if (isEmphasis) {
          chance += config.emphasisGestureBoost * delta;
        }

        if (Math.random() < chance) {
          // Smart gesture selection based on context
          let selectedType: GestureType;

          // Wave at start of speech session (first 3 seconds, once per session)
          if (!state.hasWaved && state.sessionSpeechStartTime > 0 &&
              t - state.sessionSpeechStartTime < 3 && Math.random() < 0.4) {
            selectedType = 'wave';
            state.hasWaved = true;
          }
          // Emphasis peaks → prefer emphasis gesture
          else if (isEmphasis && Math.random() < 0.6) {
            selectedType = 'emphasis';
          }
          // Sustained loud speech (>2s) → prefer openPalm
          else if (state.sustainedLoudStart > 0 &&
                   t - state.sustainedLoudStart > 2 && Math.random() < 0.4) {
            selectedType = 'openPalm';
          }
          // After silence gap (>1s) without speech resuming → thinking
          else if (!state.inSentence && t - state.lastSilenceTime > 1 &&
                   isSpeaking && Math.random() < 0.3) {
            selectedType = 'thinking';
          }
          // Otherwise: weighted random from full library
          else {
            selectedType = pickRandomGesture();
          }

          startGesture(selectedType);
          // Re-read from ref to bypass TS narrowing (startGesture mutated the ref)
          const fired = stateRef.current.activeGesture;
          log.info(
            `[GestureFired] type=${selectedType} arm=${fired?.arm ?? '?'} ` +
            `scale=${fired?.scale?.toFixed(2) ?? '?'} mouthOpen=${state.mouthOpen.toFixed(3)} ` +
            `sentenceGestures=${state.gesturesThisSentence} total=${state.gestureCount}`
          );
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
        // Apply gesture scale for varied sizing
        const envelope = gestureEnvelope(progress) * scale * blend * gesture.scale;
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
    // NOTE: Do NOT include arm/hand bones here! They use useGenesisAnimation's
    // idle pose, not useTalkingAnimation's rest poses (which are T-pose).
    // Only reset head/neck/spine/shoulders which are safe.
    if (!isSpeaking && blend > 0.01) {
      const restLerp = delta * 2.5;
      const boneKeys: (keyof TalkingBoneRefs)[] = [
        'neck1', 'neck2',
        'spine', 'spine2', 'chest',
        'shoulderL', 'shoulderR',
        'head',
        // ARM BONES EXCLUDED: 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR'
        // These stay in idle pose from useGenesisAnimation
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
        `(arm=${state.activeGesture?.arm ?? '-'}, scale=${state.activeGesture?.scale.toFixed(2) ?? '-'}), ` +
        `mouthOpen=${state.mouthOpen.toFixed(2)}, ` +
        `sentenceGestures=${state.gesturesThisSentence}, ` +
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
