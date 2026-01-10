/**
 * ============================================================================
 * GLB Inspector - Scan for Morph Targets and Bones
 * ============================================================================
 * Utility to inspect a loaded GLB scene and detect:
 *   - Morph targets (blendshapes) suitable for mouth/jaw animation
 *   - Jaw/mouth bones for rotation-based fallback
 */

import * as THREE from 'three';

// ============================================================================
// Types
// ============================================================================

export interface MorphTargetInfo {
  mesh: THREE.SkinnedMesh | THREE.Mesh;
  meshName: string;
  targetName: string;
  index: number;
}

export interface BoneInfo {
  bone: THREE.Bone;
  name: string;
  path: string;
}

export interface GLBInspectionResult {
  /** All morph targets found in the model */
  morphTargets: MorphTargetInfo[];
  /** Morph targets likely suitable for mouth animation */
  mouthMorphTargets: MorphTargetInfo[];
  /** The best candidate morph target for mouth open (null if none found) */
  bestMouthMorph: MorphTargetInfo | null;
  /** All bones found in the model */
  bones: BoneInfo[];
  /** Jaw/mouth bones suitable for rotation */
  jawBones: BoneInfo[];
  /** The best candidate jaw bone (null if none found) */
  bestJawBone: BoneInfo | null;
}

// ============================================================================
// Morph Target Name Patterns (priority order)
// ============================================================================

const MOUTH_MORPH_PATTERNS = [
  // Apple ARKit / standard blendshapes
  /^jawOpen$/i,
  /^jaw_open$/i,
  /^mouthOpen$/i,
  /^mouth_open$/i,
  // Visemes
  /^viseme_aa$/i,
  /^viseme_O$/i,
  /^viseme_oh$/i,
  // Common variations
  /jaw.*open/i,
  /mouth.*open/i,
  /open.*mouth/i,
  /open.*jaw/i,
  // VRM/VRoid
  /^A$/,
  /^aa$/i,
  // Generic fallbacks
  /jaw/i,
  /mouth/i,
];

// ============================================================================
// Jaw Bone Name Patterns (priority order)
// ============================================================================

const JAW_BONE_PATTERNS = [
  /^jaw$/i,
  /^Jaw$/,
  /^mixamorigJaw$/i,
  /^Bip01_Jaw$/i,
  /^DEF-jaw$/i,
  /jaw/i,
  /chin/i,
  /mandible/i,
];

// ============================================================================
// Inspection Function
// ============================================================================

export function inspectGLB(scene: THREE.Object3D): GLBInspectionResult {
  const morphTargets: MorphTargetInfo[] = [];
  const bones: BoneInfo[] = [];

  // Traverse scene for meshes and bones
  scene.traverse((child) => {
    // Collect morph targets from meshes
    if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
      const mesh = child;
      const morphDict = mesh.morphTargetDictionary;
      const morphInfluences = mesh.morphTargetInfluences;

      if (morphDict && morphInfluences) {
        for (const [name, index] of Object.entries(morphDict)) {
          morphTargets.push({
            mesh,
            meshName: mesh.name || 'unnamed',
            targetName: name,
            index: index as number,
          });
        }
      }
    }

    // Collect bones
    if (child instanceof THREE.Bone) {
      const path = getObjectPath(child);
      bones.push({
        bone: child,
        name: child.name,
        path,
      });
    }
  });

  // Find mouth-related morph targets
  const mouthMorphTargets = morphTargets.filter((mt) =>
    MOUTH_MORPH_PATTERNS.some((pattern) => pattern.test(mt.targetName))
  );

  // Find best mouth morph target (first match in priority order)
  let bestMouthMorph: MorphTargetInfo | null = null;
  for (const pattern of MOUTH_MORPH_PATTERNS) {
    const match = mouthMorphTargets.find((mt) => pattern.test(mt.targetName));
    if (match) {
      bestMouthMorph = match;
      break;
    }
  }

  // Find jaw bones
  const jawBones = bones.filter((b) =>
    JAW_BONE_PATTERNS.some((pattern) => pattern.test(b.name))
  );

  // Find best jaw bone (first match in priority order)
  let bestJawBone: BoneInfo | null = null;
  for (const pattern of JAW_BONE_PATTERNS) {
    const match = jawBones.find((b) => pattern.test(b.name));
    if (match) {
      bestJawBone = match;
      break;
    }
  }

  return {
    morphTargets,
    mouthMorphTargets,
    bestMouthMorph,
    bones,
    jawBones,
    bestJawBone,
  };
}

// ============================================================================
// Logging Helper
// ============================================================================

export function logGLBInspection(result: GLBInspectionResult): void {
  console.group('[GLB Inspector] Inspection Results');

  console.log(`Total morph targets: ${result.morphTargets.length}`);
  if (result.morphTargets.length > 0) {
    console.table(
      result.morphTargets.map((mt) => ({
        mesh: mt.meshName,
        target: mt.targetName,
        index: mt.index,
      }))
    );
  }

  console.log(`Mouth-related morph targets: ${result.mouthMorphTargets.length}`);
  if (result.mouthMorphTargets.length > 0) {
    console.table(
      result.mouthMorphTargets.map((mt) => ({
        mesh: mt.meshName,
        target: mt.targetName,
        index: mt.index,
      }))
    );
  }

  if (result.bestMouthMorph) {
    console.log(
      `Best mouth morph: "${result.bestMouthMorph.targetName}" on mesh "${result.bestMouthMorph.meshName}"`
    );
  } else {
    console.log('No suitable mouth morph target found');
  }

  console.log(`Total bones: ${result.bones.length}`);
  console.log(`Jaw bones: ${result.jawBones.length}`);
  if (result.jawBones.length > 0) {
    console.table(result.jawBones.map((b) => ({ name: b.name, path: b.path })));
  }

  if (result.bestJawBone) {
    console.log(`Best jaw bone: "${result.bestJawBone.name}"`);
  } else {
    console.log('No suitable jaw bone found');
  }

  console.groupEnd();
}

// ============================================================================
// Helpers
// ============================================================================

function getObjectPath(obj: THREE.Object3D): string {
  const parts: string[] = [];
  let current: THREE.Object3D | null = obj;
  while (current) {
    parts.unshift(current.name || '(unnamed)');
    current = current.parent;
  }
  return parts.join(' > ');
}
