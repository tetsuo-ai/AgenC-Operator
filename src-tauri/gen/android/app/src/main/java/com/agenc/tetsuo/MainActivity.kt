package com.agenc.tetsuo

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Force light (white) status bar and navigation bar icons for dark app
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false
  }

  override fun onWebViewCreate(webView: WebView) {
    WebView.setWebContentsDebuggingEnabled(true)
    webView.addJavascriptInterface(HapticsInterface(this), "AndroidHaptics")
  }
}

class HapticsInterface(private val context: Context) {

  private fun getVibrator(): Vibrator {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
      manager.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
  }

  @JavascriptInterface
  fun vibrate(durationMs: Long) {
    val vibrator = getVibrator()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(durationMs)
    }
  }

  @JavascriptInterface
  fun vibratePattern(pattern: String) {
    val vibrator = getVibrator()
    val timings = pattern.split(",").map { it.trim().toLong() }.toLongArray()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(timings, -1)
    }
  }
}
