/**
 * ============================================================================
 * Viseme Map - Phoneme-to-Mouth-Shape Definitions
 * ============================================================================
 * Maps phoneme groups to bone/morph weights for realistic lip sync.
 *
 * Architecture:
 *   Text → grapheme-to-phoneme lookup → viseme ID → bone weights
 *
 * Each viseme defines weights for:
 *   - jawOpen: 0-1 jaw rotation amount
 *   - lipStretch: lip corner spread (smile-like)
 *   - lipPucker: lip corner push forward (kiss-like)
 *   - lipUpperRaise: upper lip lift
 *   - lipLowerDrop: lower lip drop
 *   - tongueOut: tongue protrusion (0-1)
 *
 * These abstract weights are converted to bone rotations by useMouthAnimation.
 * ============================================================================
 */

// ============================================================================
// Viseme Shape Definitions
// ============================================================================

export interface VisemeWeights {
  jawOpen: number;
  lipStretch: number;
  lipPucker: number;
  lipUpperRaise: number;
  lipLowerDrop: number;
  tongueOut: number;
}

/** All supported viseme IDs */
export type VisemeId =
  | 'sil' | 'PP' | 'FF' | 'TH' | 'DD'
  | 'kk' | 'CH' | 'SS' | 'nn' | 'RR'
  | 'aa' | 'E' | 'ih' | 'oh' | 'ou';

/**
 * Viseme shapes - each defines a distinct mouth posture.
 * Values are 0-1 normalized weights.
 */
export const VISEME_SHAPES: Record<VisemeId, VisemeWeights> = {
  // Silence - mouth closed, relaxed
  sil: { jawOpen: 0, lipStretch: 0, lipPucker: 0, lipUpperRaise: 0, lipLowerDrop: 0, tongueOut: 0 },

  // P, B, M - lips pressed together
  PP: { jawOpen: 0.05, lipStretch: 0, lipPucker: 0.3, lipUpperRaise: 0, lipLowerDrop: 0, tongueOut: 0 },

  // F, V - lower lip tucked under upper teeth
  FF: { jawOpen: 0.15, lipStretch: 0.1, lipPucker: 0, lipUpperRaise: 0.2, lipLowerDrop: 0.3, tongueOut: 0 },

  // TH - tongue between teeth
  TH: { jawOpen: 0.2, lipStretch: 0.1, lipPucker: 0, lipUpperRaise: 0.1, lipLowerDrop: 0.1, tongueOut: 0.3 },

  // T, D, N, L - tongue on roof of mouth
  DD: { jawOpen: 0.25, lipStretch: 0.15, lipPucker: 0, lipUpperRaise: 0, lipLowerDrop: 0.1, tongueOut: 0.05 },

  // K, G - back of tongue raised
  kk: { jawOpen: 0.3, lipStretch: 0.2, lipPucker: 0, lipUpperRaise: 0, lipLowerDrop: 0.15, tongueOut: 0 },

  // CH, J, SH - lips puckered slightly, jaw open
  CH: { jawOpen: 0.25, lipStretch: 0, lipPucker: 0.5, lipUpperRaise: 0.1, lipLowerDrop: 0.1, tongueOut: 0 },

  // S, Z - teeth close, lips slightly spread
  SS: { jawOpen: 0.1, lipStretch: 0.35, lipPucker: 0, lipUpperRaise: 0, lipLowerDrop: 0, tongueOut: 0 },

  // N, L (nasal/lateral)
  nn: { jawOpen: 0.2, lipStretch: 0.1, lipPucker: 0, lipUpperRaise: 0, lipLowerDrop: 0.05, tongueOut: 0 },

  // R - lips slightly rounded
  RR: { jawOpen: 0.2, lipStretch: 0, lipPucker: 0.4, lipUpperRaise: 0, lipLowerDrop: 0.1, tongueOut: 0 },

  // A (as in "father") - wide open
  aa: { jawOpen: 0.7, lipStretch: 0.2, lipPucker: 0, lipUpperRaise: 0.15, lipLowerDrop: 0.3, tongueOut: 0 },

  // E (as in "bed") - mid open, spread
  E: { jawOpen: 0.4, lipStretch: 0.4, lipPucker: 0, lipUpperRaise: 0.1, lipLowerDrop: 0.15, tongueOut: 0 },

  // I (as in "bit") - small open, spread
  ih: { jawOpen: 0.25, lipStretch: 0.3, lipPucker: 0, lipUpperRaise: 0.05, lipLowerDrop: 0.1, tongueOut: 0 },

  // O (as in "go") - rounded, medium open
  oh: { jawOpen: 0.5, lipStretch: 0, lipPucker: 0.6, lipUpperRaise: 0.1, lipLowerDrop: 0.2, tongueOut: 0 },

  // U (as in "boot") - rounded, small open
  ou: { jawOpen: 0.3, lipStretch: 0, lipPucker: 0.7, lipUpperRaise: 0.05, lipLowerDrop: 0.1, tongueOut: 0 },
};

// ============================================================================
// Grapheme-to-Phoneme Rules (English Approximation)
// ============================================================================

/**
 * Maps character sequences to viseme IDs.
 * Ordered from longest match to shortest for greedy matching.
 * This is a simple rule-based approximation — not a full G2P engine.
 */
export const GRAPHEME_TO_VISEME: Array<[RegExp, VisemeId]> = [
  // Multi-character patterns (check first)
  [/^th/i, 'TH'],
  [/^sh/i, 'CH'],
  [/^ch/i, 'CH'],
  [/^ph/i, 'FF'],
  [/^wh/i, 'ou'],
  [/^ck/i, 'kk'],
  [/^ng/i, 'nn'],
  [/^qu/i, 'kk'],

  // Vowel digraphs
  [/^oo/i, 'ou'],
  [/^ee/i, 'E'],
  [/^ea/i, 'E'],
  [/^ai/i, 'E'],
  [/^ay/i, 'E'],
  [/^ou/i, 'oh'],
  [/^ow/i, 'oh'],
  [/^oi/i, 'oh'],
  [/^oy/i, 'oh'],
  [/^au/i, 'aa'],
  [/^aw/i, 'aa'],

  // Single consonants
  [/^[pb]/i, 'PP'],
  [/^m/i, 'PP'],
  [/^[fv]/i, 'FF'],
  [/^[td]/i, 'DD'],
  [/^[nl]/i, 'nn'],
  [/^[kg]/i, 'kk'],
  [/^[sz]/i, 'SS'],
  [/^[jy]/i, 'CH'],
  [/^r/i, 'RR'],
  [/^w/i, 'ou'],
  [/^h/i, 'aa'],
  [/^x/i, 'kk'],

  // Single vowels
  [/^a/i, 'aa'],
  [/^e/i, 'E'],
  [/^i/i, 'ih'],
  [/^o/i, 'oh'],
  [/^u/i, 'ou'],
];

// ============================================================================
// Phoneme Timing Constants
// ============================================================================

/** Average duration per phoneme in seconds */
export const PHONEME_DURATION = 0.08;

/** Transition time between visemes in seconds */
export const VISEME_TRANSITION_TIME = 0.05;

/** Duration to hold silence viseme after last phoneme */
export const SILENCE_HOLD_TIME = 0.15;

// ============================================================================
// Text-to-Phoneme Conversion
// ============================================================================

export interface PhonemeEntry {
  viseme: VisemeId;
  duration: number;
}

/**
 * Convert a text string to an estimated phoneme/viseme sequence.
 * Uses greedy grapheme matching — good enough for real-time lip sync.
 */
export function textToPhonemes(text: string): PhonemeEntry[] {
  const phonemes: PhonemeEntry[] = [];
  // Strip non-alpha characters, keep spaces for silence
  const cleaned = text.replace(/[^a-zA-Z\s]/g, '');
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];

    // Space = short silence
    if (ch === ' ') {
      // Add silence between words (merge consecutive silences)
      if (phonemes.length === 0 || phonemes[phonemes.length - 1].viseme !== 'sil') {
        phonemes.push({ viseme: 'sil', duration: PHONEME_DURATION * 0.5 });
      }
      i++;
      continue;
    }

    // Try to match grapheme patterns (longest first — patterns are pre-sorted)
    const remaining = cleaned.slice(i);
    let matched = false;

    for (const [pattern, viseme] of GRAPHEME_TO_VISEME) {
      const match = remaining.match(pattern);
      if (match) {
        phonemes.push({ viseme, duration: PHONEME_DURATION });
        i += match[0].length;
        matched = true;
        break;
      }
    }

    // Fallback: skip unrecognized character
    if (!matched) {
      i++;
    }
  }

  return phonemes;
}

// ============================================================================
// Coarticulation Helper
// ============================================================================

/**
 * Blend two viseme shapes together for smooth transitions.
 * t=0 returns `from`, t=1 returns `to`.
 */
export function blendVisemes(from: VisemeWeights, to: VisemeWeights, t: number): VisemeWeights {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    jawOpen: from.jawOpen + (to.jawOpen - from.jawOpen) * clamped,
    lipStretch: from.lipStretch + (to.lipStretch - from.lipStretch) * clamped,
    lipPucker: from.lipPucker + (to.lipPucker - from.lipPucker) * clamped,
    lipUpperRaise: from.lipUpperRaise + (to.lipUpperRaise - from.lipUpperRaise) * clamped,
    lipLowerDrop: from.lipLowerDrop + (to.lipLowerDrop - from.lipLowerDrop) * clamped,
    tongueOut: from.tongueOut + (to.tongueOut - from.tongueOut) * clamped,
  };
}
