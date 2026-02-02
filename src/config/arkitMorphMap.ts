/**
 * ============================================================================
 * ARKit Morph Target Mapping - Apple ARKit to Genesis 9 FACS
 * ============================================================================
 * Maps Apple's 52 standard ARKit blendshape names to Genesis 9 / Victoria 9
 * FACS morph target patterns. Each ARKit shape maps to an array of regex
 * patterns tried in priority order.
 *
 * Usage:
 *   const available = discoverARKitMorphs(scene);
 *   // available.eyeBlinkLeft => { mesh, index } | undefined
 * ============================================================================
 */

import * as THREE from 'three';
import { stripMorphPrefix } from '../utils/glbInspector';

// ============================================================================
// ARKit → Genesis 9 FACS Pattern Map
// ============================================================================

/**
 * All 52 ARKit blendshape names mapped to Genesis 9 FACS regex patterns.
 * Patterns are tried in priority order (FACS controller → FACS blendshape → fallback).
 */
export const ARKIT_TO_FACS: Record<string, RegExp[]> = {
  // ── Eyes ──────────────────────────────────────────────────────────────────
  eyeBlinkLeft:     [/facs_ctrl_EyesClosedL$/i, /facs_bs_EyeBlinkL$/i, /facs_bs_EyeBlink_L$/i, /eCTRLEyesClosedL$/i, /eyeBlinkLeft$/i],
  eyeBlinkRight:    [/facs_ctrl_EyesClosedR$/i, /facs_bs_EyeBlinkR$/i, /facs_bs_EyeBlink_R$/i, /eCTRLEyesClosedR$/i, /eyeBlinkRight$/i],
  eyeLookDownLeft:  [/facs_bs_EyeLookDownL$/i, /facs_bs_EyeLookDown_L$/i, /eyeLookDownLeft$/i],
  eyeLookDownRight: [/facs_bs_EyeLookDownR$/i, /facs_bs_EyeLookDown_R$/i, /eyeLookDownRight$/i],
  eyeLookInLeft:    [/facs_bs_EyeLookInL$/i, /facs_bs_EyeLookIn_L$/i, /eyeLookInLeft$/i],
  eyeLookInRight:   [/facs_bs_EyeLookInR$/i, /facs_bs_EyeLookIn_R$/i, /eyeLookInRight$/i],
  eyeLookOutLeft:   [/facs_bs_EyeLookOutL$/i, /facs_bs_EyeLookOut_L$/i, /eyeLookOutLeft$/i],
  eyeLookOutRight:  [/facs_bs_EyeLookOutR$/i, /facs_bs_EyeLookOut_R$/i, /eyeLookOutRight$/i],
  eyeLookUpLeft:    [/facs_bs_EyeLookUpL$/i, /facs_bs_EyeLookUp_L$/i, /eyeLookUpLeft$/i],
  eyeLookUpRight:   [/facs_bs_EyeLookUpR$/i, /facs_bs_EyeLookUp_R$/i, /eyeLookUpRight$/i],
  eyeSquintLeft:    [/facs_bs_EyeSquintL$/i, /facs_bs_EyeSquint_L$/i, /eyeSquintLeft$/i, /cheekSquintL$/i],
  eyeSquintRight:   [/facs_bs_EyeSquintR$/i, /facs_bs_EyeSquint_R$/i, /eyeSquintRight$/i, /cheekSquintR$/i],
  eyeWideLeft:      [/facs_bs_EyeWideL$/i, /facs_bs_EyeWide_L$/i, /facs_ctrl_EyeWideL$/i, /eyeWideLeft$/i],
  eyeWideRight:     [/facs_bs_EyeWideR$/i, /facs_bs_EyeWide_R$/i, /facs_ctrl_EyeWideR$/i, /eyeWideRight$/i],

  // ── Jaw ───────────────────────────────────────────────────────────────────
  jawForward:  [/facs_bs_JawForward$/i, /facs_ctrl_JawForward$/i, /jawForward$/i],
  jawLeft:     [/facs_bs_JawLeft$/i, /facs_ctrl_JawLeft$/i, /jawLeft$/i],
  jawRight:    [/facs_bs_JawRight$/i, /facs_ctrl_JawRight$/i, /jawRight$/i],
  jawOpen:     [/facs_ctrl_JawOpen$/i, /facs_bs_JawOpen$/i, /facs_jnt_JawOpen$/i, /eCTRLJawOpen$/i, /jawOpen$/i],

  // ── Mouth ─────────────────────────────────────────────────────────────────
  mouthClose:          [/facs_bs_MouthClose$/i, /facs_ctrl_MouthClose$/i, /mouthClose$/i],
  mouthFunnel:         [/facs_bs_MouthFunnel$/i, /facs_ctrl_MouthFunnel$/i, /mouthFunnel$/i],
  mouthPucker:         [/facs_bs_MouthPucker$/i, /facs_ctrl_MouthPucker$/i, /mouthPucker$/i],
  mouthLeft:           [/facs_bs_MouthLeft$/i, /facs_ctrl_MouthLeft$/i, /mouthLeft$/i],
  mouthRight:          [/facs_bs_MouthRight$/i, /facs_ctrl_MouthRight$/i, /mouthRight$/i],
  mouthSmileLeft:      [/facs_bs_MouthSmileL$/i, /facs_bs_MouthSmile_L$/i, /facs_ctrl_SmileL$/i, /mouthSmileLeft$/i],
  mouthSmileRight:     [/facs_bs_MouthSmileR$/i, /facs_bs_MouthSmile_R$/i, /facs_ctrl_SmileR$/i, /mouthSmileRight$/i],
  mouthFrownLeft:      [/facs_bs_MouthFrownL$/i, /facs_bs_MouthFrown_L$/i, /facs_ctrl_FrownL$/i, /mouthFrownLeft$/i],
  mouthFrownRight:     [/facs_bs_MouthFrownR$/i, /facs_bs_MouthFrown_R$/i, /facs_ctrl_FrownR$/i, /mouthFrownRight$/i],
  mouthDimpleLeft:     [/facs_bs_MouthDimpleL$/i, /facs_bs_MouthDimple_L$/i, /mouthDimpleLeft$/i],
  mouthDimpleRight:    [/facs_bs_MouthDimpleR$/i, /facs_bs_MouthDimple_R$/i, /mouthDimpleRight$/i],
  mouthStretchLeft:    [/facs_bs_MouthStretchL$/i, /facs_bs_MouthStretch_L$/i, /mouthStretchLeft$/i],
  mouthStretchRight:   [/facs_bs_MouthStretchR$/i, /facs_bs_MouthStretch_R$/i, /mouthStretchRight$/i],
  mouthRollLower:      [/facs_bs_MouthRollLower$/i, /facs_ctrl_MouthRollLower$/i, /mouthRollLower$/i],
  mouthRollUpper:      [/facs_bs_MouthRollUpper$/i, /facs_ctrl_MouthRollUpper$/i, /mouthRollUpper$/i],
  mouthShrugLower:     [/facs_bs_MouthShrugLower$/i, /mouthShrugLower$/i],
  mouthShrugUpper:     [/facs_bs_MouthShrugUpper$/i, /mouthShrugUpper$/i],
  mouthPressLeft:      [/facs_bs_MouthPressL$/i, /facs_bs_MouthPress_L$/i, /mouthPressLeft$/i],
  mouthPressRight:     [/facs_bs_MouthPressR$/i, /facs_bs_MouthPress_R$/i, /mouthPressRight$/i],
  mouthLowerDownLeft:  [/facs_bs_MouthLowerDownL$/i, /facs_bs_MouthLowerDown_L$/i, /mouthLowerDownLeft$/i],
  mouthLowerDownRight: [/facs_bs_MouthLowerDownR$/i, /facs_bs_MouthLowerDown_R$/i, /mouthLowerDownRight$/i],
  mouthUpperUpLeft:    [/facs_bs_MouthUpperUpL$/i, /facs_bs_MouthUpperUp_L$/i, /mouthUpperUpLeft$/i],
  mouthUpperUpRight:   [/facs_bs_MouthUpperUpR$/i, /facs_bs_MouthUpperUp_R$/i, /mouthUpperUpRight$/i],

  // ── Brow ──────────────────────────────────────────────────────────────────
  browDownLeft:    [/facs_bs_BrowDownL$/i, /facs_bs_BrowDown_L$/i, /facs_ctrl_BrowDownL$/i, /browDownLeft$/i],
  browDownRight:   [/facs_bs_BrowDownR$/i, /facs_bs_BrowDown_R$/i, /facs_ctrl_BrowDownR$/i, /browDownRight$/i],
  browInnerUp:     [/facs_bs_BrowInnerUp$/i, /facs_ctrl_BrowInnerUp$/i, /browInnerUp$/i],
  browOuterUpLeft: [/facs_bs_BrowOuterUpL$/i, /facs_bs_BrowOuterUp_L$/i, /facs_ctrl_BrowOuterUpL$/i, /browOuterUpLeft$/i],
  browOuterUpRight:[/facs_bs_BrowOuterUpR$/i, /facs_bs_BrowOuterUp_R$/i, /facs_ctrl_BrowOuterUpR$/i, /browOuterUpRight$/i],

  // ── Cheek ─────────────────────────────────────────────────────────────────
  cheekPuff:        [/facs_bs_CheekPuff$/i, /facs_ctrl_CheekPuff$/i, /cheekPuff$/i],
  cheekSquintLeft:  [/facs_bs_CheekSquintL$/i, /facs_bs_CheekSquint_L$/i, /cheekSquintLeft$/i],
  cheekSquintRight: [/facs_bs_CheekSquintR$/i, /facs_bs_CheekSquint_R$/i, /cheekSquintRight$/i],

  // ── Nose ──────────────────────────────────────────────────────────────────
  noseSneerLeft:  [/facs_bs_NoseSneerL$/i, /facs_bs_NoseSneer_L$/i, /noseSneerLeft$/i],
  noseSneerRight: [/facs_bs_NoseSneerR$/i, /facs_bs_NoseSneer_R$/i, /noseSneerRight$/i],

  // ── Tongue ────────────────────────────────────────────────────────────────
  tongueOut: [/facs_bs_TongueOut$/i, /facs_ctrl_TongueOut$/i, /tongueOut$/i],
};

// ============================================================================
// Discovery Result
// ============================================================================

export interface ARKitMorphRef {
  mesh: THREE.SkinnedMesh | THREE.Mesh;
  index: number;
  morphName: string;
}

export type ARKitMorphMap = Partial<Record<string, ARKitMorphRef>>;

// ============================================================================
// Discovery Function
// ============================================================================

/**
 * Scans a loaded GLB scene and returns which ARKit blendshapes are available,
 * mapped to their mesh and morph target index.
 *
 * @param scene - Root Object3D from useGLTF or loaded GLTF scene
 * @returns Map of ARKit blendshape name → { mesh, index, morphName }
 */
export function discoverARKitMorphs(scene: THREE.Object3D): ARKitMorphMap {
  const result: ARKitMorphMap = {};

  // Collect all meshes with morph targets
  const meshes: Array<{ mesh: THREE.SkinnedMesh | THREE.Mesh; dict: Record<string, number> }> = [];
  scene.traverse((child) => {
    if (
      (child instanceof THREE.SkinnedMesh || child instanceof THREE.Mesh) &&
      child.morphTargetDictionary
    ) {
      meshes.push({ mesh: child, dict: child.morphTargetDictionary });
    }
  });

  if (meshes.length === 0) return result;

  // For each ARKit blendshape, try to find a matching morph target
  for (const [arkitName, patterns] of Object.entries(ARKIT_TO_FACS)) {
    for (const { mesh, dict } of meshes) {
      let found = false;
      for (const pattern of patterns) {
        for (const [morphName, index] of Object.entries(dict)) {
          const stripped = stripMorphPrefix(morphName);
          if (pattern.test(stripped)) {
            result[arkitName] = { mesh, index, morphName };
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
  }

  return result;
}

/**
 * Returns a summary of discovered ARKit morphs for logging.
 */
export function summarizeARKitMorphs(morphMap: ARKitMorphMap): string {
  const found = Object.keys(morphMap);
  const total = Object.keys(ARKIT_TO_FACS).length;
  return `ARKit morphs: ${found.length}/${total} available [${found.join(', ')}]`;
}
