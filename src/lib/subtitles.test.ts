import { describe, it, expect } from "vitest";
import type { SubCue } from "./store";
import { parseSrt, parseVtt, getActiveCues } from "./subtitles";

describe("parseSrt", () => {
  it("parses basic 2-cue SRT", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 2500, text: "Hello" });
    expect(cues[1]).toEqual({ startMs: 3000, endMs: 4000, text: "World" });
  });

  it("strips HTML tags", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\n<i>hello</i>";
    expect(parseSrt(srt)[0].text).toBe("hello");
  });

  it("joins multi-line cue text with newline", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nline one\nline two";
    expect(parseSrt(srt)[0].text).toBe("line one\nline two");
  });

  it("skips block with no timing line", () => {
    const srt =
      "just text no timing\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("World");
  });

  it("skips empty-text cue", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\n";
    expect(parseSrt(srt)).toHaveLength(0);
  });

  it("handles dot separator in srt", () => {
    const srt = "1\n00:00:01.000 --> 00:00:02.500\nHi";
    expect(parseSrt(srt)[0]).toEqual({ startMs: 1000, endMs: 2500, text: "Hi" });
  });
});

describe("parseVtt", () => {
  it("strips WEBVTT header, parses MM:SS.mmm form", () => {
    const vtt = "WEBVTT\n\n01:02.000 --> 01:04.000\nHello";
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ startMs: 62000, endMs: 64000, text: "Hello" });
  });

  it("parses HH:MM:SS.mmm form", () => {
    const vtt = "WEBVTT\n\n01:00:02.000 --> 01:00:04.000\nHi";
    expect(parseVtt(vtt)[0]).toEqual({
      startMs: 3602000,
      endMs: 3604000,
      text: "Hi",
    });
  });

  it("strips tags", () => {
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000\n<b>bold</b>";
    expect(parseVtt(vtt)[0].text).toBe("bold");
  });
});

describe("getActiveCues", () => {
  const cues: SubCue[] = [{ startMs: 1000, endMs: 2000, text: "a" }];

  it("returns cue when time inside", () => {
    expect(getActiveCues(cues, 1500, 0)).toEqual(cues);
  });

  it("excludes before start", () => {
    expect(getActiveCues(cues, 500, 0)).toHaveLength(0);
  });

  it("excludes at exact endMs (end-exclusive)", () => {
    expect(getActiveCues(cues, 2000, 0)).toHaveLength(0);
  });

  it("includes at exact startMs", () => {
    expect(getActiveCues(cues, 1000, 0)).toEqual(cues);
  });

  it("positive offset shifts window", () => {
    expect(getActiveCues(cues, 500, 600)).toEqual(cues);
  });

  it("negative offset shifts window", () => {
    expect(getActiveCues(cues, 2500, -600)).toEqual(cues);
  });

  it("returns multiple overlapping cues", () => {
    const overlap: SubCue[] = [
      { startMs: 1000, endMs: 3000, text: "a" },
      { startMs: 2000, endMs: 4000, text: "b" },
    ];
    expect(getActiveCues(overlap, 2500, 0)).toHaveLength(2);
  });
});
