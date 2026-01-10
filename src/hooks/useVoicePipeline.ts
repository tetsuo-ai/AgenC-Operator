/**
 * ============================================================================
 * useVoicePipeline - Non-Blocking Voice Pipeline
 * ============================================================================
 * Handles voice I/O without blocking on chain operations:
 * 1. Mic capture runs in Web Audio worklet
 * 2. WebSocket to Grok Voice API streams independently
 * 3. Chain operations fire-and-forget with callbacks
 * 4. Audio playback queues async
 *
 * Key: Never await chain calls in the voice flow
 * ============================================================================
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { TetsuoAPI } from '../api';
import type {
  VoiceState,
  ChatMessage,
  VoiceIntent,
  ExecutionResult,
  GrokMessage,
  GrokResponse,
} from '../types';

// ============================================================================
// Configuration
// ============================================================================

const GROK_WS_URL = 'wss://api.x.ai/v1/realtime';
const SAMPLE_RATE = 24000;

const TETSUO_SYSTEM_PROMPT = `You are Tetsuo, a cyberpunk AI operator for the AgenC protocol on Solana.
You help users manage tasks on the blockchain through voice commands.

Your personality:
- Cool, collected, slightly mysterious cyberpunk aesthetic
- Efficient and direct, but with a touch of style
- Use subtle cyberpunk slang occasionally ("jacking in", "the net", "flatline")
- Always confirm important actions before executing

When you receive a command, parse it into a JSON intent with this structure:
{
  "action": "create_task" | "claim_task" | "complete_task" | "cancel_task" | "list_open_tasks" | "get_task_status" | "get_balance" | "get_address" | "get_protocol_state" | "help" | "unknown",
  "params": { ... relevant parameters ... }
}

After parsing, respond naturally confirming what you understood and what action you'll take.`;

// ============================================================================
// Hook Interface
// ============================================================================

interface UseVoicePipelineOptions {
  onVoiceStateChange: (state: VoiceState) => void;
  onMessage: (message: ChatMessage) => void;
  onError: (error: string) => void;
  onGlitch: () => void;
}

interface UseVoicePipelineReturn {
  isConnected: boolean;
  startListening: () => void;
  stopListening: () => void;
  sendTextMessage: (text: string) => void;
}

// ============================================================================
// Main Hook
// ============================================================================

export function useVoicePipeline({
  onVoiceStateChange,
  onMessage,
  onError,
  onGlitch,
}: UseVoicePipelineOptions): UseVoicePipelineReturn {
  const [isConnected, setIsConnected] = useState(false);

  // Refs for persistent objects
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  // ============================================================================
  // Intent Execution (Fire-and-Forget)
  // ============================================================================

  /**
   * Execute intent WITHOUT blocking voice pipeline
   * Uses callback pattern - voice continues while chain processes
   */
  const executeIntentNonBlocking = useCallback((intent: VoiceIntent) => {
    console.log('[Voice] Executing intent (non-blocking):', intent.action);

    // Fire and forget - don't await
    TetsuoAPI.intent.executeIntentAsync(
      intent,
      // Success callback
      (result: ExecutionResult) => {
        console.log('[Voice] Intent result:', result.success);

        // Add result message
        onMessage({
          id: `result_${Date.now()}`,
          role: 'system',
          content: result.message,
          timestamp: Date.now(),
          result,
        });

        // Trigger glitch on successful tx
        if (result.success && result.signature) {
          onGlitch();
        }
      },
      // Error callback
      (err: Error) => {
        console.error('[Voice] Intent execution error:', err);
        onError(`Execution failed: ${err.message}`);
      }
    );
  }, [onMessage, onError, onGlitch]);

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  const connectWebSocket = useCallback(() => {
    const apiKey = import.meta.env.VITE_XAI_API_KEY;

    if (!apiKey) {
      onError('XAI API key not configured. Set VITE_XAI_API_KEY in .env');
      return;
    }

    try {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(`${GROK_WS_URL}?model=grok-2-voice`);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[Voice] WebSocket connected');
        setIsConnected(true);

        const sessionConfig: GrokMessage = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: TETSUO_SYSTEM_PROMPT,
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        };

        ws.send(JSON.stringify(sessionConfig));
      };

      ws.onmessage = (event) => {
        // Parse response synchronously (fast)
        let response: GrokResponse;
        try {
          response = JSON.parse(event.data);
        } catch {
          return;
        }

        // Handle response - chain ops are non-blocking
        handleGrokResponse(response);
      };

      ws.onerror = () => {
        console.error('[Voice] WebSocket error');
        onError('Voice connection error');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[Voice] WebSocket closed');
        setIsConnected(false);
        onVoiceStateChange('idle');
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[Voice] Failed to connect:', error);
      onError(`Failed to connect: ${error}`);
    }
  }, [onError, onVoiceStateChange]);

  // ============================================================================
  // Handle Grok Responses (Non-Blocking)
  // ============================================================================

  const handleGrokResponse = useCallback((response: GrokResponse) => {
    switch (response.type) {
      case 'session.created':
        console.log('[Voice] Session created');
        break;

      case 'input_audio_buffer.speech_started':
        onVoiceStateChange('listening');
        onGlitch();
        break;

      case 'input_audio_buffer.speech_stopped':
        onVoiceStateChange('processing');
        break;

      case 'response.audio.delta':
        if (response.delta?.audio) {
          onVoiceStateChange('speaking');
          const audioData = base64ToFloat32(response.delta.audio);
          audioQueueRef.current.push(audioData);
          // Non-blocking audio playback
          playAudioQueueNonBlocking();
        }
        break;

      case 'response.done':
        onVoiceStateChange('idle');

        if (response.item?.content) {
          for (const content of response.item.content) {
            if (content.text) {
              onMessage({
                id: `tetsuo_${Date.now()}`,
                role: 'tetsuo',
                content: content.text,
                timestamp: Date.now(),
              });

              // Extract and execute intent (non-blocking)
              const intent = extractIntent(content.text);
              if (intent) {
                executeIntentNonBlocking(intent);
              }
            }
          }
        }
        break;

      case 'error':
        console.error('[Voice] Error:', response.error);
        onError(response.error?.message || 'Unknown voice error');
        onVoiceStateChange('error');
        break;
    }
  }, [onVoiceStateChange, onMessage, onError, onGlitch, executeIntentNonBlocking]);

  // ============================================================================
  // Audio Capture (Web Audio API)
  // ============================================================================

  const startAudioCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    mediaStreamRef.current = stream;

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPcm16(inputData);
        const base64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);

        // Send immediately - WebSocket handles buffering
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    console.log('[Voice] Audio capture started');
  }, []);

  const stopAudioCapture = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    console.log('[Voice] Audio capture stopped');
  }, []);

  // ============================================================================
  // Audio Playback (Non-Blocking)
  // ============================================================================

  const playAudioQueueNonBlocking = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const ctx = audioContextRef.current || new AudioContext({ sampleRate: SAMPLE_RATE });

    const playNext = () => {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) {
        isPlayingRef.current = false;
        return;
      }

      const buffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = playNext;
      source.start();
    };

    playNext();
  }, []);

  // ============================================================================
  // Intent Extraction
  // ============================================================================

  const extractIntent = (text: string): VoiceIntent | null => {
    const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        console.warn('[Voice] Failed to parse intent JSON');
      }
    }
    return null;
  };

  // Simple fallback parser for offline mode
  const parseSimpleIntent = (text: string): VoiceIntent | null => {
    const lower = text.toLowerCase();

    if (lower.includes('balance')) {
      return { action: 'get_balance', params: {}, raw_transcript: text };
    }
    if (lower.includes('address')) {
      return { action: 'get_address', params: {}, raw_transcript: text };
    }
    if (lower.includes('list') && lower.includes('task')) {
      return { action: 'list_open_tasks', params: {}, raw_transcript: text };
    }
    if (lower.includes('status') || lower.includes('protocol')) {
      return { action: 'get_protocol_state', params: {}, raw_transcript: text };
    }
    if (lower.includes('help')) {
      return { action: 'help', params: {}, raw_transcript: text };
    }

    return { action: 'unknown', params: {}, raw_transcript: text };
  };

  // ============================================================================
  // Public Methods
  // ============================================================================

  const startListening = useCallback(async () => {
    try {
      onVoiceStateChange('listening');

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }

      await startAudioCapture();
    } catch (error) {
      onVoiceStateChange('error');
      onError(`Failed to start listening: ${error}`);
    }
  }, [connectWebSocket, startAudioCapture, onVoiceStateChange, onError]);

  const stopListening = useCallback(() => {
    stopAudioCapture();
    onVoiceStateChange('idle');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }
  }, [stopAudioCapture, onVoiceStateChange]);

  const sendTextMessage = useCallback((text: string) => {
    // Add user message immediately (non-blocking)
    onMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    onVoiceStateChange('processing');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      }));
      wsRef.current.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text', 'audio'] },
      }));
    } else {
      // Offline fallback - parse and execute locally (non-blocking)
      const simpleIntent = parseSimpleIntent(text);
      if (simpleIntent) {
        executeIntentNonBlocking(simpleIntent);
      }
      onVoiceStateChange('idle');
    }
  }, [onMessage, onVoiceStateChange, executeIntentNonBlocking]);

  // ============================================================================
  // Cleanup
  // ============================================================================

  useEffect(() => {
    return () => {
      stopAudioCapture();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopAudioCapture]);

  return {
    isConnected,
    startListening,
    stopListening,
    sendTextMessage,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function float32ToPcm16(float32Array: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }

  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
