/**
 * ============================================================================
 * useTalkingAnimation - Speech-Driven Body Animation System
 * ============================================================================
 * Provides natural body movement during speech:
 *   - Head nods (rhythmic up/down)
 *   - Hand gestures (subtle arm/forearm movement)
 *   - Shoulder shrugs (emphasis moments)
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
  gestureChance: number;         // Chance per second of a gesture burst

  // Shoulder shrugs
  shoulderShrugsPerMinute: number;  // Average shrugs per minute during speech
  shoulderShrugsAmount: number;     // Shoulder raise amount (radians)
  shoulderShruggDuration: number;   // Duration of a single shrug
}

const DEFAULT_CONFIG: TalkingAnimationConfig = {
  headNodSpeed: 2.5,
  headNodAmount: 0.02,
  headTiltAmount: 0.01,

  gestureSpeed: 1.8,
  gestureArmAmount: 0.015,
  gestureForearmAmount: 0.02,
  gestureChance: 0.3,

  shoulderShrugsPerMinute: 4,
  shoulderShrugsAmount: 0.02,
  shoulderShruggDuration: 0.6,
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
};

// ============================================================================
// State
// ============================================================================

interface TalkingAnimationState {
  time: number;
  // Gesture state
  isGesturing: boolean;
  gestureStartTime: number;
  gestureDuration: number;
  gestureArm: 'left' | 'right';
  // Shrug state
  isShrugging: boolean;
  shrugStartTime: number;
  nextShrugTime: number;
  // Debug
  debugLogTime: number;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseTalkingAnimationReturn {
  /** Initialize with loaded scene - finds head, neck, shoulder, arm bones */
  initialize: (scene: THREE.Object3D) => void;
  /** Update talking animations each frame */
  update: (delta: number, isSpeaking: boolean) => void;
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

  const stateRef = useRef<TalkingAnimationState>({
    time: 0,
    isGesturing: false,
    gestureStartTime: 0,
    gestureDuration: 1.5,
    gestureArm: 'right',
    isShrugging: false,
    shrugStartTime: 0,
    nextShrugTime: Math.random() * 10 + 5,
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
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking: boolean) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;
    const state = stateRef.current;

    state.time += delta;
    const t = state.time;

    if (isSpeaking) {
      // ========================================
      // Head Nod (rhythmic during speech)
      // ========================================
      const nodCycle = Math.sin(t * config.headNodSpeed * Math.PI * 2);
      const tiltCycle = Math.sin(t * config.headNodSpeed * 0.7 * Math.PI * 2);

      if (bones.head && rest.head) {
        const targetX = rest.head.x + nodCycle * config.headNodAmount;
        const targetZ = rest.head.z + tiltCycle * config.headTiltAmount;
        bones.head.rotation.x = THREE.MathUtils.lerp(bones.head.rotation.x, targetX, delta * 8);
        bones.head.rotation.z = THREE.MathUtils.lerp(bones.head.rotation.z, targetZ, delta * 6);
      }

      if (bones.neck1 && rest.neck1) {
        bones.neck1.rotation.x = THREE.MathUtils.lerp(
          bones.neck1.rotation.x,
          rest.neck1.x + nodCycle * config.headNodAmount * 0.4,
          delta * 6
        );
      }

      // ========================================
      // Hand Gestures (random bursts)
      // ========================================
      if (!state.isGesturing && Math.random() < config.gestureChance * delta) {
        state.isGesturing = true;
        state.gestureStartTime = t;
        state.gestureDuration = 1.0 + Math.random() * 1.5;
        state.gestureArm = Math.random() > 0.5 ? 'right' : 'left';
      }

      if (state.isGesturing) {
        const gestureProgress = (t - state.gestureStartTime) / state.gestureDuration;

        if (gestureProgress >= 1) {
          state.isGesturing = false;
        } else {
          const gestureCurve = Math.sin(gestureProgress * Math.PI);
          const gestureOsc = Math.sin(t * config.gestureSpeed * Math.PI * 2) * gestureCurve;

          if (state.gestureArm === 'right') {
            if (bones.upperArmR && rest.upperArmR) {
              bones.upperArmR.rotation.x = THREE.MathUtils.lerp(
                bones.upperArmR.rotation.x,
                rest.upperArmR.x + gestureOsc * config.gestureArmAmount,
                delta * 5
              );
            }
            if (bones.foreArmR && rest.foreArmR) {
              bones.foreArmR.rotation.x = THREE.MathUtils.lerp(
                bones.foreArmR.rotation.x,
                rest.foreArmR.x + gestureCurve * config.gestureForearmAmount,
                delta * 5
              );
            }
          } else {
            if (bones.upperArmL && rest.upperArmL) {
              bones.upperArmL.rotation.x = THREE.MathUtils.lerp(
                bones.upperArmL.rotation.x,
                rest.upperArmL.x + gestureOsc * config.gestureArmAmount,
                delta * 5
              );
            }
            if (bones.foreArmL && rest.foreArmL) {
              bones.foreArmL.rotation.x = THREE.MathUtils.lerp(
                bones.foreArmL.rotation.x,
                rest.foreArmL.x + gestureCurve * config.gestureForearmAmount,
                delta * 5
              );
            }
          }
        }
      }

      // ========================================
      // Shoulder Shrugs (periodic emphasis)
      // ========================================
      if (!state.isShrugging && t >= state.nextShrugTime) {
        state.isShrugging = true;
        state.shrugStartTime = t;
      }

      if (state.isShrugging) {
        const shrugProgress = (t - state.shrugStartTime) / config.shoulderShruggDuration;

        if (shrugProgress >= 1) {
          state.isShrugging = false;
          const interval = 60 / Math.max(1, config.shoulderShrugsPerMinute);
          state.nextShrugTime = t + interval * (0.5 + Math.random());
        } else {
          const shrugCurve = Math.sin(shrugProgress * Math.PI);
          const shrugAmount = shrugCurve * config.shoulderShrugsAmount;

          if (bones.shoulderL && rest.shoulderL) {
            bones.shoulderL.rotation.z = THREE.MathUtils.lerp(
              bones.shoulderL.rotation.z,
              rest.shoulderL.z - shrugAmount,
              delta * 10
            );
          }
          if (bones.shoulderR && rest.shoulderR) {
            bones.shoulderR.rotation.z = THREE.MathUtils.lerp(
              bones.shoulderR.rotation.z,
              rest.shoulderR.z + shrugAmount,
              delta * 10
            );
          }
        }
      }
    } else {
      // ========================================
      // Lerp talking-only bones back to rest when not speaking.
      // Do NOT lerp head or shoulders here - those are managed by
      // useIdleAnimation (sway, breathing) which runs after this hook.
      // Only lerp neck, arms, and forearms (gesture cleanup).
      // ========================================
      const lerpSpeed = delta * 3;

      if (bones.neck1 && rest.neck1) {
        bones.neck1.rotation.x = THREE.MathUtils.lerp(bones.neck1.rotation.x, rest.neck1.x, lerpSpeed);
      }
      if (bones.upperArmL && rest.upperArmL) {
        bones.upperArmL.rotation.x = THREE.MathUtils.lerp(bones.upperArmL.rotation.x, rest.upperArmL.x, lerpSpeed);
      }
      if (bones.upperArmR && rest.upperArmR) {
        bones.upperArmR.rotation.x = THREE.MathUtils.lerp(bones.upperArmR.rotation.x, rest.upperArmR.x, lerpSpeed);
      }
      if (bones.foreArmL && rest.foreArmL) {
        bones.foreArmL.rotation.x = THREE.MathUtils.lerp(bones.foreArmL.rotation.x, rest.foreArmL.x, lerpSpeed);
      }
      if (bones.foreArmR && rest.foreArmR) {
        bones.foreArmR.rotation.x = THREE.MathUtils.lerp(bones.foreArmR.rotation.x, rest.foreArmR.x, lerpSpeed);
      }

      // Reset gesture/shrug state
      state.isGesturing = false;
      state.isShrugging = false;
    }

    // ========================================
    // Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(
        `[TalkingAnimation] speaking=${isSpeaking}, ` +
        `gesturing=${state.isGesturing}, ` +
        `shrugging=${state.isShrugging}`
      );
    }
  }, []);

  return {
    initialize,
    update,
  };
}
