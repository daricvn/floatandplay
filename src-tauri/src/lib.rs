use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use std::sync::{Arc, Mutex};
use std::collections::HashSet;

mod commands;
mod proxy;
mod companion;
mod ytdlp_types;
#[cfg(target_os = "windows")]
mod win_aspect;

pub struct ClickThroughState(pub Arc<Mutex<bool>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest client shared by every stream:// request (header-injecting media fetch)
    let stream_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .expect("build stream client");

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("stream", move |_ctx, request, responder| {
            let client = stream_client.clone();
            tauri::async_runtime::spawn(async move {
                let response = proxy::handle_stream_request(client, request).await;
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                w.show().ok();
                w.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register("floatpip").ok();
            }

            let win = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                apply_acrylic(&win, Some((18, 18, 18, 125))).ok();

                // Lock window aspect ratio to the video during native resize (WM_SIZING).
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                if let Ok(handle) = win.window_handle() {
                    if let RawWindowHandle::Win32(h) = handle.as_raw() {
                        win_aspect::install(h.hwnd.get());
                    }
                }
            }

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, None).ok();
            }

            // Restore window position and size from persistent store
            {
                let store = app.store("floatpip-settings.json")?;
                if let (Some(x), Some(y)) = (
                    store.get("win_x").and_then(|v| v.as_i64()),
                    store.get("win_y").and_then(|v| v.as_i64()),
                ) {
                    let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                }
                if let (Some(w), Some(h)) = (
                    store.get("win_w").and_then(|v| v.as_u64()),
                    store.get("win_h").and_then(|v| v.as_u64()),
                ) {
                    let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                }
            }

            // Persist window position and size on move/resize
            {
                let handle_for_events = app.handle().clone();
                win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Moved(pos) => {
                            if let Ok(store) = handle_for_events.store("floatpip-settings.json") {
                                store.set("win_x", pos.x);
                                store.set("win_y", pos.y);
                                let _ = store.save();
                            }
                        }
                        tauri::WindowEvent::Resized(size) => {
                            if let Ok(store) = handle_for_events.store("floatpip-settings.json") {
                                store.set("win_w", size.width);
                                store.set("win_h", size.height);
                                let _ = store.save();
                            }
                        }
                        _ => {}
                    }
                });
            }

            // Shared click-through state (default: false)
            let click_through_state = Arc::new(Mutex::new(false));
            app.manage(ClickThroughState(Arc::clone(&click_through_state)));

            // Ctrl+Alt+C global hotkey — toggles click-through even when window is passthrough
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyC);
            let handle_for_shortcut = app.handle().clone();
            let ct_state_shortcut = Arc::clone(&click_through_state);
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(w) = handle_for_shortcut.get_webview_window("main") {
                        let next = {
                            let mut state = ct_state_shortcut.lock().unwrap();
                            let next = !*state;
                            *state = next;
                            next
                        };
                        let _ = w.set_ignore_cursor_events(next);
                        let _ = w.emit("click-through-changed", next);
                    }
                }
            })?;

            // Build tray menu
            use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};

            let show_hide = MenuItem::with_id(app, "show-hide", "Show / Hide", true, None::<&str>)?;

            let click_through_item = Arc::new(
                CheckMenuItem::with_id(app, "click-through", "Click-through  Ctrl+Alt+C", true, false, None::<&str>)?
            );

            let always_on_top_item = Arc::new(
                CheckMenuItem::with_id(app, "always-on-top", "Always on Top", true, true, None::<&str>)?
            );

            let quit = MenuItem::with_id(app, "quit", "Quit FloatPiP", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &show_hide,
                click_through_item.as_ref(),
                always_on_top_item.as_ref(),
                &PredefinedMenuItem::separator(app)?,
                &quit,
            ])?;

            // Track always-on-top state (initial: true, matching tauri.conf.json)
            let always_on_top_state = Arc::new(Mutex::new(true));

            let click_through_item_tray = Arc::clone(&click_through_item);
            let always_on_top_item_tray = Arc::clone(&always_on_top_item);
            let always_on_top_state_tray = Arc::clone(&always_on_top_state);
            let ct_state_tray = Arc::clone(&click_through_state);
            let handle_for_tray = app.handle().clone();

            // Decode tray PNG → raw RGBA for tauri::image::Image
            let tray_png = include_bytes!("../icons/tray.png");
            let tray_img = image::load_from_memory(tray_png)
                .expect("decode tray icon")
                .to_rgba8();
            let (tw, th) = tray_img.dimensions();
            let tray_rgba = tray_img.into_raw();
            let tray_icon_img = tauri::image::Image::new_owned(tray_rgba, tw, th);

            let tray_icon = tauri::tray::TrayIconBuilder::new()
                .icon(tray_icon_img)
                .menu(&menu)
                .on_menu_event(move |_tray, event| {
                    let win = match handle_for_tray.get_webview_window("main") {
                        Some(w) => w,
                        None => return,
                    };
                    match event.id().as_ref() {
                        "show-hide" => {
                            if win.is_visible().unwrap_or(true) {
                                let _ = win.emit("window-hidden", true);
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                            }
                        }
                        "click-through" => {
                            let next = {
                                let mut state = ct_state_tray.lock().unwrap();
                                let next = !*state;
                                *state = next;
                                next
                            };
                            let _ = win.set_ignore_cursor_events(next);
                            let _ = win.emit("click-through-changed", next);
                            let _ = click_through_item_tray.set_checked(next);
                        }
                        "always-on-top" => {
                            let mut state = always_on_top_state_tray.lock().unwrap();
                            let next = !*state;
                            *state = next;
                            let _ = win.set_always_on_top(next);
                            let _ = always_on_top_item_tray.set_checked(next);
                        }
                        "quit" => {
                            handle_for_tray.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Keep tray icon alive for the duration of the app (dropping removes it from tray)
            app.manage(tray_icon);

            app.manage(companion::CompanionState(Arc::new(Mutex::new(HashSet::new()))));
            companion::spawn(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window::set_click_through,
            commands::window::set_always_on_top,
            commands::window::set_video_aspect,
            commands::window::get_click_through,
            commands::ytdlp::extract_stream,
            commands::ytdlp::extract_playlist,
            commands::subtitles::load_subtitle_file,
            proxy::get_proxy_url,
            companion::register_companion_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
