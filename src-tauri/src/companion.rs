use axum::{
    body::Bytes,
    extract::DefaultBodyLimit,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 47821;

pub struct CompanionState(pub Arc<Mutex<HashSet<String>>>);

#[derive(Deserialize)]
struct OpenPayload {
    url: String,
    start_time: Option<f64>,
    subtitle_lang: Option<String>,
}

#[derive(Serialize, Clone)]
struct CompanionEvent {
    url: String,
    #[serde(rename = "startTime")]
    start_time: Option<f64>,
    #[serde(rename = "subtitleLang")]
    subtitle_lang: Option<String>,
}

pub fn origin_allowed(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

pub fn scheme_ok(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

#[tauri::command]
pub fn register_companion_token(
    state: tauri::State<'_, CompanionState>,
    token: String,
) {
    if !token.is_empty() {
        state.0.lock().unwrap().insert(token);
    }
}

pub fn spawn(app: AppHandle) {
    let tokens = {
        let state = app.state::<CompanionState>();
        Arc::clone(&state.0)
    };

    tauri::async_runtime::spawn(async move {
        let tokens_for_open = Arc::clone(&tokens);
        let app_for_open = app.clone();

        let router = Router::new()
            .route(
                "/open",
                post(move |headers: HeaderMap, body: Bytes| {
                    handle_open(
                        headers,
                        body,
                        app_for_open.clone(),
                        Arc::clone(&tokens_for_open),
                    )
                })
                .options(handle_options),
            )
            .layer(DefaultBodyLimit::max(4096));

        let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("FloatPiP companion: failed to bind port {PORT}: {e}");
                return;
            }
        };

        axum::serve(listener, router).await.ok();
    });
}

async fn handle_options(headers: HeaderMap) -> Response {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !origin_allowed(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut map = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(origin) {
        map.insert("access-control-allow-origin", v);
    }
    map.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("POST, OPTIONS"),
    );
    map.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("content-type, x-floatpip-token"),
    );
    map.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );

    (StatusCode::NO_CONTENT, map).into_response()
}

async fn handle_open(
    headers: HeaderMap,
    body: Bytes,
    app: AppHandle,
    tokens: Arc<Mutex<HashSet<String>>>,
) -> Response {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !origin.is_empty() && !origin_allowed(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let token = headers
        .get("x-floatpip-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if token.is_empty() || !tokens.lock().unwrap().contains(token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let is_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if !is_visible {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    let payload: OpenPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    if !scheme_ok(&payload.url) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let event = CompanionEvent {
        url: payload.url,
        start_time: payload.start_time,
        subtitle_lang: payload.subtitle_lang,
    };

    app.emit("companion-open", event).ok();

    let mut map = HeaderMap::new();
    if !origin.is_empty() {
        if let Ok(v) = HeaderValue::from_str(origin) {
            map.insert("access-control-allow-origin", v);
        }
    }

    (StatusCode::OK, map).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_allowed_extension() {
        assert!(origin_allowed("chrome-extension://abcdefgh"));
        assert!(origin_allowed("moz-extension://xyz123"));
    }

    #[test]
    fn origin_allowed_rejects_web() {
        assert!(!origin_allowed("https://evil.com"));
        assert!(!origin_allowed("http://localhost:8080"));
        assert!(!origin_allowed(""));
    }

    #[test]
    fn scheme_ok_http_https() {
        assert!(scheme_ok("https://www.youtube.com/watch?v=abc"));
        assert!(scheme_ok("http://example.com/path"));
        assert!(scheme_ok("HTTPS://UPPERCASE.COM"));
    }

    #[test]
    fn scheme_ok_rejects_other() {
        assert!(!scheme_ok("file:///etc/passwd"));
        assert!(!scheme_ok("javascript:alert(1)"));
        assert!(!scheme_ok("ftp://ftp.example.com"));
        assert!(!scheme_ok(""));
    }
}
