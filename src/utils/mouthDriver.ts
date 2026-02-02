/**
 * ============================================================================
 * MouthDriver - Audio-Driven Mouth Animation
 * ============================================================================
 * Uses WebAudio AnalyserNode to compute amplitude from audio playback.
 * Provides a smoothed, noise-gated 0..1 value for mouth open amount.
 *
 * Usage:
 *   const driver = new MouthDriver(audioContext);
 *   // Connect your audio source to driver.inputNode instead of destination
 *   source.connect(driver.inputNode);
 *   // In animation loop:
 *   const mouthOpen = driver.getMouthOpen();
 */

import { log } from './log';

// ============================================================================
// Configuration
// ============================================================================

export interface MouthDriverConfig {
  /** FFT size for frequency analysis (power of 2, 32-2048) */
  fftSize: number;
  /** Smoothing time constant for AnalyserNode (0-1, higher = smoother) */
  smoothingTimeConstant: number;
  /** Noise gate threshold (0-1). Signals below this are zeroed. */
  noiseGate: number;
  /** Minimum RMS to register as mouth movement (0-1) */
  minRms: number;
  /** Maximum expected RMS (used for normalization) */
  maxRms: number;
  /** Output smoothing factor (0-1, higher = more smoothing) */
  outputSmoothing: number;
  /** Attack speed - how fast mouth opens (0-1, higher = faster) */
  attackSpeed: number;
  /** Decay speed - how fast mouth closes (0-1, higher = faster) */
  decaySpeed: number;
}

const DEFAULT_CONFIG: MouthDriverConfig = {
  fftSize: 256,
  smoothingTimeConstant: 0.5,
  noiseGate: 0.008,
  minRms: 0.01,
  maxRms: 0.20,
  outputSmoothing: 0.25,
  attackSpeed: 0.5,
  decaySpeed: 0.18,
};

// ============================================================================
// MouthDriver Class
// ============================================================================

export class MouthDriver {
  private analyser: AnalyserNode;
  private gainNode: GainNode;
  private timeDomainData = new Float32Array(0);
  private currentValue: number = 0;
  private config: MouthDriverConfig;

  /** Node to connect audio sources to */
  public readonly inputNode: GainNode;

  /** Node that outputs to destination (connect this to ctx.destination) */
  public readonly outputNode: AnalyserNode;

  constructor(
    audioContext: AudioContext,
    config: Partial<MouthDriverConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create gain node as input (allows volume control if needed)
    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    // Create analyser
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = this.config.fftSize;
    this.analyser.smoothingTimeConstant = this.config.smoothingTimeConstant;

    // Connect: input -> analyser -> (implicit output)
    this.gainNode.connect(this.analyser);

    // Allocate buffer for time domain data
    this.timeDomainData = new Float32Array(this.analyser.fftSize);

    // Expose nodes
    this.inputNode = this.gainNode;
    this.outputNode = this.analyser;

    log.info(`[MouthDriver] Created with fftSize=${this.config.fftSize}, smoothing=${this.config.smoothingTimeConstant}`);
  }

  /**
   * Connect the output to destination (call once during setup)
   */
  connectToDestination(destination: AudioNode): void {
    this.analyser.connect(destination);
  }

  // Debug: log counter to avoid spamming
  private debugLogCounter = 0;
  private debugEnabled = true;

  /**
   * Enable/disable debug logging
   */
  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Get current mouth open value (0..1)
   * Call this every frame in your animation loop.
   */
  getMouthOpen(): number {
    // Get time domain data
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    // Compute RMS (root mean square)
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      sumSquares += this.timeDomainData[i] * this.timeDomainData[i];
    }
    const rms = Math.sqrt(sumSquares / this.timeDomainData.length);

    // Apply noise gate
    const gatedRms = rms < this.config.noiseGate ? 0 : rms;

    // Normalize to 0..1 range with power curve for natural speech response
    const linear = Math.min(
      1,
      Math.max(0, (gatedRms - this.config.minRms) / (this.config.maxRms - this.config.minRms))
    );
    // Power curve: lower exponent = more expressive range from normal speech
    const normalized = Math.pow(linear, 0.5);

    // Apply asymmetric smoothing (fast attack, slow decay)
    const speed = normalized > this.currentValue
      ? this.config.attackSpeed
      : this.config.decaySpeed;

    this.currentValue += (normalized - this.currentValue) * speed;

    // Debug logging (every 30 frames = ~0.5s at 60fps)
    if (this.debugEnabled && ++this.debugLogCounter >= 30) {
      this.debugLogCounter = 0;
      if (rms > 0.001) {
        log.debug(`[MouthDriver] rms=${rms.toFixed(4)} gated=${gatedRms.toFixed(4)} normalized=${normalized.toFixed(3)} mouthOpen=${this.currentValue.toFixed(3)}`);
      }
    }

    // Clamp final value
    return Math.min(1, Math.max(0, this.currentValue));
  }

  /**
   * Get raw RMS value (for debugging)
   */
  getRawRms(): number {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      sumSquares += this.timeDomainData[i] * this.timeDomainData[i];
    }
    return Math.sqrt(sumSquares / this.timeDomainData.length);
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<MouthDriverConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.fftSize) {
      this.analyser.fftSize = config.fftSize;
      this.timeDomainData = new Float32Array(this.analyser.fftSize);
    }
    if (config.smoothingTimeConstant !== undefined) {
      this.analyser.smoothingTimeConstant = config.smoothingTimeConstant;
    }
  }

  /**
   * Reset the smoothed value (e.g., when audio stops)
   */
  reset(): void {
    this.currentValue = 0;
  }

  /**
   * Disconnect all nodes (cleanup)
   */
  dispose(): void {
    this.gainNode.disconnect();
    this.analyser.disconnect();
  }
}

// ============================================================================
// Singleton for Global Audio Analysis
// ============================================================================

let globalMouthDriver: MouthDriver | null = null;
let globalAudioContext: AudioContext | null = null;

/**
 * Get or create the global MouthDriver instance.
 * This allows sharing the analyser across the app.
 */
export function getGlobalMouthDriver(audioContext?: AudioContext): MouthDriver {
  if (!globalMouthDriver) {
    if (!audioContext) {
      if (!globalAudioContext) {
        globalAudioContext = new AudioContext({ sampleRate: 24000 });
      }
      audioContext = globalAudioContext;
    }
    globalMouthDriver = new MouthDriver(audioContext);
    globalMouthDriver.connectToDestination(audioContext.destination);
  }
  return globalMouthDriver;
}

/**
 * Get the global AudioContext used by the MouthDriver
 */
export function getGlobalAudioContext(): AudioContext {
  if (!globalAudioContext) {
    globalAudioContext = new AudioContext({ sampleRate: 24000 });
  }
  return globalAudioContext;
}

/**
 * Reset the global instances (for cleanup)
 */
export function resetGlobalMouthDriver(): void {
  if (globalMouthDriver) {
    globalMouthDriver.dispose();
    globalMouthDriver = null;
  }
}
