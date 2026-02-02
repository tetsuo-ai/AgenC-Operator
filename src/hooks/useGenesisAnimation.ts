/**
 * ============================================================================
 * useGenesisAnimation - Unified Animation System for Genesis 9
 * ============================================================================
 * Single hook that handles ALL avatar animations:
 *   - Breathing (spine chain)
 *   - Blinking (eyelid bones)
 *   - Talking (head movement, jaw)
 *   - Expressions (via rig API)
 *
 * Uses DIRECT bone name matching for Genesis 9 - no regex patterns.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { log } from '../utils/log';
import { MODEL_CONFIG } from '../config/modelConfig';
import { POSE_PRESETS } from '../config/posePresets';

// ============================================================================
// Configuration
// ============================================================================

export interface GenesisAnimationConfig {
  // Breathing
  breathSpeed: number;
  breathAmount: number;

  // Blinking
  blinkIntervalMin: number;
  blinkIntervalMax: number;
  blinkDuration: number;

  // Talking
  headNodAmount: number;
  jawOpenAmount: number;

  // Enable flags (allow disabling subsystems when handled by other hooks)
  enableBreathing: boolean;
  enableBlinking: boolean;
  enableHeadNod: boolean;

  // T-pose correction: set false if model already has a custom pose from Blender
  enableTPoseCorrection: boolean;
}

const DEFAULT_CONFIG: GenesisAnimationConfig = {
  breathSpeed: 0.6,
  breathAmount: 0.02,
  blinkIntervalMin: 2.5,
  blinkIntervalMax: 5.0,
  blinkDuration: 0.15,
  headNodAmount: 0.015,
  jawOpenAmount: 0.5,
  enableBreathing: true,
  enableBlinking: true,
  enableHeadNod: true,
  enableTPoseCorrection: true,
};

// ============================================================================
// Bone Patterns (sourced from shared modelConfig)
// ============================================================================

const sk = MODEL_CONFIG.skeleton;
const BONE_PATTERNS: Record<keyof BoneRefs, RegExp[]> = {
  // Spine chain (bottom to top) - indexed from modelConfig spine array
  pelvis: [sk.spine[0]],     // /^pelvis$/i
  spine1: [sk.spine[1]],     // /^spine1$/i
  spine2: [sk.spine[2]],     // /^spine2$/i
  spine3: [sk.spine[3]],     // /^spine3$/i
  spine4: [sk.spine[4]],     // /^spine4$/i (chest)

  // Head/Neck
  neck1: [sk.neck[0]],       // /^neck1$/i
  neck2: [sk.neck[1]],       // /^neck2$/i
  head: sk.head,

  // Jaw
  jaw: sk.jaw,

  // Eyes
  eyeL: sk.eyes.left,
  eyeR: sk.eyes.right,

  // Eyelids
  eyelidUpperL: sk.eyelids.upperL,
  eyelidUpperR: sk.eyelids.upperR,
  eyelidLowerL: sk.eyelids.lowerL,
  eyelidLowerR: sk.eyelids.lowerR,

  // Shoulders
  shoulderL: sk.shoulders.left,
  shoulderR: sk.shoulders.right,

  // Upper arms
  upperArmL: sk.upperArms.left,
  upperArmR: sk.upperArms.right,

  // Forearms
  foreArmL: sk.forearms.left,
  foreArmR: sk.forearms.right,
};

// ============================================================================
// Types
// ============================================================================

interface BoneRefs {
  pelvis: THREE.Bone | null;
  spine1: THREE.Bone | null;
  spine2: THREE.Bone | null;
  spine3: THREE.Bone | null;
  spine4: THREE.Bone | null;
  neck1: THREE.Bone | null;
  neck2: THREE.Bone | null;
  head: THREE.Bone | null;
  jaw: THREE.Bone | null;
  eyeL: THREE.Bone | null;
  eyeR: THREE.Bone | null;
  eyelidUpperL: THREE.Bone | null;
  eyelidUpperR: THREE.Bone | null;
  eyelidLowerL: THREE.Bone | null;
  eyelidLowerR: THREE.Bone | null;
  shoulderL: THREE.Bone | null;
  shoulderR: THREE.Bone | null;
  upperArmL: THREE.Bone | null;
  upperArmR: THREE.Bone | null;
  foreArmL: THREE.Bone | null;
  foreArmR: THREE.Bone | null;
}

interface RestPoses {
  [boneName: string]: THREE.Euler;
}

interface AnimationState {
  time: number;
  nextBlinkTime: number;
  isBlinking: boolean;
  blinkStartTime: number;
  blinkValue: number;
  lastLogTime: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useGenesisAnimation(
  initialConfig: Partial<GenesisAnimationConfig> = {}
) {
  const configRef = useRef<GenesisAnimationConfig>({
    ...DEFAULT_CONFIG,
    ...initialConfig,
  });

  const bonesRef = useRef<BoneRefs>({
    pelvis: null,
    spine1: null,
    spine2: null,
    spine3: null,
    spine4: null,
    neck1: null,
    neck2: null,
    head: null,
    jaw: null,
    eyeL: null,
    eyeR: null,
    eyelidUpperL: null,
    eyelidUpperR: null,
    eyelidLowerL: null,
    eyelidLowerR: null,
    shoulderL: null,
    shoulderR: null,
    upperArmL: null,
    upperArmR: null,
    foreArmL: null,
    foreArmR: null,
  });

  const restPosesRef = useRef<RestPoses>({});
  const initializedRef = useRef(false);

  const stateRef = useRef<AnimationState>({
    time: 0,
    nextBlinkTime: Math.random() * 3 + 2,
    isBlinking: false,
    blinkStartTime: 0,
    blinkValue: 0,
    lastLogTime: 0,
  });

  // ==========================================================================
  // Initialize - Find bones by EXACT name
  // ==========================================================================

  const initialize = useCallback((scene: THREE.Object3D) => {
    if (initializedRef.current) return;

    log.info('[GenesisAnimation] ========================================');
    log.info('[GenesisAnimation] INITIALIZING GENESIS 9 ANIMATION SYSTEM');
    log.info('[GenesisAnimation] ========================================');

    const found: string[] = [];
    const missing: string[] = [];

    // Traverse scene and find bones by pattern matching
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Bone)) return;

      // Check each bone slot against shared modelConfig patterns
      for (const [slot, patterns] of Object.entries(BONE_PATTERNS)) {
        if (bonesRef.current[slot as keyof BoneRefs] !== null) continue;
        for (const pattern of patterns as RegExp[]) {
          if (pattern.test(obj.name)) {
            bonesRef.current[slot as keyof BoneRefs] = obj;
            restPosesRef.current[slot] = obj.rotation.clone();
            found.push(`${slot} -> "${obj.name}"`);
            break;
          }
        }
      }
    });

    // Check what's missing
    for (const slot of Object.keys(BONE_PATTERNS)) {
      if (bonesRef.current[slot as keyof BoneRefs] === null) {
        missing.push(slot);
      }
    }

    log.info(`[GenesisAnimation] Found ${found.length} bones:`);
    found.forEach((b) => log.info(`  + ${b}`));

    if (missing.length > 0) {
      log.warn(`[GenesisAnimation] Missing ${missing.length} bones: ${missing.join(', ')}`);
    }

    // ========================================================================
    // ARM CORRECTIVE POSE: T-pose -> Natural Arms-Down
    // ========================================================================
    // Genesis 9 models often have a T-pose bind pose. Apply corrective
    // rotations to bring arms to a natural resting position.
    // Disable with enableTPoseCorrection: false if model has custom Blender pose.
    // ========================================================================

    const bones = bonesRef.current;
    const cfg = configRef.current;
    const armL = bones.upperArmL;
    const armR = bones.upperArmR;

    if (armL && armR) {
      log.info(`[GenesisAnimation] Arm rotations - L: x=${armL.rotation.x.toFixed(3)} y=${armL.rotation.y.toFixed(3)} z=${armL.rotation.z.toFixed(3)}`);
      log.info(`[GenesisAnimation] Arm rotations - R: x=${armR.rotation.x.toFixed(3)} y=${armR.rotation.y.toFixed(3)} z=${armR.rotation.z.toFixed(3)}`);

      if (cfg.enableTPoseCorrection) {
        // Check if arms appear to be in T-pose (Z rotation near 0 = arms horizontal)
        const armAngleThreshold = 0.3; // ~17 degrees
        const leftArmZAbs = Math.abs(armL.rotation.z);
        const rightArmZAbs = Math.abs(armR.rotation.z);

        if (leftArmZAbs < armAngleThreshold && rightArmZAbs < armAngleThreshold) {
          log.info('[GenesisAnimation] T-pose detected! Applying arm correction...');

          // Rotate upper arms down 90 degrees (π/2 radians) - arms flat at sides
          const armDownAngle = Math.PI / 2;
          armL.rotation.z += armDownAngle;   // Left arm: positive Z = down
          armR.rotation.z -= armDownAngle;   // Right arm: negative Z = down

          // Re-capture corrected rotations as new rest poses
          restPosesRef.current.upperArmL = armL.rotation.clone();
          restPosesRef.current.upperArmR = armR.rotation.clone();

          log.info('[GenesisAnimation] Arm correction applied - arms flat at sides');
        } else {
          log.info('[GenesisAnimation] Arms not in T-pose - no correction needed');
        }
      } else {
        log.info('[GenesisAnimation] T-pose correction disabled - preserving Blender export pose');
      }
    } else {
      log.warn('[GenesisAnimation] Upper arm bones not found - cannot check arm pose');
    }

    // ========================================================================
    // IDLE POSE: Apply relaxed contrapposto offsets from posePresets
    // ========================================================================
    // Adds subtle rotation offsets for a natural standing pose.
    // Re-captures as new rest poses so downstream hooks inherit the relaxed base.
    // ========================================================================

    const idlePose = POSE_PRESETS.idle;
    if (Object.keys(idlePose.bones).length > 0) {
      log.info('[GenesisAnimation] Applying idle pose offsets...');
      let appliedCount = 0;

      for (const [boneName, offsets] of Object.entries(idlePose.bones)) {
        const bone = bones[boneName as keyof BoneRefs];
        if (!bone || !offsets) continue;

        if (offsets.x) bone.rotation.x += offsets.x;
        if (offsets.y) bone.rotation.y += offsets.y;
        if (offsets.z) bone.rotation.z += offsets.z;

        // Re-capture as new rest pose
        restPosesRef.current[boneName] = bone.rotation.clone();
        appliedCount++;
      }

      log.info(`[GenesisAnimation] Idle pose applied to ${appliedCount} bones`);
    }

    // ========================================================================
    // EYE CORRECTIVE POSE: Reset eyes to look forward
    // ========================================================================
    // DAZ/Genesis 9 exports often have eye bones rotated to odd positions.
    // Reset l_eye and r_eye to (0,0,0) so they look straight ahead.
    // ========================================================================

    // Capture eye bone rest rotation from the GLB (don't override)
    if (bones.eyeL) {
      restPosesRef.current.eyeL = bones.eyeL.rotation.clone();
    }
    if (bones.eyeR) {
      restPosesRef.current.eyeR = bones.eyeR.rotation.clone();
    }

    initializedRef.current = true;
    log.info('[GenesisAnimation] Initialization complete!');
  }, []);

  // ==========================================================================
  // Update - Called every frame
  // ==========================================================================

  const update = useCallback((
    delta: number,
    isSpeaking: boolean,
    mouthOpen: number = 0
  ) => {
    if (!initializedRef.current) return;

    const cfg = configRef.current;
    const state = stateRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;

    state.time += delta;

    // ========================================================================
    // BREATHING - Subtle spine/chest movement
    // ========================================================================

    let breathPhase = 0;
    if (cfg.enableBreathing) {
      const breathCycle = Math.sin(state.time * cfg.breathSpeed * Math.PI * 2);
      breathPhase = (breathCycle + 1) / 2; // 0 to 1

      // Spine chain breathing - progressive amounts
      if (bones.spine1 && rest.spine1) {
        bones.spine1.rotation.x = rest.spine1.x + breathPhase * cfg.breathAmount * 0.3;
      }
      if (bones.spine2 && rest.spine2) {
        bones.spine2.rotation.x = rest.spine2.x + breathPhase * cfg.breathAmount * 0.5;
      }
      if (bones.spine3 && rest.spine3) {
        bones.spine3.rotation.x = rest.spine3.x + breathPhase * cfg.breathAmount * 0.7;
      }
      if (bones.spine4 && rest.spine4) {
        // Chest - most movement
        bones.spine4.rotation.x = rest.spine4.x + breathPhase * cfg.breathAmount;
      }

      // Shoulders rise slightly on inhale
      if (bones.shoulderL && rest.shoulderL) {
        bones.shoulderL.rotation.z = rest.shoulderL.z - breathPhase * cfg.breathAmount * 0.3;
      }
      if (bones.shoulderR && rest.shoulderR) {
        bones.shoulderR.rotation.z = rest.shoulderR.z + breathPhase * cfg.breathAmount * 0.3;
      }
    }

    // ========================================================================
    // BLINKING - Eyelid bones
    // ========================================================================

    if (cfg.enableBlinking) {
      // Check if time for new blink
      if (!state.isBlinking && state.time >= state.nextBlinkTime) {
        state.isBlinking = true;
        state.blinkStartTime = state.time;
      }

      // Process blink
      if (state.isBlinking) {
        const blinkProgress = (state.time - state.blinkStartTime) / cfg.blinkDuration;

        if (blinkProgress >= 1) {
          // Blink complete
          state.isBlinking = false;
          state.blinkValue = 0;
          // Schedule next blink
          state.nextBlinkTime = state.time +
            cfg.blinkIntervalMin +
            Math.random() * (cfg.blinkIntervalMax - cfg.blinkIntervalMin);
        } else {
          // Smooth blink curve: fast close, slower open
          if (blinkProgress < 0.4) {
            // Closing (fast)
            state.blinkValue = blinkProgress / 0.4;
          } else {
            // Opening (slower)
            state.blinkValue = 1 - (blinkProgress - 0.4) / 0.6;
          }
        }
      }

      // Apply blink to eyelids (rotate down to close)
      const blinkRotation = state.blinkValue * 0.5; // ~28 degrees

      if (bones.eyelidUpperL && rest.eyelidUpperL) {
        bones.eyelidUpperL.rotation.x = rest.eyelidUpperL.x + blinkRotation;
      }
      if (bones.eyelidUpperR && rest.eyelidUpperR) {
        bones.eyelidUpperR.rotation.x = rest.eyelidUpperR.x + blinkRotation;
      }
      if (bones.eyelidLowerL && rest.eyelidLowerL) {
        bones.eyelidLowerL.rotation.x = rest.eyelidLowerL.x - blinkRotation * 0.3;
      }
      if (bones.eyelidLowerR && rest.eyelidLowerR) {
        bones.eyelidLowerR.rotation.x = rest.eyelidLowerR.x - blinkRotation * 0.3;
      }
    }

    // ========================================================================
    // TALKING - Head nod and jaw
    // ========================================================================

    if (cfg.enableHeadNod) {
      if (isSpeaking) {
        // Subtle head nod while speaking
        const nodCycle = Math.sin(state.time * 3) * cfg.headNodAmount;
        if (bones.head && rest.head) {
          bones.head.rotation.x = rest.head.x + nodCycle;
        }
        if (bones.neck1 && rest.neck1) {
          bones.neck1.rotation.x = rest.neck1.x + nodCycle * 0.5;
        }
      } else {
        // Reset head to rest when not speaking
        if (bones.head && rest.head) {
          bones.head.rotation.x = THREE.MathUtils.lerp(
            bones.head.rotation.x,
            rest.head.x,
            delta * 3
          );
        }
        if (bones.neck1 && rest.neck1) {
          bones.neck1.rotation.x = THREE.MathUtils.lerp(
            bones.neck1.rotation.x,
            rest.neck1.x,
            delta * 3
          );
        }
      }
    }

    // Jaw - opens based on mouthOpen value (0-1)
    // Genesis 9 jaw: negative X rotation opens mouth
    // Skip when jawOpenAmount is 0 - another system (useMouthAnimation) drives the jaw
    if (cfg.jawOpenAmount > 0 && bones.jaw && rest.jaw) {
      const targetJaw = rest.jaw.x - mouthOpen * cfg.jawOpenAmount;
      bones.jaw.rotation.x = THREE.MathUtils.lerp(
        bones.jaw.rotation.x,
        targetJaw,
        delta * 15 // Fast response
      );
    }

    // Debug logging every 5 seconds
    if (state.time - state.lastLogTime > 5) {
      state.lastLogTime = state.time;
      log.debug(`[GenesisAnimation] Breath: ${breathPhase.toFixed(2)}, Blink: ${state.blinkValue.toFixed(2)}, Jaw: ${mouthOpen.toFixed(2)}`);
    }
  }, []);

  // ==========================================================================
  // Trigger blink manually
  // ==========================================================================

  const triggerBlink = useCallback(() => {
    const state = stateRef.current;
    if (!state.isBlinking) {
      state.isBlinking = true;
      state.blinkStartTime = state.time;
      log.info('[GenesisAnimation] Manual blink triggered');
    }
  }, []);

  // ==========================================================================
  // Get current blink value (for external use)
  // ==========================================================================

  const getBlinkValue = useCallback(() => {
    return stateRef.current.blinkValue;
  }, []);

  // ==========================================================================
  // Reset
  // ==========================================================================

  const reset = useCallback(() => {
    const bones = bonesRef.current;
    const rest = restPosesRef.current;

    // Reset all bones to rest pose
    for (const [slot, bone] of Object.entries(bones)) {
      if (bone && rest[slot]) {
        bone.rotation.copy(rest[slot]);
      }
    }

    stateRef.current = {
      time: 0,
      nextBlinkTime: Math.random() * 3 + 2,
      isBlinking: false,
      blinkStartTime: 0,
      blinkValue: 0,
      lastLogTime: 0,
    };

    log.info('[GenesisAnimation] Reset to rest pose');
  }, []);

  // ==========================================================================
  // Set config
  // ==========================================================================

  const setConfig = useCallback((config: Partial<GenesisAnimationConfig>) => {
    configRef.current = { ...configRef.current, ...config };
  }, []);

  return {
    initialize,
    update,
    triggerBlink,
    getBlinkValue,
    reset,
    setConfig,
  };
}

export default useGenesisAnimation;
