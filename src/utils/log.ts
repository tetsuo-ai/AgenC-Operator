/**
 * Shared logger — writes to both browser console and Tauri terminal via DebugAPI.
 */

import { DebugAPI } from '../api';

export const log = {
  debug: (msg: string) => { console.log(msg); DebugAPI.debug(msg); },
  info: (msg: string) => { console.log(msg); DebugAPI.info(msg); },
  warn: (msg: string) => { console.warn(msg); DebugAPI.warn(msg); },
  error: (msg: string) => { console.error(msg); DebugAPI.error(msg); },
};
