use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    AppHandle, Runtime,
};

use super::{account_label::account_label, ACCOUNT_PREFIX};
use crate::{commands, models::AppSettings};

pub(super) fn append_accounts<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    settings: Option<&AppSettings>,
    chinese: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let accounts = match commands::list_accounts_blocking(app.clone()) {
        Ok(accounts) => accounts,
        Err(error) => {
            eprintln!("failed to read accounts for menu: {error}");
            let text = if chinese {
                "账号读取失败"
            } else {
                "Unable to load accounts"
            };
            return append_notice(app, menu, text);
        }
    };
    if accounts.is_empty() {
        let text = if chinese {
            "暂无账号"
        } else {
            "No accounts"
        };
        return append_notice(app, menu, text);
    }
    #[cfg(windows)]
    let first_position = menu.items()?.len() as u32;
    #[cfg(windows)]
    let count = accounts.len() as u32;
    for account in accounts {
        menu.append(&CheckMenuItem::with_id(
            app,
            format!("{ACCOUNT_PREFIX}{}", account.id),
            account_label(&account.email, &account.usage, chinese),
            true,
            account.active,
            None::<&str>,
        )?)?;
    }
    #[cfg(windows)]
    super::windows_menu::style_accounts(
        menu,
        (first_position..first_position + count).collect(),
        super::account_label::theme_color(
            settings.and_then(|settings| settings.theme_color.as_deref()),
        ),
    )
    .map_err(std::io::Error::other)?;
    #[cfg(not(windows))]
    let _ = settings;
    Ok(())
}

fn append_notice<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    menu.append(&MenuItem::with_id(
        app,
        "tray:accounts-notice",
        text,
        false,
        None::<&str>,
    )?)?;
    Ok(())
}
