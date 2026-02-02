/**
 * ============================================================================
 * PCM Capture Processor - AudioWorklet for Mic Input
 * ============================================================================
 * Runs off the main thread. Accumulates 128-sample frames into ~4096-sample
 * buffers, converts float32 → PCM16 in the worklet, then transfers the
 * ArrayBuffer to the main thread for WebSocket delivery.
 *
 * Registered as 'pcm-capture-processor'.
 * ============================================================================
 */

// AudioWorklet global types (this file runs in a separate AudioWorklet scope)
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

const BUFFER_SIZE = 4096;

class PCMCaptureProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array;
  private writeIndex: number;

  constructor() {
    super();
    this.buffer = new Float32Array(BUFFER_SIZE);
    this.writeIndex = 0;
  }

  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.writeIndex++] = channelData[i];

      if (this.writeIndex >= BUFFER_SIZE) {
        // Convert float32 → PCM16 inside the worklet (off main thread)
        const pcm16 = new Int16Array(BUFFER_SIZE);
        for (let j = 0; j < BUFFER_SIZE; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Transfer the buffer to main thread (zero-copy)
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

        // Reset accumulation buffer
        this.buffer = new Float32Array(BUFFER_SIZE);
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
