package com.codexswitch.downloads

import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ScheduledFuture

internal const val CHUNK_BYTES = 256 * 1024
internal const val MAX_ACTIVE = 2
internal const val REQUEST_TIMEOUT_MS = 60_000L

internal class DownloadTask(val data: JSONObject) {
  val id: String get() = data.getString("id")
  val source: JSONObject get() = data.getJSONObject("source")
  var status: String
    get() = data.getString("status")
    set(value) { data.put("status", value) }
  var received: Long
    get() = data.optLong("received")
    set(value) { data.put("received", value) }
  val size: Long get() = data.optLong("size")
  var remoteId = ""
  var pending = ""
  var operation = ""
  var lastProgress = 0L
  var sampledBytes = 0L
  var timeout: ScheduledFuture<*>? = null

  fun fail() {
    status = "failed"
    data.put("message", "下载中断，请检查电脑连接和手机存储空间后继续。")
  }

  companion object {
    fun create(source: JSONObject): DownloadTask {
      require(source.getString("owner").length in 1..1024)
      require(source.getString("deviceId").length in 1..256)
      require(source.getString("path").length in 1..4096)
      require(source.getString("scope") in listOf("project", "computer"))
      return DownloadTask(JSONObject().put("id", UUID.randomUUID().toString()).put("source", source)
        .put("name", source.getString("path").replace('\\', '/').substringAfterLast('/'))
        .put("status", "queued").put("received", 0).put("size", 0).put("message", "")
        .put("createdAt", System.currentTimeMillis()))
    }
  }
}
