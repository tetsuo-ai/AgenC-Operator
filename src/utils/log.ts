/**
 * Shared logger — writes to both browser console and Tauri terminal via DebugAPI.
 *
 * Production filtering:
 *   VITE_DEBUG=true  → all levels (debug, info, warn, error)
 *   VITE_DEBUG=false → warn + error only
 */

import { DebugAPI } from '../api';

const IS_DEBUG = import.meta.env.VITE_DEBUG === 'true';

// No-op for silenced levels
const noop = () => {};

export const log = {
  debug: IS_DEBUG ? (msg: string) => { console.log(msg); DebugAPI.debug(msg); } : noop,
  info:  IS_DEBUG ? (msg: string) => { console.log(msg); DebugAPI.info(msg); }  : noop,
  warn:  (msg: string) => { console.warn(msg); DebugAPI.warn(msg); },
  error: (msg: string) => { console.error(msg); DebugAPI.error(msg); },
};
