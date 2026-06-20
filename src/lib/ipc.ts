import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { StreamInfo, PlaylistEntry } from "./store";

export interface PlaylistInfo {
  id: string | null;
  title: string | null;
  entries: PlaylistEntry[];
}

export function extractStream(
  url: string,
  subtitleLang?: string | null
): Promise<StreamInfo> {
  return invoke<StreamInfo>("extract_stream", { url, subtitleLang: subtitleLang ?? null });
}

export function extractPlaylist(url: string): Promise<PlaylistInfo> {
  return invoke<PlaylistInfo>("extract_playlist", { url });
}

export function setClickThrough(on: boolean): Promise<void> {
  return invoke("set_click_through", { on });
}

export function getClickThrough(): Promise<boolean> {
  return invoke<boolean>("get_click_through");
}

export function setAlwaysOnTop(on: boolean): Promise<void> {
  return invoke("set_always_on_top", { on });
}

// Lock window resize aspect ratio to the video (Rust-side WM_SIZING). 0 unlocks.
export function setVideoAspect(ratio: number): Promise<void> {
  return invoke("set_video_aspect", { ratio });
}

export function getProxyUrl(
  url: string,
  headers: Record<string, string> | null
): Promise<string> {
  return invoke<string>("get_proxy_url", { url, headers });
}

export function loadSubtitleFile(): Promise<string> {
  return invoke<string>("load_subtitle_file");
}

export function onClickThroughChanged(cb: (on: boolean) => void) {
  return listen<boolean>("click-through-changed", (e) => cb(e.payload));
}

const DRAG_EXCLUDED = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

export function startWindowDrag(e: MouseEvent): void {
  if (e.button !== 0) return;
  let el = e.target as HTMLElement | null;
  while (el) {
    if (DRAG_EXCLUDED.has(el.tagName)) return;
    if (el.dataset.tauriNoDrag !== undefined) return;
    el = el.parentElement;
  }
  getCurrentWindow().startDragging().catch(() => {});
}

export function onWindowHidden(cb: () => void) {
  return listen<unknown>("window-hidden", () => cb());
}

export async function onDeepLink(cb: (url: string, subtitleLang: string | null, startTime: number | null) => void): Promise<() => void> {
  const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  return onOpenUrl((urls) => {
    const first = urls[0];
    if (!first) return;
    try {
      const parsed = new URL(first);
      const videoUrl = parsed.searchParams.get("url");
      if (videoUrl) {
        const ct = parsed.searchParams.get("ct");
        if (ct) registerCompanionToken(decodeURIComponent(ct)).catch(() => {});
        const lang = parsed.searchParams.get("subtitleLang");
        const startTimeRaw = parsed.searchParams.get("startTime");
        const startTime = startTimeRaw != null ? parseFloat(startTimeRaw) : null;
        cb(
          decodeURIComponent(videoUrl),
          lang ? decodeURIComponent(lang) : null,
          startTime != null && isFinite(startTime) ? startTime : null
        );
      }
    } catch {
      // malformed deep link, ignore
    }
  });
}

export function registerCompanionToken(token: string): Promise<void> {
  return invoke("register_companion_token", { token });
}

export function onCompanionOpen(
  cb: (url: string, subtitleLang: string | null, startTime: number | null) => void
): Promise<() => void> {
  return listen<{ url: string; subtitleLang: string | null; startTime: number | null }>(
    "companion-open",
    (e) => cb(e.payload.url, e.payload.subtitleLang, e.payload.startTime)
  );
}
