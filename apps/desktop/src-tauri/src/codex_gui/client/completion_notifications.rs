use std::{collections::VecDeque, sync::Arc};

use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use super::{Client, GuiEvent};

const RECENT_COMPLETION_LIMIT: usize = 256;
const TITLE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_TITLE_CHARS: usize = 100;

/// Deduplicate terminal events without retaining an unbounded conversation history.
#[derive(Default)]
pub(super) struct CompletionNotifications {
    delivered: VecDeque<(String, String)>,
}

impl CompletionNotifications {
    fn accept(&mut self, event: &GuiEvent) -> bool {
        if event.method != "turn/completed" || event.params["turn"]["status"] != "completed" {
            return false;
        }
        let Some(thread_id) = event.params["threadId"]
            .as_str()
            .filter(|id| !id.is_empty())
        else {
            return false;
        };
        let Some(turn_id) = event.params["turn"]["id"]
            .as_str()
            .filter(|id| !id.is_empty())
        else {
            return false;
        };
        let key = (thread_id.to_owned(), turn_id.to_owned());
        if self.delivered.contains(&key) {
            return false;
        }
        self.delivered.push_back(key);
        if self.delivered.len() > RECENT_COMPLETION_LIMIT {
            self.delivered.pop_front();
        }
        true
    }
}

impl Client {
    pub(super) async fn notify_completion(self: &Arc<Self>, event: &GuiEvent) {
        if !self.completion_notifications.lock().await.accept(event) {
            return;
        }
        let thread_id = event.params["threadId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let client = self.clone();
        // The reader must remain free to dispatch the metadata response and other turns.
        tokio::spawn(async move {
            let response = timeout(
                TITLE_TIMEOUT,
                client.request(
                    "thread/read",
                    json!({"threadId": thread_id, "includeTurns": false}),
                ),
            )
            .await;
            let thread = match response {
                Ok(Ok(response)) => response["thread"].clone(),
                _ => Value::Null,
            };
            let title = notification_title(&thread);
            let app = client.app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::super::notifications::show(&app, &thread_id, &title);
            });
        });
    }
}

fn notification_title(thread: &Value) -> String {
    let title = ["name", "preview"]
        .into_iter()
        .filter_map(|key| thread[key].as_str())
        .find(|text| !text.trim().is_empty())
        .unwrap_or("新对话");
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = title.chars().filter(|character| !character.is_control());
    let mut title: String = chars.by_ref().take(MAX_TITLE_CHARS).collect();
    if chars.next().is_some() {
        title.push('…');
    }
    title
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(thread: &str, turn: &str, status: &str) -> GuiEvent {
        GuiEvent {
            method: "turn/completed".into(),
            id: None,
            params: json!({"threadId": thread, "turn": {"id": turn, "status": status}}),
        }
    }

    #[test]
    fn only_successful_completions_notify_once_per_turn_and_thread() {
        let mut notifications = CompletionNotifications::default();
        for status in ["failed", "interrupted", "inProgress", ""] {
            assert!(!notifications.accept(&event("thread", "turn", status)));
        }
        assert!(notifications.accept(&event("thread", "turn", "completed")));
        assert!(!notifications.accept(&event("thread", "turn", "completed")));
        assert!(notifications.accept(&event("other", "turn", "completed")));
        assert!(notifications.accept(&event("thread", "next", "completed")));
    }

    #[test]
    fn malformed_events_and_non_completion_events_are_ignored() {
        let mut notifications = CompletionNotifications::default();
        assert!(!notifications.accept(&event("", "turn", "completed")));
        assert!(!notifications.accept(&event("thread", "", "completed")));
        let mut started = event("thread", "turn", "completed");
        started.method = "turn/started".into();
        assert!(!notifications.accept(&started));
        started.method = "turn/completed".into();
        started.params = json!({});
        assert!(!notifications.accept(&started));
    }

    #[test]
    fn completion_history_is_bounded() {
        let mut notifications = CompletionNotifications::default();
        for index in 0..=RECENT_COMPLETION_LIMIT {
            assert!(notifications.accept(&event("thread", &index.to_string(), "completed")));
        }
        assert_eq!(notifications.delivered.len(), RECENT_COMPLETION_LIMIT);
    }

    #[test]
    fn title_matches_the_conversation_name_with_preview_and_default_fallbacks() {
        assert_eq!(
            notification_title(&json!({"name": " 修复通知 ", "preview": "原始问题"})),
            "修复通知"
        );
        assert_eq!(
            notification_title(&json!({"name": " ", "preview": "第一行\n第二行"})),
            "第一行 第二行"
        );
        assert_eq!(notification_title(&Value::Null), "新对话");
        assert_eq!(
            notification_title(&json!({"name": "中".repeat(MAX_TITLE_CHARS + 1)})),
            format!("{}…", "中".repeat(MAX_TITLE_CHARS))
        );
    }
}
