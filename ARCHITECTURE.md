# FloatPiP Architecture

Frameless always-on-top Picture-in-Picture video player. Built with Tauri v2 (Rust backend) + SolidJS frontend.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | SolidJS + Vite + TypeScript |
| Backend | Rust (tokio async) |
| Media extraction | yt-dlp sidecar binary |
| Media proxy | Tauri custom URI scheme (`stream://`) — header-injecting fetch |
| Persistence | tauri-plugin-store |
| Window effects | window-vibrancy (Acrylic on Windows, HudWindow on macOS) |

---

## Directory Structure

```
floatandplay/
├── src/                        # SolidJS frontend
│   ├── App.tsx                 # Root component, main orchestrator
│   ├── index.tsx               # SolidJS mount point
│   ├── components/
│   │   ├── TopBar.tsx          # Overlay: globe→URL input launcher + window controls
│   │   ├── VideoPlayer.tsx     # <video> element wrapper
│   │   ├── Controls.tsx        # Floating overlay: play/pause, seek bar, volume, prev/next
│   │   ├── SubtitleOverlay.tsx # Renders active subtitle cues
│   │   ├── SettingsPanel.tsx   # Window + subtitle settings
│   │   └── PlaylistPanel.tsx   # Collapsible playlist entry list with active highlight
│   ├── lib/
│   │   ├── store.ts            # Global SolidJS store (AppState)
│   │   ├── ipc.ts              # Tauri invoke/listen wrappers
│   │   ├── subtitles.ts        # SRT/VTT parser + cue matching
│   │   └── url.ts              # Pure URL helpers: getListId, getVideoId, buildWatchUrl
│   └── styles/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Binary entry point
│   │   ├── lib.rs              # App setup: vibrancy, proxy, hotkey, invoke handler
│   │   ├── proxy.rs            # stream:// custom URI scheme media handler
│   │   ├── win_aspect.rs       # Windows WM_SIZING subclass — locks resize to video aspect
│   │   ├── ytdlp_types.rs      # Serde types for yt-dlp JSON output (stream + playlist)
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── window.rs       # set/get click-through, set always-on-top
│   │       ├── ytdlp.rs        # extract_stream + extract_playlist commands
│   │       └── subtitles.rs    # load_subtitle_file command
│   ├── binaries/               # yt-dlp platform sidecar binaries
│   ├── capabilities/           # Tauri capability definitions
│   └── tauri.conf.json         # Window config (480x270, transparent, no decorations)
├── extension/                  # Chrome/Chromium extension
│   ├── manifest.json           # MV3 manifest (permissions, service worker)
│   ├── popup.html              # Extension popup UI
│   ├── popup.js                # Popup logic (tab scanning, PiP activation)
│   ├── popup.css               # Popup styling (glass-morphism UI)
│   └── background.js           # Service worker (context menu integration)
└── vite.config.ts
```

---

## Data Flow

### Stream Loading

```
User pastes URL
  → TopBar.onUrlSubmit
  → App.handleUrlSubmit
  → IPC: extract_stream(url)           # Rust: spawn yt-dlp sidecar with -J flag
  → yt-dlp outputs JSON
  → parse YtdlpOutput → StreamInfo     # pick best muxed format ≤720p
  → IPC: get_proxy_url(video_url, headers)
  → builds stream:// URL encoding upstream URL+headers as query params
  → VideoPlayer.src = stream:// URL
  → WebView routes to register_asynchronous_uri_scheme_protocol("stream") handler
  → Rust fetches upstream CDN (with injected headers) → returns body to WebView
  → video plays
```

### Subtitle Loading

```
Option A — embedded (from yt-dlp):
  # Only yt-dlp `subtitles` (authored tracks). `automatic_captions`
  # excluded — YouTube returns hundreds of machine-translated langs.
  SettingsPanel track select
  → App.handleSubTrackSelect(idx)
  → fetch(track.url) → parse SRT/VTT → SubCue[]
  → store.subtitleCues

Option B — local file:
  App.handleLoadExternalSub
  → IPC: load_subtitle_file           # native file dialog (srt/vtt/ass)
  → Rust reads file → raw string
  → parse SRT or VTT → SubCue[]
  → store.subtitleCues

Playback sync:
  VideoPlayer.onTimeUpdate(currentTimeMs)
  → getActiveCues(cues, time + offsetMs)
  → store.currentCues
  → SubtitleOverlay renders
```

### Click-Through Toggle

```
Ctrl+Alt+C (global hotkey, works even when window is pass-through)
  → Rust global_shortcut handler
  → window.set_ignore_cursor_events(!current)
  → emit "click-through-changed" event
  → frontend: setState("clickThrough", on)
  → App: opacity drops to 0.65, Controls hidden
```

---

## Key Components

### proxy.rs — Custom URI Scheme Media Handler

**Why it exists:** The `<video>` element cannot set custom HTTP headers (Referer, User-Agent, Cookie) required by many streaming platforms.

**Why a custom scheme, not a localhost HTTP proxy:** WebView2 silently holds loopback HTTP subresource requests — a `<video src=http://127.0.0.1:PORT/...>` request shows as `Pending` in devtools and **never reaches** an in-process listener (PNA / loopback gating). A custom URI scheme is routed by the WebView directly to the Rust handler, bypassing the network stack entirely. Cross-platform; same mechanism Tauri's `asset://` uses to play local video.

**How it works:**
- `register_asynchronous_uri_scheme_protocol("stream", …)` on the Tauri builder (lib.rs)
- `get_proxy_url` builds `stream://localhost/?url=<enc>&headers=<json>` (Windows: `http://stream.localhost/?…`)
- Handler parses query, fetches upstream with reqwest (shared client, 5-redirect limit)
- **Chunk-caps every fetch to 1 MiB** (`CHUNK_SIZE`) via `bounded_range`: the WebView's initial media request is open-ended (`Range: bytes=0-`), and the URI-scheme response is buffered whole — forwarding it verbatim downloads the *entire file* before first frame, so load time scaled with video length. `bounded_range` rewrites a missing or open-ended `bytes=START-` to `bytes=START-(START+1MiB-1)`; already-bounded (`bytes=START-END`) and multi-range values pass through untouched. Upstream returns `206` + `Content-Range`, so the WebView learns total size and drives subsequent bounded ranges as it plays/seeks. First-frame is now constant-time. (If upstream ignores Range and returns `200`, the full body buffers as before — graceful fallback, no regression.)
- Injects yt-dlp's `http_headers`; **skips** page-context headers (`Sec-Fetch-*`, `Accept`, `Accept-Encoding`, `Connection`, `Host`, `Range`) that throttle googlevideo
- Passes through: `content-type`, `content-length`, `content-range`, `accept-ranges`, `cache-control`, `last-modified`, `etag`; adds `Access-Control-Allow-Origin: *`
- Body is buffered per-request (URI scheme response is not a stream); the 1 MiB Range cap keeps each buffer bounded. **Why not true streaming:** the buffered-body type (`Cow<'static,[u8]>`) is baked through tauri → tauri-runtime-wry → wry plus a per-platform webview glue (Windows uses an in-memory `SHCreateMemStream` IStream). Progressive streaming would require forking all three crates and writing a blocking IStream COM object per platform — large and fragile across `cargo update`. Range-capping delivers identical constant-time UX without the fork.

### commands/ytdlp.rs — Stream Extraction

Runs `yt-dlp -J --no-playlist` as a sidecar process. Format selection priority:
1. Best muxed format (video+audio in one stream) at ≤720p
2. Fallback: any muxed format ignoring height cap
3. No formats array → direct URL (plain video file or single-format site)

Does **not** support DASH (separate video+audio streams). The `<video>` element handles decoding directly without MSE.

### lib/store.ts — Global State

Single `createStore<AppState>()` shared across all components. Key fields:

| Field | Purpose |
|-------|---------|
| `proxyVideoUrl` | Proxy-wrapped URL fed to `<video>` |
| `subtitleCues` | All parsed cues for active track |
| `currentCues` | Active cues at current playback time |
| `subtitleOffset` | User-adjustable timing offset in ms |
| `clickThrough` | Window cursor passthrough state |
| `opacity` | Window opacity (0.2–1.0) |

### lib/subtitles.ts

Pure TypeScript SRT/VTT parser. Strips HTML tags from cue text. `getActiveCues` does linear scan filtered by `startMs ≤ (time + offset) < endMs`.

---

## Window Configuration

- Size: 480×270 (16:9), min 240×135
- Transparent background, no OS decorations
- Always on top (default)
- Vibrancy: Acrylic (Windows), HudWindow (macOS)
- No title bar — all chrome (top buttons, URL launcher, controls) overlays the video in a `.chrome` layer that fades on cursor idle
- Drag region: `.drag-layer` covers the whole video (via `data-tauri-drag-region`); buttons/controls sit above it and capture their own clicks
- Aspect lock (Windows): when a video is loaded the window resize is locked to the video's aspect ratio. `VideoPlayer` reports `videoWidth/videoHeight` on `loadedmetadata` → `set_video_aspect` IPC. `win_aspect.rs` installs a `SetWindowSubclass` proc that intercepts `WM_SIZING` and rewrites the proposed drag RECT *before* the OS paints — flicker-free and locked every frame. **Why native, not JS:** a JS `resize` handler can only correct after the OS already painted the dragged size, so it lands a frame late and snaps (visible flicker/fighting). The command also fits the current width to the new ratio once on load. Non-Windows: no lock (no-op).

---

## IPC Commands (Rust → Frontend)

| Command | Direction | Description |
|---------|-----------|-------------|
| `extract_stream` | invoke | Run yt-dlp, return StreamInfo |
| `extract_playlist` | invoke | Run yt-dlp --flat-playlist, return PlaylistInfo (capped 300) |
| `get_proxy_url` | invoke | Build proxy URL with encoded headers |
| `set_click_through` | invoke | Toggle cursor passthrough + emit event |
| `get_click_through` | invoke | Read current passthrough state |
| `set_always_on_top` | invoke | Set window z-order |
| `set_video_aspect` | invoke | Lock resize aspect to video (Windows WM_SIZING) + fit width once |
| `load_subtitle_file` | invoke | Open file dialog, read subtitle file |
| `click-through-changed` | event (Rust→JS) | Fired by hotkey or command |

## Playlist Flow

```
URL with list= param loaded
  → handleUrlSubmit captures listId + resolveToken
  → video extract + proxy proceed normally (playlist never blocks playback)
  → on first idle/playing: if listId === state.playlistId → recompute index only
                           else → extract_playlist(url) → FlatPlaylistOutput
                                   → parse_flat_playlist → PlaylistInfo (≤300 entries)
                                   → setState playlist/playlistId/playlistTitle/playlistIndex
  → TopBar: playlist button appears (playlist.length > 0)
  → Controls: prev/next buttons appear (hasPlaylist)
  → VideoPlayer onEnded → playEntry(playlistIndex+1, auto=true)
  → playEntry → handleUrlSubmit(buildWatchUrl(id, listId))
             → same listId → index path, no refetch
  → auto-skip on extract failure, capped at 5 consecutive
  → resolveToken drops stale resolve from prior URL switch
```

---

## Browser Extension (Chrome/Chromium)

Browser companion extension enables PiP from the browser without manually copying URLs. Two modes of operation:

### Architecture

**Manifest (MV3):**
- Service worker: `background.js` — context menu registration and deep link routing
- Popup script: `popup.js` — tab scanning, video detection, UI logic
- Popup UI: `popup.html` + `popup.css` — glass-morphism design

### Features

**Popup Panel** (click extension icon):
- Toggle "Enable companion PiP" — stores preference in `chrome.storage.local`
- Lists current tab at top (marked "current")
- Async scans all other tabs for `<video>` elements (2.5s timeout per tab)
- Renders clickable tab list with favicons, titles
- Click tab → activates native browser PiP (if disabled) OR opens desktop app (if enabled)

**Context Menu Integration** (right-click):
- "Open link in FloatPiP" (link context)
- "Open page in FloatPiP" (page/frame/video/audio contexts)
- Both routes URL via deep link protocol: `floatpip://open?url=<encoded_url>`

### Deep Link Protocol

Registered protocol scheme `floatpip://` is handled by Tauri's custom protocol handler (configured in `tauri.conf.json`). The desktop app launches (or comes to foreground) and parses the URL query:
- `floatpip://open?url=https://example.com/video.mp4`
- Desktop app extracts `url` param → passes to `App.handleUrlSubmit` → stream extraction pipeline

### Video Detection

`frameHasVideo()` runs in content script context, checks for:
- `document.querySelectorAll('video')`
- Only counts if `readyState > 0` (has buffered data)

Scoring heuristic for "best" video: playing status (×1000 bonus) + pixel area (width × height). Handles embedded iframes via `allFrames: true`.

---

## Build & Run

```bash
npm run tauri dev      # dev mode (hot reload)
npm run tauri build    # production bundle
```

yt-dlp binary must be present in `src-tauri/binaries/` with platform suffix (e.g. `yt-dlp-x86_64-pc-windows-msvc.exe`).
