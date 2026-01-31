/**
 * ============================================================================
 * useIdleAnimation - Always-On Subtle Movement System
 * ============================================================================
 * Provides procedural idle animations that layer together:
 *   - Breathing: subtle chest/spine expansion
 *   - Body sway: gentle weight shifting
 *   - Micro-movements: tiny random variations
 *   - Eye blinks: random interval blinking
 *
 * All animations are additive and designed to layer with other systems.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { stripMorphPrefix } from '../utils/glbInspector';
import { log } from '../utils/log';

// ============================================================================
// Configuration
// ============================================================================

export interface IdleAnimationConfig {
  // Breathing
  breathSpeed: number;          // Breathing cycle speed
  breathSpineAmount: number;    // Spine movement amplitude
  breathChestAmount: number;    // Chest expansion amplitude
  breathShoulderAmount: number; // Shoulder rise amplitude

  // Body sway
  swaySpeed: number;            // Sway oscillation speed
  swayHipAmount: number;        // Hip sway amplitude
  swaySpineAmount: number;      // Spine sway amplitude
  swayHeadAmount: number;       // Head sway amplitude

  // Micro-movements
  microSpeed: number;           // Random movement update speed
  microAmount: number;          // Random movement amplitude

  // Blinking
  blinkIntervalMin: number;     // Min seconds between blinks
  blinkIntervalMax: number;     // Max seconds between blinks
  blinkDuration: number;        // Duration of blink in seconds
}

const DEFAULT_CONFIG: IdleAnimationConfig = {
  // Breathing - subtle but visible
  breathSpeed: 0.35,            // slower = more natural breathing rhythm
  breathSpineAmount: 0.02,      // ~1.1 degrees - subtle spine
  breathChestAmount: 0.03,      // ~1.7 degrees - natural chest rise
  breathShoulderAmount: 0.01,   // subtle shoulder rise

  // Body sway - gentle weight shifting
  swaySpeed: 0.18,
  swayHipAmount: 0.01,          // subtle hip sway
  swaySpineAmount: 0.015,       // gentle spine sway
  swayHeadAmount: 0.015,        // slight head movement

  // Micro-movements - small random variations for life-like feel
  microSpeed: 1.5,
  microAmount: 0.004,           // subtle micro-movements

  // Blinking - natural human blink rate
  blinkIntervalMin: 2.0,
  blinkIntervalMax: 6.0,
  blinkDuration: 0.15,
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
  hips?: THREE.Bone;
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
  nextBlinkTime: number;
  isBlinking: boolean;
  blinkStartTime: number;
  microNoise: THREE.Vector3;
  lastMicroUpdate: number;
  // Debug tracking
  debugLogTime: number;
  blinkCount: number;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseIdleAnimationReturn {
  /** Initialize with loaded scene */
  initialize: (scene: THREE.Object3D) => void;
  /** Update animations (call in useFrame). Pass isSpeaking to yield head/shoulder authority to talking animation. */
  update: (delta: number, isSpeaking?: boolean) => void;
  /** Get current blink value (0-1) for external use */
  getBlinkValue: () => number;
  /** Reset animation state */
  reset: () => void;
  /** Update configuration */
  setConfig: (config: Partial<IdleAnimationConfig>) => void;
}

// ============================================================================
// Bone Name Patterns
// ============================================================================

const BONE_PATTERNS: Record<keyof BoneRefs, RegExp[]> = {
  // Victoria 9 / Genesis 9 skeleton uses: spine1, spine2, spine3, spine4
  spine: [/^spine1$/i, /^spine$/i, /^Spine$/],
  spine1: [/^spine2$/i, /^spine[._]?1$/i, /^Spine1$/i],
  spine2: [/^spine3$/i, /^spine[._]?2$/i, /^Spine2$/i],
  chest: [/^spine4$/i, /^chest$/i, /^Chest$/i, /^chestUpper$/i, /^chestLower$/i],
  // Victoria 9 uses: neck1, neck2
  neck: [/^neck1$/i, /^neck2$/i, /^neck$/i, /^Neck$/i, /^neckLower$/i, /^neckUpper$/i],
  head: [/^head$/i, /^Head$/],
  // Victoria 9 uses: l_shoulder, r_shoulder
  shoulderL: [/^l_shoulder$/i, /^lCollar$/i, /^Left[_]?shoulder$/i, /^shoulder[_]?l$/i],
  shoulderR: [/^r_shoulder$/i, /^rCollar$/i, /^Right[_]?shoulder$/i, /^shoulder[_]?r$/i],
  // Victoria 9 uses: l_upperarm, r_upperarm
  upperArmL: [/^l_upperarm$/i, /^lShldrBend$/i, /^Left[_]?arm$/i, /^upperarm[_]?l$/i],
  upperArmR: [/^r_upperarm$/i, /^rShldrBend$/i, /^Right[_]?arm$/i, /^upperarm[_]?r$/i],
  // Victoria 9 uses: pelvis, hip
  hips: [/^pelvis$/i, /^hip$/i, /^hips$/i, /^Hips$/i],
};

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

  const stateRef = useRef<IdleAnimationState>({
    time: 0,
    nextBlinkTime: Math.random() * 3 + 2,
    isBlinking: false,
    blinkStartTime: 0,
    microNoise: new THREE.Vector3(),
    lastMicroUpdate: 0,
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
        // Store rest pose
        restPosesRef.current[key] = bone.rotation.clone();
        foundBones.push(`${key} -> "${bone.name}"`);
      } else {
        missingBones.push(key);
      }
    }
    bonesRef.current = bones;

    // Log found bones
    if (foundBones.length > 0) {
      log.info(`[IdleAnimation] Found ${foundBones.length} bones:`);
      foundBones.forEach(b => log.debug(`[IdleAnimation]   ✓ ${b}`));
    }
    if (missingBones.length > 0) {
      log.warn(`[IdleAnimation] Missing ${missingBones.length} bones: ${missingBones.join(', ')}`);
    }

    // Find morph target for blinking (Eyes_closed)
    let allMorphTargets: string[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        const dict = child.morphTargetDictionary;
        if (dict) {
          // Collect all morph target names for logging
          allMorphTargets = allMorphTargets.concat(Object.keys(dict));

          // Look for eyes closed morph target
          // Patterns include Genesis 9 / Victoria 9 FACS naming
          if (!morphRef.current) {
            const eyesClosedPatterns = [
              /^Eyes[_]?closed$/i,
              /^eyesClosed$/i,
              /^blink$/i,
              // Genesis 9 / Victoria 9 FACS patterns
              /facs_bs_EyeBlinkL$/i,
              /facs_bs_EyeBlinkR$/i,
              /facs_bs_EyeBlink_L$/i,
              /facs_bs_EyeBlink_R$/i,
              /eCTRLEyesClosedL$/i,
              /eCTRLEyesClosedR$/i,
              /eCTRLEyesClosed$/i,
              /facs_ctrl_EyesClosed$/i,
            ];
            for (const [name, index] of Object.entries(dict)) {
              // Test both original name and prefix-stripped name
              const cleanName = stripMorphPrefix(name);
              for (const pattern of eyesClosedPatterns) {
                if (pattern.test(name) || pattern.test(cleanName)) {
                  morphRef.current = {
                    mesh: child,
                    eyesClosedIndex: index as number,
                  };
                  log.info(`[IdleAnimation] ✓ Found blink morph: "${name}" (index ${index}) on mesh "${child.name}"`);
                  return;
                }
              }
            }
          }
        }
      }
    });

    if (!morphRef.current) {
      log.warn('[IdleAnimation] ✗ No blink morph target found');
      log.debug(`[IdleAnimation] Available morphs: ${allMorphTargets.slice(0, 20).join(', ')}${allMorphTargets.length > 20 ? '...' : ''}`);
    } else {
      // IMPORTANT: Initialize eyes to OPEN state (morph = 0)
      // Some models have non-zero default for Eyes_closed morph
      if (morphRef.current.mesh.morphTargetInfluences) {
        const currentValue = morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex];
        log.info(`[IdleAnimation] 👁️ Eyes_closed morph initial value: ${currentValue} - setting to 0 (open)`);
        morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] = 0;
      }
    }

    // Find eyelid bones - Victoria 9 uses: l_eyelidupper, l_eyelidlower, r_eyelidupper, r_eyelidlower
    const eyelidPatterns = {
      topL: [/^l_eyelidupper$/i, /^Eyelid[_]?Top[_]?l$/i, /^eyelidTopL$/i, /^lEyelidUpper$/i],
      topR: [/^r_eyelidupper$/i, /^Eyelid[_]?Top[_]?r$/i, /^eyelidTopR$/i, /^rEyelidUpper$/i],
      botL: [/^l_eyelidlower$/i, /^Eyelid[_]?Bot[_]?l$/i, /^eyelidBotL$/i, /^lEyelidLower$/i],
      botR: [/^r_eyelidlower$/i, /^Eyelid[_]?Bot[_]?r$/i, /^eyelidBotR$/i, /^rEyelidLower$/i],
    };

    const eyelids: EyelidBones = {};
    for (const [key, patterns] of Object.entries(eyelidPatterns)) {
      const bone = findBone(scene, patterns);
      if (bone) {
        eyelids[key as keyof EyelidBones] = bone;
        eyelidRestRef.current[key as keyof EyelidRestPoses] = bone.rotation.clone();
        log.debug(`[IdleAnimation] 👁️ Found eyelid bone: ${key} -> "${bone.name}"`);
      }
    }
    eyelidBonesRef.current = eyelids;

    if (Object.keys(eyelids).length > 0) {
      log.info(`[IdleAnimation] Found ${Object.keys(eyelids).length} eyelid bones for blink animation`);

      // Log raw rest poses for diagnostics
      const topLRest = eyelidRestRef.current.topL;
      const topRRest = eyelidRestRef.current.topR;
      const botLRest = eyelidRestRef.current.botL;
      const botRRest = eyelidRestRef.current.botR;
      if (topLRest) log.info(`[IdleAnimation] Raw eyelid rest - topL x=${topLRest.x.toFixed(4)}`);
      if (topRRest) log.info(`[IdleAnimation] Raw eyelid rest - topR x=${topRRest.x.toFixed(4)}`);
      if (botLRest) log.info(`[IdleAnimation] Raw eyelid rest - botL x=${botLRest.x.toFixed(4)}`);
      if (botRRest) log.info(`[IdleAnimation] Raw eyelid rest - botR x=${botRRest.x.toFixed(4)}`);

      // Normalize eyelid rest poses - Genesis 9 models often have asymmetric
      // eyelid rest rotations, causing one eye to appear more open than the other.
      // Average left/right to ensure symmetric blinks.
      if (topLRest && topRRest) {
        const avgTopX = (topLRest.x + topRRest.x) / 2;
        topLRest.x = avgTopX;
        topRRest.x = avgTopX;
        log.info(`[IdleAnimation] Normalized upper eyelid rest X to ${avgTopX.toFixed(4)}`);
      }
      if (botLRest && botRRest) {
        const avgBotX = (botLRest.x + botRRest.x) / 2;
        botLRest.x = avgBotX;
        botRRest.x = avgBotX;
        log.info(`[IdleAnimation] Normalized lower eyelid rest X to ${avgBotX.toFixed(4)}`);
      }
    }

    log.info(`[IdleAnimation] Ready: ${Object.keys(bones).length} bones, blink: ${morphRef.current ? 'yes' : 'no'}`);
    initializedRef.current = true;
  }, [findBone]);

  // ============================================================================
  // Update (call every frame)
  // ============================================================================

  const update = useCallback((delta: number, isSpeaking?: boolean) => {
    if (!initializedRef.current) return;

    const config = configRef.current;
    const bones = bonesRef.current;
    const rest = restPosesRef.current;
    const state = stateRef.current;

    state.time += delta;
    const t = state.time;

    // ========================================
    // Breathing Animation
    // ========================================
    const breathCycle = Math.sin(t * config.breathSpeed * Math.PI * 2);
    const breathIn = (breathCycle + 1) * 0.5; // 0-1 range

    if (bones.spine && rest.spine) {
      bones.spine.rotation.x = rest.spine.x - breathIn * config.breathSpineAmount;
    }

    if (bones.chest && rest.chest) {
      bones.chest.rotation.x = rest.chest.x - breathIn * config.breathChestAmount;
    }

    // Shoulder breathing yields to talking animation during speech
    if (!isSpeaking) {
      if (bones.shoulderL && rest.shoulderL) {
        bones.shoulderL.rotation.z = rest.shoulderL.z + breathIn * config.breathShoulderAmount;
      }
      if (bones.shoulderR && rest.shoulderR) {
        bones.shoulderR.rotation.z = rest.shoulderR.z - breathIn * config.breathShoulderAmount;
      }
    }

    // ========================================
    // Body Sway Animation
    // ========================================
    const swayX = Math.sin(t * config.swaySpeed * Math.PI * 2) * config.swaySpineAmount;
    const swayZ = Math.cos(t * config.swaySpeed * 0.7 * Math.PI * 2) * config.swaySpineAmount * 0.5;

    if (bones.hips && rest.hips) {
      bones.hips.rotation.x = rest.hips.x + swayX * config.swayHipAmount * 5;
      bones.hips.rotation.z = rest.hips.z + swayZ * config.swayHipAmount * 5;
    }

    if (bones.spine && rest.spine) {
      bones.spine.rotation.z = rest.spine.z + swayZ;
    }

    // Head sway and micro-movements yield to talking animation during speech
    if (!isSpeaking) {
      if (bones.head && rest.head) {
        // Head counter-sway (looks more natural)
        bones.head.rotation.x = rest.head.x - swayX * config.swayHeadAmount * 3;
        bones.head.rotation.z = rest.head.z - swayZ * config.swayHeadAmount * 2;
      }

      // Micro-Movements (random tiny variations)
      if (t - state.lastMicroUpdate > 1 / config.microSpeed) {
        state.microNoise.set(
          (Math.random() - 0.5) * 2 * config.microAmount,
          (Math.random() - 0.5) * 2 * config.microAmount,
          (Math.random() - 0.5) * 2 * config.microAmount
        );
        state.lastMicroUpdate = t;
      }

      if (bones.head && rest.head) {
        // x and z were set absolutely by sway above, so += is safe for micro offset.
        // y is never set by sway, so use absolute assignment to prevent drift.
        bones.head.rotation.x += state.microNoise.x;
        bones.head.rotation.y = rest.head.y + state.microNoise.y;
        bones.head.rotation.z += state.microNoise.z;
      }
    }

    // ========================================
    // Eye Blinking (morph target + eyelid bones)
    // ========================================

    // Check if it's time to blink
    if (!state.isBlinking && t >= state.nextBlinkTime) {
      state.isBlinking = true;
      state.blinkStartTime = t;
      state.blinkCount++;
      log.debug(`[IdleAnimation] 👁️ Blink #${state.blinkCount} started`);
    }

    // Calculate blink value
    let blinkValue = 0;
    if (state.isBlinking) {
      const blinkProgress = (t - state.blinkStartTime) / config.blinkDuration;

      if (blinkProgress >= 1) {
        // End blink
        state.isBlinking = false;
        blinkValue = 0;
        // Schedule next blink
        const nextInterval = config.blinkIntervalMin +
          Math.random() * (config.blinkIntervalMax - config.blinkIntervalMin);
        state.nextBlinkTime = t + nextInterval;
        log.debug(`[IdleAnimation] 👁️ Blink complete, next in ${nextInterval.toFixed(1)}s`);
      } else {
        // Blink curve: quick close, slightly slower open
        blinkValue = blinkProgress < 0.4
          ? blinkProgress / 0.4  // Fast close
          : 1 - (blinkProgress - 0.4) / 0.6;  // Slower open
        blinkValue = Math.max(0, Math.min(1, blinkValue));
      }
    }

    // Apply blink to morph target
    if (morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      const morphInfluences = morphRef.current.mesh.morphTargetInfluences;
      const idx = morphRef.current.eyesClosedIndex;
      morphInfluences[idx] = blinkValue;

      // Debug: Log eye morph value occasionally
      if (Math.floor(t) % 10 === 0 && Math.floor(t) !== Math.floor(t - delta)) {
        log.debug(`[IdleAnimation] 👁️ Eyes morph value: ${morphInfluences[idx].toFixed(3)}, isBlinking: ${state.isBlinking}`);
      }
    }

    // Apply blink to eyelid bones (for models that use bone-based eyelids)
    // Additive: preserves eyelid offsets set by expressionSystem (eye widen/squint)
    const eyelids = eyelidBonesRef.current;
    const eyelidCloseAmount = 0.5; // Radians to rotate eyelids when closing

    if (blinkValue > 0.01) {
      if (eyelids.topL) {
        eyelids.topL.rotation.x += blinkValue * eyelidCloseAmount;
      }
      if (eyelids.topR) {
        eyelids.topR.rotation.x += blinkValue * eyelidCloseAmount;
      }
      if (eyelids.botL) {
        eyelids.botL.rotation.x -= blinkValue * eyelidCloseAmount * 0.3;
      }
      if (eyelids.botR) {
        eyelids.botR.rotation.x -= blinkValue * eyelidCloseAmount * 0.3;
      }
    }

    // ========================================
    // Periodic Debug Logging (every 5 seconds)
    // ========================================
    if (t - state.debugLogTime >= 5.0) {
      state.debugLogTime = t;
      log.debug(`[IdleAnimation] time=${t.toFixed(1)}s, blinks=${state.blinkCount}, breath=${breathIn.toFixed(2)}`);
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

    // Reset all bones to rest pose
    for (const [key, bone] of Object.entries(bones)) {
      if (bone && rest[key]) {
        bone.rotation.copy(rest[key]);
      }
    }

    // Reset morph targets
    if (morphRef.current && morphRef.current.mesh.morphTargetInfluences) {
      morphRef.current.mesh.morphTargetInfluences[morphRef.current.eyesClosedIndex] = 0;
    }

    // Reset state
    stateRef.current = {
      time: 0,
      nextBlinkTime: Math.random() * 3 + 2,
      isBlinking: false,
      blinkStartTime: 0,
      microNoise: new THREE.Vector3(),
      lastMicroUpdate: 0,
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

  return {
    initialize,
    update,
    getBlinkValue,
    reset,
    setConfig,
  };
}
