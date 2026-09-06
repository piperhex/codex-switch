use super::ConversionError;
use serde_json::{json, Value};

#[derive(Default)]
pub(super) struct ContentBlocks {
    blocks: Vec<ContentBlock>,
}

struct ContentBlock {
    item_id: Option<String>,
    output_index: Option<u64>,
    content_index: u64,
    kind: BlockKind,
    content: String,
    closed: bool,
}

enum BlockKind {
    Text,
    Tool { id: String, name: String },
}

impl ContentBlocks {
    pub(super) fn has_tools(&self) -> bool {
        self.blocks
            .iter()
            .any(|block| matches!(block.kind, BlockKind::Tool { .. }))
    }

    pub(super) fn message_content(&self) -> Vec<Value> {
        self.blocks.iter().map(ContentBlock::value).collect()
    }

    pub(super) fn item(
        &mut self,
        event: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let item = event.get("item").ok_or(ConversionError::InvalidEvent)?;
        match item.get("type").and_then(Value::as_str) {
            Some("function_call") => self.tool_item(event, item, events),
            Some("message") => self.message_item(event, item, events),
            _ => Ok(()),
        }
    }

    fn tool_item(
        &mut self,
        event: &Value,
        item: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let reference =
            json!({ "item_id": item.get("id"), "output_index": event.get("output_index") });
        let index = if let Some(index) = self.find(&reference, true)? {
            index
        } else {
            let id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or(ConversionError::InvalidTool)?;
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or(ConversionError::InvalidTool)?;
            self.push(
                &reference,
                BlockKind::Tool {
                    id: id.to_string(),
                    name: name.to_string(),
                },
                events,
            )
        };
        if let Some(arguments) = item
            .get("arguments")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            self.append(index, arguments, true, events)?;
        }
        if event.get("type").and_then(Value::as_str) == Some("response.output_item.done") {
            self.close(index, events)?;
        }
        Ok(())
    }

    fn message_item(
        &mut self,
        event: &Value,
        item: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            return Ok(());
        };
        for (content_index, part) in content.iter().enumerate() {
            if part.get("type").and_then(Value::as_str) != Some("output_text") {
                continue;
            }
            let text = json!({
                "item_id": item.get("id"), "output_index": event.get("output_index"),
                "content_index": content_index, "text": part.get("text")
            });
            let index = match self.find(&text, false)? {
                Some(index) => index,
                None => self.push(&text, BlockKind::Text, events),
            };
            let content = part
                .get("text")
                .and_then(Value::as_str)
                .ok_or(ConversionError::InvalidEvent)?;
            self.append(index, content, true, events)?;
            if event.get("type").and_then(Value::as_str) == Some("response.output_item.done") {
                self.close(index, events)?;
            }
        }
        Ok(())
    }

    pub(super) fn text(
        &mut self,
        event: &Value,
        done: bool,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let content = event
            .get(if done { "text" } else { "delta" })
            .and_then(Value::as_str)
            .ok_or(ConversionError::InvalidEvent)?;
        let index = match self.find(event, false)? {
            Some(index) => index,
            None => self.push(event, BlockKind::Text, events),
        };
        self.append(index, content, done, events)?;
        if done {
            self.close(index, events)?;
        }
        Ok(())
    }

    pub(super) fn arguments(
        &mut self,
        event: &Value,
        done: bool,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let index = self
            .find(event, true)?
            .ok_or(ConversionError::InvalidTool)?;
        let arguments = event
            .get(if done { "arguments" } else { "delta" })
            .and_then(Value::as_str)
            .ok_or(ConversionError::InvalidTool)?;
        self.append(index, arguments, done, events)?;
        if done {
            self.close(index, events)?;
        }
        Ok(())
    }

    /// Both identifiers, when present, must identify the same block. Never choose the last tool.
    fn find(&self, event: &Value, tool: bool) -> Result<Option<usize>, ConversionError> {
        let item_id = event.get("item_id").and_then(Value::as_str);
        let output_index = event.get("output_index").and_then(Value::as_u64);
        let content_index = event
            .get("content_index")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let mut matched = None;
        for (index, block) in self.blocks.iter().enumerate() {
            if tool != matches!(block.kind, BlockKind::Tool { .. })
                || block.content_index != content_index
            {
                continue;
            }
            let same_id = item_id
                .zip(block.item_id.as_deref())
                .map(|(left, right)| left == right);
            let same_index = output_index
                .zip(block.output_index)
                .map(|(left, right)| left == right);
            let anonymous = item_id.is_none() && output_index.is_none();
            if same_id != Some(true) && same_index != Some(true) && !anonymous {
                continue;
            }
            if matched.is_some() || same_id == Some(false) || same_index == Some(false) {
                return Err(ConversionError::InvalidTool);
            }
            matched = Some(index);
        }
        Ok(matched)
    }

    fn push(&mut self, event: &Value, kind: BlockKind, events: &mut Vec<Value>) -> usize {
        let block = ContentBlock {
            item_id: event
                .get("item_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            output_index: event.get("output_index").and_then(Value::as_u64),
            content_index: event
                .get("content_index")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            kind,
            content: String::new(),
            closed: false,
        };
        let index = self.blocks.len();
        events.push(json!({
            "type": "content_block_start", "index": index, "content_block": block.value()
        }));
        self.blocks.push(block);
        index
    }

    fn append(
        &mut self,
        index: usize,
        content: &str,
        complete: bool,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let block = &mut self.blocks[index];
        let delta = if complete {
            block.remaining(content)?
        } else {
            content
        };
        if delta.is_empty() {
            return Ok(());
        }
        if block.closed {
            return Err(ConversionError::InvalidEvent);
        }
        let delta_value = match block.kind {
            BlockKind::Text => json!({ "type": "text_delta", "text": delta }),
            BlockKind::Tool { .. } => json!({ "type": "input_json_delta", "partial_json": delta }),
        };
        block.content.push_str(delta);
        events.push(json!({ "type": "content_block_delta", "index": index, "delta": delta_value }));
        Ok(())
    }

    fn close(&mut self, index: usize, events: &mut Vec<Value>) -> Result<(), ConversionError> {
        let block = &mut self.blocks[index];
        if block.closed {
            return Ok(());
        }
        if matches!(block.kind, BlockKind::Tool { .. }) {
            serde_json::from_str::<Value>(&block.content)
                .ok()
                .filter(Value::is_object)
                .ok_or(ConversionError::InvalidTool)?;
        }
        block.closed = true;
        events.push(json!({ "type": "content_block_stop", "index": index }));
        Ok(())
    }

    pub(super) fn complete(
        &mut self,
        response: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        if let Some(output) = response.get("output").and_then(Value::as_array) {
            for (index, item) in output.iter().enumerate() {
                self.item(&json!({ "output_index": index, "item": item }), events)?;
            }
        }
        for index in 0..self.blocks.len() {
            self.close(index, events)?;
        }
        Ok(())
    }
}

impl ContentBlock {
    fn value(&self) -> Value {
        match &self.kind {
            BlockKind::Text => json!({ "type": "text", "text": self.content }),
            BlockKind::Tool { id, name } => json!({
                "type": "tool_use", "id": id, "name": name,
                "input": serde_json::from_str::<Value>(&self.content).unwrap_or_else(|_| json!({}))
            }),
        }
    }

    fn remaining<'a>(&self, complete: &'a str) -> Result<&'a str, ConversionError> {
        if let Some(suffix) = complete.strip_prefix(&self.content) {
            return Ok(suffix);
        }
        if matches!(self.kind, BlockKind::Tool { .. }) {
            let current = serde_json::from_str::<Value>(&self.content).ok();
            let final_value = serde_json::from_str::<Value>(complete).ok();
            if current.is_some() && current == final_value {
                return Ok("");
            }
        }
        Err(ConversionError::InvalidEvent)
    }
}
