/**
 * ============================================================================
 * Centralized Animation Configuration
 * ============================================================================
 * All animation parameters in one place. Hooks import defaults from here
 * instead of defining local duplicates.
 *
 * Each hook still accepts runtime overrides via its own setConfig() method.
 * These are the canonical defaults.
 * ============================================================================
 */

// ============================================================================
// Breathing
// ============================================================================

export const BREATHING = {
  speed: 0.24,               // Breathing cycle speed — slower for calm presence
  spineAmount: 0.025,        // Spine movement amplitude (~1.4 deg)
  chestAmount: 0.035,        // Chest expansion (~2 deg)
  shoulderAmount: 0.012,     // Shoulder rise on inhale — very subtle
} as const;

// ============================================================================
// Body Sway (idle weight shifting)
// ============================================================================

export const SWAY = {
  speed: 0.12,               // Sway cycle speed — slow, dreamy
  hipAmount: 0.012,          // Hip lateral shift
  spineAmount: 0.016,        // Spine lean
  headAmount: 0.012,         // Head counter-sway
} as const;

// ============================================================================
// Micro-Movements (subtle head jitter)
// ============================================================================

export const MICRO = {
  speed: 0.8,                // Target update frequency — slower for organic feel
  amount: 0.004,             // Rotation amplitude per axis — very subtle
  lerpRate: 0.03,            // Smoothing rate — low for gradual drift
} as const;

// ============================================================================
// Blinking
// ============================================================================

export const BLINK = {
  intervalMin: 3.0,          // Minimum seconds between blinks
  intervalMax: 6.5,          // Maximum seconds between blinks
  duration: 0.15,            // Blink close-open duration (seconds)
  eyelidCloseAmount: 0.5,    // Radians to rotate upper eyelids when closing
  lowerLidFactor: 0.3,       // Lower lid closes this fraction of upper
  doubleBlinkChance: 0.2,    // 20% chance of a quick follow-up blink
  doubleBlinkDelay: 0.18,    // Seconds before the second blink starts
} as const;

// ============================================================================
// Jaw / Mouth
// ============================================================================

export const JAW = {
  maxRotation: 0.35,         // Max jaw rotation in radians (~20 deg) for expressive speech
  maxRotationRange: 0.5,     // Absolute max range in radians (~28 deg)
  rotationAxis: 'x' as const,
  rotationDirection: -1,     // Negative X opens jaw on Genesis 9
  useJawBone: true,          // Enable jaw bone animation
  jawBoneContribution: 1.0,  // Full jaw bone — morph targets may be on non-face mesh
} as const;

// ============================================================================
// Head Movement (during speech)
// ============================================================================

export const HEAD_NOD = {
  speed: 2.5,                // Nod cycle speed
  nodAmount: 0.06,           // Vertical nod amplitude (talking)
  tiltAmount: 0.04,          // Lateral tilt amplitude (talking)
  idleNodAmount: 0.015,      // Subtle idle head movement
} as const;

// ============================================================================
// Gestures (arm/hand movement during speech)
// ============================================================================

export const GESTURE = {
  speed: 1.8,                // Gesture cycle speed
  armAmount: 0.08,           // Upper arm rotation amplitude
  forearmAmount: 0.12,       // Forearm rotation amplitude
  handAmount: 0.15,          // Hand rotation amplitude
  chance: 0.5,               // Gestures per second probability
  minInterval: 0.8,          // Minimum seconds between gestures
  dualArmChance: 0.2,        // Chance of both arms gesturing
  dominantHandBias: 0.7,     // 70% right-hand dominant
  emphasisThreshold: 0.4,    // Audio amplitude to trigger emphasis
  emphasisBoost: 0.8,        // Multiplier during emphasis

  // Shoulder shrugs
  shrugsPerMinute: 4,
  shrugAmount: 0.06,
  shrugDuration: 0.6,

  // Spine sway during speech
  spineSwayAmount: 0.03,
} as const;

// ============================================================================
// Idle Hand Drift (wrist micro-movement at rest)
// ============================================================================

export const IDLE_HANDS = {
  driftSpeed: 0.05,            // Very slow wrist drift cycle
  driftAmount: 0.02,           // Rotation amplitude per axis (radians)
  pronateDrift: 0.015,         // Pronation/supination drift amplitude
  lerpRate: 0.02,              // Smoothing rate — very gradual
} as const;

// ============================================================================
// Facial Expressions
// ============================================================================

export const EXPRESSION = {
  smileChancePerMinute: 6,
  smileDuration: 2.0,        // seconds
  smileIntensity: 0.4,
  smileCornerAmount: 0.12,   // Lip corner raise for bone-based smile
  smileCheekAmount: 0.04,    // Cheek raise during smile

  browEmphasisAmount: 0.3,   // Brow raise during emphasis (radians)
  eyeWidenOnEmphasis: 0.06,  // Eye widening during emphasis
  happyEyesDuringSpeech: 0.03, // Subtle squint during speech

  emotionBlendRate: 2.0,     // Speed of emotion transitions
} as const;

// ============================================================================
// Eye Glow (material animation)
// ============================================================================

export const EYE_GLOW = {
  voiceBoost: 0.8,           // Additional emissive intensity when speaking
  speakingPulseSpeed: 4.0,   // Pulse speed during speech
  idlePulseSpeed: 1.5,       // Slower pulse when idle
} as const;

// ============================================================================
// Lip Sync Fine-Tuning
// ============================================================================

export const LIP_SYNC = {
  openLerpSpeed: 0.6,        // How fast mouth opens (higher = snappier)
  closeLerpSpeed: 0.3,       // How fast mouth closes (moderate)
  microVariation: 0.02,      // Random wobble on mouth position
  visemeIntensityMin: 0.4,   // Minimum viseme intensity
  visemeIntensityBoost: 2.5, // Multiplier for emphasis

  // Lip bone amplitudes — boosted for expressiveness
  lowerLipDrop: 0.2,
  upperLipRaise: 0.12,
  lipStretch: 0.12,
  lipPucker: 0.10,
  lowerLipAmplitude: 0.18,
  upperLipAmplitude: 0.08,
  cornerSpread: 0.10,
} as const;
