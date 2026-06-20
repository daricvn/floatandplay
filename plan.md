# Plan: Companion PiP auto-resend (warm localhost channel)

Goal: when a browser tab is already mirrored to the FloatPiP desktop app via
Companion PiP, and the user plays a **different** video in that tab (e.g.
YouTube SPA nav, autoplay-next, clicking a related video), the extension must
automatically (a) send the new video to the running app and (b) pause the
browser video — with no popup re-click and no junk tab spam.

Stakes: **medium-high blast.** Adds a local HTTP listener (new network surface)
+ new browser permission (`webNavigation`) + a browser→app auth handshake.
Security is the dominant concern — see Security Invariants, they are MUST-level.

---

## Decisions already made (do not relitigate)

- **Detection = `chrome.webNavigation.onHistoryStateUpdated`** in the service
  worker. No content script. Matches the existing no-content-script extension
  architecture; catches YouTube `?v=` SPA changes and any History-API SPA nav
  generically. (Confirmed gap: `extension/manifest.json` has no `content_scripts`
  and `extension/background.js` only handles `onInstalled` + `contextMenus`.)
- **Warm channel = localhost HTTP listener (axum) on the desktop app**, NOT
  native messaging. Native messaging spawns a host as a child of Chrome per
  connect — it cannot attach to the already-running single-instance GUI app
  (`src-tauri/src/lib.rs:33`), so it would need a host→app bridge anyway.
  Localhost = extension service-worker `fetch` straight to the running app.
  - **No new Rust dependency**: `axum = "0.7"` and `tokio` (full) are already
    deps (`src-tauri/Cargo.toml:25,27`). Confirmed.
  - The WebView2 loopback-gating warning in `src-tauri/src/proxy.rs:5-10` does
    NOT apply: that gating is WebView2→loopback **subresource** only. An
    extension service-worker `fetch` uses Chrome's normal network stack.
- **Cold start stays on the deep link.** When the app is not running, the warm
  `fetch` fails (connection refused) and the extension falls back to the
  existing `floatpip://open?...` deep link, which launches the app AND delivers
  the first video. The deep link is also the **token bootstrap** channel (below).

---

## Architecture / data flow

```
Tab mirrored (popup "companion" click) ──► extension records mirroredTabs[tabId] = videoId
                                            and sends video (deep link, cold)

User navigates video1 → video2 in that tab
  → chrome.webNavigation.onHistoryStateUpdated(tabId, newUrl)
  → guard: mirroredTabs[tabId] exists AND companionEnabled
           AND videoId(newUrl) !== mirroredTabs[tabId]   (dedup; ignore non-video nav)
  → pause browser video  (scripting.executeScript: frameGetAndPauseVideo, with brief retry)
  → sendToApp({url, startTime?, subtitleLang?})
       warm: POST http://127.0.0.1:47821/open  (token header)  → app emits "companion-open"
       cold/401: fallback floatpip:// deep link (active:false tab, removed after handoff)
  → mirroredTabs[tabId] = videoId(newUrl)

Desktop:
  axum POST /open  → validate (token + origin + scheme)  → app.emit("companion-open", payload)
  frontend onCompanionOpen → handleUrlSubmit(url, subtitleLang, startTime)   [SAME sink as deep link]
```

Single playback sink: the server only **emits an event**; it never touches
playback directly. `handleUrlSubmit` (`src/App.tsx:163`) remains the one entry
point, identical to the deep-link path (`src/lib/ipc.ts:72` `onDeepLink` →
`handleUrlSubmit`). No second playback code path.

---

## Security Invariants (MUST / MUST NOT — do not weaken)

The listener accepts a URL and feeds it to the yt-dlp pipeline. Treat every
request as hostile until proven otherwise.

1. **Loopback bind only.** Bind `127.0.0.1:47821`. MUST NOT bind `0.0.0.0` or
   any routable address. Blocks the LAN.
2. **Secret token required on every state-changing request.**
   - Extension generates a 128-bit token once (`crypto.randomUUID()`), persists
     in `chrome.storage.local` (`floatpipToken`).
   - Token reaches the app **only via the deep link** (trusted bootstrap,
     browser→app): append `&ct=<token>` to every `floatpip://open` URL the
     extension creates (popup activation AND cold fallback).
   - App parses `ct` in the deep-link handler, sends it to Rust via a new
     command `register_companion_token(token)`, which inserts into a shared
     `Mutex<HashSet<String>>` (a SET, so multiple browsers/profiles each
     register their own token — no ping-pong) AND persists to tauri-store.
   - `POST /open` MUST require header `X-FloatPip-Token` and reject (401) if the
     value is not a member of the registered set. Constant-time compare not
     required (set membership), but MUST NOT log the token.
   - Why this is the linchpin: a custom request header forces a CORS preflight,
     so a malicious website cannot send it (and `no-cors` mode strips it →
     arrives header-less → 401). A local non-browser process can forge headers
     but does not know the token → 401.
3. **CORS: reflect extension origins only.**
   - On `OPTIONS` preflight: return `Access-Control-Allow-Origin: <Origin>`,
     `Access-Control-Allow-Headers: content-type, x-floatpip-token`,
     `Access-Control-Allow-Methods: POST, OPTIONS`, and
     `Access-Control-Allow-Private-Network: true` **only if** the `Origin`
     starts with `chrome-extension://` or `moz-extension://`. Otherwise return
     no CORS headers (browser blocks).
   - MUST NOT reflect `http(s)://` website origins under any condition.
   - Sending `Allow-Private-Network` proactively (gated to extension origins)
     pre-empts Chrome's Private Network Access preflight requirement for
     loopback — closes the "PNA might block the warm fetch" risk.
4. **Origin allow-gate on POST.** If `Origin` header is present and is NOT
   `chrome-extension://*` / `moz-extension://*`, reject 403 before any work.
5. **URL scheme allowlist.** Accept the `url` field only if it parses and its
   scheme is `http` or `https`. Reject everything else (400). (Defense in depth
   vs scheme-injection / `file://` / SSRF-ish input handed to yt-dlp.)
   - NOTE existing gap: the deep-link path (`src/lib/ipc.ts:72`) does NOT
     validate scheme today. Apply the SAME `http(s)`-only check in
     `handleUrlSubmit` so both entry points are equally restricted. Flag in
     ARCHITECTURE.md; keep the change minimal.
6. **Body size cap.** Limit request body to a few KiB (axum
   `DefaultBodyLimit` or manual). Reject oversized (413/400). Ignore malformed
   JSON (400). No unbounded buffering.
7. **Fail safe, never crash.** If binding `47821` fails (port in use), log once
   and skip the server — the feature degrades to deep-link-only; the app MUST
   still start and play normally.
8. **No sensitive logging.** Never log the token. Avoid logging full incoming
   URLs at info level.
9. **No new capability needed** (confirmed): custom `#[tauri::command]`s and
   `app.emit` / frontend `listen` already work without capability entries —
   existing commands (`extract_stream`, etc.) and event listeners
   (`click-through-changed`, `window-hidden`) have none in
   `src-tauri/capabilities/default.json`. Do NOT widen capabilities.

Residual risk (document, do not silently accept): a local process that already
has code execution as the same user can read `chrome.storage.local`/the tauri
store and forge a valid token. This is not a meaningful escalation (such a
process can already run yt-dlp itself). Acceptable for v1.

---

## Implementation — phased, agent-executable

### Phase 1 — Desktop listener (Rust)

Files: NEW `src-tauri/src/companion.rs`; edit `src-tauri/src/lib.rs`.

`companion.rs`:
- `const PORT: u16 = 47821;`
- Shared token store: `Mutex<HashSet<String>>` held in Tauri managed state (or
  a `OnceLock`). Provide `fn register_token(&AppHandle, String)` and membership
  check used by the handler.
- `#[tauri::command] pub fn register_companion_token(state, token: String)` →
  insert into set + persist via store. Register in `generate_handler!` in
  `lib.rs`.
- `pub fn spawn(app: AppHandle)`:
  - build axum `Router` with `POST /open` and an `OPTIONS /open` (or a tower
    CORS layer hand-rolled to the rules above — prefer explicit handler so the
    extension-origin gating + PNA header are unambiguous).
  - `DefaultBodyLimit::max(4096)`.
  - bind `TcpListener` on `127.0.0.1:47821`; on `Err`, `eprintln!` once and
    return (no panic).
  - serve via `tauri::async_runtime::spawn`.
- `/open` handler:
  1. read `Origin` header → if present and not extension scheme → 403.
  2. read `X-FloatPip-Token` → if missing or not in set → 401.
  3. deserialize JSON `{ url: String, start_time: Option<f64>, subtitle_lang:
     Option<String> }`; bad → 400.
  4. validate `url` scheme http/https → else 400.
  5. `app.emit("companion-open", payload)`; return 200 + CORS headers (origin
     reflected, extension-gated).
- `lib.rs` `.setup`: after window setup, `companion::spawn(app.handle().clone());`

Tests (cargo, pure where possible): factor validation into pure fns —
`fn origin_allowed(&str) -> bool`, `fn scheme_ok(&str) -> bool` — and unit-test
them (extension vs website origin; http/https vs file/javascript/empty).

### Phase 2 — Desktop frontend wiring (TS)

Files: `src/lib/ipc.ts`, `src/App.tsx`.

- `ipc.ts`: add
  - `registerCompanionToken(token: string): Promise<void>` →
    `invoke("register_companion_token", { token })`.
  - `onCompanionOpen(cb: (url, subtitleLang, startTime) => void)` →
    `listen("companion-open", e => cb(...))` (payload mirrors deep-link args).
  - In `onDeepLink` parsing, also extract `ct` param and, when present, call
    `registerCompanionToken(ct)` before/independent of playback.
- `App.tsx`:
  - In the existing `onMount` block that wires `onDeepLink`, also wire
    `onCompanionOpen((url, lang, t) => handleUrlSubmit(url, lang, t))` and add
    its cleanup to `onCleanup`.
  - Add http(s)-only scheme guard at the top of `handleUrlSubmit` (Invariant 5);
    on reject, `showToast` and return.

### Phase 3 — Extension (service worker + manifest)

Files: `extension/manifest.json`, `extension/background.js`, `extension/popup.js`.

- `manifest.json`: add `"webNavigation"` to `permissions`. (`host_permissions`
  already `<all_urls>` → covers `127.0.0.1` fetch.) Bump `version`.
- `background.js`:
  - Token helper: `async getToken()` → read `floatpipToken` from
    `chrome.storage.local`; if absent, `crypto.randomUUID()`, persist, return.
  - Mirrored-tab state in `chrome.storage.session` (survives MV3 worker
    eviction; webNavigation re-wakes the worker): `mirrored[tabId] = videoId`.
    Helpers get/set/delete.
  - `videoIdOf(url)`: parse `?v=`, `youtu.be/<id>`, `/shorts/<id>`. Return null
    if none (non-video nav → ignored).
  - `chrome.webNavigation.onHistoryStateUpdated.addListener(async ({tabId,url}) => …)`:
    - load `companionPip` flag + `mirrored[tabId]`; bail if not enabled or tab
      not mirrored.
    - `nid = videoIdOf(url)`; bail if null or `nid === mirrored[tabId]` (dedup).
    - pause: `executeScript(frameGetAndPauseVideo, allFrames)` with a short
      retry (~250ms ×3) because the new `<video>` may not be `readyState>0` the
      instant the URL flips; capture `startTime` from the paused video.
    - grab `subtitleLang` for YouTube (reuse `frameGetYouTubeSubtitleLang`).
    - `await sendToApp(tabId, {url, startTime, subtitleLang})`.
    - `mirrored[tabId] = nid`.
  - `chrome.tabs.onRemoved` → delete `mirrored[tabId]`.
  - `sendToApp(tabId, payload)`:
    ```
    token = await getToken()
    try {
      res = await fetch('http://127.0.0.1:47821/open', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-FloatPip-Token': token },
        body: JSON.stringify(payload),
      })
      if (res.ok) return                 // warm path, no tab
    } catch {}                           // connection refused → app down
    // cold / 401 fallback: deep link (launches app + delivers + registers token)
    let dl = 'floatpip://open?url=' + encodeURIComponent(payload.url)
              + '&ct=' + encodeURIComponent(token)
    if (payload.startTime>0)   dl += '&startTime=' + encodeURIComponent(payload.startTime)
    if (payload.subtitleLang)  dl += '&subtitleLang=' + encodeURIComponent(payload.subtitleLang)
    const t = await chrome.tabs.create({ url: dl, active:false })
    setTimeout(() => chrome.tabs.remove(t.id).catch(()=>{}), 700)
    ```
- `popup.js` (`openCompanionPip`, line 104): on a normal companion activation,
  (a) append `&ct=<token>` to the deep link so the app registers the token, and
  (b) record `mirrored[tab.id] = videoIdOf(tab.url)` so subsequent in-tab nav
  triggers auto-resend. Optionally route the popup send through `sendToApp` for
  warm reuse, but the deep link must remain for the cold-launch + token bootstrap.

---

## Gate (run after each phase; capture baseline first)

- Baseline BEFORE any change: `cd src-tauri && cargo test` (record pass/fail
  names), `npm test` (vitest), `npx tsc --noEmit`, `cargo check`.
- After Rust phases: `cargo check` + `cargo test` (new origin/scheme unit tests
  green, no prior test regressed — diff against baseline).
- After TS phases: `npx tsc --noEmit` (0 errors, strict) + `npm test`.
- Extension: no automated gate. Lint by hand; load unpacked.

## Runtime verification — USER must do (cannot be confirmed from a build)

1. `npm run tauri dev`, load `extension/` unpacked in Chrome.
2. Enable Companion PiP in popup; send a YouTube video → app plays, browser
   pauses. (Bootstraps token via deep link.)
3. In the SAME tab, click a related/next video → app swaps to new video AND
   browser pauses, **with no new tab appearing** (warm path). Confirm in
   DevTools Network that the `POST 127.0.0.1:47821/open` returned 200.
4. Negative: from any website's console run
   `fetch('http://127.0.0.1:47821/open',{method:'POST',body:'{}'})` →
   MUST be blocked/!ok (CORS/401). Confirms the website vector is closed.
5. Kill the app, navigate again → extension falls back to deep link, app
   relaunches with the new video (cold path still works).

## Risks, ranked (most likely to bite first)

1. **PNA / preflight still blocks the warm fetch** despite the
   `Allow-Private-Network` header (Chrome-version dependent behavior for
   extension SW → loopback). Symptom: step-3 fetch fails, junk tab appears via
   fallback. Mitigation already in plan (gated PNA header); if it still fails,
   inspect the actual preflight in DevTools and adjust the OPTIONS response.
   This is the one claim I'd most expect to be wrong — verify on real Chrome.
2. **SPA pause timing**: new `<video>` not ready when `onHistoryStateUpdated`
   fires → `startTime` null / pause misses. Mitigation: the ~250ms ×3 retry.
3. **Multiple browsers/profiles**: handled by the token SET; verify no
   ping-pong if two browsers are both mirroring.

## Files

new:    `src-tauri/src/companion.rs`
edit:   `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/App.tsx`,
        `extension/manifest.json`, `extension/background.js`,
        `extension/popup.js`, `ARCHITECTURE.md`, `TASKS.md`
caps:   none (do not widen `src-tauri/capabilities/default.json`)
deps:   none (axum + tokio already present)
