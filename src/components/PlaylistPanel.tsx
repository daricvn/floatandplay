import { Component, For, Show } from "solid-js";
import { state } from "../lib/store";
import { CloseIcon } from "./Icons";
import { MdRoundArrow_forward_ios } from "solid-icons/md";

interface Props {
  onSelect: (i: number) => void;
  onClose?: () => void;
}

export const PlaylistPanel: Component<Props> = (props) => {
  return (
    <div class="playlist-panel">
      <div class="settings-header">
        <button class="close-settings" onClick={props.onClose}>
          <MdRoundArrow_forward_ios size={14} />
        </button>
        <div>{state.playlistTitle ?? "Playlist"} ({state.playlist.length})</div>
      </div>
      <div class="playlist-scroll">
        <For each={state.playlist}>
          {(entry, i) => (
            <button
              class="playlist-row"
              classList={{ active: i() === state.playlistIndex }}
              onClick={() => props.onSelect(i())}
            >
              <span class="playlist-num">{i() + 1}</span>
              <span class="playlist-title">{entry.title}</span>
            </button>
          )}
        </For>
        <Show when={state.playlist.length === 300}>
          <div class="playlist-cap-note">Showing first 300 entries</div>
        </Show>
      </div>
    </div>
  );
};
