/**
 * ============================================================================
 * TetsuoHologram - Cyberpunk Holographic Operator Avatar
 * ============================================================================
 * Animated 3D-ish holographic representation of Tetsuo.
 * Features:
 * - Neon white-haired female cyber-operator aesthetic
 * - Glowing eyes that pulse with voice state
 * - Holographic distortion effects
 * - Circuit/tattoo patterns that light up
 * - Particle effects around the figure
 *
 * Uses CSS 3D transforms and canvas for the holographic effect.
 * Can be upgraded to full Three.js for more advanced rendering.
 * ============================================================================
 */

import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { VoiceState } from '../types';
import { useMouthOpen2D } from '../hooks/useMouthAnimation';

interface TetsuoHologramProps {
  voiceState: VoiceState;
  isGlitching: boolean;
}

export default function TetsuoHologram({ voiceState, isGlitching }: TetsuoHologramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [particles, setParticles] = useState<Particle[]>([]);

  // Get mouth open value from audio analysis
  const mouthOpen = useMouthOpen2D({ enabled: voiceState === 'speaking' });

  // ============================================================================
  // Particle System
  // ============================================================================

  interface Particle {
    id: number;
    x: number;
    y: number;
    size: number;
    speed: number;
    opacity: number;
    color: string;
  }

  useEffect(() => {
    // Generate floating particles
    const newParticles: Particle[] = [];
    for (let i = 0; i < 30; i++) {
      newParticles.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        speed: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.2,
        color: '#ffffff',
      });
    }
    setParticles(newParticles);
  }, []);

  // ============================================================================
  // Scanline Canvas Effect
  // ============================================================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw horizontal scanlines - white
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      for (let y = 0; y < canvas.height; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw data stream lines - white
      const time = Date.now() / 1000;
      for (let i = 0; i < 5; i++) {
        const x = (i * 60 + time * 30) % canvas.width;
        const gradient = ctx.createLinearGradient(x, 0, x, canvas.height);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      requestAnimationFrame(draw);
    };

    draw();
  }, []);

  // ============================================================================
  // Voice State Colors - black and white only
  // ============================================================================

  const stateColors = {
    idle: { glow: '#ffffff', intensity: 0.6 },
    listening: { glow: '#ffffff', intensity: 1 },
    processing: { glow: '#cccccc', intensity: 0.8 },
    speaking: { glow: '#ffffff', intensity: 1 },
    error: { glow: '#ffffff', intensity: 0.8 },
    reconnecting: { glow: '#ffcc00', intensity: 0.7 },
  };

  const currentState = stateColors[voiceState];

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="relative w-[400px] h-[500px] flex items-center justify-center">
      {/* Holographic Base Platform */}
      <div
        className="absolute bottom-0 w-64 h-4 rounded-full"
        style={{
          background: `radial-gradient(ellipse, ${currentState.glow}40 0%, transparent 70%)`,
          boxShadow: `0 0 40px ${currentState.glow}60`,
        }}
      />

      {/* Particle Field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full"
            style={{
              left: `${particle.x}%`,
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              opacity: particle.opacity,
            }}
            animate={{
              y: [0, -400],
              opacity: [particle.opacity, 0],
            }}
            transition={{
              duration: particle.speed * 5,
              repeat: Infinity,
              ease: 'linear',
              delay: Math.random() * 5,
            }}
          />
        ))}
      </div>

      {/* Holographic Figure Container */}
      <motion.div
        className="relative"
        animate={{
          y: isGlitching ? [0, -5, 5, -3, 0] : [0, -5, 0],
          x: isGlitching ? [0, 3, -3, 2, 0] : 0,
        }}
        transition={{
          y: isGlitching
            ? { duration: 0.2 }
            : { duration: 3, repeat: Infinity, ease: 'easeInOut' },
          x: { duration: 0.2 },
        }}
      >
        {/* Main Figure Silhouette */}
        <div
          className="relative w-48 h-80"
          style={{
            filter: `drop-shadow(0 0 20px ${currentState.glow}80)`,
          }}
        >
          {/* Holographic Layers for Depth Effect */}
          <AnimatePresence>
            {[0, 1, 2].map((layer) => (
              <motion.div
                key={layer}
                className="absolute inset-0"
                style={{
                  transform: `translateZ(${layer * 2}px)`,
                  opacity: 1 - layer * 0.2,
                }}
                animate={{
                  opacity: isGlitching
                    ? [1 - layer * 0.2, 0.5, 1 - layer * 0.2]
                    : 1 - layer * 0.2,
                }}
              >
                {/* Figure SVG */}
                <svg
                  viewBox="0 0 200 350"
                  className="w-full h-full"
                  style={{
                    filter: layer > 0 ? `blur(${layer}px)` : 'none',
                  }}
                >
                  {/* Outer Glow */}
                  <defs>
                    <filter id={`glow-${layer}`}>
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>

                    <linearGradient id="holoGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                      <stop offset="50%" stopColor="#ffffff" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
                    </linearGradient>

                    <linearGradient id="hairGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="50%" stopColor="#cccccc" />
                      <stop offset="100%" stopColor="#999999" />
                    </linearGradient>
                  </defs>

                  {/* Hair - Flowing White */}
                  <path
                    d="M100 30 Q130 35 140 60 Q150 90 145 130 Q155 100 160 70 Q155 40 130 25
                       Q100 10 70 25 Q45 40 40 70 Q45 100 55 130 Q50 90 60 60 Q70 35 100 30"
                    fill="url(#hairGradient)"
                    filter={`url(#glow-${layer})`}
                    opacity={0.9}
                  />

                  {/* Additional Hair Strands */}
                  <path
                    d="M60 60 Q40 90 35 140 Q30 180 45 200"
                    stroke="#ffffff"
                    strokeWidth="3"
                    fill="none"
                    opacity={0.6}
                  />
                  <path
                    d="M140 60 Q160 90 165 140 Q170 180 155 200"
                    stroke="#ffffff"
                    strokeWidth="3"
                    fill="none"
                    opacity={0.6}
                  />

                  {/* Face Outline */}
                  <ellipse
                    cx="100"
                    cy="75"
                    rx="35"
                    ry="42"
                    fill="url(#holoGradient)"
                    filter={`url(#glow-${layer})`}
                    opacity={0.85}
                  />

                  {/* Eyes */}
                  <g className="eyes">
                    {/* Left Eye */}
                    <ellipse
                      cx="85"
                      cy="70"
                      rx="8"
                      ry="5"
                      fill={currentState.glow}
                      filter={`url(#glow-${layer})`}
                    >
                      <animate
                        attributeName="opacity"
                        values={voiceState === 'listening' ? '1;0.6;1' : '0.8;0.6;0.8'}
                        dur={voiceState === 'listening' ? '0.5s' : '2s'}
                        repeatCount="indefinite"
                      />
                    </ellipse>

                    {/* Right Eye */}
                    <ellipse
                      cx="115"
                      cy="70"
                      rx="8"
                      ry="5"
                      fill={currentState.glow}
                      filter={`url(#glow-${layer})`}
                    >
                      <animate
                        attributeName="opacity"
                        values={voiceState === 'listening' ? '1;0.6;1' : '0.8;0.6;0.8'}
                        dur={voiceState === 'listening' ? '0.5s' : '2s'}
                        repeatCount="indefinite"
                      />
                    </ellipse>

                    {/* Eye Glow Overlay */}
                    <ellipse cx="85" cy="70" rx="12" ry="8" fill={currentState.glow} opacity={0.2} />
                    <ellipse cx="115" cy="70" rx="12" ry="8" fill={currentState.glow} opacity={0.2} />
                  </g>

                  {/* Mouth - animated by audio */}
                  <g className="mouth">
                    {/* Mouth shape that opens based on audio amplitude */}
                    <ellipse
                      cx="100"
                      cy="95"
                      rx={4 + mouthOpen * 4}
                      ry={1 + mouthOpen * 6}
                      fill={currentState.glow}
                      filter={`url(#glow-${layer})`}
                      opacity={0.8}
                    />
                    {/* Mouth glow when open */}
                    {mouthOpen > 0.1 && (
                      <ellipse
                        cx="100"
                        cy="95"
                        rx={6 + mouthOpen * 6}
                        ry={2 + mouthOpen * 8}
                        fill={currentState.glow}
                        opacity={0.15 * mouthOpen}
                      />
                    )}
                  </g>

                  {/* Neck */}
                  <rect x="90" y="115" width="20" height="25" fill="url(#holoGradient)" opacity={0.7} />

                  {/* Body/Shoulders */}
                  <path
                    d="M60 140 Q70 135 100 135 Q130 135 140 140 Q155 145 160 170
                       L155 280 Q150 320 100 330 Q50 320 45 280 L40 170 Q45 145 60 140"
                    fill="url(#holoGradient)"
                    filter={`url(#glow-${layer})`}
                    opacity={0.75}
                  />

                  {/* Circuit/Tattoo Patterns */}
                  <g stroke={currentState.glow} strokeWidth="1" fill="none" opacity={0.6}>
                    {/* Neck circuit */}
                    <path d="M95 120 L95 135 M105 120 L105 135" />

                    {/* Shoulder circuits */}
                    <path d="M60 155 L45 165 L45 190 L55 200" />
                    <path d="M140 155 L155 165 L155 190 L145 200" />

                    {/* Chest circuit pattern */}
                    <path d="M80 160 L80 180 L90 190 L110 190 L120 180 L120 160" />
                    <circle cx="100" cy="175" r="8" />

                    {/* Arm circuits */}
                    <path d="M50 175 L40 200 L45 240" />
                    <path d="M150 175 L160 200 L155 240" />
                  </g>

                  {/* Data Stream Lines on Body */}
                  <g stroke="#ffffff" strokeWidth="0.5" opacity={0.3}>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <line
                        key={i}
                        x1={60 + i * 8}
                        y1={150}
                        x2={60 + i * 8}
                        y2={300}
                      >
                        <animate
                          attributeName="opacity"
                          values="0.1;0.4;0.1"
                          dur={`${1 + i * 0.1}s`}
                          repeatCount="indefinite"
                        />
                      </line>
                    ))}
                  </g>
                </svg>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Voice State Indicator Ring */}
        <motion.div
          className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 w-32 h-32 rounded-full"
          style={{
            border: `2px solid ${currentState.glow}`,
            boxShadow: `0 0 20px ${currentState.glow}60, inset 0 0 20px ${currentState.glow}20`,
          }}
          animate={{
            scale: voiceState === 'listening' ? [1, 1.1, 1] : 1,
            opacity: voiceState === 'idle' ? 0.4 : 0.8,
          }}
          transition={{
            scale: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
          }}
        />

        {/* Speaking Waveform */}
        {voiceState === 'speaking' && (
          <motion.div
            className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 flex gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {[...Array(7)].map((_, i) => (
              <motion.div
                key={i}
                className="w-1 bg-neon-cyan rounded-full"
                animate={{
                  height: [8, 24, 8],
                }}
                transition={{
                  duration: 0.4,
                  repeat: Infinity,
                  delay: i * 0.05,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* Scanline Overlay Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none opacity-30"
        width={400}
        height={500}
      />

      {/* State Label */}
      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2">
        <motion.div
          className="font-display text-xs uppercase tracking-widest"
          style={{ color: currentState.glow }}
          animate={{
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {voiceState === 'idle' && 'STANDBY'}
          {voiceState === 'listening' && 'LISTENING'}
          {voiceState === 'processing' && 'PROCESSING'}
          {voiceState === 'speaking' && 'SPEAKING'}
          {voiceState === 'error' && 'ERROR'}
        </motion.div>
      </div>
    </div>
  );
}
