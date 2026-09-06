use super::{blocks::ContentBlocks, ConversionError};
use serde_json::{json, Value};

pub(super) struct MessageState {
    model: String,
    response_id: String,
    blocks: ContentBlocks,
    usage: Value,
    service_tier: Option<String>,
    stop_reason: Option<&'static str>,
    started: bool,
    finished: bool,
}

impl MessageState {
    pub(super) fn new(model: &str) -> Self {
        Self {
            model: model.to_string(),
            response_id: "msg_codex_switch".to_string(),
            blocks: ContentBlocks::default(),
            usage: super::super::anthropic_usage(None),
            service_tier: None,
            stop_reason: None,
            started: false,
            finished: false,
        }
    }

    pub(super) fn finished(&self) -> bool {
        self.finished
    }

    pub(super) fn message(&self) -> Value {
        let mut message = json!({
            "id": self.response_id, "type": "message", "role": "assistant",
            "model": self.model, "content": self.blocks.message_content(),
            "stop_reason": self.stop_reason, "stop_sequence": Value::Null, "usage": self.usage
        });
        if let Some(tier) = &self.service_tier {
            message["service_tier"] = json!(tier);
        }
        message
    }

    pub(super) fn observe(&mut self, value: &Value) -> Result<Vec<Value>, ConversionError> {
        if self.finished {
            return Ok(Vec::new());
        }
        self.observe_metadata(value);
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or(ConversionError::InvalidEvent)?;
        if matches!(kind, "response.failed" | "error") {
            return Err(ConversionError::UpstreamFailed);
        }
        let mut events = Vec::new();
        self.start(&mut events);
        match kind {
            "response.output_item.added" | "response.output_item.done" => {
                self.blocks.item(value, &mut events)?
            }
            "response.output_text.delta" => self.blocks.text(value, false, &mut events)?,
            "response.output_text.done" => self.blocks.text(value, true, &mut events)?,
            "response.function_call_arguments.delta" => {
                self.blocks.arguments(value, false, &mut events)?
            }
            "response.function_call_arguments.done" => {
                self.blocks.arguments(value, true, &mut events)?
            }
            "response.completed" | "response.incomplete" => self.finish(value, &mut events)?,
            _ => events.push(json!({ "type": "ping" })),
        }
        Ok(events)
    }

    fn observe_metadata(&mut self, value: &Value) {
        if !self.started {
            if let Some(id) = value.pointer("/response/id").and_then(Value::as_str) {
                self.response_id = id.to_string();
            }
        }
        if let Some(usage) = value
            .pointer("/response/usage")
            .filter(|usage| !usage.is_null())
        {
            self.usage = super::super::anthropic_usage(Some(usage));
        }
        if let Some(tier) = super::super::extract_service_tier_from_value(value) {
            self.service_tier = Some(tier);
        }
    }

    fn start(&mut self, events: &mut Vec<Value>) {
        if self.started {
            return;
        }
        self.started = true;
        events.push(json!({ "type": "message_start", "message": self.message() }));
    }

    fn finish(&mut self, value: &Value, events: &mut Vec<Value>) -> Result<(), ConversionError> {
        let response = value
            .get("response")
            .filter(|response| response.is_object())
            .ok_or(ConversionError::InvalidEvent)?;
        let incomplete = value["type"] == "response.incomplete";
        let expected = if incomplete {
            "incomplete"
        } else {
            "completed"
        };
        if response
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status != expected)
        {
            return Err(ConversionError::InvalidEvent);
        }
        if incomplete
            && response
                .pointer("/incomplete_details/reason")
                .and_then(Value::as_str)
                != Some("max_output_tokens")
        {
            return Err(ConversionError::Incomplete);
        }
        self.blocks.complete(response, events)?;
        self.stop_reason = Some(if incomplete {
            "max_tokens"
        } else if self.blocks.has_tools() {
            "tool_use"
        } else {
            "end_turn"
        });
        let mut delta = json!({
            "type": "message_delta", "delta": { "stop_reason": self.stop_reason, "stop_sequence": Value::Null },
            "usage": self.usage
        });
        if let Some(tier) = &self.service_tier {
            delta["service_tier"] = json!(tier);
        }
        events.push(delta);
        events.push(json!({ "type": "message_stop" }));
        self.finished = true;
        Ok(())
    }

    pub(super) fn fail(&mut self, error: ConversionError) -> Vec<Value> {
        self.finished = true;
        let mut event = json!({
            "type": "error", "error": { "type": "api_error", "message": error.to_string() },
            "usage": self.usage
        });
        if let Some(tier) = &self.service_tier {
            event["service_tier"] = json!(tier);
        }
        vec![event]
    }
}
