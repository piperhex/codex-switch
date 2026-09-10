package com.codexswitch.chat

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.common.LifecycleState

class ChatBackgroundModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ChatBackground"

  @ReactMethod
  fun start(promise: Promise) {
    if (ChatConnectionService.running) { promise.resolve(true); return }
    if (context.lifecycleState != LifecycleState.RESUMED) { promise.resolve(false); return }
    try {
      ContextCompat.startForegroundService(context, Intent(context, ChatConnectionService::class.java))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("CHAT_BACKGROUND_UNAVAILABLE", "暂时无法保持后台聊天，请重新打开应用。", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    context.stopService(Intent(context, ChatConnectionService::class.java))
    promise.resolve(null)
  }

  override fun invalidate() {
    context.stopService(Intent(context, ChatConnectionService::class.java))
    super.invalidate()
  }
}
