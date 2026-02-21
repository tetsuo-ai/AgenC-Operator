/**
 * ============================================================================
 * useVisemeDriver - Text-to-Viseme Timing Engine
 * ============================================================================
 * Converts transcript text chunks into a timed sequence of viseme targets,
 * synchronized to audio playback.
 *
 * Flow:
 *   1. Voice pipeline sends transcript text deltas + audio chunk durations
 *   2. This driver converts text → phoneme sequence (via visemeMap)
 *   3. Phonemes are queued with timing aligned to audio chunks
 *   4. Each frame, the driver advances and outputs the current viseme blend
 *   5. useMouthAnimation reads the current viseme to shape lips
 *
 * Falls back gracefully: if no transcript is available, returns null
 * so the mouth animation can use amplitude-only mode.
 * ============================================================================
 */

import { useRef, useCallback } from 'react';
import {
  textToPhonemes,
  blendVisemes,
  VISEME_SHAPES,
  VISEME_TRANSITION_TIME,
  SILENCE_HOLD_TIME,
  type VisemeId,
  type VisemeWeights,
} from '../constants/visemeMap';
import { log } from '../utils/log';

// ============================================================================
// Types
// ============================================================================

interface QueuedPhoneme {
  viseme: VisemeId;
  startTime: number; // relative to queue start
  duration: number;
}

export interface VisemeDriverState {
  /** Current blended viseme weights, or null if no viseme active */
  currentViseme: VisemeWeights | null;
  /** Whether the driver is actively producing visemes */
  isActive: boolean;
  /** Debug: current viseme ID */
  currentVisemeId: VisemeId | null;
}

export interface UseVisemeDriverReturn {
  /** Feed a transcript text chunk (call on each transcript delta) */
  pushText: (text: string) => void;
  /** Notify the driver that an audio chunk has been queued for playback */
  pushAudioDuration: (durationSeconds: number) => void;
  /** Advance the driver timeline (call in useFrame) */
  update: (delta: number) => void;
  /** Get current viseme state */
  getState: () => VisemeDriverState;
  /** Reset all state (call on response end) */
  reset: () => void;
}

// ============================================================================
// Internal State
// ============================================================================

interface DriverState {
  // Phoneme queue with absolute timestamps
  queue: QueuedPhoneme[];
  // Current position in the timeline (seconds)
  timelinePosition: number;
  // Total audio duration queued (used for timing sync)
  totalAudioDuration: number;
  // Total text duration estimated (from phonemes)
  totalTextDuration: number;
  // Accumulated text that hasn't been processed yet
  pendingText: string;
  // Current interpolated viseme
  currentWeights: VisemeWeights | null;
  currentId: VisemeId | null;
  // Whether we have any active phonemes
  isActive: boolean;
  // Time since last phoneme ended (for silence detection)
  silenceTimer: number;
  // Debug
  debugTimer: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useVisemeDriver(): UseVisemeDriverReturn {
  const stateRef = useRef<DriverState>({
    queue: [],
    timelinePosition: 0,
    totalAudioDuration: 0,
    totalTextDuration: 0,
    pendingText: '',
    currentWeights: null,
    currentId: null,
    isActive: false,
    silenceTimer: 0,
    debugTimer: 0,
  });

  /**
   * Push transcript text to the driver.
   * Text is converted to phonemes and queued at the current timeline position.
   */
  const pushText = useCallback((text: string) => {
    const state = stateRef.current;
    state.pendingText += text;

    // Process accumulated text into phonemes
    const phonemes = textToPhonemes(state.pendingText);
    state.pendingText = '';

    if (phonemes.length === 0) return;

    // Calculate the time scaling factor:
    // We know how long the audio is (from pushAudioDuration),
    // and we estimate how long the text phonemes take.
    // But text arrives before audio timing is known, so we use
    // the default phoneme duration and let update() handle sync.

    let offset = state.totalTextDuration;
    for (const phoneme of phonemes) {
      state.queue.push({
        viseme: phoneme.viseme,
        startTime: offset,
        duration: phoneme.duration,
      });
      offset += phoneme.duration;
    }
    state.totalTextDuration = offset;
    state.isActive = true;
  }, []);

  /**
   * Notify that an audio chunk has been queued for playback.
   * Used to synchronize viseme timing with actual audio duration.
   */
  const pushAudioDuration = useCallback((durationSeconds: number) => {
    const state = stateRef.current;
    state.totalAudioDuration += durationSeconds;
  }, []);

  /**
   * Advance the viseme timeline and compute current blended shape.
   */
  const update = useCallback((delta: number) => {
    const state = stateRef.current;

    if (!state.isActive && state.queue.length === 0) {
      state.currentWeights = null;
      state.currentId = null;
      return;
    }

    // Compute playback speed adjustment:
    // If we have both audio and text durations, scale phoneme timing
    // to match audio duration. Otherwise play at 1x.
    let speed = 1.0;
    if (state.totalAudioDuration > 0 && state.totalTextDuration > 0) {
      speed = state.totalTextDuration / state.totalAudioDuration;
    }

    state.timelinePosition += delta * speed;
    const t = state.timelinePosition;

    // Find the phoneme at the current timeline position
    let currentPhoneme: QueuedPhoneme | null = null;
    let nextPhoneme: QueuedPhoneme | null = null;

    for (let i = 0; i < state.queue.length; i++) {
      const p = state.queue[i];
      const pEnd = p.startTime + p.duration;

      if (t >= p.startTime && t < pEnd) {
        currentPhoneme = p;
        nextPhoneme = state.queue[i + 1] || null;
        break;
      }
    }

    // Prune completed phonemes from queue (keep only current + future)
    while (state.queue.length > 0) {
      const first = state.queue[0];
      if (t >= first.startTime + first.duration + VISEME_TRANSITION_TIME) {
        state.queue.shift();
      } else {
        break;
      }
    }

    if (currentPhoneme) {
      state.silenceTimer = 0;

      const currentShape = VISEME_SHAPES[currentPhoneme.viseme];
      state.currentId = currentPhoneme.viseme;

      if (nextPhoneme) {
        const timeInPhoneme = t - currentPhoneme.startTime;
        const blendStart = currentPhoneme.duration - VISEME_TRANSITION_TIME;

        if (timeInPhoneme > blendStart) {
          // Transition phase: blend toward next phoneme
          const blendT = (timeInPhoneme - blendStart) / VISEME_TRANSITION_TIME;
          const nextShape = VISEME_SHAPES[nextPhoneme.viseme];
          state.currentWeights = blendVisemes(currentShape, nextShape, blendT);
        } else {
          // Hold phase: coarticulation lookahead — blend 25% toward next viseme
          // This prevents the "locked shape" look during holds
          const nextShape = VISEME_SHAPES[nextPhoneme.viseme];
          state.currentWeights = blendVisemes(currentShape, nextShape, 0.25);
        }
      } else {
        state.currentWeights = { ...currentShape };
      }
    } else {
      // No current phoneme - fade to silence
      state.silenceTimer += delta;

      if (state.currentWeights) {
        const silenceShape = VISEME_SHAPES.sil;
        const fadeT = Math.min(1, state.silenceTimer / SILENCE_HOLD_TIME);
        state.currentWeights = blendVisemes(state.currentWeights, silenceShape, fadeT);
        state.currentId = 'sil';

        if (fadeT >= 1) {
          state.currentWeights = null;
          state.currentId = null;
        }
      }

      // If queue is empty and silence timer exceeded, deactivate
      if (state.queue.length === 0 && state.silenceTimer > SILENCE_HOLD_TIME) {
        state.isActive = false;
        state.currentWeights = null;
        state.currentId = null;
      }
    }

    // Debug logging every 5 seconds
    state.debugTimer += delta;
    if (state.debugTimer >= 5.0) {
      state.debugTimer = 0;
      if (state.isActive) {
        log.debug(
          `[VisemeDriver] active=${state.isActive} viseme=${state.currentId ?? 'none'} ` +
          `queue=${state.queue.length} t=${t.toFixed(2)} ` +
          `audioDur=${state.totalAudioDuration.toFixed(2)} textDur=${state.totalTextDuration.toFixed(2)}`
        );
      }
    }
  }, []);

  /**
   * Get the current driver state for consumption by useMouthAnimation.
   */
  const getState = useCallback((): VisemeDriverState => {
    const state = stateRef.current;
    return {
      currentViseme: state.currentWeights,
      isActive: state.isActive,
      currentVisemeId: state.currentId,
    };
  }, []);

  /**
   * Reset all state. Call when a response ends.
   */
  const reset = useCallback(() => {
    const state = stateRef.current;
    state.queue = [];
    state.timelinePosition = 0;
    state.totalAudioDuration = 0;
    state.totalTextDuration = 0;
    state.pendingText = '';
    state.currentWeights = null;
    state.currentId = null;
    state.isActive = false;
    state.silenceTimer = 0;
  }, []);

  // Register this instance as the global viseme driver so the voice pipeline
  // (which lives in a different component tree) can push text/audio events.
  globalVisemeDriverRef = { pushText, pushAudioDuration, reset };

  return {
    pushText,
    pushAudioDuration,
    update,
    getState,
    reset,
  };
}

// ============================================================================
// Global Bridge (connects voice pipeline in App.tsx to viseme driver in avatar)
// ============================================================================

interface GlobalVisemeDriver {
  pushText: (text: string) => void;
  pushAudioDuration: (durationSeconds: number) => void;
  reset: () => void;
}

let globalVisemeDriverRef: GlobalVisemeDriver | null = null;

/** Get the global viseme driver instance (set by the first useVisemeDriver hook) */
export function getGlobalVisemeDriver(): GlobalVisemeDriver | null {
  return globalVisemeDriverRef;
}
