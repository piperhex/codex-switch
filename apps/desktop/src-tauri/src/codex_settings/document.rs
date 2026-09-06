use serde_json::{Map, Number, Value as JsonValue};
use toml_edit::{DocumentMut, Item, TableLike, Value};

use super::{error::ConfigError, models::ConfigDiagnostic};

pub(super) const MAX_CONTENT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_DEPTH: usize = 64;
pub(super) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub(super) fn parse(content: &str) -> Result<DocumentMut, ConfigError> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(ConfigError::TooLarge);
    }
    content.parse::<DocumentMut>().map_err(|error| {
        let position = error.span().map(|span| position(content, span.start));
        ConfigError::InvalidToml(ConfigDiagnostic {
            message: "格式不正确，请检查此处的引号、括号或重复配置。".to_owned(),
            line: position.map(|(line, _)| line),
            column: position.map(|(_, column)| column),
        })
    })
}

fn position(content: &str, offset: usize) -> (usize, usize) {
    let mut boundary = offset.min(content.len());
    while !content.is_char_boundary(boundary) {
        boundary -= 1;
    }
    let prefix = &content[..boundary];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let column = prefix
        .rsplit('\n')
        .next()
        .unwrap_or_default()
        .chars()
        .count()
        + 1;
    (line, column)
}

pub(super) fn values(document: &DocumentMut) -> Result<JsonValue, ConfigError> {
    table_values(document.as_table(), 0)
}

fn table_values(table: &dyn TableLike, depth: usize) -> Result<JsonValue, ConfigError> {
    table
        .iter()
        .filter(|(_, item)| !item.is_none())
        .map(|(key, item)| item_value(item, depth + 1).map(|value| (key.to_owned(), value)))
        .collect::<Result<Map<_, _>, _>>()
        .map(JsonValue::Object)
}

fn item_value(item: &Item, depth: usize) -> Result<JsonValue, ConfigError> {
    if depth > MAX_DEPTH {
        return Err(ConfigError::UnrepresentableValue);
    }
    match item {
        Item::None => Err(ConfigError::UnrepresentableValue),
        Item::Value(value) => scalar_value(value, depth),
        Item::Table(table) => table_values(table, depth),
        Item::ArrayOfTables(tables) => tables
            .iter()
            .map(|table| table_values(table, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
    }
}

fn scalar_value(value: &Value, depth: usize) -> Result<JsonValue, ConfigError> {
    if depth > MAX_DEPTH {
        return Err(ConfigError::UnrepresentableValue);
    }
    match value {
        Value::String(value) => Ok(JsonValue::String(value.value().clone())),
        Value::Boolean(value) => Ok(JsonValue::Bool(*value.value())),
        Value::Integer(value) if value.value().unsigned_abs() <= MAX_SAFE_INTEGER as u64 => {
            Ok(JsonValue::Number(Number::from(*value.value())))
        }
        Value::Float(value) => Number::from_f64(*value.value())
            .map(JsonValue::Number)
            .ok_or(ConfigError::UnrepresentableValue),
        Value::Array(array) => array
            .iter()
            .map(|value| scalar_value(value, depth + 1))
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        Value::InlineTable(table) => table_values(table, depth),
        Value::Integer(_) | Value::Datetime(_) => Err(ConfigError::UnrepresentableValue),
    }
}
