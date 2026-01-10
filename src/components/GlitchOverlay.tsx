/**
 * ============================================================================
 * GlitchOverlay - Cyberpunk Visual Effects Layer
 * ============================================================================
 * Provides scanlines, noise, RGB split, and glitch effects.
 * Activates on voice activity and error states for immersive feedback.
 * ============================================================================
 */

import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface GlitchOverlayProps {
  active: boolean;
  intensity?: 'low' | 'medium' | 'high';
}

export default function GlitchOverlay({
  active,
  intensity = 'medium',
}: GlitchOverlayProps) {
  const noiseCanvasRef = useRef<HTMLCanvasElement>(null);

  // ============================================================================
  // Noise Generator
  // ============================================================================

  useEffect(() => {
    const canvas = noiseCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const generateNoise = () => {
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255;
        data[i] = value; // R
        data[i + 1] = value; // G
        data[i + 2] = value; // B
        data[i + 3] = active ? 15 : 5; // Alpha (more visible when active)
      }

      ctx.putImageData(imageData, 0, 0);

      if (active) {
        animationId = requestAnimationFrame(generateNoise);
      }
    };

    generateNoise();

    // Update periodically even when not active
    const interval = setInterval(() => {
      if (!active) generateNoise();
    }, 100);

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(interval);
    };
  }, [active]);

  // Intensity settings
  const intensityConfig = {
    low: { scanlineOpacity: 0.02, noiseOpacity: 0.03, glitchScale: 0.5 },
    medium: { scanlineOpacity: 0.04, noiseOpacity: 0.05, glitchScale: 1 },
    high: { scanlineOpacity: 0.08, noiseOpacity: 0.1, glitchScale: 2 },
  };

  const config = intensityConfig[intensity];

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {/* Scanlines */}
      <div
        className="absolute inset-0"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 0, 0, ${config.scanlineOpacity}) 2px,
            rgba(0, 0, 0, ${config.scanlineOpacity}) 4px
          )`,
        }}
      />

      {/* Moving Scanline */}
      <motion.div
        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent"
        animate={{
          top: ['0%', '100%'],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Noise Canvas */}
      <canvas
        ref={noiseCanvasRef}
        className="absolute inset-0 w-full h-full mix-blend-overlay"
        style={{ opacity: config.noiseOpacity }}
        width={256}
        height={256}
      />

      {/* RGB Split Effect - Only when active */}
      <AnimatePresence>
        {active && (
          <>
            {/* Red Channel Shift */}
            <motion.div
              className="absolute inset-0"
              style={{
                background: 'rgba(255, 0, 0, 0.02)',
                mixBlendMode: 'screen',
              }}
              initial={{ x: 0 }}
              animate={{
                x: [-2 * config.glitchScale, 2 * config.glitchScale, -2 * config.glitchScale],
              }}
              exit={{ x: 0, opacity: 0 }}
              transition={{
                duration: 0.1,
                repeat: Infinity,
              }}
            />

            {/* Blue Channel Shift */}
            <motion.div
              className="absolute inset-0"
              style={{
                background: 'rgba(0, 0, 255, 0.02)',
                mixBlendMode: 'screen',
              }}
              initial={{ x: 0 }}
              animate={{
                x: [2 * config.glitchScale, -2 * config.glitchScale, 2 * config.glitchScale],
              }}
              exit={{ x: 0, opacity: 0 }}
              transition={{
                duration: 0.1,
                repeat: Infinity,
              }}
            />

            {/* Glitch Bars */}
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute left-0 right-0 bg-white/5"
                style={{
                  height: Math.random() * 4 + 2,
                  top: `${Math.random() * 100}%`,
                }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{
                  scaleX: [0, 1, 0],
                  opacity: [0, 0.5, 0],
                  x: ['-100%', '100%'],
                }}
                transition={{
                  duration: 0.15,
                  repeat: Infinity,
                  repeatDelay: Math.random() * 0.5,
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* CRT Flicker */}
      <motion.div
        className="absolute inset-0 bg-white"
        animate={{
          opacity: active ? [0, 0.01, 0, 0.02, 0] : [0, 0.005, 0],
        }}
        transition={{
          duration: active ? 0.2 : 2,
          repeat: Infinity,
        }}
      />

      {/* Vignette Enhancement when Active */}
      <AnimatePresence>
        {active && (
          <motion.div
            className="absolute inset-0"
            style={{
              boxShadow: 'inset 0 0 150px rgba(0, 0, 0, 0.5)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      {/* Corner Decorations */}
      <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-cyan-500/30" />
      <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-cyan-500/30" />
      <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-cyan-500/30" />
      <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-cyan-500/30" />
    </div>
  );
}
