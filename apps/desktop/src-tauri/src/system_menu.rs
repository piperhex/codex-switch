use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager, Runtime,
};

use crate::storage::read_app_settings;

pub(crate) const SYSTEM_MENU_EVENT: &str = "system-menu-action";

const ACTION_PREFIX: &str = "system-menu:";
const RESTART_APP_ID: &str = "system-menu:restart-app";
const QUIT_ID: &str = "system-menu:quit";

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.set_menu(build_menu(app.handle())?)?;
    Ok(())
}

pub(crate) fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if let Err(error) = window.set_menu(menu) {
                eprintln!("failed to refresh system menu: {error}");
            }
        }
        Err(error) => eprintln!("failed to build system menu: {error}"),
    }
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == RESTART_APP_ID {
        app.request_restart();
        return;
    }
    if id == QUIT_ID {
        app.exit(0);
        return;
    }
    let Some(action) = id.strip_prefix(ACTION_PREFIX) else {
        return;
    };
    crate::system_tray::show_dashboard(app);
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.emit(SYSTEM_MENU_EVENT, action) {
            eprintln!("failed to dispatch system menu action '{action}': {error}");
        }
    }
}

pub(crate) fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let chinese = read_app_settings(app)
        .ok()
        .and_then(|settings| settings.language)
        .as_deref()
        == Some("zh");

    let add_account = action_item(app, "add-account", chinese, "添加账户", "Add account")?;
    let import_archive = action_item(app, "import-archive", chinese, "导入备份", "Import backup")?;
    let export_archive = action_item(app, "export-archive", chinese, "导出备份", "Export backup")?;
    let open_codex_home = action_item(
        app,
        "open-codex-home",
        chinese,
        "打开 Codex Home 目录",
        "Open Codex Home",
    )?;
    let open_account_store = action_item(
        app,
        "open-account-store",
        chinese,
        "打开账户仓库",
        "Open account store",
    )?;
    let restart_app = MenuItem::with_id(
        app,
        RESTART_APP_ID,
        text(chinese, "重启 Codex Switch", "Restart Codex Switch"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        QUIT_ID,
        text(chinese, "退出程序", "Quit"),
        true,
        None::<&str>,
    )?;
    let file_menu = Submenu::with_items(
        app,
        text(chinese, "文件", "File"),
        true,
        &[
            &add_account,
            &PredefinedMenuItem::separator(app)?,
            &import_archive,
            &export_archive,
            &PredefinedMenuItem::separator(app)?,
            &open_codex_home,
            &open_account_store,
            &PredefinedMenuItem::separator(app)?,
            &restart_app,
            &quit,
        ],
    )?;

    let accounts = action_item(app, "accounts", chinese, "账户管理", "Accounts")?;
    let providers = action_item(app, "providers", chinese, "三方 Provider", "Providers")?;
    let token_usage = action_item(app, "token-usage", chinese, "Token 汇总", "Token summary")?;
    let dream_skin = action_item(app, "dream-skin", chinese, "一键换肤", "One-click Skin")?;
    let skills = action_item(app, "skills", chinese, "Skills 市场", "Skills Market")?;
    let settings = action_item(app, "settings", chinese, "设置", "Settings")?;
    let navigate_menu = Submenu::with_items(
        app,
        text(chinese, "导航", "Navigate"),
        true,
        &[
            &accounts,
            &providers,
            &token_usage,
            &PredefinedMenuItem::separator(app)?,
            &dream_skin,
            &skills,
            &PredefinedMenuItem::separator(app)?,
            &settings,
        ],
    )?;

    let refresh_all = action_item(
        app,
        "refresh-all",
        chinese,
        "刷新全部用量",
        "Refresh all usage",
    )?;
    let refresh_reset_credits = action_item(
        app,
        "refresh-reset-credits",
        chinese,
        "刷新重置卡",
        "Refresh reset cards",
    )?;
    let open_token_window = action_item(
        app,
        "open-token-window",
        chinese,
        "打开 Token 用量窗口",
        "Open token usage window",
    )?;
    let start_chatgpt = action_item(
        app,
        "start-chatgpt",
        chinese,
        "启动 ChatGPT",
        "Start ChatGPT",
    )?;
    let restart_chatgpt = action_item(
        app,
        "restart-chatgpt",
        chinese,
        "重启 ChatGPT",
        "Restart ChatGPT",
    )?;
    let export_logs = action_item(
        app,
        "export-logs",
        chinese,
        "导出诊断日志",
        "Export diagnostic logs",
    )?;
    let tools_menu = Submenu::with_items(
        app,
        text(chinese, "工具", "Tools"),
        true,
        &[
            &refresh_all,
            &refresh_reset_credits,
            &open_token_window,
            &PredefinedMenuItem::separator(app)?,
            &start_chatgpt,
            &restart_chatgpt,
            &PredefinedMenuItem::separator(app)?,
            &export_logs,
        ],
    )?;

    let cloud_account = action_item(
        app,
        "cloud-account",
        chinese,
        "登录 / 账户信息",
        "Sign in / Account details",
    )?;
    let cloud_sync = action_item(app, "cloud-sync", chinese, "立即云同步", "Sync cloud now")?;
    let cloud_logout = action_item(
        app,
        "cloud-logout",
        chinese,
        "退出云端账户",
        "Sign out of cloud",
    )?;
    let cloud_menu = Submenu::with_items(
        app,
        text(chinese, "云端", "Cloud"),
        true,
        &[&cloud_account, &cloud_sync, &cloud_logout],
    )?;

    let notifications = action_item(app, "notifications", chinese, "通知", "Notifications")?;
    let help = action_item(app, "help", chinese, "使用帮助", "Help")?;
    let check_update = action_item(
        app,
        "check-update",
        chinese,
        "检查更新",
        "Check for updates",
    )?;
    let feedback = action_item(app, "feedback", chinese, "反馈问题", "Send feedback")?;
    let repository = action_item(
        app,
        "repository",
        chinese,
        "GitHub 项目仓库",
        "GitHub repository",
    )?;
    let about = action_item(
        app,
        "about",
        chinese,
        "关于 Codex Switch",
        "About Codex Switch",
    )?;
    let help_menu = Submenu::with_items(
        app,
        text(chinese, "帮助", "Help"),
        true,
        &[
            &notifications,
            &help,
            &check_update,
            &feedback,
            &PredefinedMenuItem::separator(app)?,
            &repository,
            &about,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &file_menu,
            &navigate_menu,
            &tools_menu,
            &cloud_menu,
            &help_menu,
        ],
    )
}

fn action_item<R: Runtime>(
    app: &AppHandle<R>,
    action: &str,
    chinese: bool,
    zh: &str,
    en: &str,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(
        app,
        format!("{ACTION_PREFIX}{action}"),
        text(chinese, zh, en),
        true,
        None::<&str>,
    )
}

fn text<'a>(chinese: bool, zh: &'a str, en: &'a str) -> &'a str {
    if chinese {
        zh
    } else {
        en
    }
}
