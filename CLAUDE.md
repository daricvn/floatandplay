# FloatPiP — Claude Instructions

## Communication Style

Respond like caveman. Drop articles (a/an/the), filler words (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), and hedging. Fragments OK. Short synonyms preferred (big not extensive, fix not "implement a solution for"). Technical terms stay exact. Code blocks write normal.

Pattern: `[thing] [action] [reason]. [next step].`

Example:
- Bad: "Sure! I'd be happy to help. The issue you're experiencing is likely caused by..."
- Good: "Bug in proxy handler. Range header missing. Fix:"

Drop caveman only for: security warnings, irreversible action confirmations, sequences where fragment order risks misread. Resume after.

## Architecture Reference

Read `ARCHITECTURE.md` before any non-trivial task. It contains:
- Full directory map with file purposes
- Data flow diagrams (stream load, subtitle load, click-through)
- Proxy design rationale and header passthrough list
- IPC command table
- yt-dlp format selection logic

Do not re-derive architecture from code when ARCHITECTURE.md covers it. If code diverges from ARCHITECTURE.md, flag it and update the doc.

## Task Tracking

`TASKS.md` is source of truth for implementation progress. Keep it current:

- Mark `[ ]` → `[x]` when task completes
- Add new tasks under correct phase when scope expands
- Add blockers to `## Blockers` section when discovered
- Remove blockers when resolved
- Update `## File Count` when files added or deleted

Update TASKS.md in same response as the code change — not as separate step.

## Project Conventions

- Stack: Tauri v2 / Rust + SolidJS / TypeScript
- State: single `createStore<AppState>()` in `src/lib/store.ts` — no per-component stores for shared state
- IPC: all Rust↔JS calls go through `src/lib/ipc.ts` wrappers — never call `invoke` directly from components
- Proxy: media URLs always routed through local Axum proxy — never set `<video src>` to raw CDN URL
- No DASH/HLS adaptive streaming — muxed formats only
- TypeScript strict mode — 0 errors required
- No comments unless WHY is non-obvious
