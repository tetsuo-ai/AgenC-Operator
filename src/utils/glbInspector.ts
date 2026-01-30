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
// Morph Target Prefix Stripping
// ============================================================================

/**
 * Strip known mesh/model prefixes from morph target names.
 * DAZ Studio exports often prepend mesh names like "Genesis9__" or "Victoria9__"
 * Example: "Genesis9__facs_bs_JawOpen" -> "facs_bs_JawOpen"
 */
export function stripMorphPrefix(name: string): string {
  // Match patterns like "Genesis9__", "Victoria9__", "Genesis9Tear__", etc.
  return name.replace(/^[A-Za-z0-9]+__/, '');
}

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
  /^Mouth[_]?Open$/i,
  // Genesis 9 / Victoria 9 FACS (may have mesh prefix)
  /facs_jnt_JawOpen$/i,
  /facs_ctrl_JawOpen$/i,
  /facs_bs_JawOpen$/i,
  /facs_bs_JawOpen_div2$/i,
  /eCTRLJawOpen$/i,
  /eCTRLMouthOpen$/i,
  // Genesis 9 FACS with potential prefixes (e.g., "Genesis9__facs_bs_JawOpen")
  /Genesis.*facs.*JawOpen/i,
  /Victoria.*facs.*JawOpen/i,
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
// Morph Target Exclusion Patterns (NOT animation morphs)
// ============================================================================

/**
 * Patterns for morphs that should NOT be used for animation.
 * These are face sculpting/proportion morphs, not FACS animation morphs.
 * Victoria 9 HD has 236 morphs but they're all asymmetry/proportion adjustments.
 */
const MOUTH_MORPH_EXCLUSIONS = [
  /asymmetry/i,   // Face sculpting adjustments (e.g., AsymmetryJawHorizontalBalance)
  /proportion/i,  // Character sizing morphs
  /balance/i,     // Balance adjustments (often paired with asymmetry)
  /head_bs_/i,    // Victoria 9 head blendshape sculpting morphs
];

/**
 * Check if a morph target name is excluded (not suitable for animation).
 * This prevents matching sculpting morphs like "AsymmetryJawHorizontalBalance"
 * as mouth animation targets.
 */
export function isExcludedMorph(name: string): boolean {
  const cleanName = stripMorphPrefix(name);
  return MOUTH_MORPH_EXCLUSIONS.some(p => p.test(name) || p.test(cleanName));
}

// ============================================================================
// Jaw Bone Name Patterns (priority order)
// ============================================================================

const JAW_BONE_PATTERNS = [
  // Victoria 9 / Genesis 9 - priority order
  /^lowerJaw$/i,
  /^lowerjaw$/i,
  /^lowerFaceRig$/i,
  /^lowerFaceRig_jnt$/i,
  // Standard patterns
  /^jaw$/i,
  /^Jaw$/,
  /^Jawbone[_.]?x$/i,    // Tory model specific
  /^Jawbone$/i,
  /^mixamorigJaw$/i,
  /^Bip01_Jaw$/i,
  /^DEF-jaw$/i,
  // Genesis 9 FACS controller bones
  /^facs_jnt_Jaw$/i,
  /^facs_ctrl_Jaw$/i,
  // Generic fallbacks
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

  // Find mouth-related morph targets (test both original and prefix-stripped names)
  const mouthMorphTargets = morphTargets.filter((mt) => {
    const cleanName = stripMorphPrefix(mt.targetName);
    return MOUTH_MORPH_PATTERNS.some((pattern) =>
      pattern.test(mt.targetName) || pattern.test(cleanName)
    );
  });

  // Find best mouth morph target (first match in priority order)
  let bestMouthMorph: MorphTargetInfo | null = null;
  for (const pattern of MOUTH_MORPH_PATTERNS) {
    const match = mouthMorphTargets.find((mt) => {
      const cleanName = stripMorphPrefix(mt.targetName);
      return pattern.test(mt.targetName) || pattern.test(cleanName);
    });
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
