struct ThinkingContent {
    item: Value,
    parts: std::collections::BTreeMap<u64, String>,
    signature: String,
}

impl ContentBlocks {
    fn thinking_block(
        &mut self,
        reference: &Value,
        events: &mut Vec<Value>,
    ) -> Result<usize, ConversionError> {
        if let Some(index) = self.find(reference, BlockType::Thinking)? {
            return Ok(index);
        }
        let item = json!({ "type": "reasoning", "id": reference.get("item_id") });
        Ok(self.push(
            reference,
            BlockKind::Thinking(Box::new(ThinkingContent {
                item,
                parts: Default::default(),
                signature: String::new(),
            })),
            events,
        ))
    }

    pub(super) fn reasoning_text(
        &mut self,
        event: &Value,
        complete: bool,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let text = event
            .get(if complete { "text" } else { "delta" })
            .and_then(Value::as_str)
            .ok_or(ConversionError::InvalidEvent)?;
        let index = self.thinking_block(event, events)?;
        let part_index = event
            .get("summary_index")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let BlockKind::Thinking(thinking) = &mut self.blocks[index].kind else {
            return Err(ConversionError::InvalidEvent);
        };
        let part = thinking.parts.entry(part_index).or_default();
        let delta = if complete {
            text.strip_prefix(part.as_str())
                .ok_or(ConversionError::InvalidEvent)?
        } else {
            text
        };
        part.push_str(delta);
        // Keep the block open until output_item.done: encrypted_content arrives after summary.done.
        self.append(index, delta, false, events)
    }

    fn reasoning_item(
        &mut self,
        event: &Value,
        item: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        let reference =
            json!({ "item_id": item.get("id"), "output_index": event.get("output_index") });
        let index = self.thinking_block(&reference, events)?;
        if let BlockKind::Thinking(thinking) = &mut self.blocks[index].kind {
            for key in ["id", "encrypted_content"] {
                if let Some(value) = item.get(key).filter(|value| !value.is_null()) {
                    thinking.item[key] = value.clone();
                }
            }
        }
        for (part_index, part) in item
            .get("summary")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            if part["type"] != "summary_text" {
                continue;
            }
            let mut text = reference.clone();
            text["summary_index"] = json!(part_index);
            text["text"] = part["text"].clone();
            self.reasoning_text(&text, true, events)?;
        }
        if event["type"] == "response.output_item.done" {
            self.close(index, events)?;
        }
        Ok(())
    }
}
