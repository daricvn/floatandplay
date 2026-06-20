use tauri::Emitter;
use crate::ClickThroughState;

#[tauri::command]
pub fn set_click_through(
    window: tauri::WebviewWindow,
    state: tauri::State<ClickThroughState>,
    on: bool,
) -> Result<(), String> {
    {
        let mut s = state.0.lock().unwrap();
        *s = on;
    }
    window.set_ignore_cursor_events(on).map_err(|e| e.to_string())?;
    window.emit("click-through-changed", on).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_click_through(state: tauri::State<ClickThroughState>) -> Result<bool, String> {
    Ok(*state.0.lock().unwrap())
}

#[tauri::command]
pub fn set_always_on_top(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

/// Lock the window's resize aspect ratio to the loaded video, and fit the
/// current width to it once. `ratio` is width / height; 0 unlocks.
#[tauri::command]
pub fn set_video_aspect(window: tauri::WebviewWindow, ratio: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::win_aspect::set_aspect(ratio);
        if ratio > 0.0 {
            if let Ok(size) = window.inner_size() {
                let h = (size.width as f64 / ratio).round() as u32;
                window
                    .set_size(tauri::PhysicalSize::new(size.width, h))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&window, ratio);
    }
    Ok(())
}
