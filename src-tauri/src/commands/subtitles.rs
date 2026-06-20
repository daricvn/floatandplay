use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn load_subtitle_file(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Subtitles", &["srt", "vtt", "ass"])
        .blocking_pick_file();

    let file_path = path.ok_or_else(|| "No file selected".to_string())?;

    let path_buf = match file_path {
        tauri_plugin_dialog::FilePath::Path(p) => p,
        _ => return Err("Unsupported path type".to_string()),
    };

    std::fs::read_to_string(path_buf).map_err(|e| e.to_string())
}
