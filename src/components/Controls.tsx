import {
  Component,
  createSignal,
  createEffect,
  onCleanup,
  Show,
} from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
  PrevIcon,
  NextIcon,
} from "./Icons";
import {
  MdOutlineSkip_next,
  MdOutlineSkip_previous,
  MdRoundClosed_caption,
  MdOutlineClosed_caption_off,
} from "solid-icons/md";

interface Props {
  videoRef: () => HTMLVideoElement | undefined;
  tooSmall?: boolean;
  hasPlaylist?: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  ccTrackCount?: number;
  activeSubTrack?: number;
  onToggleCC?: () => void;
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = sec.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export const Controls: Component<Props> = (props) => {
  const [playing, setPlaying] = createSignal(false);
  const [current, setCurrent] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(1);
  const [muted, setMuted] = createSignal(false);

  createEffect(() => {
    const v = props.videoRef();
    if (!v) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(v.currentTime);
    const onDur = () => setDuration(isFinite(v.duration) ? v.duration : 0);
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("volumechange", onVol);

    onCleanup(() => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("volumechange", onVol);
    });
  });

  const togglePlay = () => {
    const v = props.videoRef();
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const toggleMute = () => {
    const v = props.videoRef();
    if (!v) return;
    v.muted = !v.muted;
  };

  const seek = (e: Event) => {
    const v = props.videoRef();
    if (!v) return;
    v.currentTime = parseFloat((e.target as HTMLInputElement).value);
  };

  const changeVolume = (e: Event) => {
    const v = props.videoRef();
    if (!v) return;
    v.volume = parseFloat((e.target as HTMLInputElement).value);
    v.muted = false;
  };

  const seekFill = () => {
    const d = duration();
    return d > 0 ? `${(current() / d) * 100}%` : "0%";
  };
  const volFill = () => `${(muted() ? 0 : volume()) * 100}%`;

  return (
    <div class="controls">
      <Show when={props.hasPlaylist && !props.tooSmall}>
        <button
          class="ctrl-btn nav-btn"
          onClick={props.onPrev}
          disabled={!props.hasPrev}
          data-tip="Previous"
        >
          <MdOutlineSkip_previous size={15} />
        </button>
      </Show>
      <button
        class="ctrl-btn play-btn"
        onClick={togglePlay}
        data-tip={playing() ? "Pause" : "Play"}
      >
        {playing() ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
      </button>
      <Show when={props.hasPlaylist && !props.tooSmall}>
        <button
          class="ctrl-btn nav-btn"
          onClick={props.onNext}
          disabled={!props.hasNext}
          data-tip="Next"
        >
          <MdOutlineSkip_next size={16} />
        </button>
      </Show>

      <input
        class="seek-bar"
        type="range"
        min="0"
        max={duration() || 100}
        step="0.1"
        value={current()}
        onInput={seek}
        style={{ "--fill": seekFill() }}
      />

      <Show when={!props.tooSmall}>
        <span class="time">
          {fmt(current())} <span class="time-sep">/</span> {fmt(duration())}
        </span>
      </Show>
      <Show when={!props.tooSmall && (props.ccTrackCount ?? 0) > 0}>
        <button
          class="ctrl-btn cc-btn"
          onClick={props.onToggleCC}
          data-tip="Subtitles"
        >
          {(props.activeSubTrack ?? -1) >= 0
            ? <MdRoundClosed_caption size={18} />
            : <MdOutlineClosed_caption_off size={18} />
          }
        </button>
      </Show>
      <button
        class="ctrl-btn vol-btn"
        onClick={toggleMute}
        data-tip={muted() ? "Unmute" : "Mute"}
      >
        {muted() || volume() === 0 ? (
          <VolumeMuteIcon size={16} />
        ) : volume() < 0.5 ? (
          <VolumeLowIcon size={16} />
        ) : (
          <VolumeHighIcon size={16} />
        )}
      </button>
      <Show when={!props.tooSmall}>
        <input
          class="vol-bar"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted() ? 0 : volume()}
          onInput={changeVolume}
          style={{ "--fill": volFill() }}
        />
      </Show>
    </div>
  );
};
