# FloatPiP

Frameless, transparent, always-on-top desktop Picture-in-Picture video player.
Paste any video URL → plays in a floating window that stays above everything.

Built with **Tauri v2** (Rust) + **SolidJS** + **yt-dlp**.

---

## Features

- Frameless transparent window, always on top
- Paste YouTube / Vimeo / Twitch / any yt-dlp-supported URL
- Acrylic/blur background (Windows 11)
- Click-through mode — watch video while clicking through to apps behind it
- Subtitle support: auto-loaded from stream, or load external `.srt` / `.vtt`
- Subtitle offset slider, font size control
- Local header-injecting proxy — handles sites that check Referer/User-Agent
- Seeking, volume, mute

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | `winget install Rustlang.Rustup` → `rustup default stable` |
| Node | 18+ | [nodejs.org](https://nodejs.org) |
| WebView2 | any | Pre-installed on Windows 11 |

## Setup

```bash
# 1. Install JS deps
npm install

# 2. Drop yt-dlp sidecar into binaries/
#    Name must match the Rust target triple exactly:
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe \
  -o src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe

# 3. Dev mode
npm run tauri dev

# 4. Production build
npm run tauri build
```

## Usage

1. Paste a video URL in the top bar → press **Enter** or **Go**
2. Video extracts and plays at up to 720p muxed quality
3. Use controls at the bottom for play/pause, seek, volume

### Click-through mode

Toggle with **Ctrl+Alt+C** (global hotkey — works even when the window is passthrough).

When click-through is ON:
- All clicks pass through the window to whatever is behind it
- Window dims to 65% opacity as visual indicator
- Use **Ctrl+Alt+C** again to regain control

### Subtitles

- If the stream has subtitles, they appear in **Settings → Subtitles**
- Load an external `.srt` or `.vtt` file via **Settings → Load file…**
- Adjust offset (ms) if subs are out of sync

## Project Structure

```
floatandplay/
├── src/                        # SolidJS frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── TitleBar.tsx        # drag region, URL input, window controls
│   │   ├── VideoPlayer.tsx     # <video> element
│   │   ├── Controls.tsx        # play/seek/volume bar
│   │   ├── SubtitleOverlay.tsx # custom div overlay (not <track>)
│   │   └── SettingsPanel.tsx
│   ├── lib/
│   │   ├── ipc.ts              # Tauri invoke() wrappers
│   │   ├── store.ts            # solid-js/store global state
│   │   └── subtitles.ts        # SRT/VTT parser + cue sync
│   └── styles/main.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs              # Tauri builder, plugins, global shortcut
│   │   ├── proxy.rs            # local axum proxy (header injection + range)
│   │   ├── ytdlp_types.rs      # serde structs for yt-dlp JSON
│   │   └── commands/
│   │       ├── ytdlp.rs        # extract_stream command
│   │       ├── window.rs       # click-through / always-on-top
│   │       └── subtitles.rs    # load external subtitle file
│   ├── binaries/               # yt-dlp sidecar (not committed)
│   ├── tauri.conf.json
│   └── Cargo.toml
└── plan.md                     # architecture decisions
```

## Architecture Notes

**Why a local proxy?**
yt-dlp extracts direct media URLs, but some hosts reject requests without the right
`Referer` or `User-Agent`. The proxy runs on a random localhost port and injects those
headers transparently. It also forwards `Range` headers so seeking works.

**Why 720p cap?**
Best quality on YouTube returns separate video+audio DASH streams, which require MSE
(Media Source Extensions) — significant complexity. Muxed progressive up to 720p works
with a plain `<video src>` tag. Higher quality (MSE path) is a planned future phase.

**Why custom subtitle overlay?**
`<track>` element styling is near-impossible to customize via CSS. Subtitle cues are
parsed to typed objects and rendered as absolutely-positioned `<div>`s over the video.

**Stream URL expiry**
yt-dlp stream URLs expire (YouTube: hours) and are IP-locked. Only the original page URL
is persisted. Stream URLs are re-extracted on every play.

## Roadmap

- [ ] Phase 2: yt-dlp integration ✅ (done)
- [ ] Phase 3: Subtitle system ✅ (done)
- [ ] Phase 4: Tray icon, persist window position/settings, opacity slider
- [ ] Phase 4: MSE path for 1080p+ (separate video+audio DASH streams)
- [ ] Phase 5: Chrome extension + deep-link (`floatpip://open?url=...`)
- [ ] Auto-update yt-dlp binary from GitHub releases

## Troubleshooting

**Video won't play / black screen**
- Check that `src-tauri/binaries/yt-dlp-*.exe` exists and is executable
- Run `yt-dlp -U` to update — YouTube breaks yt-dlp roughly monthly
- Some sites need cookies: add `--cookies-from-browser chrome` to the args in `commands/ytdlp.rs`

**Window clicks fall through unexpectedly**
- Click-through is ON. Press **Ctrl+Alt+C** to toggle it off.

**Subtitles out of sync**
- Use the offset slider in Settings (positive = delay, negative = advance)

**Build fails: `window-vibrancy` version mismatch**
- Try bumping to `window-vibrancy = "0.6"` in `Cargo.toml`
