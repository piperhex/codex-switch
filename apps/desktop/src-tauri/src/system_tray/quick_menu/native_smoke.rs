//! Run this ignored regression with Vite serving the desktop frontend on port 1489.
//! Uses a separate WebView profile and synthetic menu entries; never switches real accounts.
use super::*;
use std::time::Duration;

#[test]
#[ignore = "requires an interactive Windows desktop and Vite on port 1489"]
fn dismisses_real_menu_without_webview_blur() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.quick-menu-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1489".parse().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();
    tauri::Builder::default()
        .any_thread()
        .manage(QuickMenuState::default())
        // Deliberately omit handle_window_event: exercise native dismissal with no WebView blur.
        .invoke_handler(tauri::generate_handler![
            quick_menu_snapshot,
            quick_menu_present,
            quick_menu_dismiss,
        ])
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(30), exercise(&app)).await;
                let result = result
                    .map_err(|error| error.to_string())
                    .and_then(|result| result);
                sender.send(result).unwrap();
                app.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap()
        .run_return(|_, _| {});
    receiver.recv().unwrap().unwrap();
}

async fn open_fixture(app: &AppHandle) -> Result<WebviewWindow, String> {
    {
        let state = app.state::<QuickMenuState>();
        let mut session = state.session.lock().await;
        session.snapshot.revision += 1;
        session.snapshot.entries = vec![snapshot::MenuEntry {
            id: "smoke:item".into(),
            text: "Menu focus fixture".into(),
            enabled: true,
            checked: false,
            separator: false,
            children: vec![],
        }];
        session.open = true;
        session.anchor = PhysicalPosition::new(500.0, 300.0);
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .emit(REFRESH_EVENT, ())
            .map_err(|error| error.to_string())?;
    } else {
        create_window(app).await?;
    }
    let window = app.get_webview_window(LABEL).ok_or("missing menu window")?;
    wait_for(|| window.is_visible())
        .await
        .map_err(|error| format!("opening fixture: {error}"))?;
    Ok(window)
}

async fn exercise(app: &AppHandle) -> Result<(), String> {
    let outside = tauri::WindowBuilder::new(app, "outside-menu")
        .title("Quick menu dismissal regression")
        .inner_size(320.0, 160.0)
        .position(40.0, 40.0)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..3 {
        let menu = open_fixture(app).await?;
        menu.eval("document.querySelector('button[role=menuitem]').focus()")
            .map_err(|error| error.to_string())?;
        tokio::time::sleep(Duration::from_millis(150)).await;
        if !menu.is_visible().map_err(|error| error.to_string())? {
            return Err("focus inside the WebView dismissed the menu".into());
        }
        deactivate_while_locked(&menu, &outside).await?;
        wait_for(|| Ok(!menu.is_visible()?))
            .await
            .map_err(|error| format!("dismissing fixture: {error}"))?;
        let state = app.state::<QuickMenuState>();
        if state.session.lock().await.open || state.presented_revision.load(Ordering::Acquire) != 0
        {
            return Err("hidden menu retained an open session".into());
        }
    }
    outside.destroy().map_err(|error| error.to_string())?;
    app.get_webview_window(LABEL)
        .unwrap()
        .destroy()
        .map_err(|error| error.to_string())
}

async fn deactivate_while_locked(
    menu: &WebviewWindow,
    outside: &tauri::Window,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, WA_INACTIVE, WM_ACTIVATE};
    let app = menu.app_handle();
    let state = app.state::<QuickMenuState>();
    let _session = state.session.lock().await;
    outside.show().map_err(|error| error.to_string())?;
    outside.set_focus().map_err(|error| error.to_string())?;
    let hwnd = menu.hwnd().map_err(|error| error.to_string())?.0 as usize;
    // A native deactivation callback must return even while a refresh owns the session lock.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        // Test runners may be denied foreground activation. Deliver the native message explicitly
        // so this test still covers missing WebView blur without requiring global input injection.
        // SAFETY: This is the live menu HWND on its owning UI thread, with scalar message arguments.
        unsafe {
            SendMessageW(hwnd as _, WM_ACTIVATE, WA_INACTIVE as usize, 0);
        }
        sender.send(()).unwrap();
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .map_err(|_| "native dismissal blocked the UI thread")?
        .map_err(|error| error.to_string())
}

async fn wait_for(mut predicate: impl FnMut() -> tauri::Result<bool>) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if predicate().map_err(|error| error.to_string())? {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .map_err(|_| "menu visibility did not change")?
}
