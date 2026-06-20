use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistInfo {
    pub id: Option<String>,
    pub title: Option<String>,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Debug, Deserialize)]
pub struct FlatPlaylistEntry {
    pub id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub webpage_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FlatPlaylistOutput {
    pub id: Option<String>,
    pub title: Option<String>,
    pub entries: Option<Vec<FlatPlaylistEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamInfo {
    pub title: String,
    pub duration: Option<f64>,
    pub is_live: bool,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub subtitles: Vec<SubTrack>,
    pub http_headers: HashMap<String, String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubTrack {
    pub lang: String,
    pub label: String,
    pub url: String,
    pub ext: String,
}

#[derive(Debug, Deserialize)]
pub struct YtdlpFormat {
    pub url: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub protocol: Option<String>,
    pub format_id: Option<String>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub tbr: Option<f64>,
    pub http_headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
pub struct YtdlpSubtitle {
    pub url: String,
    pub ext: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct YtdlpOutput {
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub is_live: Option<bool>,
    pub url: Option<String>,
    pub formats: Option<Vec<YtdlpFormat>>,
    pub subtitles: Option<HashMap<String, Vec<YtdlpSubtitle>>>,
    pub automatic_captions: Option<HashMap<String, Vec<YtdlpSubtitle>>>,
    pub http_headers: Option<HashMap<String, String>>,
    pub thumbnail: Option<String>,
    pub language: Option<String>,
}
