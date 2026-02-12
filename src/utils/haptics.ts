/**
 * Haptic feedback utility for Android WebView.
 * Uses native Android Vibrator via JavascriptInterface bridge
 * injected in MainActivity.kt ("AndroidHaptics").
 * Falls back to Web Vibration API if bridge not available.
 */

declare global {
  interface Window {
    AndroidHaptics?: {
      vibrate(durationMs: number): void;
      vibratePattern(pattern: string): void;
    };
  }
}

function vibrate(ms: number) {
  if (window.AndroidHaptics) {
    window.AndroidHaptics.vibrate(ms);
  } else {
    navigator.vibrate?.(ms);
  }
}

function vibratePattern(pattern: number[]) {
  if (window.AndroidHaptics) {
    window.AndroidHaptics.vibratePattern(pattern.join(','));
  } else {
    navigator.vibrate?.(pattern);
  }
}

/** Light tap — buttons, nav tabs, toggles */
export function hapticLight() {
  vibrate(8);
}

/** Medium tap — important actions, confirms */
export function hapticMedium() {
  vibrate(15);
}

/** Heavy tap — destructive or significant actions */
export function hapticHeavy() {
  vibrate(25);
}

/** Double pulse — success feedback */
export function hapticSuccess() {
  vibratePattern([10, 50, 10]);
}
