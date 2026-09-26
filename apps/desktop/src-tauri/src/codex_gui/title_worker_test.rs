//! Opt-in protocol smoke test: the real installed CLI talks only to a local fixture server.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tiny_http::{Header, Response, Server};

struct CapturedRequest {
    body: Value,
    purpose: Option<String>,
}

fn response_stream() -> String {
    let text = r#"{"title":"熊骑车 SVG 动画"}"#;
    let item = json!({"id": "message-title", "type": "message", "role": "assistant", "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}]});
    let events = [
        json!({"type": "response.created", "response": {"id": "response-title", "status": "in_progress"}}),
        json!({"type": "response.output_item.added", "output_index": 0, "item": {
            "id": "message-title", "type": "message", "role": "assistant", "content": []}}),
        json!({"type": "response.output_text.delta", "item_id": "message-title",
            "output_index": 0, "content_index": 0, "delta": text}),
        json!({"type": "response.output_item.done", "output_index": 0, "item": item}),
        json!({"type": "response.completed", "response": {"id": "response-title", "status": "completed",
            "output": [item], "usage": {"input_tokens": 20, "output_tokens": 10, "total_tokens": 30}}}),
    ];
    events
        .iter()
        .map(|event| {
            format!(
                "event: {}\ndata: {event}\n\n",
                event["type"].as_str().unwrap()
            )
        })
        .collect()
}

fn serve(server: Server, stop: Arc<AtomicBool>, bodies: Arc<Mutex<Vec<CapturedRequest>>>) {
    while !stop.load(Ordering::Acquire) {
        let Some(mut request) = server.recv_timeout(Duration::from_millis(100)).unwrap() else {
            continue;
        };
        if request.url().ends_with("/responses") {
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            bodies.lock().unwrap().push(CapturedRequest {
                body: serde_json::from_str(&body).unwrap(),
                purpose: request
                    .headers()
                    .iter()
                    .find(|header| {
                        header
                            .field
                            .equiv(crate::codex_config::LOCAL_PROXY_REQUEST_PURPOSE_HEADER)
                    })
                    .map(|header| header.value.to_string()),
            });
            request
                .respond(
                    Response::from_string(response_stream()).with_header(
                        Header::from_bytes("Content-Type", "text/event-stream").unwrap(),
                    ),
                )
                .unwrap();
        } else {
            request
                .respond(
                    Response::from_string(r#"{"models":[]}"#).with_header(
                        Header::from_bytes("Content-Type", "application/json").unwrap(),
                    ),
                )
                .unwrap();
        }
    }
}

fn remove_fixture(root: &std::path::Path) {
    // Windows can briefly retain SQLite handles after the CLI process has exited.
    for _ in 0..40 {
        match std::fs::remove_dir_all(root) {
            Ok(()) => return,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "Set CODEX_TITLE_TEST_CLI to an installed Codex binary; uses a local HTTP fixture only"]
async fn real_cli_generates_a_private_title_with_configured_model_and_effort() {
    let binary =
        std::env::var_os("CODEX_TITLE_TEST_CLI").expect("CODEX_TITLE_TEST_CLI is required");
    let root = std::env::temp_dir().join(format!("title-worker-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let server = Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr();
    std::fs::write(
        root.join("config.toml"),
        format!(
            "model_provider = 'codex-switch-gui'\n[model_providers.codex-switch-gui]\n\
         name = 'Title fixture'\nbase_url = 'http://{address}/v1'\nwire_api = 'responses'\n\
         requires_openai_auth = false\nsupports_websockets = false\n"
        ),
    )
    .unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let worker = {
        let stop = stop.clone();
        let bodies = bodies.clone();
        std::thread::spawn(move || serve(server, stop, bodies))
    };
    let request = serde_json::from_value(
        json!({"threadId": "original", "prompt": "生成一个熊骑车的 SVG 动画",
        "settings": {"model": "gpt-5.6-luna", "effort": "low"}}),
    )
    .unwrap();
    let binary = Executable {
        path: binary.into(),
        version: "0.154.0".into(),
    };
    let result = name_first_turn(&binary, &root, request).await;
    stop.store(true, Ordering::Release);
    worker.join().unwrap();
    remove_fixture(&root);
    assert_eq!(result.unwrap(), "熊骑车 SVG 动画");
    let bodies = bodies.lock().unwrap();
    assert_eq!(bodies.first().unwrap().body["model"], "gpt-6-astra");
    assert!(bodies.first().unwrap().purpose.is_none());
    let naming = bodies.last().expect("the CLI must contact the fixture");
    assert_eq!(
        naming.purpose.as_deref(),
        Some(crate::codex_config::TITLE_GENERATION_REQUEST_PURPOSE)
    );
    let body = &naming.body;
    assert_eq!(body["model"], "gpt-5.6-luna");
    assert_eq!(body["reasoning"]["effort"], "low");
    assert_eq!(body["text"]["format"]["type"], "json_schema");
    assert!(body["tools"].as_array().is_none_or(Vec::is_empty));
    assert_eq!(
        bodies.len(),
        2,
        "the first turn and private naming each issue one request"
    );
}

async fn start_conversation(
    binary: &Executable,
    root: &std::path::Path,
    request: &mut TitleRequest,
) -> Result<Worker> {
    let mut worker = Worker::spawn(binary, root)?;
    worker
        .rpc("initialize", identity::initialize_params(&binary.version))
        .await?;
    worker.write(json!({"method": "initialized"})).await?;
    let mut params =
        title_generation::start_params(&request.settings, &platform::execution_path(root));
    params["ephemeral"] = json!(false);
    params["model"] = json!("gpt-6-astra");
    let thread = worker.rpc("thread/start", params).await?;
    request.thread_id = thread["thread"]["id"]
        .as_str()
        .ok_or(GuiError::Rpc)?
        .to_owned();
    let mut turn = title_generation::turn_params(&request.thread_id, request);
    turn["model"] = json!("gpt-6-astra");
    worker.rpc("turn/start", turn).await?;
    Ok(worker)
}

async fn name_first_turn(
    binary: &Executable,
    root: &std::path::Path,
    mut request: TitleRequest,
) -> Result<String> {
    let worker = tokio::sync::Mutex::new(start_conversation(binary, root, &mut request).await?);
    // Exercise the real CLI at the same point as the GUI: immediately after turn/start acknowledges.
    let result = async {
        let original = crate::codex_gui::title_read::when_ready(|| async {
            worker
                .lock()
                .await
                .rpc("thread/read", json!({"threadId": request.thread_id}))
                .await
        })
        .await?;
        assert!(title_generation::explicit_title(&original["thread"]).is_none());
        let title = generate(
            Executable {
                path: binary.path.clone(),
                version: binary.version.clone(),
            },
            naming_home(root),
            &request,
        )
        .await?;
        let mut worker = worker.lock().await;
        worker
            .rpc(
                "thread/name/set",
                json!({"threadId": request.thread_id, "name": title}),
            )
            .await?;
        let saved = worker
            .rpc("thread/read", json!({"threadId": request.thread_id}))
            .await?;
        assert_eq!(saved["thread"]["name"], title);
        assert_eq!(saved["thread"]["preview"], request.prompt);
        Ok(title)
    }
    .await;
    worker
        .lock()
        .await
        .process
        .kill()
        .await
        .map_err(|_| GuiError::Disconnected)?;
    result
}

fn naming_home(root: &std::path::Path) -> PathBuf {
    let original: toml_edit::DocumentMut = std::fs::read_to_string(root.join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    let base_url = original["model_providers"]["codex-switch-gui"]["base_url"]
        .as_str()
        .unwrap();
    crate::codex_gui::home::prepare_title_home(root, base_url).unwrap()
}
