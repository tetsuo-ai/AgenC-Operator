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
import { getGlobalMouthDriver, getGlobalAudioContext } from '../utils/mouthDriver';
import { log } from '../utils/log';
import type {
  VoiceState,
  ChatMessage,
  VoiceIntent,
  ExecutionResult,
  GrokMessage,
  GrokResponse,
  Memory,
} from '../types';

// ============================================================================
// Configuration
// ============================================================================

const GROK_WS_URL = 'wss://api.x.ai/v1/realtime';
const SAMPLE_RATE = 24000;

// Debug flag - set to true to see WebSocket messages
const DEBUG_WS = true;

const TETSUO_SYSTEM_PROMPT = `You are Tetsuo, a cyberpunk AI operator for the AgenC protocol on Solana.
You help users manage tasks on the blockchain, trade tokens, write code, and post to social media.

Your personality:
- Cool, collected, slightly mysterious cyberpunk aesthetic
- Efficient and direct, but with a touch of style
- Use subtle cyberpunk slang occasionally ("jacking in", "the net", "flatline")
- Always confirm important actions before executing

CAPABILITIES:

TASK MANAGEMENT:
- "Create a task: [description] with [amount] SOL reward"
- "Claim task [id]"
- "Complete task [id]"
- "Cancel task [id]"
- "List open tasks"
- "Get task status [id]"

WALLET:
- "What's my balance?"
- "What's my address?"

CODE (Pro tier):
- "Fix the bug in [file] where [issue]"
- "Review [file]"
- "Generate a [language] function that [description]"
- "Explain [file]"

TRADING (Basic tier):
- "Swap [amount] SOL for USDC"
- "What's the price of [token]?"
- "Get quote for [amount] [token] to [token]"

SOCIAL (Pro tier):
- "Post to Twitter: [content]"
- "Post a thread about [topic]"

When you receive a command, parse it into a JSON intent with this structure:
{
  "action": "create_task" | "claim_task" | "complete_task" | "cancel_task" | "list_open_tasks" | "get_task_status" | "get_balance" | "get_address" | "get_protocol_state" | "code_fix" | "code_review" | "code_generate" | "code_explain" | "swap_tokens" | "get_swap_quote" | "get_token_price" | "post_tweet" | "post_thread" | "help" | "unknown",
  "params": { ... relevant parameters ... }
}

For CODE actions, params should include: file_path, issue_description (for fix), language (for generate), description (for generate)
For SWAP actions, params should include: from_token, to_token, amount
For TWITTER actions, params should include: content (for tweet), tweets (array for thread)

After parsing, respond naturally confirming what you understood and what action you'll take.
For financial operations (swaps, task creation), ALWAYS confirm the amount before executing.`;

/**
 * Format memories for injection into system prompt
 */
function formatMemoriesForPrompt(memories: Memory[]): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const memoryLines = memories.map((m) => {
    const typeLabel = m.memory_type.replace(/_/g, ' ');
    return `- [${typeLabel}] ${m.content}`;
  });

  return `

## User Context (from previous conversations)
${memoryLines.join('\n')}

Use this context to personalize your responses. Reference relevant memories when appropriate.`;
}

// ============================================================================
// Hook Interface
// ============================================================================

interface UseVoicePipelineOptions {
  onVoiceStateChange: (state: VoiceState) => void;
  onMessage: (message: ChatMessage) => void;
  onError: (error: string) => void;
  onGlitch: () => void;
  /** User ID for memory context (typically wallet address) */
  userId?: string;
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
  userId,
}: UseVoicePipelineOptions): UseVoicePipelineReturn {
  const [isConnected, setIsConnected] = useState(false);

  // Refs for persistent objects
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentTranscriptRef = useRef<string>('');
  const responseDoneRef = useRef(false); // Track when response.done received
  const currentUserMessageRef = useRef<string>(''); // Track current user message for memory storage

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

  /**
   * Store conversation exchange to memory (non-blocking)
   * Extracts important facts and stores them
   */
  const storeConversationMemory = useCallback((
    memoryUserId: string,
    userMessage: string,
    tetsuoResponse: string
  ) => {
    // Fire and forget - don't block voice pipeline
    (async () => {
      try {
        // Don't store empty messages
        if (!userMessage || !tetsuoResponse) return;

        // Store the exchange as a summary
        const topic = extractTopicFromResponse(tetsuoResponse);
        const summary = `User: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}" - Tetsuo: ${topic}`;

        await TetsuoAPI.memory.storeMemory(
          memoryUserId,
          summary,
          'summary',
          0.5
        );

        // Extract any user facts mentioned
        const userFacts = extractUserFacts(userMessage);
        for (const fact of userFacts) {
          await TetsuoAPI.memory.storeMemory(
            memoryUserId,
            fact,
            'user_fact',
            0.7
          );
        }

        if (userFacts.length > 0) {
          log.debug('[Voice] Stored ' + userFacts.length + ' user facts to memory');
        }
        log.debug('[Voice] Stored conversation to memory');
      } catch (err) {
        log.warn('[Voice] Failed to store memory: ' + err);
      }
    })();
  }, []);

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  const connectWebSocket = useCallback(async () => {
    // Get ephemeral token from Tauri backend (keeps API key secure)
    let token: string;
    try {
      token = await TetsuoAPI.voice.getVoiceToken();
    } catch (err) {
      onError(`${err}`);
      return;
    }

    try {
      if (wsRef.current) {
        wsRef.current.close();
      }

      // x.ai Realtime API - use ephemeral token for browser auth
      // Token was obtained securely from backend using the API key
      // x.ai is OpenAI API compatible - use same subprotocol auth pattern
      const ws = new WebSocket(
        GROK_WS_URL,
        ['realtime', `openai-insecure-api-key.${token}`, 'openai-beta.realtime-v1']
      );
      ws.binaryType = 'arraybuffer';

      ws.onopen = async () => {
        log.info('[Voice] WebSocket connected to x.ai');
        if (DEBUG_WS) log.debug('[Voice] Sending session config...');
        setIsConnected(true);

        // Build enhanced system prompt with memory context
        let systemPrompt = TETSUO_SYSTEM_PROMPT;

        if (userId) {
          try {
            log.debug('[Voice] Fetching user context for: ' + userId);
            // Pass current message for contextual semantic search (may be empty on initial connect)
            const context = await TetsuoAPI.memory.buildVoiceContext(userId, currentUserMessageRef.current || undefined);

            if (context && context.relevant_memories.length > 0) {
              const memoryContext = formatMemoriesForPrompt(context.relevant_memories);
              systemPrompt += memoryContext;
              log.info('[Voice] Injected ' + context.relevant_memories.length + ' memories into context');
            }

            // Add tier info to prompt
            if (context?.access_tier) {
              systemPrompt += `\n\n## User Access Level\nUser has ${context.access_tier.toUpperCase()} tier access.`;
            }
          } catch (err) {
            log.warn('[Voice] Failed to fetch user context: ' + err);
            // Continue without memory context
          }
        }

        // x.ai compatible session config
        const sessionConfig: GrokMessage = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: systemPrompt,
            voice: 'sage', // x.ai voice options: sage, ember, ash, ballad, coral, verse
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

        if (DEBUG_WS) log.debug('[Voice] Session config: ' + JSON.stringify(sessionConfig));
        ws.send(JSON.stringify(sessionConfig));
      };

      ws.onmessage = (event) => {
        // Parse response synchronously (fast)
        let response: GrokResponse;
        try {
          if (typeof event.data === 'string') {
            response = JSON.parse(event.data);
            if (DEBUG_WS) log.debug('[Voice] Received: ' + response.type);
          } else {
            // Binary data - might be audio
            if (DEBUG_WS) log.debug('[Voice] Received binary data: ' + event.data.byteLength + ' bytes');
            return;
          }
        } catch (e) {
          log.error('[Voice] Failed to parse message: ' + e);
          return;
        }

        // Handle response - chain ops are non-blocking
        handleGrokResponse(response);
      };

      ws.onerror = (event) => {
        log.error('[Voice] WebSocket error');
        // Try to get more error details
        const errorDetails = (event as any).message || (event as any).error || 'Unknown error';
        log.error('[Voice] Error details: ' + errorDetails);
        onError('Voice API connection failed. Check your API key and network connection.');
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        log.info('[Voice] WebSocket closed: ' + event.code + ' ' + event.reason);
        if (event.code !== 1000) {
          log.warn('[Voice] Abnormal close - code: ' + event.code + ' reason: ' + event.reason);
        }
        setIsConnected(false);
        onVoiceStateChange('idle');
      };

      wsRef.current = ws;
    } catch (error) {
      log.error('[Voice] Failed to connect: ' + error);
      onError(`Failed to connect: ${error}`);
    }
  }, [onError, onVoiceStateChange, userId]);

  // ============================================================================
  // Handle Grok Responses (Non-Blocking)
  // ============================================================================

  const handleGrokResponse = useCallback((response: GrokResponse) => {
    switch (response.type) {
      case 'session.created':
        log.info('[Voice] Session created successfully');
        break;

      case 'session.updated':
        log.info('[Voice] Session updated');
        break;

      case 'error':
        log.error('[Voice] API Error: ' + JSON.stringify(response.error));
        onError(response.error?.message || 'Unknown voice error');
        onVoiceStateChange('error');
        break;

      case 'input_audio_buffer.speech_started':
        onVoiceStateChange('listening');
        onGlitch();
        break;

      case 'input_audio_buffer.speech_stopped':
        onVoiceStateChange('processing');
        break;

      case 'response.created':
        // Reset transcript accumulator for new response
        currentTranscriptRef.current = '';
        // Reset responseDone flag for new response
        responseDoneRef.current = false;
        break;

      // x.ai sends audio as response.output_audio.delta (not response.audio.delta)
      case 'response.output_audio.delta':
        if (response.delta) {
          onVoiceStateChange('speaking');
          // delta can be string directly or object with audio field
          const audioBase64 = typeof response.delta === 'string'
            ? response.delta
            : response.delta.audio;
          if (audioBase64) {
            const audioData = base64ToFloat32(audioBase64);
            audioQueueRef.current.push(audioData);
            // Non-blocking audio playback
            playAudioQueueNonBlocking();
          }
        }
        break;

      // x.ai sends text transcript incrementally
      case 'response.output_audio_transcript.delta':
        if (response.delta) {
          // delta can be string directly or object with text field
          const deltaText = typeof response.delta === 'string'
            ? response.delta
            : (response.delta.text || response.delta.transcript || '');
          currentTranscriptRef.current += deltaText;
        }
        break;

      case 'response.output_audio_transcript.done':
        // Full transcript is now available
        if (response.transcript || currentTranscriptRef.current) {
          const text = response.transcript || currentTranscriptRef.current;
          log.info('[Voice] Tetsuo said: ' + text);

          onMessage({
            id: `tetsuo_${Date.now()}`,
            role: 'tetsuo',
            content: text,
            timestamp: Date.now(),
          });

          // Extract and execute intent (non-blocking)
          const intent = extractIntent(text);
          if (intent) {
            executeIntentNonBlocking(intent);
          }

          // Store conversation to memory (non-blocking)
          if (userId && currentUserMessageRef.current) {
            storeConversationMemory(
              userId,
              currentUserMessageRef.current,
              text
            );
          }
        }
        break;

      case 'response.done':
        // Mark response as done, but DON'T go to idle yet
        // The audio queue may still be playing - playAudioQueueNonBlocking
        // will set idle when the queue is actually empty
        responseDoneRef.current = true;
        // Only go idle immediately if no audio is playing/queued
        if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
          onVoiceStateChange('idle');
        }
        break;
    }
  }, [onVoiceStateChange, onMessage, onError, onGlitch, executeIntentNonBlocking, storeConversationMemory, userId]);

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

  // Track if we've logged audio routing setup
  const audioRoutingLoggedRef = useRef(false);

  const playAudioQueueNonBlocking = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    // Use global audio context and mouth driver for amplitude analysis
    const ctx = getGlobalAudioContext();
    const mouthDriver = getGlobalMouthDriver(ctx);

    // Log audio routing once
    if (!audioRoutingLoggedRef.current) {
      audioRoutingLoggedRef.current = true;
      console.log('[Voice] Audio routing setup:');
      console.log('  - AudioContext state:', ctx.state);
      console.log('  - MouthDriver inputNode:', mouthDriver.inputNode);
      console.log('  - MouthDriver outputNode:', mouthDriver.outputNode);
      console.log('  - Destination:', ctx.destination);

      // Resume AudioContext if suspended (required for user gesture)
      if (ctx.state === 'suspended') {
        console.log('[Voice] Resuming suspended AudioContext...');
        ctx.resume().then(() => {
          console.log('[Voice] AudioContext resumed, state:', ctx.state);
        });
      }
    }

    const playNext = () => {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) {
        isPlayingRef.current = false;
        // Audio queue is empty - if response.done was received, go to idle
        if (responseDoneRef.current) {
          onVoiceStateChange('idle');
        }
        return;
      }

      const buffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Route through mouth driver for amplitude analysis
      source.connect(mouthDriver.inputNode);
      source.onended = playNext;
      source.start();
    };

    playNext();
  }, [onVoiceStateChange]);

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
        await connectWebSocket();
      }

      await startAudioCapture();
    } catch (error) {
      onVoiceStateChange('error');

      // Provide specific error messages for common issues
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          onError('Microphone access denied. Please allow microphone access in your system settings.');
        } else if (error.name === 'NotFoundError') {
          onError('No microphone found. Please connect a microphone and try again.');
        } else if (error.name === 'NotReadableError') {
          onError('Microphone is in use by another application.');
        } else {
          onError(`Microphone error: ${error.message}`);
        }
      } else {
        onError(`Failed to start listening: ${error}`);
      }
    }
  }, [connectWebSocket, startAudioCapture, onVoiceStateChange, onError]);

  const stopListening = useCallback(() => {
    stopAudioCapture();
    onVoiceStateChange('idle');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }
  }, [stopAudioCapture, onVoiceStateChange]);

  const sendTextMessage = useCallback(async (text: string) => {
    log.info('[Voice] sendTextMessage called: ' + text);

    // Store user message for memory storage later
    currentUserMessageRef.current = text;

    // Add user message immediately (non-blocking)
    onMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    onVoiceStateChange('processing');

    // Connect WebSocket if not already connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      log.info('[Voice] WebSocket not connected, connecting...');
      await connectWebSocket();
      // Wait a bit for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const wsState = wsRef.current?.readyState;
    log.info('[Voice] WebSocket state: ' + wsState + ' (OPEN=1, CLOSED=3)');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send via WebSocket
      const createMsg = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      };
      const responseMsg = {
        type: 'response.create',
        response: { modalities: ['text', 'audio'] },
      };

      if (DEBUG_WS) {
        log.debug('[Voice] Sending: ' + JSON.stringify(createMsg));
        log.debug('[Voice] Sending: ' + JSON.stringify(responseMsg));
      }

      wsRef.current.send(JSON.stringify(createMsg));
      wsRef.current.send(JSON.stringify(responseMsg));
    } else {
      log.warn('[Voice] WebSocket not open, using offline fallback');
      // Offline fallback - parse and execute locally (non-blocking)
      const simpleIntent = parseSimpleIntent(text);
      if (simpleIntent) {
        executeIntentNonBlocking(simpleIntent);
      }
      onVoiceStateChange('idle');
    }
  }, [onMessage, onVoiceStateChange, executeIntentNonBlocking, connectWebSocket]);

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

// ============================================================================
// Memory Extraction Helpers
// ============================================================================

/**
 * Extract topic from response for summary
 */
function extractTopicFromResponse(text: string): string {
  // Simple heuristic - first 50 chars or first sentence
  const firstSentence = text.split(/[.!?]/)[0];
  return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
}

/**
 * Extract user facts from message (simple patterns)
 */
function extractUserFacts(text: string): string[] {
  const facts: string[] = [];
  const lower = text.toLowerCase();

  // Name patterns
  const nameMatch = text.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)/i);
  if (nameMatch) {
    facts.push(`User's name is ${nameMatch[1]}`);
  }

  // Preference patterns
  if (lower.includes('i prefer') || lower.includes('i like') || lower.includes('i want')) {
    facts.push(`User preference: ${text.slice(0, 100)}`);
  }

  // Location patterns
  const locationMatch = text.match(/(?:i live in|i'm from|i'm in|based in)\s+([A-Z][a-zA-Z\s]+)/i);
  if (locationMatch) {
    facts.push(`User location: ${locationMatch[1].trim()}`);
  }

  // Work/occupation patterns
  const workMatch = text.match(/(?:i work as|i'm a|i am a|my job is)\s+([a-zA-Z\s]+)/i);
  if (workMatch) {
    facts.push(`User occupation: ${workMatch[1].trim().slice(0, 50)}`);
  }

  return facts;
}
