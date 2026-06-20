import { Component, createSignal, createEffect, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { state, setState } from "../lib/store";
import {
  GlobeIcon,
  ArrowIcon,
  SettingsIcon,
  CloseIcon,
  VolumeBoostIcon,
  PlaylistIcon,
} from "./Icons";
import { FaSolidCog } from "solid-icons/fa";
import { MdOutlineSettings } from "solid-icons/md";

interface Props {
  onUrlSubmit: (url: string) => void;
  initialUrl?: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  tooSmall?: boolean;
  onHide?: () => void;
}

export const TopBar: Component<Props> = (props) => {
  const [url, setUrl] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.initialUrl) setUrl(props.initialUrl);
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const val = url().trim();
    if (val) props.onUrlSubmit(val);
    props.setOpen(false);
  };

  const toggle = () => {
    const next = !props.open;
    props.setOpen(next);
    if (next) setTimeout(() => inputRef?.focus(), 60);
  };

  const win = getCurrentWindow();

  return (
    <div class="topbar">
      <div class="url-launcher" classList={{ open: props.open }}>
        <button
          class="globe-btn"
          onClick={toggle}
          data-tip="Load video"
          data-tip-pos="bottom-start"
        >
          <GlobeIcon size={16} />
        </button>
        <form class="url-form" onSubmit={submit}>
          <input
            ref={inputRef}
            class="url-input"
            type="text"
            placeholder="Paste a video link…"
            value={url()}
            tabindex={props.open ? 0 : -1}
            onInput={(e) => setUrl(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") props.setOpen(false);
            }}
          />
          <button
            type="submit"
            class="url-submit"
            data-tip="Load"
            data-tip-pos="bottom"
          >
            <ArrowIcon size={15} />
          </button>
        </form>
      </div>

      <div class="win-controls">
        <Show when={!props.tooSmall}>
          <Show when={state.playlist.length > 0}>
            <button
              class="win-btn"
              data-tip="Playlist"
              data-tip-pos="bottom-end"
              onClick={() => {
                setState("showPlaylist", (v: boolean) => !v);
                setState({ showSettings: false, showVolumeBooster: false });
              }}
            >
              <PlaylistIcon size={16} />
            </button>
          </Show>
          <div class="vb-btn-wrap">
            <button
              class="win-btn"
              data-tip="Volume Booster"
              data-tip-pos="bottom-end"
              onClick={() => {
                setState("showVolumeBooster", (v: boolean) => !v);
                setState({ showSettings: false, showPlaylist: false });
              }}
              style={{ color: '#9880e0' }}
            >
              <VolumeBoostIcon size={16} />
            </button>
            <Show when={state.volumeBoost !== 100}>
              <span class="vb-icon-badge">{state.volumeBoost}%</span>
            </Show>
          </div>
          <button
            class="win-btn hover-rotate"
            data-tip="Settings"
            data-tip-pos="bottom-end"
            onClick={() => {
              setState("showSettings", (v: boolean) => !v);
              setState({ showVolumeBooster: false, showPlaylist: false });
            }}
          >
            <MdOutlineSettings size={16} />
          </button>
        </Show>
        <button
          class="win-btn close-btn"
          data-tip="Close"
          data-tip-pos="bottom-end"
          onClick={() => (props.onHide ? props.onHide() : win.hide())}
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
};
