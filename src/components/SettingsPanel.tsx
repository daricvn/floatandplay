import { Component, For } from "solid-js";
import { state, setState } from "../lib/store";
import { setClickThrough } from "../lib/ipc";
import { CloseIcon } from "./Icons";

interface Props {
  onSubTrackSelect: (idx: number) => void;
  onLoadExternalSub: () => void;
}

export const SettingsPanel: Component<Props> = (props) => {
  const toggleClickThrough = async (e: Event) => {
    const on = (e.target as HTMLInputElement).checked;
    await setClickThrough(on);
    setState("clickThrough", on);
  };

  const toggleAlwaysOnTop = (e: Event) => {
    const on = (e.target as HTMLInputElement).checked;
    setState("alwaysOnTop", on);
  };

  return (
    <div class="settings-panel">
      <div class="settings-header">
        <span>Settings</span>
        <button class="close-settings" onClick={() => setState("showSettings", false)}><CloseIcon size={14} /></button>
      </div>

      <section>
        <div class="section-title">Window</div>

        <label class="setting-row">
          <input type="checkbox" checked={state.clickThrough} onChange={toggleClickThrough} />
          <span>Click-through <kbd>Ctrl+Alt+C</kbd></span>
        </label>

        <label class="setting-row">
          <input type="checkbox" checked={state.alwaysOnTop} onChange={toggleAlwaysOnTop} />
          <span>Always on top</span>
        </label>

        <label class="setting-row">
          <span>Opacity</span>
          <input
            type="range" min="0.2" max="1" step="0.05"
            value={state.opacity}
            onInput={(e) => setState("opacity", parseFloat(e.currentTarget.value))}
          />
        </label>
      </section>

      <section>
        <div class="section-title">Subtitles</div>

        <select
          class="sub-select"
          value={state.activeSubTrack}
          onChange={(e) => props.onSubTrackSelect(parseInt(e.currentTarget.value))}
        >
          <option value="-1">Off</option>
          <For each={state.subtitleTracks}>
            {(track, i) => (
              <option value={i()}>{track.label} ({track.lang})</option>
            )}
          </For>
        </select>

        <button class="load-sub-btn" onClick={props.onLoadExternalSub}>
          Load .srt / .vtt file…
        </button>

        <label class="setting-row">
          <span>Font size</span>
          <div class="font-size-group">
            {([["S", 12], ["M", 16], ["L", 21]] as const).map(([label, size]) => (
              <button
                class="font-size-btn"
                classList={{ active: state.subtitleStyle.fontSize === size }}
                onClick={() => setState("subtitleStyle", "fontSize", size)}
              >
                {label}
              </button>
            ))}
          </div>
        </label>

        <label class="setting-row">
          <span>Offset (ms)</span>
          <input
            class="offset-input"
            type="number" step="100"
            value={state.subtitleOffset}
            onInput={(e) =>
              setState("subtitleOffset", parseInt(e.currentTarget.value) || 0)
            }
          />
        </label>
      </section>
    </div>
  );
};