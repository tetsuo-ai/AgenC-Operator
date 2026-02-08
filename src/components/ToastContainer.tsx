/**
 * ============================================================================
 * ToastContainer - Cyberpunk Toast Notifications
 * ============================================================================
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore } from '../stores/notificationStore';
import { isMobile } from '../hooks/usePlatform';

const typeStyles = {
  success: {
    border: 'border-neon-green/50',
    bg: 'bg-neon-green/10',
    icon: 'text-neon-green',
    iconChar: '\u2713',
  },
  error: {
    border: 'border-neon-magenta/50',
    bg: 'bg-neon-magenta/10',
    icon: 'text-neon-magenta',
    iconChar: '\u2717',
  },
  warning: {
    border: 'border-yellow-400/50',
    bg: 'bg-yellow-400/10',
    icon: 'text-yellow-400',
    iconChar: '!',
  },
  info: {
    border: 'border-neon-cyan/50',
    bg: 'bg-neon-cyan/10',
    icon: 'text-neon-cyan',
    iconChar: 'i',
  },
};

export default function ToastContainer() {
  const { toasts, removeToast } = useNotificationStore();
  const mobile = isMobile();

  return (
    <div
      className={`fixed z-[100] flex flex-col gap-2 pointer-events-none
        ${mobile ? 'top-2 left-2 right-2' : 'top-14 right-4 w-80'}`}
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const style = typeStyles[toast.type];
          return (
            <motion.div
              key={toast.id}
              className={`pointer-events-auto rounded border ${style.border} ${style.bg}
                backdrop-blur-sm px-3 py-2.5 flex items-start gap-2 cursor-pointer`}
              initial={{ opacity: 0, x: mobile ? 0 : 40, y: mobile ? -20 : 0, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: mobile ? 0 : 40, y: mobile ? -20 : 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              onClick={() => removeToast(toast.id)}
            >
              <span className={`${style.icon} text-sm font-bold mt-0.5 w-4 text-center`}>
                {style.iconChar}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 uppercase tracking-wider">
                  {toast.title}
                </p>
                {toast.message && (
                  <p className="text-[10px] text-white/60 mt-0.5 line-clamp-2">
                    {toast.message}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
