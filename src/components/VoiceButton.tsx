/**
 * ============================================================================
 * VoiceButton - Voice Activation Control
 * ============================================================================
 * Large cyberpunk button for activating voice input.
 * Features pulse rings, glow effects, and state-based animations.
 * ============================================================================
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { VoiceState } from '../types';

interface VoiceButtonProps {
  voiceState: VoiceState;
  isConnected: boolean;
  onClick: () => void;
}

export default function VoiceButton({
  voiceState,
  isConnected,
  onClick,
}: VoiceButtonProps) {
  const isListening = voiceState === 'listening';
  const isProcessing = voiceState === 'processing';
  const isSpeaking = voiceState === 'speaking';
  const isActive = isListening || isProcessing || isSpeaking;

  // State-based colors - black and white only
  const stateConfig = {
    idle: { color: '#ffffff', label: 'ACTIVATE' },
    listening: { color: '#ffffff', label: 'LISTENING' },
    processing: { color: '#cccccc', label: 'PROCESSING' },
    speaking: { color: '#ffffff', label: 'SPEAKING' },
    error: { color: '#ffffff', label: 'ERROR' },
    reconnecting: { color: '#ffcc00', label: 'RECONNECTING' },
  };

  const config = stateConfig[voiceState];

  return (
    <div className="relative">
      {/* Outer Pulse Rings */}
      <AnimatePresence>
        {isActive && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: config.color }}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{
                  scale: [1, 1.8],
                  opacity: [0.6, 0],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.5,
                  ease: 'easeOut',
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Main Button */}
      <motion.button
        onClick={onClick}
        disabled={isProcessing || isSpeaking}
        className="relative w-12 h-12 rounded-full flex items-center justify-center"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${config.color}40 0%, ${config.color}10 50%, transparent 70%)`,
          border: `2px solid ${config.color}`,
          boxShadow: `
            0 0 15px ${config.color}40,
            0 0 30px ${config.color}20,
            inset 0 0 15px ${config.color}10
          `,
        }}
        whileHover={{
          scale: 1.05,
          boxShadow: `
            0 0 20px ${config.color}60,
            0 0 40px ${config.color}30,
            inset 0 0 20px ${config.color}20
          `,
        }}
        whileTap={{ scale: 0.95 }}
        animate={{
          scale: isActive ? [1, 1.02, 1] : 1,
        }}
        transition={{
          scale: isActive
            ? { duration: 0.5, repeat: Infinity }
            : { duration: 0.2 },
        }}
      >
        {/* Icon */}
        <motion.div
          className="relative"
          animate={{
            opacity: isProcessing ? [1, 0.5, 1] : 1,
          }}
          transition={{
            duration: 0.5,
            repeat: isProcessing ? Infinity : 0,
          }}
        >
          {/* Microphone Icon */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={config.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isListening ? (
              // Sound waves when listening
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
                {/* Sound waves */}
                <motion.path
                  d="M5 10a9 9 0 0 0 0 4"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
                <motion.path
                  d="M19 10a9 9 0 0 1 0 4"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity, delay: 0.25 }}
                />
              </>
            ) : isProcessing ? (
              // Loading spinner when processing
              <motion.circle
                cx="12"
                cy="12"
                r="8"
                strokeDasharray="50"
                strokeDashoffset="10"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            ) : isSpeaking ? (
              // Sound output when speaking
              <>
                <circle cx="12" cy="12" r="3" fill={config.color} />
                <motion.circle
                  cx="12"
                  cy="12"
                  r="6"
                  strokeDasharray="4 4"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
                <motion.circle
                  cx="12"
                  cy="12"
                  r="9"
                  strokeDasharray="6 6"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                />
              </>
            ) : (
              // Default microphone
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </>
            )}
          </svg>
        </motion.div>

        {/* Inner glow ring */}
        <motion.div
          className="absolute inset-2 rounded-full"
          style={{
            border: `1px solid ${config.color}30`,
          }}
          animate={{
            opacity: isActive ? [0.3, 0.6, 0.3] : 0.3,
          }}
          transition={{
            duration: 1,
            repeat: isActive ? Infinity : 0,
          }}
        />
      </motion.button>

      {/* State Label */}
      <motion.div
        className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        key={voiceState}
      >
        <span
          className="font-display text-[10px] uppercase tracking-widest"
          style={{ color: config.color }}
        >
          {config.label}
        </span>
      </motion.div>

      {/* Connection Status */}
      <div className="absolute -top-1 -right-1">
        <motion.div
          className={`w-2.5 h-2.5 rounded-full border ${
            isConnected
              ? 'bg-neon-green/50 border-neon-green'
              : 'bg-red-500/50 border-red-500'
          }`}
          animate={{
            scale: isConnected ? [1, 1.2, 1] : 1,
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
          }}
          title={isConnected ? 'Voice API Connected' : 'Voice API Disconnected'}
        />
      </div>
    </div>
  );
}
