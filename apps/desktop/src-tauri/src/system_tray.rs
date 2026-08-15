use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime,
};

use crate::{
    commands,
    models::{AccountSummary, ProviderSummary, UsageWindow},
    providers,
    storage::read_app_settings,
};

const TRAY_ID: &str = "main-tray";
const DASHBOARD_ID: &str = "tray:dashboard";
const RESTART_CHATGPT_ID: &str = "tray:restart-chatgpt";
const RESTART_APP_ID: &str = "tray:restart-app";
const QUIT_ID: &str = "tray:quit";
const ACCOUNT_PREFIX: &str = "tray:account:";
const PROVIDER_PREFIX: &str = "tray:provider:";
const PROVIDER_MODEL_PREFIX: &str = "tray:provider-model:";
const PROVIDER_SUBMENU_PREFIX: &str = "tray:provider-submenu:";
const MENU_EMAIL_CHARS: usize = 15;
const MENU_PROVIDER_CHARS: usize = 28;

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_menu(app.handle())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Codex Switch")
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_dashboard(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub(crate) fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                eprintln!("failed to refresh tray menu: {error}");
            }
        }
        Err(error) => eprintln!("failed to build tray menu: {error}"),
    }
}

pub(crate) fn show_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        crate::main_window::reset_to_default_size(app);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == DASHBOARD_ID {
        show_dashboard(app);
        return;
    }
    if id == RESTART_CHATGPT_ID {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = commands::restart_chatgpt_blocking(app) {
                eprintln!("failed to restart ChatGPT from menu: {error}");
            }
        });
        return;
    }
    if id == RESTART_APP_ID {
        app.request_restart();
        return;
    }
    if id == QUIT_ID {
        app.exit(0);
        return;
    }
    if let Some(account_id) = id.strip_prefix(ACCOUNT_PREFIX) {
        let app = app.clone();
        let account_id = account_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) =
                commands::switch_account_and_restart_chatgpt_blocking(app, account_id)
            {
                eprintln!("failed to switch account from tray: {error}");
            }
        });
        return;
    }
    if let Some(selection) = parse_provider_model_menu_id(id) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = providers::switch_provider_model_and_activate_blocking(
                app,
                selection.provider_id,
                selection.model,
            ) {
                eprintln!("failed to switch provider model from menu: {error}");
            }
        });
        return;
    }
    if let Some(provider_id) = id.strip_prefix(PROVIDER_PREFIX) {
        let app = app.clone();
        let provider_id = provider_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = providers::switch_provider_blocking(app, provider_id) {
                eprintln!("failed to switch provider from tray: {error}");
            }
        });
    }
}

pub(crate) fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;
    let chinese = read_app_settings(app)
        .ok()
        .and_then(|settings| settings.language)
        .as_deref()
        == Some("zh");

    let accounts_header = MenuItem::with_id(
        app,
        "tray:accounts-header",
        if chinese { "账号" } else { "Accounts" },
        false,
        None::<&str>,
    )?;
    menu.append(&accounts_header)?;

    match commands::list_accounts_blocking(app.clone()) {
        Ok(accounts) if accounts.is_empty() => {
            let empty = MenuItem::with_id(app, "tray:empty", "暂无节点", false, None::<&str>)?;
            menu.append(&empty)?;
        }
        Ok(accounts) => {
            for account in accounts {
                let item = CheckMenuItem::with_id(
                    app,
                    format!("{ACCOUNT_PREFIX}{}", account.id),
                    account_label(&account),
                    true,
                    account.active,
                    None::<&str>,
                )?;
                menu.append(&item)?;
            }
        }
        Err(error) => {
            let item = MenuItem::with_id(
                app,
                "tray:accounts-error",
                format!("节点读取失败: {error}"),
                false,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    append_provider_items(app, &menu, chinese)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        DASHBOARD_ID,
        if chinese { "仪表板" } else { "Dashboard" },
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        RESTART_CHATGPT_ID,
        if chinese {
            "重启 ChatGPT"
        } else {
            "Restart ChatGPT"
        },
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        RESTART_APP_ID,
        if chinese {
            "重启 Codex Switch"
        } else {
            "Restart Codex Switch"
        },
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        if chinese { "退出程序" } else { "Quit" },
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

fn append_provider_items<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    chinese: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let header = MenuItem::with_id(
        app,
        "tray:providers-header",
        if chinese {
            "三方 Provider"
        } else {
            "Providers"
        },
        false,
        None::<&str>,
    )?;
    menu.append(&header)?;

    match providers::list_providers(app.clone()) {
        Ok(providers) => {
            if providers.is_empty() {
                let empty = MenuItem::with_id(
                    app,
                    "tray:providers-empty",
                    "No providers",
                    false,
                    None::<&str>,
                )?;
                menu.append(&empty)?;
                return Ok(());
            }

            for provider in providers {
                append_provider_item(app, menu, &provider)?;
            }
        }
        Err(error) => {
            let item = MenuItem::with_id(
                app,
                "tray:providers-error",
                format!("Providers error: {error}"),
                false,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }
    Ok(())
}

fn append_provider_item<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    provider: &ProviderSummary,
) -> Result<(), Box<dyn std::error::Error>> {
    if provider.model_selection_controlled_by_codex || provider.models.is_empty() {
        let item = CheckMenuItem::with_id(
            app,
            format!("{PROVIDER_PREFIX}{}", provider.id),
            provider_label(provider),
            provider.supports_direct_switch,
            provider.active,
            None::<&str>,
        )?;
        menu.append(&item)?;
        return Ok(());
    }

    let submenu = Submenu::with_id(
        app,
        format!("{PROVIDER_SUBMENU_PREFIX}{}", provider.id),
        provider_submenu_label(provider),
        provider.supports_direct_switch,
    )?;
    for model in &provider.models {
        let item = CheckMenuItem::with_id(
            app,
            provider_model_menu_id(&provider.id, model),
            escape_menu_text(&truncate_menu_provider(model)),
            provider.supports_direct_switch,
            provider.active && provider.model == *model,
            None::<&str>,
        )?;
        submenu.append(&item)?;
    }
    menu.append(&submenu)?;
    Ok(())
}

fn provider_submenu_label(provider: &ProviderSummary) -> String {
    let label = provider_label(provider);
    if provider.active {
        format!("✓ {label}")
    } else {
        label
    }
}

struct ProviderModelSelection {
    provider_id: String,
    model: String,
}

fn provider_model_menu_id(provider_id: &str, model: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    format!(
        "{PROVIDER_MODEL_PREFIX}{}:{}",
        URL_SAFE_NO_PAD.encode(provider_id),
        URL_SAFE_NO_PAD.encode(model)
    )
}

fn parse_provider_model_menu_id(id: &str) -> Option<ProviderModelSelection> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    let encoded = id.strip_prefix(PROVIDER_MODEL_PREFIX)?;
    let (provider_id, model) = encoded.split_once(':')?;
    Some(ProviderModelSelection {
        provider_id: String::from_utf8(URL_SAFE_NO_PAD.decode(provider_id).ok()?).ok()?,
        model: String::from_utf8(URL_SAFE_NO_PAD.decode(model).ok()?).ok()?,
    })
}

fn account_label(account: &AccountSummary) -> String {
    format!(
        "{} | 5h {} | 1week {}",
        escape_menu_text(&truncate_menu_email(&account.email)),
        remaining_label(account.usage.primary.as_ref()),
        remaining_label(account.usage.secondary.as_ref()),
    )
}

pub(crate) fn provider_label(provider: &ProviderSummary) -> String {
    let name = escape_menu_text(&truncate_menu_provider(&provider.name));
    if provider.model_selection_controlled_by_codex || provider.model.trim().is_empty() {
        name
    } else {
        format!(
            "{name} | {}",
            escape_menu_text(&truncate_menu_provider(&provider.model))
        )
    }
}

fn remaining_label(window: Option<&UsageWindow>) -> String {
    window
        .map(|window| format!("{}%", window.remaining_percent.round().clamp(0.0, 100.0)))
        .unwrap_or_else(|| "--".to_string())
}

fn truncate_menu_provider(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_PROVIDER_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn escape_menu_text(text: &str) -> String {
    text.replace('&', "&&")
}

fn truncate_menu_email(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_EMAIL_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_provider_model_menu_id, provider_model_menu_id};

    #[test]
    fn provider_model_menu_id_round_trips_special_characters() {
        let id = provider_model_menu_id("relay:one", "openai/gpt:latest 中文");
        let selection = parse_provider_model_menu_id(&id).expect("menu id should be valid");

        assert_eq!(selection.provider_id, "relay:one");
        assert_eq!(selection.model, "openai/gpt:latest 中文");
    }

    #[test]
    fn provider_model_menu_id_rejects_invalid_values() {
        assert!(parse_provider_model_menu_id("tray:provider-model:not-base64:!").is_none());
        assert!(parse_provider_model_menu_id("tray:provider:relay").is_none());
    }
}
