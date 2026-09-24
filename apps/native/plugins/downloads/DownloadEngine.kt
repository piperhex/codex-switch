package com.codexswitch.downloads

import android.os.Process
import android.os.SystemClock
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Scheduling, validation, base64 decoding, disk I/O and checkpoints stay off the UI and JS threads.
 * The bridge forwards bounded RPC packets through the existing authenticated/encrypted chat connection.
 */
internal class DownloadEngine(
  private val storage: DownloadStorage,
  private val emit: (String, String) -> Unit,
  private val requestTimeout: Long = REQUEST_TIMEOUT_MS,
) {
  private val worker = ScheduledThreadPoolExecutor(1) { action ->
    Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); action.run() }, "file-downloads")
  }.apply { removeOnCancelPolicy = true }
  private var tasks: LinkedHashMap<String, DownloadTask>? = null
  private val ready = mutableSetOf<String>()
  private fun jobs(): LinkedHashMap<String, DownloadTask> = tasks ?: storage.load().also { tasks = it }

  fun submit(action: () -> Any?, resolve: (Any?) -> Unit, reject: (Exception) -> Unit) {
    worker.execute { try { resolve(action()) } catch (error: Exception) { reject(error) } }
  }

  fun snapshot(): String = JSONArray().apply { jobs().values.forEach { put(it.data) } }.toString()

  private fun changed(persist: Boolean = true) {
    if (persist) storage.save(jobs().values)
    emit("downloadTasksChanged", snapshot())
  }

  fun enqueue(source: JSONObject): String {
    val existing = jobs().values.find { it.source.toString() == source.toString() && it.status != "completed" }
    if (existing != null) return existing.id
    require(jobs().size < 500)
    val task = DownloadTask.create(source)
    jobs()[task.id] = task
    changed(); pump()
    return task.id
  }

  private fun key(source: JSONObject) = source.getString("owner") + "\n" + source.getString("deviceId")

  fun connection(owner: String, deviceId: String, connected: Boolean) {
    val key = owner + "\n" + deviceId
    if (connected) ready.add(key) else ready.remove(key)
    if (!connected) jobs().values.filter { key(it.source) == key && it.status in listOf("queued", "downloading") }
      .forEach { release(it); it.status = "paused" }
    changed(); pump()
  }

  fun pause(id: String) {
    val task = requireNotNull(jobs()[id])
    if (task.status == "completed") return
    release(task); task.status = "paused"
    changed(); pump()
  }

  fun resume(id: String) {
    val task = requireNotNull(jobs()[id])
    if (task.status in listOf("completed", "queued", "downloading")) return
    require(ready.contains(key(task.source)))
    task.status = "queued"; task.data.put("message", "")
    changed(); pump()
  }

  fun delete(id: String) {
    val task = jobs()[id] ?: return
    release(task); task.status = "paused"
    try { storage.delete(task); jobs().remove(id) }
    finally { changed(); pump() }
  }

  private fun pump() {
    val active = jobs().values.count { it.status == "downloading" }
    jobs().values.filter { it.status == "queued" && ready.contains(key(it.source)) }
      .take(MAX_ACTIVE - active).forEach {
        it.status = "downloading"
        request(it, "open")
      }
    changed()
  }

  private fun request(task: DownloadTask, operation: String) {
    task.pending = UUID.randomUUID().toString(); task.operation = operation
    val requestId = task.pending
    val packet = JSONObject().put("requestId", requestId).put("taskId", task.id).put("source", task.source)
      .put("operation", operation).put("remoteId", task.remoteId).put("offset", task.received)
      .put("length", minOf(CHUNK_BYTES.toLong(), task.size - task.received))
    emit("downloadRequest", packet.toString())
    task.timeout = worker.schedule({
      if (task.pending == requestId) { release(task); task.fail(); changed(); pump() }
    }, requestTimeout, TimeUnit.MILLISECONDS)
  }

  fun accept(requestId: String, json: String?, failed: Boolean): Boolean {
    val task = jobs().values.find { it.pending == requestId } ?: return false
    task.timeout?.cancel(false); task.timeout = null
    task.pending = ""
    try {
      check(!failed)
      val result = JSONObject(requireNotNull(json))
      if (task.operation == "open") opened(task, result) else received(task, result)
      if (task.received == task.size) complete(task) else request(task, "read")
    } catch (_: Exception) { release(task); task.fail(); changed(); pump() }
    return true
  }

  private fun opened(task: DownloadTask, info: JSONObject) {
    val remoteId = info.getString("id")
    UUID.fromString(remoteId); task.remoteId = remoteId
    val size = info.getLong("size")
    require(size >= 0 && size <= 9_007_199_254_740_991L)
    val name = info.getString("name")
    require(name.isNotEmpty() && name !in listOf(".", "..") && name.length <= 255)
    require(name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 })
    val revision = info.optString("revision")
    if (task.received > 0 && (revision.isEmpty() || revision != task.data.optString("revision") || task.size != size)) {
      task.received = 0; task.data.put("message", "文件已更新，已从头下载。")
    }
    task.received = minOf(task.received, storage.part(task).length(), size)
    task.data.put("size", size).put("name", name).put("revision", revision)
      .put("mimeType", info.getString("mimeType"))
    task.lastProgress = SystemClock.elapsedRealtime(); task.sampledBytes = task.received
    storage.prepare(task); changed()
  }

  private fun received(task: DownloadTask, result: JSONObject) {
    val length = minOf(CHUNK_BYTES.toLong(), task.size - task.received).toInt()
    require(result.getLong("offset") == task.received)
    val encoded = result.getString("data")
    require(encoded.length == ((length + 2) / 3) * 4)
    require(encoded.matches(Regex("[A-Za-z0-9+/]*={0,2}")))
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    require(bytes.size == length)
    storage.append(task, bytes)
    storage.save(jobs().values)
    val now = SystemClock.elapsedRealtime()
    val elapsed = now - task.lastProgress
    if (elapsed >= 500) {
      task.data.put("bytesPerSecond", (task.received - task.sampledBytes) * 1000 / elapsed)
      task.lastProgress = now; task.sampledBytes = task.received; changed(false)
    }
  }

  private fun complete(task: DownloadTask) {
    release(task)
    storage.publish(task) { storage.save(jobs().values) }
    task.status = "completed"; task.data.put("message", "已保存到下载文件夹")
    changed()
    storage.removePart(task)
    pump()
  }

  private fun release(task: DownloadTask) {
    task.data.put("bytesPerSecond", 0)
    task.timeout?.cancel(false); task.timeout = null
    task.pending = ""
    if (task.remoteId.isNotEmpty()) {
      emit("downloadRequest", JSONObject().put("operation", "close").put("taskId", task.id)
        .put("source", task.source).put("remoteId", task.remoteId).toString())
      task.remoteId = ""
    }
  }

  fun shutdown() {
    worker.execute {
      jobs().values.filter { it.status in listOf("queued", "downloading") }.forEach {
        release(it); it.status = "paused"
      }
      storage.save(jobs().values)
    }
    worker.shutdown()
  }
}
