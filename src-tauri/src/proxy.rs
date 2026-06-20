use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tauri::http::{Request, Response};
use url::form_urlencoded;

// TEMP TRACE: per-request sequence so the cold first request is identifiable.
static REQ_SEQ: AtomicU64 = AtomicU64::new(0);

// Media is delivered through a Tauri custom URI scheme (`stream://`), NOT a
// localhost HTTP proxy. WebView2 silently holds loopback HTTP subresource
// requests (they never reach a 127.0.0.1 listener), so an in-process Axum
// server is unreachable from `<video src>`. A custom scheme is routed by the
// WebView straight to this handler — no network stack, no PNA/mixed-content
// gating, cross-platform. The header-injection proxy logic is unchanged.

fn err_response(code: u16, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header("Access-Control-Allow-Origin", "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// Max bytes served per request. The URI-scheme response is buffered whole (not
/// a stream), so an open-ended `Range: bytes=0-` would download the entire file
/// before first frame — load time ∝ video length. We cap each fetch to this and
/// let the WebView drive subsequent bounded ranges as it plays/seeks.
const CHUNK_SIZE: u64 = 1024 * 1024; // 1 MiB

/// Decide the upstream Range header to send. Returns the header value plus
/// whether we imposed the cap (so the caller knows to expect/synthesize a 206).
/// - No incoming Range, or open-ended `bytes=START-` → bound to START+CHUNK_SIZE.
/// - Already-bounded `bytes=START-END` → forward unchanged (seek/explicit range).
fn bounded_range(incoming: Option<&str>) -> String {
    let start = match incoming {
        None => 0,
        Some(v) => parse_open_ended_start(v).unwrap_or(0),
    };
    // If incoming was already a bounded range, keep it verbatim.
    if let Some(v) = incoming {
        if parse_open_ended_start(v).is_none() && !v.trim().is_empty() {
            return v.to_string();
        }
    }
    format!("bytes={}-{}", start, start + CHUNK_SIZE - 1)
}

/// Parse `bytes=START-` (open-ended) → Some(START). Returns None for bounded
/// ranges (`bytes=START-END`), multi-range, or unparseable input.
fn parse_open_ended_start(v: &str) -> Option<u64> {
    let spec = v.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None; // multi-range — leave untouched
    }
    let (start, end) = spec.split_once('-')?;
    if !end.trim().is_empty() {
        return None; // bounded
    }
    start.trim().parse::<u64>().ok()
}

/// Fetch upstream media with yt-dlp headers injected, return it to the WebView.
/// Buffers the (range-bounded) body — Tauri's URI scheme response is not a stream.
pub async fn handle_stream_request(
    client: reqwest::Client,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let query = request.uri().query().unwrap_or("");
    let mut target_url: Option<String> = None;
    let mut headers_json: Option<String> = None;
    for (k, v) in form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "url" => target_url = Some(v.into_owned()),
            "headers" => headers_json = Some(v.into_owned()),
            _ => {}
        }
    }
    let Some(target_url) = target_url else {
        return err_response(400, "missing url param");
    };

    let incoming_range = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok());

    // TEMP TRACE: identify cold first request + time each stage.
    let seq = REQ_SEQ.fetch_add(1, Ordering::Relaxed);
    let t0 = Instant::now();
    eprintln!("[proxy #{seq}] in range={:?}", incoming_range);

    // Retry up to 2 times on transient network errors (connection reset,
    // timeout, CDN drops). Each attempt rebuilds the request from the client.
    let range_header = bounded_range(incoming_range);
    let (status, up_headers, bytes) = {
        let mut last_err = String::new();
        let mut result = None;
        for attempt in 0..3u8 {
            if attempt > 0 {
                eprintln!("[proxy #{seq}] retry attempt={attempt} after err={last_err}");
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            let mut r = client.get(&target_url).header("Range", &range_header);
            if let Some(h_json) = &headers_json {
                if let Ok(headers) = serde_json::from_str::<HashMap<String, String>>(h_json) {
                    for (k, v) in &headers {
                        let lk = k.to_ascii_lowercase();
                        if lk.starts_with("sec-fetch-")
                            || lk == "accept"
                            || lk == "accept-encoding"
                            || lk == "connection"
                            || lk == "host"
                            || lk == "range"
                        {
                            continue;
                        }
                        r = r.header(k, v);
                    }
                }
            }
            let t_send = Instant::now();
            let upstream = match r.send().await {
                Ok(u) => u,
                Err(e) => {
                    eprintln!(
                        "[proxy #{seq}] send ERR attempt={attempt} send_ms={} err={e}",
                        t_send.elapsed().as_millis()
                    );
                    last_err = e.to_string();
                    continue;
                }
            };
            let send_ms = t_send.elapsed().as_millis();
            let s = upstream.status();
            // Don't retry on 4xx — those are permanent (bad URL, expired, forbidden).
            let is_client_err = s.is_client_error();
            let h = upstream.headers().clone();
            let t_body = Instant::now();
            match upstream.bytes().await {
                Ok(b) => {
                    eprintln!(
                        "[proxy #{seq}] ok attempt={attempt} status={} send_ms={send_ms} body_ms={} bytes={}",
                        s.as_u16(),
                        t_body.elapsed().as_millis(),
                        b.len()
                    );
                    result = Some((s, h, b));
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[proxy #{seq}] body ERR attempt={attempt} status={} send_ms={send_ms} body_ms={} err={e}",
                        s.as_u16(),
                        t_body.elapsed().as_millis()
                    );
                    last_err = e.to_string();
                    if is_client_err {
                        break;
                    }
                }
            }
        }
        match result {
            Some(r) => r,
            None => return err_response(502, &last_err),
        }
    };

    eprintln!(
        "[proxy #{seq}] done total_ms={} status={}",
        t0.elapsed().as_millis(),
        status.as_u16()
    );

    let mut builder = Response::builder().status(status.as_u16());
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "last-modified",
        "etag",
    ] {
        if let Some(v) = up_headers.get(name) {
            builder = builder.header(name, v);
        }
    }
    builder = builder.header("Access-Control-Allow-Origin", "*");

    builder
        .body(bytes.to_vec())
        .unwrap_or_else(|_| err_response(500, "response build error"))
}

/// Build the `stream://` URL the `<video>` element loads. Encodes the upstream
/// URL + headers as query params parsed back in `handle_stream_request`.
/// Windows WebView2 maps the scheme to `http://stream.localhost/`.
#[tauri::command]
pub fn get_proxy_url(url: String, headers: Option<HashMap<String, String>>) -> String {
    let mut ser = form_urlencoded::Serializer::new(String::new());
    ser.append_pair("url", &url);
    if let Some(h) = headers {
        if !h.is_empty() {
            ser.append_pair("headers", &serde_json::to_string(&h).unwrap_or_default());
        }
    }
    let query = ser.finish();

    #[cfg(windows)]
    {
        format!("http://stream.localhost/?{query}")
    }
    #[cfg(not(windows))]
    {
        format!("stream://localhost/?{query}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEMP: reproduce the cold-connect cost in-env. Run:
    //   cargo test --lib coldconn -- --ignored --nocapture
    #[ignore]
    #[tokio::test]
    async fn coldconn_default() {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap();
        for host in ["https://rr1---sn-8qj-nbo6.googlevideo.com/", "https://www.youtube.com/", "https://i.ytimg.com/"] {
            let t = std::time::Instant::now();
            let r = client.get(host).send().await;
            eprintln!("default {host} -> {:?} in {}ms", r.as_ref().map(|x| x.status()).map_err(|e| e.to_string()), t.elapsed().as_millis());
        }
    }

    #[ignore]
    #[tokio::test]
    async fn coldconn_real() {
        let raw = std::fs::read_to_string(format!("{}/fp_req.json", std::env::var("TEMP").unwrap())).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let url = v["url"].as_str().unwrap().to_string();
        let hdrs: HashMap<String, String> = serde_json::from_value(v["headers"].clone()).unwrap();
        for label in ["default", "ipv4"] {
            let mut b = reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(5));
            if label == "ipv4" { b = b.local_address("0.0.0.0".parse::<std::net::IpAddr>().unwrap()); }
            let client = b.build().unwrap();
            let mut r = client.get(&url).header("Range", "bytes=0-1048575");
            for (k, val) in &hdrs {
                let lk = k.to_ascii_lowercase();
                if lk.starts_with("sec-fetch-") || lk == "accept" || lk == "accept-encoding" || lk == "connection" || lk == "host" || lk == "range" { continue; }
                r = r.header(k, val);
            }
            let t = std::time::Instant::now();
            let res = r.send().await;
            eprintln!("REAL[{label}] send -> {:?} in {}ms", res.as_ref().map(|x| x.status()).map_err(|e| e.to_string()), t.elapsed().as_millis());
        }
    }

    #[ignore]
    #[tokio::test]
    async fn coldconn_ipv4_only() {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .local_address("0.0.0.0".parse::<std::net::IpAddr>().unwrap())
            .build()
            .unwrap();
        for host in ["https://rr1---sn-8qj-nbo6.googlevideo.com/", "https://www.youtube.com/", "https://i.ytimg.com/"] {
            let t = std::time::Instant::now();
            let r = client.get(host).send().await;
            eprintln!("ipv4 {host} -> {:?} in {}ms", r.as_ref().map(|x| x.status()).map_err(|e| e.to_string()), t.elapsed().as_millis());
        }
    }

    fn query_of(s: &str) -> &str {
        s.split_once('?').map(|(_, q)| q).unwrap_or("")
    }

    #[test]
    fn special_chars_url_roundtrips() {
        let original = "https://cdn.example.com/v.mp4?a=1&b=2";
        let out = get_proxy_url(original.to_string(), None);
        let q = query_of(&out);
        let url_pair = form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "url")
            .map(|(_, v)| v.into_owned());
        assert_eq!(url_pair.as_deref(), Some(original));
    }

    #[test]
    fn headers_none_has_no_headers_param() {
        let out = get_proxy_url("https://x/v.mp4".to_string(), None);
        assert!(!out.contains("headers="));
    }

    #[test]
    fn headers_empty_has_no_headers_param() {
        let out = get_proxy_url("https://x/v.mp4".to_string(), Some(HashMap::new()));
        assert!(!out.contains("headers="));
    }

    #[test]
    fn range_none_caps_from_zero() {
        assert_eq!(bounded_range(None), format!("bytes=0-{}", CHUNK_SIZE - 1));
    }

    #[test]
    fn range_open_ended_zero_caps() {
        assert_eq!(
            bounded_range(Some("bytes=0-")),
            format!("bytes=0-{}", CHUNK_SIZE - 1)
        );
    }

    #[test]
    fn range_open_ended_offset_caps_from_offset() {
        assert_eq!(
            bounded_range(Some("bytes=5000000-")),
            format!("bytes=5000000-{}", 5000000 + CHUNK_SIZE - 1)
        );
    }

    #[test]
    fn range_bounded_passes_through() {
        assert_eq!(bounded_range(Some("bytes=100-200")), "bytes=100-200");
    }

    #[test]
    fn range_multipart_passes_through() {
        assert_eq!(
            bounded_range(Some("bytes=0-100,200-300")),
            "bytes=0-100,200-300"
        );
    }

    #[test]
    fn parse_open_ended_variants() {
        assert_eq!(parse_open_ended_start("bytes=0-"), Some(0));
        assert_eq!(parse_open_ended_start("bytes=42-"), Some(42));
        assert_eq!(parse_open_ended_start("bytes=0-100"), None); // bounded
        assert_eq!(parse_open_ended_start("bytes=0-1,2-3"), None); // multi
        assert_eq!(parse_open_ended_start("garbage"), None);
    }

    #[test]
    fn headers_nonempty_roundtrips() {
        let mut h = HashMap::new();
        h.insert("Referer".to_string(), "https://site/".to_string());
        h.insert("User-Agent".to_string(), "UA/1.0".to_string());
        let out = get_proxy_url("https://x/v.mp4".to_string(), Some(h.clone()));
        assert!(out.contains("headers="));
        let q = query_of(&out);
        let headers_json = form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "headers")
            .map(|(_, v)| v.into_owned())
            .unwrap();
        let parsed: HashMap<String, String> = serde_json::from_str(&headers_json).unwrap();
        assert_eq!(parsed, h);
    }
}
