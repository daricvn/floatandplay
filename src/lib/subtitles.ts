import type { SubCue } from "./store";

function toMs(h: number, m: number, s: number, ms: number): number {
  return h * 3_600_000 + m * 60_000 + s * 1_000 + ms;
}

export function parseSrt(text: string): SubCue[] {
  const cues: SubCue[] = [];
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx < 0) continue;

    const match = lines[timingIdx].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!match) continue;

    const startMs = toMs(+match[1], +match[2], +match[3], +match[4]);
    const endMs = toMs(+match[5], +match[6], +match[7], +match[8]);
    const text = lines
      .slice(timingIdx + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (text) cues.push({ startMs, endMs, text });
  }

  return cues;
}

export function parseVtt(text: string): SubCue[] {
  const cues: SubCue[] = [];
  const body = text.replace(/^WEBVTT[^\n]*\n/, "").trim();
  const blocks = body.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx < 0) continue;

    // VTT allows MM:SS.mmm or HH:MM:SS.mmm
    const match = lines[timingIdx].match(
      /(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/
    );
    if (!match) continue;

    const startMs = toMs(+(match[1] ?? 0), +match[2], +match[3], +match[4]);
    const endMs = toMs(+(match[5] ?? 0), +match[6], +match[7], +match[8]);
    const text = lines
      .slice(timingIdx + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (text) cues.push({ startMs, endMs, text });
  }

  return cues;
}

export function getActiveCues(
  cues: SubCue[],
  currentTimeMs: number,
  offsetMs: number
): SubCue[] {
  const t = currentTimeMs + offsetMs;
  return cues.filter((c) => t >= c.startMs && t < c.endMs);
}

export async function fetchSubtitles(url: string): Promise<SubCue[]> {
  const resp = await fetch(url);
  const text = await resp.text();
  return text.startsWith("WEBVTT") ? parseVtt(text) : parseSrt(text);
}
