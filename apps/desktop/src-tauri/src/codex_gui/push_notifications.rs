//! Content-free alerts originate in the app-server reader, independently of the main WebView.
use super::protocol::GuiEvent;
use serde::Serialize;
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    thread_id: String,
    event_id: String,
    kind: &'static str,
}
static OUTBOX: OnceLock<mpsc::SyncSender<(tauri::AppHandle, Notice)>> = OnceLock::new();

fn notice(event: &GuiEvent) -> Option<Notice> {
    let thread_id = event.params.get("threadId")?.as_str()?.to_owned();
    let (event_id, kind) = if event.method == "turn/completed" {
        let turn = event.params.get("turn")?;
        let kind = match turn.get("status")?.as_str()? {
            "completed" => "completed",
            "failed" => "failed",
            _ => return None,
        };
        (turn.get("id")?.as_str()?.to_owned(), kind)
    } else if event.method.ends_with("/requestApproval")
        || event.method == "item/tool/requestUserInput"
    {
        let id = event.id.as_ref()?;
        let id = id
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| id.to_string());
        (format!("request-{id}"), "attention")
    } else if event.method == "item/completed" {
        let item = event.params.get("item")?;
        if item.get("delivery")?.as_str()? != "async"
            || item.get("questions")?.as_array()?.is_empty()
        {
            return None;
        }
        (
            format!("question-{}", item.get("id")?.as_str()?),
            "attention",
        )
    } else {
        return None;
    };
    Some(Notice {
        thread_id,
        event_id,
        kind,
    })
}

pub(super) fn receive(app: &tauri::AppHandle, event: &GuiEvent) {
    let Some(notice) = notice(event) else {
        return;
    };
    let sender = OUTBOX.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel(128);
        std::thread::spawn(move || run(receiver));
        sender
    });
    if sender.try_send((app.clone(), notice)).is_err() {
        eprintln!("chat notification queue unavailable");
    }
}

fn run(receiver: mpsc::Receiver<(tauri::AppHandle, Notice)>) {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    else {
        return;
    };
    let mut disabled: Option<(String, Instant)> = None;
    for (app, notice) in receiver {
        let config = match crate::cloud::remote_control_config(&app) {
            Ok(Some(config)) => config,
            Ok(None) => continue,
            Err(_) => {
                eprintln!("chat notification identity unavailable");
                continue;
            }
        };
        if disabled.as_ref().is_some_and(|(server, until)| {
            server == &config.websocket_url && Instant::now() < *until
        }) {
            continue;
        }
        match send(&client, &config, &notice) {
            Ok(false) => {
                disabled = Some((
                    config.websocket_url,
                    Instant::now() + Duration::from_secs(600),
                ))
            }
            Ok(true) => {}
            Err(()) => eprintln!("chat notification could not reach server"),
        }
    }
}

fn send(
    client: &reqwest::blocking::Client,
    config: &crate::cloud::RemoteControlConfig,
    notice: &Notice,
) -> Result<bool, ()> {
    let mut url = url::Url::parse(&config.websocket_url).map_err(|_| ())?;
    let scheme = if url.scheme() == "wss" {
        "https"
    } else {
        "http"
    };
    url.set_scheme(scheme)?;
    let path = format!(
        "{}chat-push/events",
        url.path().trim_end_matches("device-switch")
    );
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    let mut payload = serde_json::to_value(notice).map_err(|_| ())?;
    payload["deviceId"] = config.device_id.clone().into();
    let result = client
        .post(url)
        .bearer_auth(&config.access_token)
        .json(&payload)
        .send()
        .map_err(|_| ())?;
    if matches!(result.status().as_u16(), 404 | 503) {
        return Ok(false);
    }
    if !result.status().is_success() {
        return Err(());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publishes_only_actionable_metadata() {
        let mut event = GuiEvent {
            method: "turn/completed".into(),
            id: None,
            params: serde_json::json!({"threadId":"thread","turn":{"id":"turn","status":"completed", "items":["secret"]}}),
        };
        let value = serde_json::to_string(&notice(&event).unwrap()).unwrap();
        assert!(!value.contains("secret"));
        event.params["turn"]["status"] = "interrupted".into();
        assert!(notice(&event).is_none());
        event.method = "item/commandExecution/requestApproval".into();
        event.id = Some(serde_json::json!(42));
        assert_eq!(notice(&event).unwrap().kind, "attention");
    }
}
