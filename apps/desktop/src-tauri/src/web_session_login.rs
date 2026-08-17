use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use crate::{auth::decode_jwt, oauth::emit_login, storage::import_value};

pub(crate) const WINDOW_LABEL: &str = "chatgpt-web-login";
const CHATGPT_URL: &str = "https://chatgpt.com/";
const CALLBACK_SCHEME: &str = "codex-switch-auth";
const CALLBACK_HOST: &str = "session";
const DEFAULT_PLAN: &str = "free";
const DEFAULT_SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;
const MAX_SESSION_PAYLOAD_LENGTH: usize = 64 * 1024;
const NONCE_PLACEHOLDER: &str = "__CALLBACK_NONCE__";

const SESSION_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (window.top !== window || location.origin !== 'https://chatgpt.com') return;
  if (window.__codexSwitchSessionCaptureStarted) return;
  window.__codexSwitchSessionCaptureStarted = true;
  let completed = false;

  const encode = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };

  const capture = async () => {
    if (completed) return;
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const session = await response.json();
      if (!session || typeof session.accessToken !== 'string' || !session.accessToken) return;
      const payload = {
        accessToken: session.accessToken,
        expires: session.expires,
        user: session.user && {
          id: session.user.id,
          email: session.user.email,
        },
        account: session.account && {
          id: session.account.id,
          planType: session.account.planType,
        },
      };
      completed = true;
      location.replace(`codex-switch-auth://session/__CALLBACK_NONCE__/${encode(payload)}`);
    } catch (_) {
      // The page is still loading or signed out. The next poll retries locally.
    }
  };

  void capture();
  window.setInterval(() => void capture(), 1500);
})();
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatGptSession {
    access_token: String,
    expires: Option<String>,
    user: Option<SessionUser>,
    account: Option<SessionAccount>,
}

#[derive(Debug, Deserialize)]
struct SessionUser {
    id: Option<String>,
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionAccount {
    id: Option<String>,
    plan_type: Option<String>,
}

struct SessionIdentity {
    account_id: String,
    user_id: String,
    email: String,
    plan_type: String,
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn nested_claim<'a>(claims: &'a Value, key: &str) -> Option<&'a str> {
    claims
        .get("https://api.openai.com/auth")?
        .get(key)?
        .as_str()
        .and_then(|value| non_empty(Some(value)))
}

fn session_identity(session: &ChatGptSession) -> Result<SessionIdentity, String> {
    let claims = decode_jwt(&session.access_token).unwrap_or(Value::Null);
    let account_id = non_empty(
        session
            .account
            .as_ref()
            .and_then(|account| account.id.as_deref()),
    )
    .or_else(|| nested_claim(&claims, "chatgpt_account_id"))
    .ok_or_else(|| "未能读取 ChatGPT 账户信息，请确认登录完成后重试".to_string())?;
    let email = non_empty(session.user.as_ref().and_then(|user| user.email.as_deref()))
        .or_else(|| {
            claims
                .get("email")
                .and_then(Value::as_str)
                .and_then(|value| non_empty(Some(value)))
        })
        .ok_or_else(|| "未能读取 ChatGPT 邮箱，请确认登录完成后重试".to_string())?;
    let user_id = non_empty(session.user.as_ref().and_then(|user| user.id.as_deref()))
        .or_else(|| nested_claim(&claims, "chatgpt_user_id"))
        .or_else(|| nested_claim(&claims, "user_id"))
        .or_else(|| {
            claims
                .get("sub")
                .and_then(Value::as_str)
                .and_then(|value| non_empty(Some(value)))
        })
        .unwrap_or(email);
    let plan_type = non_empty(
        session
            .account
            .as_ref()
            .and_then(|account| account.plan_type.as_deref()),
    )
    .or_else(|| nested_claim(&claims, "chatgpt_plan_type"))
    .unwrap_or(DEFAULT_PLAN);

    Ok(SessionIdentity {
        account_id: account_id.to_string(),
        user_id: user_id.to_string(),
        email: email.to_string(),
        plan_type: plan_type.to_string(),
    })
}

fn session_expiration(session: &ChatGptSession, now: DateTime<Utc>) -> i64 {
    session
        .expires
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp())
        .filter(|value| *value > now.timestamp())
        .unwrap_or_else(|| now.timestamp() + DEFAULT_SESSION_SECONDS)
}

fn encode_json(value: &Value) -> Result<String, String> {
    serde_json::to_vec(value)
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
        .map_err(|_| "无法生成账户凭据".to_string())
}

fn synthetic_id_token(
    identity: &SessionIdentity,
    expiration: i64,
    issued_at: i64,
) -> Result<String, String> {
    let header = json!({ "alg": "none", "typ": "JWT", "cpa_synthetic": true });
    let payload = json!({
        "iat": issued_at,
        "exp": expiration,
        "email": identity.email,
        "sub": identity.user_id,
        "https://api.openai.com/auth": {
            "chatgpt_account_id": identity.account_id,
            "chatgpt_plan_type": identity.plan_type,
            "chatgpt_user_id": identity.user_id,
            "user_id": identity.user_id,
        },
    });
    Ok(format!(
        "{}.{}.synthetic",
        encode_json(&header)?,
        encode_json(&payload)?
    ))
}

fn auth_from_session(session: ChatGptSession, now: DateTime<Utc>) -> Result<Value, String> {
    let access_token = non_empty(Some(&session.access_token))
        .ok_or_else(|| "ChatGPT 登录会话中没有可用凭据".to_string())?;
    let identity = session_identity(&session)?;
    let id_token = synthetic_id_token(
        &identity,
        session_expiration(&session, now),
        now.timestamp(),
    )?;
    Ok(json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "id_token": id_token,
            "access_token": access_token,
            "refresh_token": "",
            "account_id": identity.account_id,
        },
        "last_refresh": now.to_rfc3339(),
    }))
}

fn decode_session(payload: &str) -> Result<ChatGptSession, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "ChatGPT 登录结果无效，请重新登录".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "ChatGPT 登录结果格式无效，请重新登录".to_string())
}

fn random_nonce() -> String {
    let mut bytes = [0_u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn capture_script(nonce: &str) -> String {
    SESSION_CAPTURE_SCRIPT.replace(NONCE_PLACEHOLDER, nonce)
}

fn callback_payload(url: &Url, expected_nonce: &str) -> Option<String> {
    if url.scheme() != CALLBACK_SCHEME || url.host_str() != Some(CALLBACK_HOST) {
        return None;
    }
    let mut segments = url.path_segments()?;
    if segments.next() != Some(expected_nonce) {
        return None;
    }
    let payload = segments.next()?.to_string();
    if payload.is_empty() || payload.len() > MAX_SESSION_PAYLOAD_LENGTH || segments.next().is_some()
    {
        return None;
    }
    Some(payload)
}

fn close_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if let Err(error) = window.destroy() {
            eprintln!("failed to close ChatGPT web login window: {error}");
        }
    }
}

fn complete_login<R: Runtime>(app: tauri::AppHandle<R>, payload: String) {
    let result = decode_session(&payload)
        .and_then(|session| auth_from_session(session, Utc::now()))
        .and_then(|auth| import_value(&app, auth, false));
    match result {
        Ok(account_id) => {
            let _ = app.emit("accounts-changed", ());
            if let Err(error) =
                crate::commands::refresh_usage_blocking(app.clone(), account_id.clone())
            {
                eprintln!("initial web session account usage refresh failed: {error}");
            }
            emit_login(&app, true, "网页登录成功，账户已添加", Some(account_id));
            crate::system_tray::refresh_menu(&app);
        }
        Err(error) => emit_login(&app, false, error, None),
    }
    close_window(&app);
}

#[tauri::command]
pub(crate) async fn start_web_session_login<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    close_window(&app);
    let url = Url::parse(CHATGPT_URL).map_err(|_| "无法打开 ChatGPT 登录页面".to_string())?;
    let callback_nonce = random_nonce();
    let initialization_script = capture_script(&callback_nonce);
    let completed = Arc::new(AtomicBool::new(false));
    let navigation_completed = completed.clone();
    let navigation_app = app.clone();
    let window = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("ChatGPT 网页登录 - Codex Switch")
        .inner_size(560.0, 760.0)
        .min_inner_size(420.0, 620.0)
        .center()
        .incognito(true)
        .initialization_script(initialization_script)
        .on_navigation(move |url| {
            let Some(payload) = callback_payload(url, &callback_nonce) else {
                return true;
            };
            if !navigation_completed.swap(true, Ordering::Relaxed) {
                let callback_app = navigation_app.clone();
                tauri::async_runtime::spawn_blocking(move || complete_login(callback_app, payload));
            }
            false
        })
        .build()
        .map_err(|error| format!("无法打开 ChatGPT 网页登录：{error}"))?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("无法显示 ChatGPT 网页登录：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn encoded_session() -> String {
        URL_SAFE_NO_PAD.encode(
            json!({
                "accessToken": "header.payload.signature",
                "expires": "2026-09-01T00:00:00Z",
                "user": { "id": "user-1", "email": "person@example.com" },
                "account": { "id": "account-1", "planType": "plus" }
            })
            .to_string(),
        )
    }

    #[test]
    fn builds_codex_auth_from_web_session() {
        let session = decode_session(&encoded_session()).expect("decode session");
        let now = Utc.with_ymd_and_hms(2026, 8, 17, 1, 2, 3).unwrap();
        let auth = auth_from_session(session, now).expect("build auth");
        let claims = decode_jwt(auth["tokens"]["id_token"].as_str().unwrap()).unwrap();

        assert_eq!(auth["tokens"]["access_token"], "header.payload.signature");
        assert_eq!(auth["tokens"]["refresh_token"], "");
        assert_eq!(claims["email"], "person@example.com");
        assert_eq!(
            claims["https://api.openai.com/auth"]["chatgpt_account_id"],
            "account-1"
        );
        assert_eq!(
            claims["https://api.openai.com/auth"]["chatgpt_plan_type"],
            "plus"
        );
    }

    #[test]
    fn recognizes_only_the_private_callback_scheme() {
        let nonce = "test-nonce";
        let callback = Url::parse(&format!(
            "codex-switch-auth://session/{nonce}/{}",
            encoded_session()
        ))
        .unwrap();
        assert_eq!(callback_payload(&callback, nonce), Some(encoded_session()));
        assert!(callback_payload(&callback, "wrong-nonce").is_none());
        assert!(callback_payload(&Url::parse("https://chatgpt.com/").unwrap(), nonce).is_none());
    }
}
