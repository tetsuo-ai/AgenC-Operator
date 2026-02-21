/**
 * ============================================================================
 * BottomNav - Mobile Navigation Bar
 * ============================================================================
 * Touch-friendly bottom navigation for mobile. Replaces desktop keyboard
 * shortcuts (C/H/M) with tappable tabs for Chat, Tasks, and Settings.
 * Only renders on mobile — desktop uses keyboard shortcuts.
 * ============================================================================
 */

import { motion } from 'framer-motion';
import { FEATURES } from '../config/platform';
import { hapticLight } from '../utils/haptics';

type Tab = 'chat' | 'tasks' | 'store' | 'devices' | 'settings';

interface BottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  taskCount?: number;
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: 'chat',
    label: 'CHAT',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'TASKS',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'store',
    label: 'STORE',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
  },
  {
    id: 'devices',
    label: 'DEVICES',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function BottomNav({ activeTab, onTabChange, taskCount }: BottomNavProps) {
  if (!FEATURES.bottomNav) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 safe-area-bottom"
      style={{
        background: 'rgba(0, 0, 0, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center justify-around h-14">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => { hapticLight(); onTabChange(tab.id); }}
              className="flex flex-col items-center justify-center flex-1 h-full relative"
              aria-label={tab.label}
              whileTap={{ scale: 0.9 }}
              transition={{ duration: 0.1 }}
            >
              {isActive && (
                <motion.div
                  className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-white"
                  layoutId="bottomnav-indicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                />
              )}
              <motion.span
                className="relative"
                animate={{
                  scale: isActive ? 1 : 0.9,
                  color: isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.4)',
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                {tab.icon}
                {tab.id === 'tasks' && (taskCount ?? 0) > 0 && !isActive && (
                  <motion.span
                    className="absolute -top-1 -right-2 min-w-[14px] h-[14px] flex items-center justify-center
                      rounded-full bg-neon-cyan text-black text-[8px] font-bold px-0.5"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  >
                    {taskCount! > 99 ? '99+' : taskCount}
                  </motion.span>
                )}
              </motion.span>
              <motion.span
                className="text-[9px] mt-0.5 font-display tracking-widest"
                animate={{
                  color: isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.4)',
                }}
                transition={{ duration: 0.2 }}
              >
                {tab.label}
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}

export type { Tab };
