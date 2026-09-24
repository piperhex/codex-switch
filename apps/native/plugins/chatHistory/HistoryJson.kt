package com.codexswitch.history

import android.util.JsonReader
import android.util.JsonToken
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.io.StringReader
import java.io.Writer
import java.security.DigestOutputStream
import java.security.MessageDigest

/** Preserve JS number lexemes and UTF-16 key order, including escapes and unpaired surrogates. */
internal object HistoryJson {
  private sealed interface Value
  private data class Text(val text: String) : Value
  private data class Literal(val text: String) : Value
  private data class Fields(val values: Map<String, Value>) : Value
  private data class Items(val values: List<Value>) : Value
  private const val MAX_DEPTH = 128
  private const val HEX = "0123456789abcdef"

  fun prepare(json: String): WritableMap {
    val value = JsonReader(StringReader(json)).use { reader ->
      val result = read(reader, 0)
      require(reader.peek() == JsonToken.END_DOCUMENT)
      result as Fields
    }
    val fields = Arguments.createMap()
    value.values.forEach { (key, entry) ->
      fields.putMap(key, Arguments.createMap().apply {
        putString("hash", digest(entry))
        if (entry is Text) putInt("length", entry.text.length)
      })
    }
    return Arguments.createMap().apply {
      putMap("fields", fields)
      // Offline record signatures historically hash the JSON string as a JSON string value.
      putString("hash", digest(Text(json)))
    }
  }

  private fun read(reader: JsonReader, depth: Int): Value {
    require(depth <= MAX_DEPTH)
    return when (reader.peek()) {
      JsonToken.BEGIN_OBJECT -> readFields(reader, depth)
      JsonToken.BEGIN_ARRAY -> readItems(reader, depth)
      JsonToken.STRING -> Text(reader.nextString())
      JsonToken.NUMBER -> Literal(reader.nextString())
      JsonToken.BOOLEAN -> Literal(reader.nextBoolean().toString())
      JsonToken.NULL -> { reader.nextNull(); Literal("null") }
      else -> error("Invalid JSON value")
    }
  }

  private fun readFields(reader: JsonReader, depth: Int): Fields {
    reader.beginObject()
    val fields = sortedMapOf<String, Value>()
    while (reader.hasNext()) fields[reader.nextName()] = read(reader, depth + 1)
    reader.endObject()
    return Fields(fields)
  }

  private fun readItems(reader: JsonReader, depth: Int): Items {
    reader.beginArray()
    val items = mutableListOf<Value>()
    while (reader.hasNext()) items.add(read(reader, depth + 1))
    reader.endArray()
    return Items(items)
  }

  private fun digest(value: Value): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val sink = object : OutputStream() {
      override fun write(value: Int) {}
      override fun write(bytes: ByteArray, offset: Int, length: Int) {}
    }
    OutputStreamWriter(DigestOutputStream(sink, digest), Charsets.UTF_8).buffered().use { write(it, value) }
    return buildString { digest.digest().forEach { byte ->
      val number = byte.toInt() and 255
      append(HEX[number ushr 4]); append(HEX[number and 15])
    } }
  }

  private fun write(writer: Writer, value: Value) {
    when (value) {
      is Text -> quote(writer, value.text)
      is Literal -> writer.write(value.text)
      is Fields -> {
        writer.write("{")
        value.values.entries.forEachIndexed { index, (key, entry) ->
          if (index > 0) writer.write(",")
          quote(writer, key); writer.write(":"); write(writer, entry)
        }
        writer.write("}")
      }
      is Items -> {
        writer.write("[")
        value.values.forEachIndexed { index, entry ->
          if (index > 0) writer.write(",")
          write(writer, entry)
        }
        writer.write("]")
      }
    }
  }

  private fun quote(writer: Writer, text: String) {
    writer.write("\"")
    var start = 0
    for (index in text.indices) {
      val escape = escape(text, index) ?: continue
      writer.write(text, start, index - start)
      writer.write(escape)
      start = index + 1
    }
    writer.write(text, start, text.length - start)
    writer.write("\"")
  }

  private fun escape(text: String, index: Int): String? {
    val char = text[index]
    return when (char) {
      '"' -> "\\\""
      '\\' -> "\\\\"
      '\b' -> "\\b"
      '\u000C' -> "\\f"
      '\n' -> "\\n"
      '\r' -> "\\r"
      '\t' -> "\\t"
      else -> {
        val unpaired = (char.isHighSurrogate() && (index + 1 == text.length || !text[index + 1].isLowSurrogate())) ||
          (char.isLowSurrogate() && (index == 0 || !text[index - 1].isHighSurrogate()))
        if (char < ' ' || unpaired) "\\u" + char.code.toString(16).padStart(4, '0') else null
      }
    }
  }
}
