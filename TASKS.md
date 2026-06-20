# FloatPiP — Tasks

## Phase: UI / Chrome

- [x] Remove persistent title bar; video fills window
- [x] Auto-hide chrome overlay (fades ~2.6s after cursor idle, cursor hidden when faded)
- [x] Top-right window controls (settings + close) overlaid on video
- [x] Top-left globe button → morphs to rounded URL input
- [x] Minimal floating bottom controls (play, seek, time, volume) — Google-PiP style
- [x] Whole-app drag region (`data-tauri-drag-region` on `.app` — Tauri v2 auto-excludes buttons/inputs; avoids z-index conflict with chrome overlay)
- [x] YouTube-style chrome: white transparent icon buttons, gradient top/bottom scrims for legibility, fast custom dark tooltips (replaced native `title`)
- [x] Volume Booster — new icon button in TopBar; pop-over panel with aurora bg, dial readout, mode group (Generic/Voice/Bass), nonlinear slider, auto-level toggle; Web Audio API GainNode + BiquadFilter engine in `lib/audioBoost.ts`; state persisted in global store; `crossOrigin="anonymous"` on video for Web Audio access
- [x] Aspect-ratio window lock — JS reports video aspect on `loadedmetadata` → `set_video_aspect` IPC. Windows: native WM_SIZING subclass (`win_aspect.rs`) constrains drag RECT before paint (flicker-free, locked every frame); command also fits current width once on load. JS-side `setSize` correction loop removed (reacted post-paint → flicker)
- [x] Non-blocking video-loading indicator — extracting keeps full blocking overlay; video-loading uses `.loading-overlay--passive` (corner spinner, `pointer-events: none`) so controls/buttons stay interactive while buffering
- [x] Now-playing notice — YouTube-style top-right card showing video title after extract; `showNotice`/`Notice` in `Toast.tsx`, auto-hides after 5s, manual close button (CloseIcon)
- [x] CC button — left of volume slider in Controls; shows when ≥1 non-live_chat subtitle track; `MdRoundClosed_caption` when on, `MdOutlineClosed_caption_off` when off; toggle picks: last selected → English → first available; resets per stream load

## Phase: Browser Extension

- [x] Manifest v3 — add popup, scripting, storage, host_permissions
- [x] Popup — list of video tabs with current tab pinned to top
- [x] Popup — native PiP: click tab → browser built-in picture-in-picture via scripting.executeScript
- [x] Popup — companion PiP toggle with help tooltip explaining the feature
- [x] Popup — companion PiP: click tab → floatpip://open?url deep link to desktop app
- [x] Popup — glassy UI restyle (translucent surfaces, gradient bg, accent glow) + ellipsis on title/label overflow
- [x] Popup — companion PiP: detect active YouTube caption track; pass subtitleLang in deep link; desktop app auto-selects matching track on load
- [x] Deep link — if re-sent URL matches already-loaded playable video, skip re-extraction; seek to sent timestamp + resume (`handleUrlSubmit` early-return in `App.tsx`)

## Phase: Companion PiP Auto-Resend

- [x] Desktop Rust listener (`src-tauri/src/companion.rs`) — axum on 127.0.0.1:47821; token auth; CORS gated to extension origins; `companion-open` event emit; `origin_allowed`/`scheme_ok` unit tests
- [x] `lib.rs` — `mod companion`, `CompanionState` managed, `companion::spawn` in setup, `register_companion_token` in invoke_handler
- [x] `src/lib/ipc.ts` — `registerCompanionToken`, `onCompanionOpen` exports; `onDeepLink` extracts `ct` param and registers token
- [x] `src/App.tsx` — `onCompanionOpen` wired in onMount; http/https scheme guard in `handleUrlSubmit`
- [x] `extension/manifest.json` — `webNavigation` permission added; version bumped to 0.3.0
- [x] `extension/background.js` — token helpers, mirrored-tab session state, `videoIdOf`, `sendToApp` (warm POST + cold deep-link fallback), webNavigation listener with pause+retry, tabs.onRemoved cleanup
- [x] `extension/popup.js` — `videoIdOf` local copy, `openCompanionPip` appends `&ct=<token>`, records tab in `chrome.storage.session`

## Phase: Fixes

- [x] Proxy: skip page-context headers (`Sec-Fetch-*`, `Accept: text/html`) yt-dlp dumps — googlevideo throttled muxed stream 6x (1.2s→7.8s) when forwarded
- [x] VideoPlayer: surface `MediaError` + non-gesture `play()` rejections via toast (was console-only → silent failures)
- [x] Media delivery: replace localhost Axum proxy with `stream://` custom URI scheme — WebView2 held loopback HTTP `<video>` requests `Pending` forever, never reached the 127.0.0.1 listener (handler never logged). Custom scheme routes WebView→Rust directly.
- [x] Subtitles: YouTube auto-generated captions not showing via extension flow — they live in yt-dlp `automatic_captions` (excluded to avoid hundreds of machine-translated langs), so the deep-link `subtitleLang` matched no track. Thread `subtitleLang` into `extract_stream`; resolve that single auto track server-side and append to track list.
- [x] Proxy: load time scaled with video length — open-ended `Range: bytes=0-` from WebView made the buffered URI-scheme handler download the whole file before first frame. `bounded_range` caps every fetch to 1 MiB (rewrites missing/open-ended ranges, passes bounded/multi-range through); upstream 206 lets WebView drive its own ranges → constant-time first-frame. Unit tests in proxy.rs. True streaming rejected (would need forking wry + per-platform IStream COM).
- [x] Subtitles: auto-generated-only videos (no authored tracks) showed empty subtitle list — `player.getOption('captions','track')` returns no `languageCode` for ASR tracks so extension sent null lang. Fixed with: (1) backend fallback to yt-dlp `language` field when no lang from extension, so auto track always surfaces; (2) frontend auto-selects single-track result; (3) hardened `frameGetYouTubeSubtitleLang` with tracklist + `ytInitialPlayerResponse` fallbacks; (4) context-menu path now detects + forwards lang; (5) URL match broadened to `youtu.be`/`/shorts`.

## Phase: Tests

- [x] Frontend test infra — vitest + jsdom; `npm test` / `npm run test:watch`; config in `vite.config.ts`
- [x] `lib/subtitles.ts` — parseSrt/parseVtt/getActiveCues unit tests (tags, multiline, end-exclusive, offset)
- [x] `lib/ipc.ts` — startWindowDrag drag-exclusion + onDeepLink URL parse (malformed/missing/region-lang), Tauri modules mocked
- [x] Rust `commands/ytdlp.rs` — pick_best_muxed, collect_subs, lang_matches, find_auto_track, parse_ytdlp_output (`cargo test --lib`)
- [x] Rust `proxy.rs` — get_proxy_url query encode/roundtrip

## Phase: Playlist

- [x] ytdlp_types.rs: PlaylistEntry/PlaylistInfo/FlatPlaylist* structs
- [x] ytdlp.rs: extract_playlist command + parse_flat_playlist (take 300) + unit tests
- [x] lib.rs: register extract_playlist in generate_handler!
- [x] store.ts: PlaylistEntry interface + 5 state fields (playlist, playlistId, playlistTitle, playlistIndex, showPlaylist) + init
- [x] ipc.ts: extractPlaylist wrapper + PlaylistInfo type
- [x] lib/url.ts: getListId/getVideoId/buildWatchUrl + url.test.ts vitest suite
- [x] Icons.tsx: PrevIcon, NextIcon, PlaylistIcon
- [x] VideoPlayer.tsx: onEnded prop
- [x] Controls.tsx: prev/next buttons (Show-gated, disabled at ends)
- [x] TopBar.tsx: playlist toggle button (gated on playlist.length>0 && !tooSmall); mutual exclusion with settings/volume-booster; tooSmall clears showPlaylist
- [x] PlaylistPanel.tsx: new component (title+count header, scrollable row list, active highlight, 300-cap footer note)
- [x] App.tsx: resolveToken race guard, videoId early-return, deferred resolve (requestIdleCallback/setTimeout after playing), playEntry, capped auto-skip (max 5), PlaylistPanel wiring
- [x] styles/main.css: playlist panel + nav-btn styling

## Blockers (debug)

- Strip throwaway `eprintln!` trace logging from `commands/ytdlp.rs` once stream playback confirmed on device
- Remove now-unused `axum` + `futures-util` deps from `Cargo.toml` (proxy rewritten off them)

## Blockers

- None

## File Count

- `src/components/`: TopBar, VideoPlayer, Controls, SubtitleOverlay, SettingsPanel, VolumeBoosterPanel, Toast, Icons, PlaylistPanel (9)
- `src/lib/`: store, ipc, subtitles, audioBoost, url (5)
- `extension/`: manifest.json, background.js, popup.html, popup.css, popup.js (5)
- `src/lib/` tests: subtitles.test.ts, ipc.test.ts, url.test.ts (3)
- Rust tests: in-file `#[cfg(test)]` mods in ytdlp.rs, proxy.rs (2)
