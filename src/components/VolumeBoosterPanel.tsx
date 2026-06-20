import { Component, For, Show } from "solid-js";
import { state, setState } from "../lib/store";
import { applyBoost, resetBoost } from "../lib/audioBoost";
import { CloseIcon } from "./Icons";

const MAX = 600;
const POS_MAX = 600;
const SEGMENTS = [
  { v0: 0, v1: 10, p0: 0, p1: 60 },
  { v0: 10, v1: 80, p0: 60, p1: 165 },
  { v0: 80, v1: 600, p0: 165, p1: 600 },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function posToVol(p: number): number {
  p = Math.max(0, Math.min(POS_MAX, p));
  for (const s of SEGMENTS) {
    if (p <= s.p1) return lerp(s.v0, s.v1, (p - s.p0) / (s.p1 - s.p0));
  }
  return MAX;
}

function volToPos(v: number): number {
  for (const s of SEGMENTS) {
    if (v <= s.v1) return lerp(s.p0, s.p1, (v - s.v0) / (s.v1 - s.v0));
  }
  return POS_MAX;
}

function clampVol(v: number): number {
  const snapped = v < 10 ? Math.round(v / 2) * 2 : Math.round(v / 10) * 10;
  return Math.max(0, Math.min(MAX, snapped));
}

type Mode = "generic" | "voice" | "bass";

interface Props {
  videoRef: () => HTMLVideoElement | undefined;
  winH: number;
}

const TICKS: { v: number; label: string; roundBorder?: boolean }[] = [
  { v: 10, label: "10", roundBorder: true },
  { v: 100, label: "100" },
  { v: 200, label: "200" },
  { v: 400, label: "400" },
];

export const VolumeBoosterPanel: Component<Props> = (props) => {
  let sliderRef: HTMLInputElement | undefined;

  const avH = () => props.winH - 54;
  const showDial = () => avH() >= 200;
  const showMode = () => avH() >= 248;
  const showAuto = () => avH() >= 320;

  const fill = () => (Math.round(volToPos(state.volumeBoost)) / POS_MAX).toFixed(3);
  const pct = () => (state.volumeBoost / MAX).toFixed(3);

  const push = (v: number, m: Mode = state.volumeBoostMode, a: boolean = state.volumeBoostAuto) => {
    const el = props.videoRef();
    if (el) applyBoost(el, v, m, a);
  };

  const setAndPush = (v: number) => {
    const c = clampVol(v);
    setState("volumeBoost", c);
    if (sliderRef) sliderRef.value = String(Math.round(volToPos(c)));
    push(c);
  };

  const handleSlider = () => {
    if (!sliderRef) return;
    const v = clampVol(posToVol(Number(sliderRef.value)));
    setState("volumeBoost", v);
    push(v);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 10 : -10;
    setAndPush(clampVol(state.volumeBoost + delta));
  };

  const doReset = () => {
    setState({ volumeBoost: 100, volumeBoostMode: "generic", volumeBoostAuto: false });
    if (sliderRef) sliderRef.value = String(Math.round(volToPos(100)));
    const el = props.videoRef();
    if (el) resetBoost(el);
  };

  const switchMode = (m: Mode) => {
    setState("volumeBoostMode", m);
    push(state.volumeBoost, m);
  };

  const toggleAuto = () => {
    const next = !state.volumeBoostAuto;
    setState("volumeBoostAuto", next);
    push(state.volumeBoost, state.volumeBoostMode, next);
  };

  return (
    <div
      class="vb-panel"
      style={`--vb-pct: ${pct()}; --vb-fill: ${fill()}; max-height: ${avH()}px`}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={handleWheel}
    >
      <div class="vb-aurora" />

      <div class="vb-header">
        <span class="vb-title">Volume Booster</span>
        <div class="vb-header-actions">
          <button class="vb-reset-btn" title="Reset to 100%" onClick={doReset}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
              <path d="M20 11A8 8 0 1 0 17.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M20 4v7h-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <button class="close-settings" onClick={() => setState("showVolumeBooster", false)}>
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      <Show when={showDial()}>
        <div class="vb-dial">
          <div class="vb-rings">
            <span class="vb-ring" />
            <span class="vb-ring" />
            <span class="vb-ring" />
          </div>
          <div class="vb-readout">
            <span class="vb-value">{state.volumeBoost}</span>
            <span class="vb-pct-label">%</span>
          </div>
          <div class="vb-badge" classList={{ show: state.volumeBoost > 100 }}>BOOSTED</div>
        </div>
      </Show>

      <Show when={showMode()}>
        <div class="vb-mode-group">
          <button class="vb-mode-btn" classList={{ active: state.volumeBoostMode === "generic" }} onClick={() => switchMode("generic")}>
            Generic
          </button>
          <button class="vb-mode-btn" classList={{ active: state.volumeBoostMode === "voice" }} onClick={() => switchMode("voice")}>
            <svg class="vb-mode-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M12 17v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            Voice
          </button>
          <button class="vb-mode-btn" classList={{ active: state.volumeBoostMode === "bass" }} onClick={() => switchMode("bass")}>
            <svg class="vb-mode-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <rect x="4" y="9" width="3" height="6" rx="1.5" fill="currentColor" />
              <rect x="10.5" y="5" width="3" height="14" rx="1.5" fill="currentColor" />
              <rect x="17" y="10" width="3" height="4" rx="1.5" fill="currentColor" />
            </svg>
            Bass
          </button>
        </div>
      </Show>

      <div class="vb-slider-row">
        <button class="vb-vol-icon" title="Mute (0%)" onClick={() => setAndPush(0)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
            <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
        <div class="vb-slider-wrap">
          <input
            ref={sliderRef}
            class="vb-slider"
            type="range"
            min="0"
            max={POS_MAX}
            step="1"
            value={Math.round(volToPos(state.volumeBoost))}
            onInput={handleSlider}
          />
          <div class="vb-ticks">
            <For each={TICKS}>{(t) => (
              <span
                class={`vb-tick${t.roundBorder ? " vb-tick-border" : ""}`}
                style={`left: calc(10px + ${(volToPos(t.v) / POS_MAX).toFixed(3)} * (100% - 20px)); transform: translateX(-50%)`}
                onClick={() => setAndPush(t.v)}
              >
                {t.label}
              </span>
            )}</For>
          </div>
        </div>
        <button class="vb-vol-icon vb-max-icon" title="Max (600%)" onClick={() => setAndPush(600)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
            <path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <Show when={showAuto()}>
        <div class="vb-auto-row">
          <button
            class="vb-auto-chip"
            classList={{ on: state.volumeBoostAuto }}
            role="switch"
            aria-checked={state.volumeBoostAuto ? "true" : "false"}
            onClick={toggleAuto}
          >
            <span class="vb-auto-label">Auto-level</span>
            <span class="vb-switch"><span class="vb-knob" /></span>
          </button>
        </div>
      </Show>
    </div>
  );
};
