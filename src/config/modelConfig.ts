/**
 * ============================================================================
 * Model Configuration - Genesis 9 Avatar
 * ============================================================================
 * Centralized configuration for the Genesis 9 avatar model including:
 *   - Bone name patterns for skeleton rigging
 *   - Morph target patterns for facial expressions
 *   - Material categorization rules
 * ============================================================================
 */

// ============================================================================
// Types
// ============================================================================

export interface SkeletonConfig {
  /** Jaw bone for mouth animation */
  jaw: RegExp[];
  /** Spine chain (from pelvis up) */
  spine: RegExp[];
  /** Head bone */
  head: RegExp[];
  /** Neck bones */
  neck: RegExp[];
  /** Left/right eye bones */
  eyes: { left: RegExp[]; right: RegExp[] };
  /** Eyelid bones for blinking */
  eyelids: {
    upperL: RegExp[];
    upperR: RegExp[];
    lowerL: RegExp[];
    lowerR: RegExp[];
  };
  /** Shoulder bones */
  shoulders: { left: RegExp[]; right: RegExp[] };
  /** Upper arm bones */
  upperArms: { left: RegExp[]; right: RegExp[] };
  /** Hip/pelvis bone */
  hips: RegExp[];
}

export interface MorphTargetConfig {
  /** Jaw open patterns for lip sync */
  jawOpen: RegExp[];
  /** Eye blink patterns */
  eyeBlink: { left: RegExp[]; right: RegExp[]; both: RegExp[] };
  /** Smile patterns */
  smile: { left: RegExp[]; right: RegExp[]; both: RegExp[] };
  /** Eyebrow patterns */
  brows: {
    up: RegExp[];
    down: RegExp[];
    innerUp: RegExp[];
  };
  /** Eye look direction */
  eyeLook: {
    up: RegExp[];
    down: RegExp[];
    left: RegExp[];
    right: RegExp[];
  };
}

export interface MaterialCategoryConfig {
  /** Patterns for skin materials */
  skin: RegExp[];
  /** Patterns for eye materials */
  eyes: RegExp[];
  /** Patterns for hair materials */
  hair: RegExp[];
  /** Patterns for mouth/teeth materials */
  mouth: RegExp[];
  /** Patterns for clothing materials */
  clothing: RegExp[];
  /** Patterns for accent/glow materials */
  accent: RegExp[];
}

export interface ModelConfig {
  /** Path to the GLB model file */
  path: string;
  /** Whether the model uses Draco compression */
  draco: boolean;
  /** Draco decoder path */
  dracoPath: string;
  /** Skeleton bone patterns */
  skeleton: SkeletonConfig;
  /** Morph target patterns */
  morphTargets: MorphTargetConfig;
  /** Material categorization */
  materials: MaterialCategoryConfig;
  /** Animation parameters */
  animation: {
    /** Maximum jaw rotation in radians */
    maxJawRotation: number;
    /** Jaw rotation axis */
    jawRotationAxis: 'x' | 'y' | 'z';
    /** Jaw rotation direction (1 or -1) */
    jawRotationDirection: number;
    /** Breathing speed multiplier */
    breathSpeed: number;
    /** Blink interval range [min, max] in seconds */
    blinkInterval: [number, number];
    /** Blink duration in seconds */
    blinkDuration: number;
  };
}

// ============================================================================
// Genesis 9 Configuration
// ============================================================================

export const GENESIS9_CONFIG: ModelConfig = {
  path: '/models/agencfinalformr.glb',
  draco: true,
  dracoPath: '/draco/',

  skeleton: {
    jaw: [
      /^lowerjaw$/i,
      /^lowerJaw$/i,
      /^jaw$/i,
    ],

    spine: [
      /^pelvis$/i,
      /^spine1$/i,
      /^spine2$/i,
      /^spine3$/i,
      /^spine4$/i,
    ],

    head: [
      /^head$/i,
    ],

    neck: [
      /^neck1$/i,
      /^neck2$/i,
    ],

    eyes: {
      left: [/^l_eye$/i],
      right: [/^r_eye$/i],
    },

    eyelids: {
      upperL: [/^l_eyelidupper$/i],
      upperR: [/^r_eyelidupper$/i],
      lowerL: [/^l_eyelidlower$/i],
      lowerR: [/^r_eyelidlower$/i],
    },

    shoulders: {
      left: [/^l_shoulder$/i],
      right: [/^r_shoulder$/i],
    },

    upperArms: {
      left: [/^l_upperarm$/i],
      right: [/^r_upperarm$/i],
    },

    hips: [
      /^pelvis$/i,
      /^hip$/i,
    ],
  },

  morphTargets: {
    jawOpen: [
      // FACS controls (highest priority)
      /facs_ctrl_JawOpen$/i,
      /facs_bs_JawOpen$/i,
      /facs_jnt_JawOpen$/i,
      // Standard patterns
      /^jawOpen$/i,
      /^jaw_open$/i,
      /^mouthOpen$/i,
    ],

    eyeBlink: {
      left: [
        /facs_bs_EyeBlinkL$/i,
        /facs_bs_EyeBlink_L$/i,
        /eCTRLEyesClosedL$/i,
      ],
      right: [
        /facs_bs_EyeBlinkR$/i,
        /facs_bs_EyeBlink_R$/i,
        /eCTRLEyesClosedR$/i,
      ],
      both: [
        /facs_ctrl_EyesClosed$/i,
        /eCTRLEyesClosed$/i,
        /^Eyes[_]?closed$/i,
        /^eyesClosed$/i,
        /^blink$/i,
      ],
    },

    smile: {
      left: [
        /A38_Mouth_Smile_Left$/i,
        /facs_bs_MouthSmileL$/i,
        /mouthSmile_L$/i,
      ],
      right: [
        /A39_Mouth_Smile_Right$/i,
        /facs_bs_MouthSmileR$/i,
        /mouthSmile_R$/i,
      ],
      both: [
        /mouthSmile$/i,
        /smile$/i,
      ],
    },

    brows: {
      up: [
        /facs_bs_BrowOuterUp/i,
        /browsUp$/i,
        /browUp$/i,
      ],
      down: [
        /facs_bs_BrowDown/i,
        /browsDown$/i,
        /browDown$/i,
      ],
      innerUp: [
        /facs_bs_BrowInnerUp/i,
        /browInnerUp$/i,
      ],
    },

    eyeLook: {
      up: [/facs_ctrl_EyeLookUp/i, /eyeLookUp/i],
      down: [/facs_ctrl_EyeLookDown/i, /eyeLookDown/i],
      left: [/facs_ctrl_EyeLookIn/i, /eyeLookIn/i],
      right: [/facs_ctrl_EyeLookOut/i, /eyeLookOut/i],
    },
  },

  materials: {
    skin: [
      /body/i,
      /arms/i,
      /legs/i,
      /face/i,
      /head/i,
      /neck/i,
      /torso/i,
      /hand/i,
      /feet/i,
      /finger/i,
      /toe/i,
      /nail/i,
      /ear/i,
      /nose/i,
      /lip/i,
      /genesis/i,
    ],

    eyes: [
      /eye/i,
      /iris/i,
      /pupil/i,
      /cornea/i,
      /sclera/i,
      /moisture/i,
      /refract/i,
      /tear/i,
      /occlusion/i,
    ],

    hair: [
      /hair/i,
      /strand/i,
      /brow/i,
      /lash/i,
      /scalp/i,
    ],

    mouth: [
      /mouth/i,
      /teeth/i,
      /tongue/i,
      /gum/i,
      /cavity/i,
    ],

    clothing: [
      /cloth/i,
      /fabric/i,
      /shirt/i,
      /pants/i,
      /shorts/i,
      /sock/i,
      /shoe/i,
      /tank/i,
      /top/i,
    ],

    accent: [
      /accent/i,
      /glow/i,
      /emissive/i,
      /neon/i,
      /circuit/i,
      /trim/i,
    ],
  },

  animation: {
    maxJawRotation: 0.5,        // ~28 degrees
    jawRotationAxis: 'x',
    jawRotationDirection: -1,   // Negative opens jaw
    breathSpeed: 0.6,           // Breathing cycle speed
    blinkInterval: [2.0, 6.0],  // Random interval between blinks
    blinkDuration: 0.15,        // Duration of each blink
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find a bone in the scene that matches any of the given patterns.
 */
export function findBoneByPatterns(
  scene: THREE.Object3D,
  patterns: RegExp[]
): THREE.Bone | null {
  let foundBone: THREE.Bone | null = null;

  scene.traverse((child) => {
    if (foundBone) return;
    if ((child as THREE.Bone).isBone) {
      for (const pattern of patterns) {
        if (pattern.test(child.name)) {
          foundBone = child as THREE.Bone;
          return;
        }
      }
    }
  });

  return foundBone;
}

/**
 * Find all morph targets in a mesh that match any of the given patterns.
 */
export function findMorphTargetsByPatterns(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  patterns: RegExp[]
): Array<{ name: string; index: number }> {
  const results: Array<{ name: string; index: number }> = [];
  const dict = mesh.morphTargetDictionary;

  if (!dict) return results;

  for (const [name, index] of Object.entries(dict)) {
    for (const pattern of patterns) {
      if (pattern.test(name)) {
        results.push({ name, index: index as number });
        break;
      }
    }
  }

  return results;
}

/**
 * Determine material category based on mesh and material names.
 */
export function categorizeMaterial(
  meshName: string,
  materialName: string,
  config: MaterialCategoryConfig
): 'skin' | 'eyes' | 'hair' | 'mouth' | 'clothing' | 'accent' | 'default' {
  const combined = `${meshName} ${materialName}`.toLowerCase();

  if (config.skin.some(p => p.test(combined))) return 'skin';
  if (config.eyes.some(p => p.test(combined))) return 'eyes';
  if (config.hair.some(p => p.test(combined))) return 'hair';
  if (config.mouth.some(p => p.test(combined))) return 'mouth';
  if (config.clothing.some(p => p.test(combined))) return 'clothing';
  if (config.accent.some(p => p.test(combined))) return 'accent';

  return 'default';
}

// Export current model config as default
export const MODEL_CONFIG = GENESIS9_CONFIG;

// Type import for THREE (will be used by consumers)
import type * as THREE from 'three';
