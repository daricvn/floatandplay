import { describe, it, expect } from "vitest";
import { getListId, getVideoId, buildWatchUrl } from "./url";

describe("getListId", () => {
  it("extracts list from watch url", () => {
    expect(getListId("https://www.youtube.com/watch?v=abc&list=PL123")).toBe("PL123");
  });
  it("extracts list from playlist url", () => {
    expect(getListId("https://www.youtube.com/playlist?list=PL456")).toBe("PL456");
  });
  it("returns null when no list param", () => {
    expect(getListId("https://www.youtube.com/watch?v=abc")).toBeNull();
  });
  it("returns null for invalid url", () => {
    expect(getListId("not-a-url")).toBeNull();
  });
});

describe("getVideoId", () => {
  it("extracts v param from watch url", () => {
    expect(getVideoId("https://www.youtube.com/watch?v=abc123")).toBe("abc123");
  });
  it("extracts id from youtu.be", () => {
    expect(getVideoId("https://youtu.be/abc123")).toBe("abc123");
  });
  it("extracts id from shorts", () => {
    expect(getVideoId("https://www.youtube.com/shorts/abc123")).toBe("abc123");
  });
  it("returns null when no video id", () => {
    expect(getVideoId("https://www.youtube.com/playlist?list=PL1")).toBeNull();
  });
});

describe("buildWatchUrl", () => {
  it("builds url with list", () => {
    expect(buildWatchUrl("abc", "PL1")).toBe("https://www.youtube.com/watch?v=abc&list=PL1");
  });
  it("builds url without list", () => {
    expect(buildWatchUrl("abc", null)).toBe("https://www.youtube.com/watch?v=abc");
  });
});
