/**
 * ============================================================================
 * Platform Detection — Mobile vs Desktop
 * ============================================================================
 * Detects whether the app is running on Android (Tauri mobile) or desktop.
 * Provides both a plain function (for non-React code) and a hook.
 * ============================================================================
 */

/** Returns true when running inside Tauri Android or an Android browser */
export function isMobile(): boolean {
  // Tauri v2 exposes platform info on the global object
  const tauriPlatform = (window as any).__TAURI_INTERNALS__?.metadata?.currentDevice?.platform;
  if (tauriPlatform === 'android' || tauriPlatform === 'ios') return true;

  // Fallback: user-agent sniffing for WebView / browser contexts
  return /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Returns true when running on desktop (Tauri desktop or desktop browser) */
export function isDesktop(): boolean {
  return !isMobile();
}

/** React hook — re-exports the same value (stable, no state needed) */
export function usePlatform() {
  const mobile = isMobile();
  return { isMobile: mobile, isDesktop: !mobile } as const;
}
