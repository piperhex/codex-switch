mod account_archive;
mod agent_identity;
mod auth;
mod autostart;
mod cloud;
mod codex_api;
mod codex_runtime;
mod commands;
mod conversation_hub;
mod dream_skin;
mod dream_skin_community;
mod dream_skin_market;
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
mod official_plugins;
mod provider_models;
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
    if std::env::args_os().any(|argument| argument == "--print-local-proxy-token") {
        println!("{}", providers::LOCAL_PROXY_TOKEN);
        return;
    }
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            storage::migrate_app_settings_for_version(app.handle())?;
            if let Err(error) = autostart::restore_preference(app.handle()) {
                eprintln!("failed to restore the startup setting: {error}");
            }
            if !launch_options.headless {
                main_window::restore_or_set_default(app)?;
            }
            commands::initialize_local_state(app.handle());
            if !launch_options.headless {
                dream_skin::start_background_updates();
                if let Err(error) = codex_runtime::setup(app.handle()) {
                    eprintln!("failed to initialize the Codex renderer channel: {error}");
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
            commands::copy_account_auth_json,
            commands::import_auth_file,
            commands::import_account_json_file,
            commands::import_account_json_text,
            commands::import_compatible_json_file,
            commands::import_sub2api_json_file,
            account_archive::export_accounts_archive,
            account_archive::import_accounts_archive,
            commands::switch_account,
            commands::switch_account_and_restart_chatgpt,
            commands::deactivate_account_and_restart_chatgpt,
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
            conversation_hub::browse_codex_threads,
            conversation_hub::measure_codex_thread_tokens,
            conversation_hub::discard_codex_threads,
            conversation_hub::browse_codex_thread_bin,
            conversation_hub::recover_codex_threads,
            conversation_hub::purge_codex_threads,
            conversation_hub::empty_codex_thread_bin,
            conversation_hub::inspect_codex_thread_export,
            conversation_hub::pack_codex_threads,
            conversation_hub::inspect_codex_thread_import,
            conversation_hub::unpack_codex_threads,
            conversation_hub::reconcile_codex_thread_visibility,
            conversation_hub::rebuild_codex_thread_index,
            conversation_hub::open_codex_thread_file,
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
            dream_skin::get_dream_skin_market,
            dream_skin::install_dream_skin_market_theme,
            dream_skin::get_dream_skin_community_page,
            dream_skin::install_dream_skin_community_theme,
            providers::list_providers,
            providers::save_provider,
            provider_models::fetch_relay_models,
            providers::fetch_deepseek_models,
            providers::query_provider_balance,
            providers::query_provider_usage,
            providers::switch_provider,
            providers::switch_provider_model,
            providers::set_provider_model_control,
            providers::set_provider_auto_switch_enabled,
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
            local_proxy::list_provider_token_usage,
            local_proxy::show_token_usage_window,
            local_proxy::start_local_proxy,
            local_proxy::stop_local_proxy,
            local_proxy::set_auto_switch_on_quota_exhaustion,
            local_proxy::set_concurrent_account_routing_enabled,
            local_proxy::set_custom_auto_switch_priority_enabled,
            local_proxy::set_auto_disable_unreachable_accounts,
            local_proxy::set_image_generation_account,
            local_proxy::set_local_proxy_openai_auth_account,
            local_proxy::set_local_proxy_listen_on_all_interfaces,
            local_proxy::copy_local_proxy_lan_api_key,
            floating_bubble::get_app_settings,
            autostart::set_launch_at_startup,
            floating_bubble::set_floating_bubble,
            floating_bubble::set_privacy_mode,
            floating_bubble::set_hide_account_notes,
            floating_bubble::set_show_usage_network_errors,
            floating_bubble::set_token_usage_preferences,
            floating_bubble::set_bubble_reset_display,
            floating_bubble::set_bubble_style,
            floating_bubble::set_theme_color,
            floating_bubble::set_app_language,
            web_server::set_web_proxy_port,
            floating_bubble::resize_floating_bubble,
            floating_bubble::resize_floating_bubble_for_provider_card,
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
            cloud::cloud_list_deleted_accounts,
            cloud::cloud_restore_deleted_account,
            cloud::cloud_list_deleted_providers,
            cloud::cloud_restore_deleted_provider,
            cloud::cloud_delete_provider,
            cloud::cloud_sync_accounts,
            cloud::cloud_sync_totp,
            skills_market::list_market_skills,
            skills_market::upload_market_skill,
            skills_market::install_market_skill,
            official_plugins::list_official_plugins,
            official_plugins::install_official_plugin,
            official_plugins::remove_official_plugin,
            official_plugins::set_official_plugin_enabled,
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
