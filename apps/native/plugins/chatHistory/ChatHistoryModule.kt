package com.codexswitch.history

import android.os.Process
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Hashing and canonical JSON traversal never run on the JS, UI or native-modules thread. */
class ChatHistoryModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  @Volatile private var invalidated = false
  private val worker = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(8)) {
    task -> Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "chat-history")
  }

  override fun getName() = "ChatHistoryWorker"

  @ReactMethod
  fun prepare(json: ReadableArray, promise: Promise) {
    val task = Preparation(json, promise)
    try { worker.execute(task) }
    catch (_: RejectedExecutionException) { task.cancel() }
  }

  private inner class Preparation(private val input: ReadableArray, private val promise: Promise) : Runnable {
    fun cancel() { promise.reject("HISTORY_CANCELLED", "聊天记录处理已中断，请重试。") }

    override fun run() {
      if (invalidated) { cancel(); return }
      try {
        require(input.size() <= MAX_BATCH_OBJECTS)
        var chars = 0
        val results = Arguments.createArray()
        for (index in 0 until input.size()) {
          if (invalidated || Thread.currentThread().isInterrupted) { cancel(); return }
          val json = requireNotNull(input.getString(index))
          chars += json.length
          require(chars <= MAX_BATCH_CHARS)
          results.pushMap(HistoryJson.prepare(json))
        }
        if (invalidated) cancel() else promise.resolve(results)
      } catch (_: Exception) { promise.reject("HISTORY_PREPARATION", "聊天记录处理未完成，请重试。") }
    }
  }

  override fun invalidate() {
    invalidated = true
    worker.shutdownNow().forEach { (it as Preparation).cancel() }
    super.invalidate()
  }

  companion object {
    private const val MAX_BATCH_OBJECTS = 16
    // A normal batch is 128 KiB; one large tool output may span the protocol's complete message budget.
    private const val MAX_BATCH_CHARS = 32 * 1024 * 1024
  }
}
