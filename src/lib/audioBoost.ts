type Mode = "generic" | "voice" | "bass";

const BANDS: Partial<Record<Mode, { type: BiquadFilterType; frequency: number; Q: number }>> = {
  voice: { type: "peaking", frequency: 2000, Q: 1.0 },
  bass: { type: "lowshelf", frequency: 200, Q: 0.7 },
};

const COMP_CFG = { threshold: -28, knee: 30, ratio: 12, attack: 0.003, release: 0.25 };
const MAKEUP_GAIN = 1.8;

let ctx: AudioContext | null = null;
let filterNode: BiquadFilterNode | null = null;
let gainNode: GainNode | null = null;
let compNode: DynamicsCompressorNode | null = null;
let makeupNode: GainNode | null = null;
let wiredEl: HTMLVideoElement | null = null;
let autoRouted: boolean | null = null;

function clampGain(volume: number): number {
  return Math.max(0, Math.min(6, volume / 100));
}

function volToDb(volume: number): number {
  return Math.max(-60, Math.min(20, 20 * Math.log10(Math.max(1, volume) / 100)));
}

function wire(el: HTMLVideoElement): boolean {
  if (wiredEl === el && ctx) return true;
  if (ctx) {
    try { ctx.close(); } catch (_) {}
    ctx = null; filterNode = null; gainNode = null;
    compNode = null; makeupNode = null; wiredEl = null; autoRouted = null;
  }
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    filterNode = ctx.createBiquadFilter();
    gainNode = ctx.createGain();
    compNode = ctx.createDynamicsCompressor();
    makeupNode = ctx.createGain();
    compNode.threshold.value = COMP_CFG.threshold;
    compNode.knee.value = COMP_CFG.knee;
    compNode.ratio.value = COMP_CFG.ratio;
    compNode.attack.value = COMP_CFG.attack;
    compNode.release.value = COMP_CFG.release;
    makeupNode.gain.value = MAKEUP_GAIN;
    src.connect(filterNode);
    filterNode.connect(gainNode);
    wiredEl = el;
    return true;
  } catch (_) {
    return false;
  }
}

function routeAuto(auto: boolean): void {
  if (!ctx || !gainNode || !compNode || !makeupNode) return;
  if (autoRouted === auto) return;
  try { gainNode.disconnect(); compNode.disconnect(); makeupNode.disconnect(); } catch (_) {}
  if (auto) {
    gainNode.connect(compNode);
    compNode.connect(makeupNode);
    makeupNode.connect(ctx.destination);
  } else {
    gainNode.connect(ctx.destination);
  }
  autoRouted = auto;
}

export function applyBoost(el: HTMLVideoElement, volume: number, mode: Mode, auto: boolean): boolean {
  if (!wire(el) || !ctx || !filterNode || !gainNode) return false;
  routeAuto(auto);
  const now = ctx.currentTime;
  const ramp = (param: AudioParam, val: number) => {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(val, now + 0.05);
  };
  const band = BANDS[mode];
  if (band) {
    filterNode.type = band.type;
    filterNode.frequency.setValueAtTime(band.frequency, now);
    filterNode.Q.setValueAtTime(band.Q, now);
    ramp(filterNode.gain, volToDb(volume));
    ramp(gainNode.gain, volume === 0 ? 0 : 1);
  } else {
    filterNode.type = "peaking";
    filterNode.frequency.setValueAtTime(1000, now);
    filterNode.gain.setValueAtTime(0, now);
    ramp(gainNode.gain, clampGain(volume));
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return true;
}

export function resetBoost(el: HTMLVideoElement): void {
  applyBoost(el, 100, "generic", false);
}
