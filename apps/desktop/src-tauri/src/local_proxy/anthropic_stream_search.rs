impl ContentBlocks {
    fn search_item(
        &mut self,
        event: &Value,
        item: &Value,
        events: &mut Vec<Value>,
    ) -> Result<(), ConversionError> {
        if event["type"] == "response.output_item.added" {
            return Ok(());
        }
        let reference =
            json!({ "item_id": item.get("id"), "output_index": event.get("output_index") });
        if self.find(&reference, BlockType::Server)?.is_some() {
            return Ok(());
        }
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or(ConversionError::InvalidEvent)?;
        let tool_id = format!("srvtoolu_{id}");
        let input = search_input(item);
        let index = self.push(
            &reference,
            BlockKind::Server(json!({
                "type": "server_tool_use", "id": tool_id, "name": "web_search", "input": input
            })),
            events,
        );
        self.close(index, events)?;
        // Responses exposes source metadata, not Claude's encrypted search documents.
        // Keep the real URLs/titles; never invent document ciphertext or search excerpts.
        let results: Vec<Value> = item
            .pointer("/action/sources")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(search_source)
            .collect();
        let result_reference = json!({ "item_id": format!("result_{id}"), "content_index": 1 });
        let index = self.push(
            &result_reference,
            BlockKind::Server(json!({
                "type": "web_search_tool_result", "tool_use_id": tool_id, "content": results
            })),
            events,
        );
        self.close(index, events)
    }
}

fn search_input(item: &Value) -> Value {
    if let Some(query) = item.pointer("/action/query") {
        return json!({ "query": query });
    }
    let queries = item
        .pointer("/action/queries")
        .and_then(Value::as_array)
        .map(|queries| {
            queries
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    json!({ "query": queries })
}

fn search_source(source: &Value) -> Option<Value> {
    Some(json!({
        "type": "web_search_result", "url": source.get("url")?.as_str()?,
        "title": source.get("title").and_then(Value::as_str).unwrap_or_default(),
        "encrypted_content": ""
    }))
}
