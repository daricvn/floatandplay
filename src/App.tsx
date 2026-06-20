import {
  Component,
  onMount,
  onCleanup,
  Show,
  createSignal,
  createEffect,
  on,
  createMemo,
} from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import { TopBar } from "./components/TopBar";
import { VideoPlayer } from "./components/VideoPlayer";
import { Controls } from "./components/Controls";
import { SubtitleOverlay } from "./components/SubtitleOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { VolumeBoosterPanel } from "./components/VolumeBoosterPanel";
import { PlaylistPanel } from "./components/PlaylistPanel";
import { Toast, Notice, showToast } from "./components/Toast";
import { state, setState, type SubtitleStyle } from "./lib/store";
import {
  extractStream,
  extractPlaylist,
  getProxyUrl,
  getClickThrough,
  onClickThroughChanged,
  setAlwaysOnTop,
  setVideoAspect,
  loadSubtitleFile,
  onDeepLink,
  onCompanionOpen,
  onWindowHidden,
  startWindowDrag,
} from "./lib/ipc";
import {
  fetchSubtitles,
  parseSrt,
  parseVtt,
  getActiveCues,
} from "./lib/subtitles";
import { getListId, getVideoId, buildWatchUrl } from "./lib/url";
import { Transition } from "solid-transition-group";

const appStore = new LazyStore("floatpip-settings.json");

let resolveToken = 0;
const MAX_AUTO_SKIPS = 5;

export const App: Component = () => {
  let videoRef: HTMLVideoElement | undefined;
  const [savedUrl, setSavedUrl] = createSignal("");
  const [chromeOn, setChromeOn] = createSignal(true);
  const [urlOpen, setUrlOpen] = createSignal(false);
  const [overChrome, setOverChrome] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [winW, setWinW] = createSignal(window.innerWidth);
  const [winH, setWinH] = createSignal(window.innerHeight);
  const tooSmall = createMemo(() => winW() < 250 || winH() < 250);
  let hideTimer: number | undefined;
  const [pendingSubIdx, setPendingSubIdx] = createSignal(-1);
  const [pendingStartTime, setPendingStartTime] = createSignal<number | null>(
    null,
  );
  const [lastCcTrackIdx, setLastCcTrackIdx] = createSignal(-1);

  const ccTracks = createMemo(() =>
    state.subtitleTracks.filter((t) => t.lang !== "live_chat"),
  );

  // chrome visible when cursor active, settings/booster/playlist open, or url input expanded
  const chromeVisible = () =>
    chromeOn() ||
    state.showSettings ||
    state.showVolumeBooster ||
    state.showPlaylist ||
    urlOpen();

  const pokeChrome = () => {
    setChromeOn(true);
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!overChrome()) setChromeOn(false);
    }, 2600);
  };
  onCleanup(() => clearTimeout(hideTimer));

  createEffect(() => {
    if (tooSmall())
      setState({
        showSettings: false,
        showVolumeBooster: false,
        showPlaylist: false,
      });
  });

  createEffect(() => {
    setAlwaysOnTop(state.alwaysOnTop && state.proxyVideoUrl !== null);
  });

  onMount(async () => {
    const onResize = () => {
      setWinW(window.innerWidth);
      setWinH(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
    const ct = await getClickThrough().catch(() => false);
    setState("clickThrough", ct);

    const unsub = await onClickThroughChanged((on) => {
      setState("clickThrough", on);
      showToast(
        on ? "Click-through ON — Ctrl+Alt+C to exit" : "Click-through OFF",
      );
    });
    onCleanup(() => unsub());

    const saved = await appStore.get<{
      lastUrl?: string;
      opacity?: number;
      alwaysOnTop?: boolean;
      subtitleStyle?: SubtitleStyle;
    }>("settings");
    if (saved) {
      if (saved.opacity != null) setState("opacity", saved.opacity);
      if (saved.alwaysOnTop != null) setState("alwaysOnTop", saved.alwaysOnTop);
      if (saved.subtitleStyle != null)
        setState("subtitleStyle", saved.subtitleStyle);
      if (saved.lastUrl) setSavedUrl(saved.lastUrl);
    }

    const cleanupDeepLink = await onDeepLink((url, subtitleLang, startTime) =>
      handleUrlSubmit(url, subtitleLang, startTime),
    );
    onCleanup(cleanupDeepLink);

    const cleanupCompanion = await onCompanionOpen((url, lang, t) =>
      handleUrlSubmit(url, lang, t),
    );
    onCleanup(cleanupCompanion);

    const unsubHidden = await onWindowHidden(() => {
      videoRef?.pause();
    });
    onCleanup(() => unsubHidden());
  });

  createEffect(
    on(
      () =>
        [
          state.pageUrl,
          state.opacity,
          state.alwaysOnTop,
          state.subtitleStyle,
        ] as const,
      ([lastUrl, opacity, alwaysOnTop, subtitleStyle]) => {
        appStore
          .set("settings", { lastUrl, opacity, alwaysOnTop, subtitleStyle })
          .then(() => appStore.save());
      },
      { defer: true },
    ),
  );

  let autoSkipCount = 0;
  let streamRetrying = false;

  const handleUrlSubmit = async (
    url: string,
    subtitleLang?: string | null,
    startTime?: number | null,
    auto = false,
  ) => {
    const myToken = ++resolveToken;

    if (!/^https?:\/\//i.test(url)) {
      showToast("Invalid URL: only http/https supported");
      return;
    }

    // Same video already loaded and still playable → seek + play, skip re-extraction.
    // Also catch canonical watch URLs that differ from original (youtu.be / extra params).
    const sameVideo =
      (url === state.pageUrl ||
        getVideoId(url) === getVideoId(state.pageUrl)) &&
      state.proxyVideoUrl !== null &&
      videoRef &&
      videoRef.error === null &&
      videoRef.readyState >= 2;

    if (sameVideo) {
      if (startTime != null) videoRef!.currentTime = startTime;
      videoRef!.play().catch((e) => {
        if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
          showToast(`Playback failed: ${e?.message ?? e}`);
        }
      });
      // Re-sync playlist index for the canonical url
      const vid = getVideoId(url);
      if (vid && state.playlist.length > 0) {
        const idx = state.playlist.findIndex((e) => e.id === vid);
        if (idx >= 0) setState("playlistIndex", idx);
      }
      return;
    }

    const listId = getListId(url);

    setPendingSubIdx(-1);
    setPendingStartTime(startTime ?? null);
    setState({ loading: true, error: null });
    try {
      const info = await extractStream(url, subtitleLang);
      const proxyUrl = await getProxyUrl(
        info.video_url,
        Object.keys(info.http_headers).length > 0 ? info.http_headers : null,
      );
      if (myToken !== resolveToken) return;
      autoSkipCount = 0;
      streamRetrying = false;
      setLastCcTrackIdx(-1);
      setState({
        stream: info,
        proxyVideoUrl: proxyUrl,
        pageUrl: url,
        loading: false,
        subtitleTracks: info.subtitles,
        activeSubTrack: -1,
        subtitleCues: [],
        currentCues: [],
        error: null,
      });
      if (info.title) setNotice(info.title);
      if (info.subtitles.length > 0) {
        let idx = -1;
        if (subtitleLang) {
          idx = info.subtitles.findIndex(
            (t) =>
              t.lang === subtitleLang ||
              t.lang.startsWith(subtitleLang + "-") ||
              subtitleLang.startsWith(t.lang + "-"),
          );
        }
        if (idx < 0 && subtitleLang && info.subtitles.length === 1) idx = 0;
        if (idx >= 0) setPendingSubIdx(idx);
      }

      // Defer playlist resolve until first playing event — video already buffers
      if (listId) {
        const capturedToken = myToken;
        const doResolve = () => {
          if (capturedToken !== resolveToken) return;
          if (listId === state.playlistId) {
            // Same playlist: just recompute index
            const vid = getVideoId(url);
            const idx = vid
              ? state.playlist.findIndex((e) => e.id === vid)
              : -1;
            setState("playlistIndex", idx);
          } else {
            extractPlaylist(url)
              .then((info) => {
                if (capturedToken !== resolveToken) return;
                const vid = getVideoId(url);
                const idx = vid
                  ? info.entries.findIndex((e) => e.id === vid)
                  : -1;
                setState({
                  playlist: info.entries,
                  playlistId: info.id ?? listId,
                  playlistTitle: info.title ?? null,
                  playlistIndex: idx >= 0 ? idx : 0,
                });
              })
              .catch(() => {
                if (capturedToken !== resolveToken) return;
                setState({
                  playlist: [],
                  playlistId: null,
                  playlistTitle: null,
                  playlistIndex: -1,
                  showPlaylist: false,
                });
              });
          }
        };
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(doResolve, { timeout: 3000 });
        } else {
          setTimeout(doResolve, 500);
        }
      } else {
        setState({
          playlist: [],
          playlistId: null,
          playlistTitle: null,
          playlistIndex: -1,
          showPlaylist: false,
        });
      }
    } catch (e) {
      if (myToken !== resolveToken) return;
      if (auto) {
        autoSkipCount++;
        if (autoSkipCount <= MAX_AUTO_SKIPS) {
          const nextIdx = state.playlistIndex + 1;
          if (nextIdx < state.playlist.length) {
            playEntry(nextIdx, true);
            return;
          }
        }
        showToast("Playlist: could not play entry");
      }
      setState({ loading: false, error: String(e) });
    }
  };

  const playEntry = (i: number, auto = false) => {
    const e = state.playlist[i];
    if (!e) return;
    handleUrlSubmit(buildWatchUrl(e.id, state.playlistId), null, null, auto);
  };

  const handleVideoError = (code: number, message: string, currentTime: number) => {
    // Mid-playback network/decode error (code 2 or 3) — re-extract fresh URL and resume.
    // Only retry once per stream load; initial-load failures (currentTime ~0) go straight to toast.
    if ((code === 2 || code === 3) && currentTime > 0.5 && !streamRetrying && state.pageUrl) {
      streamRetrying = true;
      const track = state.activeSubTrack >= 0 ? state.subtitleTracks[state.activeSubTrack] : null;
      handleUrlSubmit(state.pageUrl, track?.lang ?? null, currentTime);
      return;
    }
    streamRetrying = false;
    showToast(`Video error ${code}: ${message || "cannot play stream"}`);
  };

  const handleSubTrackSelect = async (idx: number) => {
    setState({ activeSubTrack: idx, subtitleCues: [], currentCues: [] });
    if (idx >= 0 && state.subtitleTracks[idx]?.lang !== "live_chat") {
      setLastCcTrackIdx(idx);
    }
    if (idx < 0) return;
    const track = state.subtitleTracks[idx];
    if (!track) return;
    try {
      const cues = await fetchSubtitles(track.url);
      setState("subtitleCues", cues);
    } catch (e) {
      console.error("Failed to load subtitles:", e);
    }
  };

  const handleToggleCC = () => {
    if (state.activeSubTrack >= 0) {
      handleSubTrackSelect(-1);
      return;
    }
    const tracks = state.subtitleTracks;
    // last selected
    const last = lastCcTrackIdx();
    if (last >= 0 && tracks[last] && tracks[last].lang !== "live_chat") {
      handleSubTrackSelect(last);
      return;
    }
    // english
    const enIdx = tracks.findIndex(
      (t) => t.lang !== "live_chat" && t.lang.startsWith("en"),
    );
    if (enIdx >= 0) { handleSubTrackSelect(enIdx); return; }
    // first non-live_chat
    const firstIdx = tracks.findIndex((t) => t.lang !== "live_chat");
    if (firstIdx >= 0) handleSubTrackSelect(firstIdx);
  };

  const handleLoadExternalSub = async () => {
    try {
      const content = await loadSubtitleFile();
      const cues = content.startsWith("WEBVTT")
        ? parseVtt(content)
        : parseSrt(content);
      setState({ subtitleCues: cues, currentCues: [], activeSubTrack: -99 });
    } catch {
      // user cancelled
    }
  };

  const handleTimeUpdate = (currentTimeMs: number) => {
    if (state.subtitleCues.length === 0) {
      if (state.currentCues.length > 0) setState("currentCues", []);
      return;
    }
    const cues = getActiveCues(
      state.subtitleCues,
      currentTimeMs,
      state.subtitleOffset,
    );
    setState("currentCues", cues);
  };

  return (
    <div
      class="app"
      classList={{ "chrome-hidden": !chromeVisible() && !state.clickThrough }}
      style={{ opacity: state.clickThrough ? "0.65" : String(state.opacity) }}
      onMouseDown={startWindowDrag}
      onMouseMove={pokeChrome}
      onMouseLeave={() => {
        clearTimeout(hideTimer);
        if (!overChrome()) setChromeOn(false);
      }}
    >
      <Toast />
      <Notice title={notice()} setTitle={(title)=> setNotice(title)} autoDismiss={5000} />

      <div class="video-wrapper">
        <VideoPlayer
          src={state.proxyVideoUrl ?? undefined}
          onTimeUpdate={handleTimeUpdate}
          onRef={(el) => (videoRef = el)}
          onLoadingChange={(loading) => setState("videoLoading", loading)}
          onAspectRatio={(r) => setVideoAspect(r).catch(() => {})}
          onReady={() => {
            const st = pendingStartTime();
            if (st != null && videoRef) {
              videoRef.currentTime = st;
              setPendingStartTime(null);
            }
            const idx = pendingSubIdx();
            if (idx >= 0) {
              setPendingSubIdx(-1);
              handleSubTrackSelect(idx);
            }
          }}
          onEnded={() => {
            if (
              state.playlist.length > 0 &&
              state.playlistIndex < state.playlist.length - 1
            ) {
              playEntry(state.playlistIndex + 1, true);
            }
          }}
          onError={handleVideoError}
        />
        <SubtitleOverlay cues={state.currentCues} style={state.subtitleStyle} />
      </div>

      <Show when={!state.clickThrough}>
        <div
          class="chrome"
          classList={{ visible: chromeVisible() }}
          onMouseEnter={() => setOverChrome(true)}
          onMouseLeave={() => setOverChrome(false)}
        >
          <div class="scrim-top" />
          <div class="scrim-bottom" />
          <TopBar
            onUrlSubmit={handleUrlSubmit}
            initialUrl={savedUrl()}
            open={urlOpen()}
            setOpen={setUrlOpen}
            tooSmall={tooSmall()}
            onHide={() => {
              videoRef?.pause();
              getCurrentWindow().hide();
            }}
          />
          <Controls
            videoRef={() => videoRef}
            tooSmall={tooSmall()}
            hasPlaylist={state.playlist.length > 0}
            hasPrev={state.playlistIndex > 0}
            hasNext={state.playlistIndex < state.playlist.length - 1}
            onPrev={() => playEntry(state.playlistIndex - 1)}
            onNext={() => playEntry(state.playlistIndex + 1)}
            ccTrackCount={ccTracks().length}
            activeSubTrack={state.activeSubTrack}
            onToggleCC={handleToggleCC}
          />
        </div>
      </Show>

      <Show when={state.showSettings && !state.clickThrough && !tooSmall()}>
        <div
          class="settings-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            setState("showSettings", false);
          }}
        />
      </Show>
      <Transition name="slide-down">
        <Show when={state.showSettings && !state.clickThrough && !tooSmall()}>
          <SettingsPanel
            onSubTrackSelect={handleSubTrackSelect}
            onLoadExternalSub={handleLoadExternalSub}
          />
        </Show>
      </Transition>

      <Show
        when={state.showVolumeBooster && !state.clickThrough && !tooSmall()}
      >
        <div
          class="settings-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            setState("showVolumeBooster", false);
          }}
        />
      </Show>
      <Transition name="slide-down">
        <Show
          when={state.showVolumeBooster && !state.clickThrough && !tooSmall()}
        >
          <VolumeBoosterPanel videoRef={() => videoRef} winH={winH()} />
        </Show>
      </Transition>

      <Show when={state.showPlaylist && !state.clickThrough && !tooSmall()}>
        <div
          class="settings-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            setState("showPlaylist", false);
          }}
        />
      </Show>
      <Transition name="slide-fade">
        <Show when={state.showPlaylist && !state.clickThrough && !tooSmall()}>
          <PlaylistPanel
            onSelect={playEntry}
            onClose={() => setState("showPlaylist", false)}
          />
        </Show>
      </Transition>

      <Show when={state.loading || state.videoLoading}>
        <div
          class={
            state.loading
              ? "loading-overlay"
              : "loading-overlay loading-overlay--passive"
          }
        >
          <div class="spinner" />
          <span>
            {state.loading ? "Extracting stream..." : "Loading video..."}
          </span>
        </div>
      </Show>

      <Show when={!!state.error}>
        <div class="error-banner" onClick={() => setState("error", null)}>
          {state.error}
        </div>
      </Show>
    </div>
  );
};
