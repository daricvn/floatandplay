use crate::ytdlp_types::{
    FlatPlaylistOutput, PlaylistEntry, PlaylistInfo, StreamInfo, SubTrack, YtdlpOutput,
    YtdlpSubtitle,
};
use std::collections::HashMap;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn extract_stream(
    app: tauri::AppHandle,
    url: String,
    subtitle_lang: Option<String>,
) -> Result<StreamInfo, String> {
    eprintln!("[extract] called url={url}");
    let shell = app.shell();
    let output = shell
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "-J",
            "--no-playlist",
            "--no-warnings",
            "-f",
            "best[protocol^=http][acodec!=none][vcodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            &url,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    eprintln!(
        "[extract] yt-dlp exit success={} stdout={}B stderr={}B",
        output.status.success(),
        output.stdout.len(),
        output.stderr.len()
    );

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("[extract] !! yt-dlp failed: {err}");
        return Err(err);
    }

    let v: YtdlpOutput = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[extract] !! json parse error: {e}");
            return Err(e.to_string());
        }
    };

    let result = parse_ytdlp_output(v, subtitle_lang.as_deref());
    match &result {
        Ok(info) => eprintln!(
            "[extract] ok title={:?} video_url_len={}",
            info.title,
            info.video_url.len()
        ),
        Err(e) => eprintln!("[extract] !! parse_ytdlp_output: {e}"),
    }
    result
}

#[tauri::command]
pub async fn extract_playlist(
    app: tauri::AppHandle,
    url: String,
) -> Result<PlaylistInfo, String> {
    let shell = app.shell();
    let output = shell
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(["-J", "--flat-playlist", "--yes-playlist", "--no-warnings", &url])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let flat: FlatPlaylistOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| e.to_string())?;
    Ok(parse_flat_playlist(flat))
}

fn parse_flat_playlist(flat: FlatPlaylistOutput) -> PlaylistInfo {
    let entries = flat
        .entries
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| {
            let id = e.id?;
            let title = e.title.unwrap_or_else(|| "[unavailable]".to_string());
            let url = e
                .webpage_url
                .or(e.url)
                .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
            Some(PlaylistEntry { id, title, url })
        })
        .take(300)
        .collect();

    PlaylistInfo {
        id: flat.id,
        title: flat.title,
        entries,
    }
}

fn pick_best_muxed(formats: &[crate::ytdlp_types::YtdlpFormat]) -> Option<usize> {
    // Prefer muxed (has both video+audio) up to 720p
    let mut best: Option<(usize, i64)> = None;

    for (i, f) in formats.iter().enumerate() {
        if f.url.is_none() {
            continue;
        }
        let has_video = f.vcodec.as_deref().map(|v| v != "none").unwrap_or(false);
        let has_audio = f.acodec.as_deref().map(|a| a != "none").unwrap_or(false);
        if !has_video || !has_audio {
            continue;
        }
        let height = f.height.unwrap_or(0);
        if height > 720 {
            continue;
        }
        if best.is_none() || height > best.unwrap().1 {
            best = Some((i, height));
        }
    }

    // Fallback: any muxed format ignoring height cap
    if best.is_none() {
        for (i, f) in formats.iter().enumerate() {
            if f.url.is_none() {
                continue;
            }
            let has_video = f.vcodec.as_deref().map(|v| v != "none").unwrap_or(false);
            let has_audio = f.acodec.as_deref().map(|a| a != "none").unwrap_or(false);
            if has_video && has_audio {
                return Some(i);
            }
        }
    }

    best.map(|(i, _)| i)
}

fn collect_subs(subs: &Option<HashMap<String, Vec<YtdlpSubtitle>>>) -> Vec<SubTrack> {
    let Some(map) = subs else { return vec![] };
    let mut out = vec![];
    for (lang, tracks) in map {
        let track = tracks
            .iter()
            .find(|t| t.ext == "vtt")
            .or_else(|| tracks.iter().find(|t| t.ext == "srt"))
            .or_else(|| tracks.first());
        if let Some(t) = track {
            out.push(SubTrack {
                lang: lang.clone(),
                label: t.name.clone().unwrap_or_else(|| lang.clone()),
                url: t.url.clone(),
                ext: t.ext.clone(),
            });
        }
    }
    out
}

/// True if two lang codes refer to the same language, allowing region variants
/// (`en` ~ `en-US`). Mirrors the frontend's deep-link matching in App.tsx.
fn lang_matches(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}-")) || b.starts_with(&format!("{a}-"))
}

/// Resolve a single auto-generated caption track for `lang` from
/// `automatic_captions`. Skips the whole map unless a lang is requested — the
/// extension passes the user's active YouTube caption lang via deep link — so
/// we surface only that one track, not YouTube's hundreds of machine
/// translations. Returns None if a human-authored track already covers `lang`.
fn find_auto_track(
    auto: &Option<HashMap<String, Vec<YtdlpSubtitle>>>,
    lang: &str,
    existing: &[SubTrack],
) -> Option<SubTrack> {
    let map = auto.as_ref()?;
    if existing.iter().any(|t| lang_matches(&t.lang, lang)) {
        return None;
    }
    let (key, tracks) = map.iter().find(|(k, _)| lang_matches(k, lang))?;
    let t = tracks
        .iter()
        .find(|t| t.ext == "vtt")
        .or_else(|| tracks.iter().find(|t| t.ext == "srt"))
        .or_else(|| tracks.first())?;
    Some(SubTrack {
        lang: key.clone(),
        label: t.name.clone().unwrap_or_else(|| format!("{key} (auto)")),
        url: t.url.clone(),
        ext: t.ext.clone(),
    })
}

fn parse_ytdlp_output(v: YtdlpOutput, subtitle_lang: Option<&str>) -> Result<StreamInfo, String> {
    let title = v.title.unwrap_or_else(|| "Untitled".to_string());
    let is_live = v.is_live.unwrap_or(false);

    eprintln!("[extract] subtitle_lang={:?} video_language={:?}", subtitle_lang, v.language.as_deref());

    // Human-authored subtitles. Skip the bulk of automatic_captions — YouTube
    // returns hundreds of machine-translated langs. When the extension forwards
    // the user's active caption lang, pull that single auto track below.
    // Fallback: if no lang from extension, use the video's native language field
    // so videos with only auto-captions still surface one track.
    let mut subs = collect_subs(&v.subtitles);
    let auto_lang = subtitle_lang.or_else(|| v.language.as_deref());
    if let Some(lang) = auto_lang {
        if let Some(auto) = find_auto_track(&v.automatic_captions, lang, &subs) {
            subs.push(auto);
        }
    }

    // No formats array — direct URL (e.g. plain video file or single-format site)
    if v.formats.is_none() {
        let video_url = v.url.ok_or("No URL in yt-dlp output")?;
        return Ok(StreamInfo {
            title,
            duration: v.duration,
            is_live,
            video_url,
            audio_url: None,
            subtitles: subs,
            http_headers: v.http_headers.unwrap_or_default(),
            thumbnail: v.thumbnail,
        });
    }

    let formats = v.formats.as_ref().unwrap();
    let idx = pick_best_muxed(formats).ok_or("No suitable muxed format found")?;
    let best = &formats[idx];

    let video_url = best.url.clone().ok_or("Format has no URL")?;
    let http_headers = best
        .http_headers
        .clone()
        .or_else(|| v.http_headers.clone())
        .unwrap_or_default();

    Ok(StreamInfo {
        title,
        duration: v.duration,
        is_live,
        video_url,
        audio_url: None,
        subtitles: subs,
        http_headers,
        thumbnail: v.thumbnail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytdlp_types::{FlatPlaylistEntry, FlatPlaylistOutput, YtdlpFormat, YtdlpOutput};
    use serde_json::{from_value, json};

    fn flat_entry(id: Option<&str>, title: Option<&str>, url: Option<&str>, webpage_url: Option<&str>) -> FlatPlaylistEntry {
        FlatPlaylistEntry {
            id: id.map(str::to_string),
            title: title.map(str::to_string),
            url: url.map(str::to_string),
            webpage_url: webpage_url.map(str::to_string),
        }
    }

    #[test]
    fn parse_flat_entries_mapped() {
        let flat = FlatPlaylistOutput {
            id: Some("PL1".into()),
            title: Some("My List".into()),
            entries: Some(vec![
                flat_entry(Some("abc"), Some("Video A"), None, Some("https://youtube.com/watch?v=abc")),
                flat_entry(Some("def"), Some("Video B"), Some("https://youtube.com/watch?v=def"), None),
            ]),
        };
        let info = parse_flat_playlist(flat);
        assert_eq!(info.id.as_deref(), Some("PL1"));
        assert_eq!(info.title.as_deref(), Some("My List"));
        assert_eq!(info.entries.len(), 2);
        assert_eq!(info.entries[0].id, "abc");
        assert_eq!(info.entries[0].url, "https://youtube.com/watch?v=abc");
        assert_eq!(info.entries[1].url, "https://youtube.com/watch?v=def");
    }

    #[test]
    fn parse_flat_drops_no_id() {
        let flat = FlatPlaylistOutput {
            id: None, title: None,
            entries: Some(vec![
                flat_entry(None, Some("No ID"), None, None),
                flat_entry(Some("ok"), Some("OK"), None, Some("https://youtube.com/watch?v=ok")),
            ]),
        };
        let info = parse_flat_playlist(flat);
        assert_eq!(info.entries.len(), 1);
        assert_eq!(info.entries[0].id, "ok");
    }

    #[test]
    fn parse_flat_null_title_placeholder() {
        let flat = FlatPlaylistOutput {
            id: None, title: None,
            entries: Some(vec![flat_entry(Some("x"), None, None, None)]),
        };
        let info = parse_flat_playlist(flat);
        assert_eq!(info.entries[0].title, "[unavailable]");
    }

    #[test]
    fn parse_flat_url_fallback_chain() {
        let flat = FlatPlaylistOutput {
            id: None, title: None,
            entries: Some(vec![flat_entry(Some("id1"), None, None, None)]),
        };
        let info = parse_flat_playlist(flat);
        assert_eq!(info.entries[0].url, "https://www.youtube.com/watch?v=id1");
    }

    #[test]
    fn parse_flat_none_entries_empty() {
        let flat = FlatPlaylistOutput { id: None, title: None, entries: None };
        let info = parse_flat_playlist(flat);
        assert!(info.entries.is_empty());
    }

    #[test]
    fn parse_flat_capped_at_300() {
        let entries: Vec<FlatPlaylistEntry> = (0..350)
            .map(|i| flat_entry(Some(&format!("id{i}")), None, None, None))
            .collect();
        let flat = FlatPlaylistOutput { id: None, title: None, entries: Some(entries) };
        let info = parse_flat_playlist(flat);
        assert_eq!(info.entries.len(), 300);
    }

    fn fmt(v: serde_json::Value) -> YtdlpFormat {
        from_value(v).unwrap()
    }

    fn output(v: serde_json::Value) -> YtdlpOutput {
        from_value(v).unwrap()
    }

    #[test]
    fn pick_best_muxed_picks_highest_under_720() {
        let formats = vec![
            fmt(json!({"url":"u360","vcodec":"h264","acodec":"aac","height":360})),
            fmt(json!({"url":"u720","vcodec":"h264","acodec":"aac","height":720})),
            fmt(json!({"url":"u1080","vcodec":"h264","acodec":"aac","height":1080})),
        ];
        assert_eq!(pick_best_muxed(&formats), Some(1));
    }

    #[test]
    fn pick_best_muxed_skips_no_url() {
        let formats = vec![
            fmt(json!({"url":null,"vcodec":"h264","acodec":"aac","height":720})),
            fmt(json!({"url":"u360","vcodec":"h264","acodec":"aac","height":360})),
        ];
        assert_eq!(pick_best_muxed(&formats), Some(1));
    }

    #[test]
    fn pick_best_muxed_skips_video_only_and_audio_only() {
        let formats = vec![
            fmt(json!({"url":"vonly","vcodec":"h264","acodec":"none","height":720})),
            fmt(json!({"url":"aonly","vcodec":"none","acodec":"aac"})),
        ];
        assert_eq!(pick_best_muxed(&formats), None);
    }

    #[test]
    fn pick_best_muxed_fallback_above_720() {
        let formats = vec![
            fmt(json!({"url":"u1080","vcodec":"h264","acodec":"aac","height":1080})),
            fmt(json!({"url":"u1440","vcodec":"h264","acodec":"aac","height":1440})),
        ];
        let idx = pick_best_muxed(&formats);
        assert!(idx.is_some());
    }

    #[test]
    fn pick_best_muxed_none_when_no_muxed() {
        let formats = vec![
            fmt(json!({"url":"vonly","vcodec":"h264","acodec":"none","height":720})),
        ];
        assert_eq!(pick_best_muxed(&formats), None);
    }

    #[test]
    fn lang_matches_cases() {
        assert!(lang_matches("en", "en"));
        assert!(lang_matches("en", "en-US"));
        assert!(lang_matches("en-US", "en"));
        assert!(!lang_matches("en", "fr"));
        assert!(!lang_matches("en-US", "en-GB"));
    }

    #[test]
    fn collect_subs_none_is_empty() {
        assert!(collect_subs(&None).is_empty());
    }

    #[test]
    fn collect_subs_prefers_vtt() {
        let mut map = HashMap::new();
        map.insert(
            "en".to_string(),
            vec![
                from_value::<YtdlpSubtitle>(json!({"url":"srt","ext":"srt"})).unwrap(),
                from_value::<YtdlpSubtitle>(json!({"url":"vtt","ext":"vtt"})).unwrap(),
            ],
        );
        let out = collect_subs(&Some(map));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].ext, "vtt");
        assert_eq!(out[0].url, "vtt");
    }

    #[test]
    fn collect_subs_srt_label_fallback_and_name() {
        let mut map = HashMap::new();
        map.insert(
            "en".to_string(),
            vec![from_value::<YtdlpSubtitle>(json!({"url":"srt","ext":"srt"})).unwrap()],
        );
        let out = collect_subs(&Some(map));
        assert_eq!(out[0].ext, "srt");
        assert_eq!(out[0].label, "en");

        let mut map2 = HashMap::new();
        map2.insert(
            "en".to_string(),
            vec![
                from_value::<YtdlpSubtitle>(json!({"url":"srt","ext":"srt","name":"English"}))
                    .unwrap(),
            ],
        );
        let out2 = collect_subs(&Some(map2));
        assert_eq!(out2[0].label, "English");
    }

    #[test]
    fn find_auto_track_skipped_when_existing_covers() {
        let mut auto = HashMap::new();
        auto.insert(
            "en".to_string(),
            vec![from_value::<YtdlpSubtitle>(json!({"url":"a","ext":"vtt"})).unwrap()],
        );
        let existing = vec![SubTrack {
            lang: "en".to_string(),
            label: "English".to_string(),
            url: "x".to_string(),
            ext: "vtt".to_string(),
        }];
        assert!(find_auto_track(&Some(auto), "en", &existing).is_none());
    }

    #[test]
    fn find_auto_track_matches_with_auto_label() {
        let mut auto = HashMap::new();
        auto.insert(
            "en".to_string(),
            vec![from_value::<YtdlpSubtitle>(json!({"url":"a","ext":"vtt"})).unwrap()],
        );
        let track = find_auto_track(&Some(auto), "en", &[]).unwrap();
        assert_eq!(track.lang, "en");
        assert_eq!(track.label, "en (auto)");
    }

    #[test]
    fn find_auto_track_no_match() {
        let mut auto = HashMap::new();
        auto.insert(
            "fr".to_string(),
            vec![from_value::<YtdlpSubtitle>(json!({"url":"a","ext":"vtt"})).unwrap()],
        );
        assert!(find_auto_track(&Some(auto), "en", &[]).is_none());
    }

    #[test]
    fn parse_no_formats_uses_url_and_default_title() {
        let v = output(json!({"url":"direct.mp4"}));
        let info = parse_ytdlp_output(v, None).unwrap();
        assert_eq!(info.video_url, "direct.mp4");
        assert_eq!(info.title, "Untitled");
    }

    #[test]
    fn parse_no_formats_no_url_errs() {
        let v = output(json!({"title":"t"}));
        let err = parse_ytdlp_output(v, None).unwrap_err();
        assert_eq!(err, "No URL in yt-dlp output");
    }

    #[test]
    fn parse_formats_picks_muxed() {
        let v = output(json!({
            "formats":[{"url":"u480","vcodec":"h264","acodec":"aac","height":480}]
        }));
        let info = parse_ytdlp_output(v, None).unwrap();
        assert_eq!(info.video_url, "u480");
    }

    #[test]
    fn parse_formats_none_muxed_errs() {
        let v = output(json!({
            "formats":[{"url":"vonly","vcodec":"h264","acodec":"none","height":480}]
        }));
        let err = parse_ytdlp_output(v, None).unwrap_err();
        assert_eq!(err, "No suitable muxed format found");
    }

    #[test]
    fn parse_adds_requested_auto_caption() {
        let v = output(json!({
            "url":"direct.mp4",
            "automatic_captions":{"en":[{"url":"auto.vtt","ext":"vtt"}]}
        }));
        let info = parse_ytdlp_output(v, Some("en")).unwrap();
        assert!(info.subtitles.iter().any(|s| s.lang == "en"));
    }

    #[test]
    fn parse_language_fallback_adds_auto_caption_when_no_subtitle_lang() {
        let v = output(json!({
            "url":"direct.mp4",
            "language":"en",
            "automatic_captions":{"en":[{"url":"auto.vtt","ext":"vtt"}]}
        }));
        let info = parse_ytdlp_output(v, None).unwrap();
        assert!(info.subtitles.iter().any(|s| s.lang == "en"));
    }

    #[test]
    fn parse_language_fallback_skipped_when_authored_exists() {
        let mut subs = std::collections::HashMap::new();
        subs.insert("en".to_string(), vec![from_value::<YtdlpSubtitle>(json!({"url":"authored.vtt","ext":"vtt"})).unwrap()]);
        let mut auto = std::collections::HashMap::new();
        auto.insert("en".to_string(), vec![from_value::<YtdlpSubtitle>(json!({"url":"auto.vtt","ext":"vtt"})).unwrap()]);
        let v = YtdlpOutput {
            title: None, duration: None, is_live: None, url: Some("direct.mp4".into()),
            formats: None, subtitles: Some(subs), automatic_captions: Some(auto),
            http_headers: None, thumbnail: None, language: Some("en".into()),
        };
        let info = parse_ytdlp_output(v, None).unwrap();
        assert_eq!(info.subtitles.len(), 1);
        assert_eq!(info.subtitles[0].url, "authored.vtt");
    }
}
