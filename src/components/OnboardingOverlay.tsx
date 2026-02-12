/**
 * ============================================================================
 * OnboardingOverlay - First-Time User Welcome Flow
 * ============================================================================
 * Shows once on first launch. Walks new users through:
 * 1. Welcome / branding
 * 2. Connect wallet prompt
 * 3. Feature overview (voice, tasks, trading, devices)
 * 4. Ready to go
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { hapticLight, hapticMedium } from '../utils/haptics';

const STORAGE_KEY = 'tetsuo-onboarding-seen';

/** Check if onboarding has been completed */
export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

/** Mark onboarding as completed */
function markOnboardingSeen(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
}

// ============================================================================
// Step Content
// ============================================================================

const STEPS = [
  {
    title: 'WELCOME TO TETSUO',
    subtitle: 'AgenC Operator',
    body: 'Your voice-controlled AI agent for the Solana blockchain. Talk, trade, build, and manage — all from one interface.',
    icon: (
      <svg className="w-16 h-16 text-neon-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    title: 'CONNECT YOUR WALLET',
    subtitle: 'Step 1',
    body: 'Link your Solana wallet to unlock on-chain features — create tasks, claim rewards, and trade tokens. On Seeker, tap "Connect" in the top bar.',
    icon: (
      <svg className="w-16 h-16 text-neon-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    title: 'VOICE COMMANDS',
    subtitle: 'Talk to Tetsuo',
    body: 'Press the voice button and speak naturally. "Create a task for 0.5 SOL", "Swap 1 SOL to USDC", "Post a tweet about our launch" — Tetsuo understands intent and executes.',
    icon: (
      <svg className="w-16 h-16 text-neon-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
  },
  {
    title: 'TASK MARKETPLACE',
    subtitle: 'On-Chain Bounties',
    body: 'Browse open tasks, create bounties with SOL + SKR rewards, and claim work. Everything settles on-chain with escrow protection.',
    icon: (
      <svg className="w-16 h-16 text-neon-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "YOU'RE READY",
    subtitle: 'Let\'s Go',
    body: 'Press the voice button to start talking, or explore the tabs below. Settings (gear icon) let you customize everything. Say "Tetsuo help" anytime for a command list.',
    icon: (
      <svg className="w-16 h-16 text-neon-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
];

// ============================================================================
// Component
// ============================================================================

interface OnboardingOverlayProps {
  onComplete: () => void;
}

export default function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = useCallback(() => {
    hapticLight();
    if (isLast) {
      markOnboardingSeen();
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onComplete]);

  const handleSkip = useCallback(() => {
    hapticMedium();
    markOnboardingSeen();
    onComplete();
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <motion.div
        className="w-full max-w-sm mx-4 rounded-xl border border-white/10 bg-black/90 p-8 text-center"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* Step indicator */}
        <div className="flex justify-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-neon-cyan' : i < step ? 'w-3 bg-neon-cyan/40' : 'w-3 bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Content with transitions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex justify-center mb-4 opacity-80">
              {current.icon}
            </div>

            <p className="text-[10px] font-display uppercase tracking-[0.3em] text-neon-cyan/60 mb-1">
              {current.subtitle}
            </p>

            <h2 className="font-display text-lg uppercase tracking-widest text-white mb-4">
              {current.title}
            </h2>

            <p className="text-sm text-white/60 leading-relaxed mb-8">
              {current.body}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Buttons */}
        <div className="flex gap-3">
          {!isLast && (
            <button
              onClick={handleSkip}
              className="flex-1 py-2.5 text-xs font-display uppercase tracking-widest
                border border-white/10 text-white/40 rounded-lg
                hover:border-white/20 hover:text-white/60 transition-colors"
            >
              Skip
            </button>
          )}
          <motion.button
            onClick={handleNext}
            className={`py-2.5 text-xs font-display uppercase tracking-widest rounded-lg
              bg-neon-cyan/20 border border-neon-cyan/50 text-neon-cyan
              hover:bg-neon-cyan/30 transition-colors ${isLast ? 'flex-1' : 'flex-1'}`}
            whileTap={{ scale: 0.97 }}
          >
            {isLast ? "LET'S GO" : 'Next'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
