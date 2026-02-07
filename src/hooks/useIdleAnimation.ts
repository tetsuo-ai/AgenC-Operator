/**
 * ============================================================================
 * useIdleAnimation - Always-On Subtle Movement System
 * ============================================================================
 * Provides procedural idle animations that layer together:
 *   - Breathing: subtle chest/spine expansion
 *   - Body sway: gentle weight shifting with hip sway
 *   - Weight shifts: occasional left/right weight changes
 *   - Spine S-curve: natural postural micro-movements
 *   - Arm asymmetry: one arm slightly more relaxed
 *   - Micro-movements: lerped random drift (no snapping)
 *   - Eye blinks: random interval with double-blink support
 *
 * All animations use smooth easing — no sudden direction changes.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { stripMorphPrefix } from '../utils/glbInspector';
import { log } from '../utils/log';
import { MODEL_CONFIG } from '../config/modelConfig';
import { BREATHING, SWAY, MICRO, BLINK } from '../config/animationConfig';
import { FacsMorphController } from '../utils/dazMorphMap';

// ============================================================================
// Configuration
// ============================================================================

export interface IdleAnimationConfig {
  // Breathing
  breathSpeed: number;
  breathSpineAmount: number;
  breathChestAmount: number;
  breathShoulderAmount: number;

  // Body sway
  swaySpeed: number;
  swayHipAmount: number;
  swaySpineAmount: number;
  swayHeadAmount: number;

  // Micro-movements
  microSpeed: number;
  microAmount: number;
  microLerpRate: number;

  // Blinking
  blinkIntervalMin: number;
  blinkIntervalMax: number;
  blinkDuration: number;
}

const DEFAULT_CONFIG: IdleAnimationConfig = {
  breathSpeed: BREATHING.speed,
  breathSpineAmount: BREATHING.spineAmount,
  breathChestAmount: BREATHING.chestAmount,
  breathShoulderAmount: BREATHING.shoulderAmount,

  swaySpeed: SWAY.speed,
  swayHipAmount: SWAY.hipAmount,
  swaySpineAmount: SWAY.spineAmount,
  swayHeadAmount: SWAY.headAmount,

  microSpeed: MICRO.speed,
  microAmount: MICRO.amount,
  microLerpRate: MICRO.lerpRate,

  blinkIntervalMin: BLINK.intervalMin,
  blinkIntervalMax: BLINK.intervalMax,
  blinkDuration: BLINK.duration,
};

// ============================================================================
// Bone References
// ============================================================================

interface BoneRefs {
  spine?: THREE.Bone;
  spine1?: THREE.Bone;
  spine2?: THREE.Bone;
  chest?: THREE.Bone;
  neck?: THREE.Bone;
  head?: THREE.Bone;
  shoulderL?: THREE.Bone;
  shoulderR?: THREE.Bone;
  upperArmL?: THREE.Bone;
  upperArmR?: THREE.Bone;
  forearmL?: THREE.Bone;
  forearmR?: THREE.Bone;
  handL?: THREE.Bone;
  handR?: THREE.Bone;
  hips?: THREE.Bone;
  thighL?: THREE.Bone;
  thighR?: THREE.Bone;
}

interface RestPoses {
  [boneName: string]: THREE.Euler;
}

// ============================================================================
// Morph Target References
// ============================================================================

interface MorphRefs {
  mesh: THREE.SkinnedMesh | THREE.Mesh;
  eyesClosedIndex: number;
}

interface EyelidBones {
  topL?: THREE.Bone;
  topR?: THREE.Bone;
  botL?: THREE.Bone;
  botR?: THREE.Bone;
}

interface EyelidRestPoses {
  topL?: THREE.Euler;
  topR?: THREE.Euler;
  botL?: THREE.Euler;
  botR?: THREE.Euler;
}

// ============================================================================
// State
// ============================================================================

interface IdleAnimationState {
  time: number;

  // Blinking
  nextBlinkTime: number;
  isBlinking: boolean;
  blinkStartTime: number;
  doubleBlinkPending: boolean;
  wasSpeaking: boolean;        // Track speech transitions for blink timing

  // Micro-movements (lerped — no snapping)
  microTarget: THREE.Vector3;
  microCurrent: THREE.Vector3;
  lastMicroUpdate: number;

  // Weight shift
  weightShiftTarget: number;   // -1 (left) to 1 (right), 0 = centered
  weightShiftCurrent: number;
  nextWeightShiftTime: number;

  // Debug tracking
  debugLogTime: number;
  blinkCount: number;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseIdleAnimationReturn {
  initialize: (scene: THREE.Object3D) => void;
  update: (delta: number, isSpeaking?: boolean) => void;
  getBlinkValue: () => number;
  reset: () => void;
  setConfig: (config: Partial<IdleAnimationConfig>) => void;
  setMorphController: (controller: FacsMorphController) => void;
}

// ============================================================================
// Bone Name Patterns
// ============================================================================

const sk = MODEL_CONFIG.skeleton;
const BONE_PATTERNS: Record<keyof BoneRefs, RegExp[]> = {
  spine: [/^spine1$/i, /^spine$/i],
  spine1: [/^spine2$/i],
  spine2: [/^spine3$/i],
  chest: [/^spine4$/i, /^chest$/i, /^chestUpper$/i, /^chestLower$/i],
  neck: sk.neck,
  head: sk.head,
  shoulderL: [...sk.shoulders.left, /^Left[_]?shoulder$/i],
  shoulderR: [...sk.shoulders.right, /^Right[_]?shoulder$/i],
  upperArmL: [...sk.upperArms.left, /^Left[_]?arm$/i],
  upperArmR: [...sk.upperArms.right, /^Right[_]?arm$/i],
  forearmL: [...sk.forearms.left],
  forearmR: [...sk.forearms.right],
  handL: sk.hands.left,
  handR: sk.hands.right,
  hips: sk.hips,
  thighL: [/^l_thigh$/i, /^lThighBend$/i, /^thigh[_]?l$/i],
  thighR: [/^r_thigh$/i, /^rThighBend$/i, /^thigh[_]?r$/i],
};

// ============================================================================
// Smooth easing helpers
// ============================================================================

/** Soft oscillation: sinusoidal with gentler peaks than raw Math.sin */
function softOscillate(time: number, speed: number): number {
  // Map time to 0-1 phase within each cycle, then apply easeInOutSine
  const phase = (time * speed) % 1;
  // Convert 0..1 ease to -1..1 oscillation
  return Math.sin(phase * Math.PI * 2);
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useIdleAnimation(
  initialConfig: Partial<IdleAnimationConfig> = {}
): UseIdleAnimationReturn {
  const configRef = useRef<IdleAnimationConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const bonesRef = useRef<BoneRefs>({});
  const restPosesRef = useRef<RestPoses>({});
  const morphRef = useRef<MorphRefs | null>(null);
  const eyelidBonesRef = useRef<EyelidBones>({});
  const eyelidRestRef = useRef<EyelidRestPoses>({});
  const initializedRef = useRef(false);
  const morphControllerRef = useRef<FacsMorphController | null>(null);

  const stateRef = useRef<IdleAnimationState>({
    time: 0,
    nextBlinkTime: Math.random() * 3 + 2,
    isBlinking: false,
    blinkStartTime: 0,
    doubleBlinkPending: false,
    wasSpeaking: false,
    microTarget: new THREE.Vector3(),
    microCurrent: new THREE.Vector3(),
    lastMicroUpdate: 0,
    weightShiftTarget: 0,
    weightShiftCurrent: 0,
    nextWeightShiftTime: 5 + Math.random() * 5,
    debugLogTime: 0,
    blinkCount: 0,
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

    log.info('[IdleAnimation] ========== INITIALIZING ==========');

    // Find all bones
    const bones: BoneRefs = {};
    const foundBones: string[] = [];
    const missingBones: string[] = [];

    for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        bones[key as keyof BoneRefs] = bone;
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      } else {
        missingBones.push(key);
      }
    }
    bonesRef.current = bones;

    if (foundBones.length > 0) {
      log.info(`[IdleAnimation] Found ${foundBones.length} bones:`);
      foundBones.forEach(b => log.debug(`[IdleAnimation]   + ${b}`));
    }
    if (missingBones.length > 0) {
      log.warn(`[IdleAnimation] Missing ${missingBones.length} bones: ${missingBones.join(', ')}`);
    }

    // Find morph target for blinking
    let allMorphTargets: string[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        const dict = child.morphTargetDictionary;
        if (dict) {
          allMorphTargets = allMorphTargets.concat(Object.keys(dict));

          if (!morphRef.current) {
            const eyeBlink = MODEL_CONFIG.morphTargets.eyeBlink;
            const eyesClosedPatterns = [
              ...eyeBlink.both,
              ...eyeBlink.left,
              ...eyeBlink.right,
              /facs_bs_EyeBlink$/i,
              /facs_bs_EyeBlinkLeft$/i,
              /facs_bs_EyeBlinkRight$/i,
            ];
            for (const [name, index] of Object.entries(dict)) {
              const cleanName = stripMorphPrefix(name);
              for (const pattern of eyesClosedPatterns) {
                if (pattern.test(name) || pattern.test(cleanName)) {
                  morphRef.current = {
                    mesh: child,
                    eyesClosedIndex: index as number,
                  };
                  log.info(`[IdleAnimation] Found blink morph: "${name}" (index ${index}) on mesh "${child.name}"`);
                  return;
                }
              }
            }
          }
        }
      }
    });

    if (!morphRef.current) {
      log.warn('[IdleAnimation] No blink morph target found');
      log.debug(`[IdleAnimation] Available morphs: ${allMorphTargets.slice(0, 20).join(', ')}${allMorphTargets.length > 20 ? '...' : ''}`);
    } else {
      if (morphRef.current.mesh.morphTargetInfluences) {
        const currentValue = morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex];
        log.info(`[IdleAnimation] Eyes_closed morph initial value: ${currentValue} - setting to 0 (open)`);
        morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] = 0;
      }
    }

    // Find eyelid bones
    const eyelidPatterns = {
      topL: sk.eyelids.upperL,
      topR: sk.eyelids.upperR,
      botL: sk.eyelids.lowerL,
      botR: sk.eyelids.lowerR,
    };

    const eyelids: EyelidBones = {};
    for (const [key, patterns] of Object.entries(eyelidPatterns)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        eyelids[key as keyof EyelidBones] = bone;
        eyelidRestRef.current[key as keyof EyelidRestPoses] = bone.rotation.clone();
        log.debug(`[IdleAnimation] Found eyelid bone: ${key} -> "${bone.name}"`);
      }
    }
    eyelidBonesRef.current = eyelids;

    if (Object.keys(eyelids).length > 0) {
      log.info(`[IdleAnimation] Found ${Object.keys(eyelids).length} eyelid bones for blink animation`);
    }

    log.info(`[IdleAnimation] Ready: ${Object.keys(bones).length} bones, blink: ${morphRef.current ? 'yes' : 'no'}`);
    initializedRef.current = true;
  }, [findBone]);

  // ============================================================================
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking?: boolean) => {
    if (!initializedRef.current) return;

    const cfg = configRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;
    const state = stateRef.current;

    state.time += delta;
    const t = state.time;

    // ========================================
    // Breathing Animation
    // ========================================
    // Smooth sinusoidal cycle — easeInOutSine-like due to sine's natural zero-velocity peaks
    const breathCycle = Math.sin(t * cfg.breathSpeed * Math.PI * 2);
    const breathIn = (breathCycle + 1) * 0.5; // 0-1 range

    if (bones.spine && rest.spine) {
      bones.spine.rotation.x = rest.spine.x - breathIn * cfg.breathSpineAmount;
    }

    if (bones.chest && rest.chest) {
      bones.chest.rotation.x = rest.chest.x - breathIn * cfg.breathChestAmount;
    }

    // Spine1/spine2: subtle S-curve micro-movements offset from breath
    if (bones.spine1 && rest.spine1) {
      const sCurve = Math.sin(t * cfg.breathSpeed * Math.PI * 2 + 0.8) * 0.004;
      bones.spine1.rotation.z = rest.spine1.z + sCurve;
    }
    if (bones.spine2 && rest.spine2) {
      const sCurve = Math.sin(t * cfg.breathSpeed * Math.PI * 2 + 1.6) * 0.003;
      bones.spine2.rotation.z = rest.spine2.z - sCurve;
    }

    // Shoulder breathing yields to talking animation during speech
    if (!isSpeaking) {
      if (bones.shoulderL && rest.shoulderL) {
        bones.shoulderL.rotation.z = rest.shoulderL.z + breathIn * cfg.breathShoulderAmount;
      }
      if (bones.shoulderR && rest.shoulderR) {
        bones.shoulderR.rotation.z = rest.shoulderR.z - breathIn * cfg.breathShoulderAmount;
      }
    }

    // ========================================
    // Body Sway Animation
    // ========================================
    // Two out-of-phase oscillators for organic, non-repetitive feel
    const swayX = softOscillate(t, cfg.swaySpeed) * cfg.swaySpineAmount;
    const swayZ = softOscillate(t, cfg.swaySpeed * 0.7) * cfg.swaySpineAmount * 0.5;

    if (bones.hips && rest.hips) {
      bones.hips.rotation.x = rest.hips.x + swayX * cfg.swayHipAmount * 4;
      bones.hips.rotation.z = rest.hips.z + swayZ * cfg.swayHipAmount * 4;
    }

    if (bones.spine && rest.spine) {
      // Additive: breathing already set .x, sway only touches .z
      bones.spine.rotation.z = rest.spine.z + swayZ;
    }

    // ========================================
    // Weight Shift (occasional left/right)
    // ========================================
    if (t >= state.nextWeightShiftTime) {
      // Pick a new weight target: left, center, or right
      const r = Math.random();
      if (r < 0.3) state.weightShiftTarget = -0.6 - Math.random() * 0.4; // left
      else if (r < 0.6) state.weightShiftTarget = 0.6 + Math.random() * 0.4; // right
      else state.weightShiftTarget = (Math.random() - 0.5) * 0.3; // near-center
      state.nextWeightShiftTime = t + 6 + Math.random() * 8; // 6-14s between shifts
    }

    // Smooth approach to weight target
    state.weightShiftCurrent += (state.weightShiftTarget - state.weightShiftCurrent) * 0.008;
    const ws = state.weightShiftCurrent;

    // Apply weight shift to hips and thighs
    if (bones.hips && rest.hips) {
      // Lateral hip shift on Z axis (additive)
      bones.hips.rotation.z += ws * 0.008;
    }
    if (bones.thighL && rest.thighL) {
      // Weighted leg bends slightly (subtle knee unlock)
      bones.thighL.rotation.x = rest.thighL.x + Math.max(0, -ws) * 0.015;
    }
    if (bones.thighR && rest.thighR) {
      bones.thighR.rotation.x = rest.thighR.x + Math.max(0, ws) * 0.015;
    }

    // ========================================
    // Arm Animation DISABLED
    // ========================================
    // IMPORTANT: Arm rotations are now controlled by useGenesisAnimation's idle pose
    // and useTalkingAnimation's gestures. Do NOT touch arm bones here or it will
    // overwrite the idle pose and put arms back in T-pose.
    //
    // TODO: Re-enable subtle arm drift once we have a shared rest pose system
    // that captures poses AFTER useGenesisAnimation applies idle corrections.
    // ========================================

    // ========================================
    // Head Sway + Micro-Movements
    // ========================================
    if (!isSpeaking) {
      if (bones.head && rest.head) {
        // Head counter-sway (looks more natural)
        bones.head.rotation.x = rest.head.x - swayX * cfg.swayHeadAmount * 2;
        bones.head.rotation.z = rest.head.z - swayZ * cfg.swayHeadAmount * 1.5;
      }

      // Micro-movements: pick new target periodically, lerp smoothly (never snap)
      if (t - state.lastMicroUpdate > 1 / cfg.microSpeed) {
        state.microTarget.set(
          (Math.random() - 0.5) * 2 * cfg.microAmount,
          (Math.random() - 0.5) * 2 * cfg.microAmount,
          (Math.random() - 0.5) * 2 * cfg.microAmount
        );
        state.lastMicroUpdate = t;
      }

      // Smooth lerp toward micro target — never jumps
      state.microCurrent.lerp(state.microTarget, cfg.microLerpRate);

      if (bones.head && rest.head) {
        bones.head.rotation.x += state.microCurrent.x;
        bones.head.rotation.y = rest.head.y + state.microCurrent.y;
        bones.head.rotation.z += state.microCurrent.z;
      }
    }

    // ========================================
    // Neck micro-adjustment
    // ========================================
    if (bones.neck && rest.neck) {
      // Very subtle neck compensation — opposite of head micro for natural look
      const neckComp = Math.sin(t * 0.13) * 0.003;
      bones.neck.rotation.z = rest.neck.z + neckComp;
    }

    // ========================================
    // Eye Blinking (speech-aware timing)
    // ========================================
    // Speech-aware: blink less during active speech, more at phrase boundaries.
    // People naturally suppress blinks mid-sentence and blink at pauses/transitions.

    const speaking = !!isSpeaking;

    // Detect speech→pause transition: queue a blink soon (phrase boundary effect)
    if (state.wasSpeaking && !speaking && !state.isBlinking) {
      const boundaryDelay = 0.2 + Math.random() * 0.5; // 200-700ms after speech stops
      if (state.nextBlinkTime > t + boundaryDelay) {
        state.nextBlinkTime = t + boundaryDelay;
      }
    }
    state.wasSpeaking = speaking;

    // Check if it's time to blink
    if (!state.isBlinking && t >= state.nextBlinkTime) {
      state.isBlinking = true;
      state.blinkStartTime = t;
      state.blinkCount++;
      log.debug(`[IdleAnimation] Blink #${state.blinkCount} started (speaking=${speaking})`);
    }

    // Calculate blink value
    let blinkValue = 0;
    if (state.isBlinking) {
      const blinkProgress = (t - state.blinkStartTime) / cfg.blinkDuration;

      if (blinkProgress >= 1) {
        // End blink
        state.isBlinking = false;
        blinkValue = 0;

        // Double-blink: 20% chance of a quick follow-up blink
        if (!state.doubleBlinkPending && Math.random() < BLINK.doubleBlinkChance) {
          state.doubleBlinkPending = true;
          state.nextBlinkTime = t + BLINK.doubleBlinkDelay;
          log.debug(`[IdleAnimation] Double-blink queued`);
        } else {
          state.doubleBlinkPending = false;

          // Speech-aware interval scheduling:
          let baseInterval = cfg.blinkIntervalMin +
            Math.random() * (cfg.blinkIntervalMax - cfg.blinkIntervalMin);

          if (speaking) {
            // During speech: stretch intervals 1.5-2x (suppress blinks mid-sentence)
            baseInterval *= 1.5 + Math.random() * 0.5;
          }

          // 10% chance of a long pause (8-10s) for natural variety
          if (Math.random() < 0.1) {
            baseInterval = 8 + Math.random() * 2;
          }

          state.nextBlinkTime = t + baseInterval;
          log.debug(`[IdleAnimation] Next blink in ${baseInterval.toFixed(1)}s (speaking=${speaking})`);
        }
      } else {
        // Blink curve: quick close (easeIn), slightly slower open (easeOut)
        if (blinkProgress < 0.35) {
          // Fast close with ease-in
          const closePhase = blinkProgress / 0.35;
          blinkValue = closePhase * closePhase; // quadratic ease-in
        } else {
          // Slower open with ease-out
          const openPhase = (blinkProgress - 0.35) / 0.65;
          blinkValue = 1 - openPhase * (2 - openPhase); // quadratic ease-out
        }
        blinkValue = Math.max(0, Math.min(1, blinkValue));
      }
    }

    // Apply blink via FACS morph controller (primary path)
    const morphCtrl = morphControllerRef.current;
    if (morphCtrl) {
      if (morphCtrl.hasMorph('eyeBlinkLeft') && morphCtrl.hasMorph('eyeBlinkRight')) {
        morphCtrl.setMorph('eyeBlinkLeft', blinkValue);
        morphCtrl.setMorph('eyeBlinkRight', blinkValue);
      }
    }

    // Fallback: legacy morph target
    if (!morphCtrl && morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] = blinkValue;
    }

    // Fallback: eyelid bones (only when no morph controller)
    const eyelids = eyelidBonesRef.current;
    const eyelidCloseAmount = 0.5;

    if (!morphCtrl && blinkValue > 0.01) {
      if (eyelids.topL) eyelids.topL.rotation.x += blinkValue * eyelidCloseAmount;
      if (eyelids.topR) eyelids.topR.rotation.x += blinkValue * eyelidCloseAmount;
      if (eyelids.botL) eyelids.botL.rotation.x -= blinkValue * eyelidCloseAmount * 0.3;
      if (eyelids.botR) eyelids.botR.rotation.x -= blinkValue * eyelidCloseAmount * 0.3;
    }

    // ========================================
    // Periodic Debug Logging (every 10 seconds)
    // ========================================
    if (t - state.debugLogTime >= 10.0) {
      state.debugLogTime = t;
      log.debug(`[IdleAnimation] t=${t.toFixed(1)}s blinks=${state.blinkCount} breath=${breathIn.toFixed(2)} weight=${ws.toFixed(2)}`);
    }
  }, []);

  // ============================================================================
  // Get Blink Value (for external use)
  // ============================================================================

  const getBlinkValue = useCallback((): number => {
    if (!morphRef.current || !morphRef.current.mesh.morphTargetInfluences) {
      return 0;
    }
    return morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] || 0;
  }, []);

  // ============================================================================
  // Reset
  // ============================================================================

  const reset = useCallback(() => {
    log.info('[IdleAnimation] Resetting animation state');

    const bones = bonesRef.current;
    const rest = restPosesRef.current;

    for (const [key, bone] of Object.entries(bones)) {
      if (bone && rest[key]) {
        bone.rotation.copy(rest[key]);
      }
    }

    if (morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] = 0;
    }

    stateRef.current = {
      time: 0,
      nextBlinkTime: Math.random() * 3 + 2,
      isBlinking: false,
      blinkStartTime: 0,
      doubleBlinkPending: false,
      wasSpeaking: false,
      microTarget: new THREE.Vector3(),
      microCurrent: new THREE.Vector3(),
      lastMicroUpdate: 0,
      weightShiftTarget: 0,
      weightShiftCurrent: 0,
      nextWeightShiftTime: 5 + Math.random() * 5,
      debugLogTime: 0,
      blinkCount: 0,
    };
  }, []);

  // ============================================================================
  // Set Config
  // ============================================================================

  const setConfig = useCallback((config: Partial<IdleAnimationConfig>) => {
    configRef.current = { ...configRef.current, ...config };
  }, []);

  // Set the FACS morph controller
  const setMorphController = useCallback((controller: FacsMorphController) => {
    morphControllerRef.current = controller;
    const hasBlink = controller.hasMorph('eyeBlinkLeft') && controller.hasMorph('eyeBlinkRight');
    log.info(`[IdleAnimation] FACS morph controller set (${controller.morphCount} morphs, blink=${hasBlink ? 'yes' : 'no'})`);
  }, []);

  return {
    initialize,
    update,
    getBlinkValue,
    reset,
    setConfig,
    setMorphController,
  };
}
