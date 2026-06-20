import { Component, For } from "solid-js";
import type { SubCue, SubtitleStyle } from "../lib/store";

interface Props {
  cues: SubCue[];
  style: SubtitleStyle;
}

export const SubtitleOverlay: Component<Props> = (props) => {
  return (
    <div
      class="subtitle-overlay"
      style={{ "font-size": `${props.style.fontSize}px`, color: props.style.color }}
    >
      <For each={props.cues}>
        {(cue) => (
          <div
            class="subtitle-cue"
            style={{ background: props.style.background }}
            // Safe: yt-dlp subtitle text, HTML tags stripped in parser
            innerHTML={cue.text.replace(/\n/g, "<br/>")}
          />
        )}
      </For>
    </div>
  );
};
