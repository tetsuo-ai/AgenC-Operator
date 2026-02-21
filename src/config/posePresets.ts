/**
 * ============================================================================
 * Pose Presets - Predefined Body Poses for Avatar
 * ============================================================================
 * Each preset defines rotation offsets (radians) added on top of the rest pose.
 * Bone slot names match useGenesisAnimation's BoneRefs.
 *
 * The animation system lerps between current and target offsets over
 * `transitionDuration` seconds for smooth blending.
 * ============================================================================
 */

// ============================================================================
// Types
// ============================================================================

/** Rotation offset per axis (radians). Omitted axes default to 0. */
export interface BoneOffset {
  x?: number;
  y?: number;
  z?: number;
  /** If true, values are absolute rotations, not offsets added to rest pose */
  absolute?: boolean;
}

export interface PosePreset {
  name: string;
  bones: Partial<Record<string, BoneOffset>>;
  /** Seconds to blend from current pose to this one */
  transitionDuration: number;
}

export type PoseName = 'idle' | 'thinking' | 'excited' | 'attentive' | 'listening' | 'speaking' | 'thinkingDeep';

// ============================================================================
// Presets
// ============================================================================

export const POSE_PRESETS: Record<PoseName, PosePreset> = {
  /** Relaxed contrapposto — weight shifted, natural S-curve, asymmetric arms */
  idle: {
    name: 'idle',
    bones: {
      pelvis:     { z: 0.04, y: 0.02 },           // weight shift right + slight hip rotation
      spine1:     { z: -0.02, x: 0.005 },          // S-curve counter
      spine2:     { z: -0.015 },                    // continuing S-curve
      spine3:     { x: 0.015 },                     // forward lean (sternum area)
      spine4:     { x: 0.012 },                     // chest slightly forward
      shoulderL:  { x: 0.03, z: -0.03 },            // left shoulder forward + down
      shoulderR:  { x: 0.02, z: 0.015 },            // right shoulder slightly back
      // Upper arms: ABSOLUTE rotations for full control
      // X: -PI/2 (-1.57) = straight down from shoulder
      // Y: controls arm twist (palms inward vs forward) — 0.90 ≈ 52° for natural palms-inward
      upperArmL:  { x: -1.50, y: 0.90, z: 0.05, absolute: true },   // reduced Y-twist from 112° to 52°
      upperArmR:  { x: 1.50, y: -0.90, z: -0.05, absolute: true },  // mirrored
      // Forearm: ABSOLUTE rotations — slight elbow flex + pronation
      foreArmL:   { x: -0.15, y: 0.20, z: 0.10, absolute: true },   // ~8.5° elbow flex + slight pronation
      foreArmR:   { x: 0.15, y: -0.20, z: 0.10, absolute: true },   // mirrored
      // Hands: adjusted for new arm orientation
      handL:      { x: -0.08, y: 0.05, z: 0.04 },   // wrist flex adjusted for new arm twist
      handR:      { x: -0.08, y: -0.05, z: -0.04 },  // mirrored
      neck1:      { x: 0.015, z: 0.015 },           // slight forward + tilt
      head:       { x: 0.025, z: 0.025 },           // head slightly forward and tilted
    },
    transitionDuration: 0.8,
  },

  /** Head tilted right, chin slightly down — contemplative look */
  thinking: {
    name: 'thinking',
    bones: {
      head:      { x: 0.04, z: -0.06 },   // chin down + tilt right
      neck1:     { x: 0.02, z: -0.03 },   // follow-through
      spine4:    { x: 0.01 },              // slight chest droop
      shoulderL: { z: -0.02 },             // left shoulder slightly up
      upperArmL: { x: -0.1, z: 0.15 },    // left arm raised hint
      foreArmL:  { x: -0.2 },             // forearm bent (hand-on-chin)
    },
    transitionDuration: 1.2,
  },

  /** Chest lifted, shoulders back, slight forward lean — energetic */
  excited: {
    name: 'excited',
    bones: {
      spine3:    { x: -0.03 },             // upper back straightened
      spine4:    { x: -0.04 },             // chest lift
      shoulderL: { z: 0.03 },              // shoulders back
      shoulderR: { z: -0.03 },             // shoulders back
      head:      { x: -0.03 },             // chin slightly up
      neck1:     { x: -0.02 },             // follow-through
    },
    transitionDuration: 0.6,
  },

  /** Head slightly forward and down — engaged listening */
  attentive: {
    name: 'attentive',
    bones: {
      head:  { x: 0.04 },                  // slight forward nod
      neck1: { x: 0.03 },                  // neck follows
      neck2: { x: 0.02 },                  // distributed along chain
      spine4: { x: 0.01 },                 // subtle lean forward
    },
    transitionDuration: 0.8,
  },

  /** Slight forward lean, chin down — receptive body language */
  listening: {
    name: 'listening',
    bones: {
      head:   { x: 0.05, z: 0.02 },        // chin down + slight tilt
      neck1:  { x: 0.03 },                  // neck follows
      spine3: { x: 0.02 },                  // forward lean
      spine4: { x: 0.015 },                 // chest follows
      shoulderL: { z: -0.02 },              // shoulders slightly forward
      shoulderR: { z: 0.02 },
    },
    transitionDuration: 1.0,
  },

  /** Straightened posture, chin up — confident/active */
  speaking: {
    name: 'speaking',
    bones: {
      head:   { x: -0.02 },                 // chin slightly up
      neck1:  { x: -0.015 },                // neck straightened
      spine3: { x: -0.02 },                 // upper back straightened
      spine4: { x: -0.025 },                // chest lift
      shoulderL: { z: 0.02 },               // shoulders back
      shoulderR: { z: -0.02 },
    },
    transitionDuration: 0.8,
  },

  /** Slumped posture, head tilted — deep contemplation */
  thinkingDeep: {
    name: 'thinkingDeep',
    bones: {
      head:   { x: 0.06, z: -0.04 },       // chin down, tilted right
      neck1:  { x: 0.04, z: -0.02 },        // neck follows
      spine3: { x: 0.03 },                  // slight slump
      spine4: { x: 0.02 },                  // chest droop
      shoulderL: { z: -0.03 },              // shoulders forward
      shoulderR: { z: 0.02 },               // slight asymmetry
    },
    transitionDuration: 1.2,
  },
};
