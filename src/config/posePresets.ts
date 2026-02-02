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
}

export interface PosePreset {
  name: string;
  bones: Partial<Record<string, BoneOffset>>;
  /** Seconds to blend from current pose to this one */
  transitionDuration: number;
}

export type PoseName = 'idle' | 'thinking' | 'excited' | 'attentive';

// ============================================================================
// Presets
// ============================================================================

export const POSE_PRESETS: Record<PoseName, PosePreset> = {
  /** Relaxed contrapposto — weight shifted, natural S-curve, slight head tilt */
  idle: {
    name: 'idle',
    bones: {
      pelvis:     { z: 0.03 },                   // weight shifted right
      spine1:     { z: -0.015 },                  // S-curve counter
      spine2:     { z: -0.01 },
      spine3:     { x: 0.01 },                    // slight forward lean
      spine4:     { x: 0.01 },
      shoulderL:  { x: 0.02, z: -0.02 },
      shoulderR:  { x: 0.02, z: 0.01 },
      upperArmL:  { x: 0.05, z: 0.03 },
      upperArmR:  { x: 0.05, z: -0.03 },
      foreArmL:   { x: -0.15 },                   // natural elbow bend
      foreArmR:   { x: -0.15 },
      neck1:      { x: 0.01, z: 0.01 },
      head:       { x: 0.02, z: 0.02 },           // slight tilt
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
};
