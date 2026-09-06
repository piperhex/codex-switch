use serde_json::Value as JsonValue;
use toml_edit::{Array, DocumentMut, InlineTable, Item, TableLike, Value};

use super::{
    document::{self, MAX_DEPTH, MAX_SAFE_INTEGER},
    error::ConfigError,
};

const MAX_KEY_BYTES: usize = 4096;

pub(super) fn apply(
    source: &str,
    path: &[String],
    replacement: &JsonValue,
) -> Result<String, ConfigError> {
    if path.is_empty() || path.len() > MAX_DEPTH || path.iter().any(|key| key.len() > MAX_KEY_BYTES)
    {
        return Err(ConfigError::InvalidPath);
    }
    let mut document: DocumentMut = document::parse(source)?;
    patch_table(document.as_table_mut(), path, replacement)?;
    let content = document.to_string();
    document::parse(&content)?;
    Ok(content)
}

fn patch_table(
    table: &mut dyn TableLike,
    path: &[String],
    replacement: &JsonValue,
) -> Result<(), ConfigError> {
    let (key, remaining) = path.split_first().ok_or(ConfigError::InvalidPath)?;
    if remaining.is_empty() {
        return replace_value(table, key, replacement);
    }
    if !table.contains_key(key) {
        if replacement.is_null() {
            return Ok(());
        }
        table.insert(key, Item::Value(Value::InlineTable(InlineTable::new())));
    }
    let child = table
        .get_mut(key)
        .and_then(Item::as_table_like_mut)
        .ok_or(ConfigError::InvalidPath)?;
    patch_table(child, remaining, replacement)
}

fn replace_value(
    table: &mut dyn TableLike,
    key: &str,
    replacement: &JsonValue,
) -> Result<(), ConfigError> {
    if replacement.is_null() {
        table.remove(key);
        return Ok(());
    }
    let mut value = json_value(replacement, 0)?;
    if let Some(existing) = table.get_mut(key) {
        if let Some(previous) = existing.as_value() {
            *value.decor_mut() = previous.decor().clone();
        }
        // Replacing the item in place retains quoted keys, their comments, and ordering.
        *existing = Item::Value(value);
    } else {
        table.insert(key, Item::Value(value));
    }
    Ok(())
}

fn json_value(value: &JsonValue, depth: usize) -> Result<Value, ConfigError> {
    if depth > MAX_DEPTH {
        return Err(ConfigError::InvalidValue);
    }
    match value {
        JsonValue::Null => Err(ConfigError::InvalidValue),
        JsonValue::Bool(value) => Ok(Value::from(*value)),
        JsonValue::String(value) => Ok(Value::from(value.as_str())),
        JsonValue::Number(value) => number_value(value),
        JsonValue::Array(values) => {
            let mut array = Array::new();
            for value in values {
                array.push(json_value(value, depth + 1)?);
            }
            Ok(Value::Array(array))
        }
        JsonValue::Object(values) => {
            let mut table = InlineTable::new();
            for (key, value) in values {
                table.insert(key, json_value(value, depth + 1)?);
            }
            Ok(Value::InlineTable(table))
        }
    }
}

fn number_value(value: &serde_json::Number) -> Result<Value, ConfigError> {
    if let Some(integer) = value.as_i64() {
        return (integer.unsigned_abs() <= MAX_SAFE_INTEGER as u64)
            .then(|| Value::from(integer))
            .ok_or(ConfigError::InvalidValue);
    }
    if value.is_u64() {
        return Err(ConfigError::InvalidValue);
    }
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .map(Value::from)
        .ok_or(ConfigError::InvalidValue)
}
