/**
 * ============================================================================
 * TitleBar - Custom Window Title Bar
 * ============================================================================
 * Custom frameless window title bar with window controls.
 * Styled with cyberpunk aesthetics for the transparent window.
 * ============================================================================
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { motion } from 'framer-motion';

export default function TitleBar() {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div className="titlebar">
      {/* Left - Logo & Title */}
      <div className="flex items-center gap-3">
        {/* Animated Logo */}
        <motion.div
          className="w-5 h-5 relative"
          animate={{
            rotate: [0, 360],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
        >
          <div className="absolute inset-0 border border-neon-cyan/50 rotate-45" />
          <div className="absolute inset-1 border border-neon-magenta/50 rotate-45" />
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={{
              rotate: [0, -360],
            }}
            transition={{
              duration: 20,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <div className="w-1.5 h-1.5 bg-neon-cyan rounded-full" />
          </motion.div>
        </motion.div>

        {/* Title */}
        <span className="titlebar-title">
          TETSUO <span className="text-holo-silver/50">//</span> AGENC OPERATOR
        </span>
      </div>

      {/* Center - Status Indicators */}
      <div className="flex items-center gap-4">
        <StatusIndicator label="SYS" status="online" />
        <StatusIndicator label="NET" status="online" />
        <StatusIndicator label="SOL" status="online" />
      </div>

      {/* Right - Window Controls */}
      <div className="window-controls">
        <button
          onClick={handleMinimize}
          className="window-btn minimize"
          title="Minimize"
        />
        <button
          onClick={handleMaximize}
          className="window-btn maximize"
          title="Maximize"
        />
        <button
          onClick={handleClose}
          className="window-btn close"
          title="Close"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Status Indicator
// ============================================================================

interface StatusIndicatorProps {
  label: string;
  status: 'online' | 'offline' | 'warning';
}

function StatusIndicator({ label, status }: StatusIndicatorProps) {
  const colors = {
    online: 'bg-neon-green',
    offline: 'bg-red-500',
    warning: 'bg-yellow-500',
  };

  return (
    <div className="flex items-center gap-1.5">
      <motion.div
        className={`w-1.5 h-1.5 rounded-full ${colors[status]}`}
        animate={{
          opacity: status === 'online' ? [1, 0.5, 1] : 1,
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
        }}
      />
      <span className="text-[10px] text-holo-silver/60 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
