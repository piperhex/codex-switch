mod account_archive;
mod agent_identity;
mod auth;
mod cloud;
mod codex_api;
mod commands;
mod dream_skin;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod dream_skin_native;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod dream_skin_resources;
mod floating_bubble;
mod launch_options;
mod local_proxy;
mod main_window;
mod models;
mod oauth;
mod providers;
mod remote_control;
mod skills_market;
mod storage;
mod system_proxy;
mod system_tray;
mod web_server;

use oauth::AppState;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_options = match launch_options::LaunchOptions::from_environment() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}\nUsage: codex-switch --headless --port=<1-65535>");
            std::process::exit(2);
        }
    };
    let mut context = tauri::generate_context!();
    if launch_options.headless {
        context.config_mut().app.windows.clear();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            match launch_options::LaunchOptions::parse(args) {
                Ok(options) if options.headless => {
                    if let Some(port) = options.port {
                        if let Err(error) = web_server::restart_at_port(app, port) {
                            eprintln!("failed to apply headless launch request: {error}");
                        }
                    }
                }
                Ok(_) => system_tray::show_dashboard(app),
                Err(error) => eprintln!("invalid launch request: {error}"),
            }
        }))
        .manage(AppState::default())
        .manage(main_window::MainWindowStateCache::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            storage::migrate_app_settings_for_version(app.handle())?;
            if !launch_options.headless {
                main_window::restore_or_set_default(app)?;
            }
            commands::initialize_local_state(app.handle());
            if !launch_options.headless {
                if let Err(error) = dream_skin::setup(app.handle()) {
                    eprintln!("failed to restore Dream Skin monitor: {error}");
                }
            }
            match local_proxy::restore_local_proxy_if_enabled(app.handle()) {
                Ok(true) => {}
                Ok(false) => providers::cleanup_stale_local_proxy_config(app.handle())?,
                Err(error) => {
                    eprintln!("failed to restore local proxy: {error}");
                    providers::cleanup_stale_local_proxy_config(app.handle())?;
                }
            }
            if !launch_options.headless {
                system_tray::setup(app)?;
                floating_bubble::setup(app.handle())?;
            }
            if let Err(error) = web_server::setup(app.handle(), launch_options.port) {
                if launch_options.headless {
                    return Err(std::io::Error::other(error).into());
                }
                eprintln!("failed to restore web version server: {error}");
            }
            remote_control::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                ) {
                    main_window::remember(window);
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    main_window::remember_and_save(window);
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == local_proxy::TOKEN_USAGE_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.destroy();
                }
            }
            if window.label() == floating_bubble::BUBBLE_LABEL
                && matches!(event, tauri::WindowEvent::Moved(_))
            {
                floating_bubble::remember_position(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::open_managed_folder,
            commands::list_accounts,
            commands::import_auth_file,
            commands::import_account_json_file,
            commands::import_account_json_text,
            commands::import_compatible_json_file,
            commands::import_sub2api_json_file,
            account_archive::export_accounts_archive,
            account_archive::import_accounts_archive,
            commands::switch_account,
            commands::switch_account_and_restart_chatgpt,
            commands::set_account_auto_switch_enabled,
            commands::set_account_auto_switch_priority,
            commands::set_auto_disable_status_codes,
            commands::update_account_note,
            commands::delete_account,
            commands::refresh_usage,
            commands::consume_account_quota,
            commands::fetch_reset_credits,
            commands::consume_reset_credit,
            commands::restart_chatgpt,
            commands::launch_chatgpt,
            commands::restore_non_proxy_conversations,
            dream_skin::get_dream_skin_status,
            dream_skin::get_dream_skin_resources_status,
            dream_skin::retry_dream_skin_resources,
            dream_skin::install_dream_skin,
            dream_skin::apply_dream_skin_theme,
            dream_skin::import_dream_skin_image,
            dream_skin::save_dream_skin_theme,
            dream_skin::set_dream_skin_appearance,
            dream_skin::set_dream_skin_paused,
            dream_skin::reapply_dream_skin,
            dream_skin::verify_dream_skin,
            dream_skin::restore_dream_skin,
            dream_skin::open_dream_skin_folder,
            dream_skin::get_dream_skin_theme_preview,
            providers::list_providers,
            providers::save_provider,
            providers::query_provider_balance,
            providers::switch_provider,
            providers::switch_provider_model,
            providers::set_provider_model_control,
            providers::disable_provider,
            providers::delete_provider,
            local_proxy::get_local_proxy_status,
            local_proxy::list_proxy_sessions,
            local_proxy::list_proxy_session_requests,
            local_proxy::get_recent_proxy_session_latency,
            local_proxy::export_diagnostic_logs,
            local_proxy::list_token_usage_entries,
            local_proxy::list_daily_token_usage,
            local_proxy::list_account_token_usage,
            local_proxy::show_token_usage_window,
            local_proxy::start_local_proxy,
            local_proxy::stop_local_proxy,
            local_proxy::set_auto_switch_on_quota_exhaustion,
            local_proxy::set_custom_auto_switch_priority_enabled,
            local_proxy::set_auto_disable_unreachable_accounts,
            local_proxy::set_image_generation_account,
            local_proxy::set_local_proxy_openai_auth_account,
            local_proxy::set_local_proxy_listen_on_all_interfaces,
            floating_bubble::get_app_settings,
            floating_bubble::set_floating_bubble,
            floating_bubble::set_privacy_mode,
            floating_bubble::set_show_usage_network_errors,
            floating_bubble::set_token_usage_preferences,
            floating_bubble::set_bubble_reset_display,
            floating_bubble::set_bubble_style,
            floating_bubble::set_theme_color,
            floating_bubble::set_app_language,
            web_server::set_web_proxy_port,
            floating_bubble::resize_floating_bubble,
            floating_bubble::drag_floating_bubble,
            floating_bubble::show_floating_bubble_menu,
            floating_bubble::show_dashboard_from_bubble,
            oauth::start_login,
            cloud::get_cloud_auth_state,
            cloud::get_saved_cloud_login,
            cloud::fetch_cloud_announcement,
            cloud::fetch_cloud_faqs,
            cloud::fetch_cloud_notifications,
            cloud::report_announcement_click,
            cloud::submit_feedback,
            cloud::report_first_installation,
            cloud::report_device_activity,
            cloud::report_base_url_change,
            cloud::set_cloud_base_url,
            cloud::cloud_login,
            cloud::cloud_request_registration_code,
            cloud::cloud_register,
            cloud::cloud_change_password,
            cloud::cloud_logout,
            cloud::cloud_push_accounts,
            cloud::cloud_push_account,
            cloud::cloud_push_providers,
            cloud::cloud_push_provider,
            cloud::cloud_delete_account,
            cloud::cloud_delete_provider,
            cloud::cloud_sync_accounts,
            skills_market::list_market_skills,
            skills_market::upload_market_skill,
            skills_market::install_market_skill,
        ])
        .build(context)
        .unwrap_or_else(|error| {
            eprintln!("failed to start Codex Switch: {error}");
            std::process::exit(1);
        })
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                system_tray::show_dashboard(app);
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                web_server::shutdown();
                // Window move/resize events keep this cache current. Reading the
                // native window again while macOS is tearing it down can return a
                // transient, much smaller frame and corrupt the persisted size.
                if let Err(error) = main_window::save_cached(app) {
                    eprintln!("failed to save main window state before exit: {error}");
                }
            }
        });
}
