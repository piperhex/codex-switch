package com.codexswitch.desktop

import android.content.Context
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.IllegalViewOperationException
import com.facebook.react.uimanager.UIManagerHelper

/** Update the viewer's dialog window; Activity status-bar changes do not update an already open RN Modal. */
class DesktopWindowModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "DesktopWindow"

  @ReactMethod
  fun setImmersive(tag: Int, enabled: Boolean, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val view = UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag)
        if (view != null && view.isAttachedToWindow) applyImmersive(view.rootView, enabled)
        promise.resolve(null)
      } catch (_: IllegalViewOperationException) {
        // Closing the dialog can detach the stage before its final layout callback reaches native code.
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun showKeyboard(tag: Int, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val container = UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag)
        val input = container?.let { findWebView(it) }
        if (input != null && input.isAttachedToWindow) {
          // DOM focus alone does not request Android's IME when the editor is created inside a Modal.
          input.requestFocus()
          val keyboard = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
          keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
        promise.resolve(null)
      } catch (_: IllegalViewOperationException) {
        // The user may switch tabs before the input document finishes loading.
        promise.resolve(null)
      }
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  private fun applyImmersive(root: View, enabled: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      root.windowInsetsController?.let { controller ->
        controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (enabled) controller.hide(WindowInsets.Type.systemBars())
        else controller.show(WindowInsets.Type.systemBars())
      }
    } else {
      applyLegacyImmersive(root, enabled)
    }
  }

  @Suppress("DEPRECATION") // Android 7–10 require the legacy flags on the dialog's decor view.
  private fun applyLegacyImmersive(root: View, enabled: Boolean) {
    val flags = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    root.systemUiVisibility = if (enabled) root.systemUiVisibility or flags
      else root.systemUiVisibility and flags.inv()
  }
}
