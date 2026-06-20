import { vi, describe, it, expect, beforeEach } from "vitest";

const startDragging = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const onOpenUrl = vi.fn();
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: (cb: (urls: string[]) => void) => {
    onOpenUrl(cb);
    return () => {};
  },
}));

import { startWindowDrag, onDeepLink } from "./ipc";

describe("startWindowDrag", () => {
  beforeEach(() => startDragging.mockClear());

  it("starts drag for plain DIV, button 0", () => {
    const el = document.createElement("div");
    startWindowDrag({ button: 0, target: el } as unknown as MouseEvent);
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("ignores non-left button", () => {
    const el = document.createElement("div");
    startWindowDrag({ button: 2, target: el } as unknown as MouseEvent);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("ignores BUTTON target", () => {
    const el = document.createElement("button");
    startWindowDrag({ button: 0, target: el } as unknown as MouseEvent);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("ignores target nested in INPUT ancestor", () => {
    const input = document.createElement("input");
    const child = document.createElement("span");
    input.appendChild(child);
    startWindowDrag({ button: 0, target: child } as unknown as MouseEvent);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("ignores element with dataset.tauriNoDrag", () => {
    const el = document.createElement("div");
    el.dataset.tauriNoDrag = "";
    startWindowDrag({ button: 0, target: el } as unknown as MouseEvent);
    expect(startDragging).not.toHaveBeenCalled();
  });
});

describe("onDeepLink", () => {
  beforeEach(() => onOpenUrl.mockClear());

  async function register(cb: (...args: unknown[]) => void) {
    await onDeepLink(cb as never);
    return onOpenUrl.mock.calls[0][0] as (urls: string[]) => void;
  }

  it("parses valid deep link", async () => {
    const cb = vi.fn();
    const handler = await register(cb);
    const video = encodeURIComponent("https://example.com/v.mp4");
    handler([`floatpip://open?url=${video}&subtitleLang=en&startTime=12.5`]);
    expect(cb).toHaveBeenCalledWith("https://example.com/v.mp4", "en", 12.5);
  });

  it("ignores missing url param", async () => {
    const cb = vi.fn();
    const handler = await register(cb);
    handler(["floatpip://open?subtitleLang=en"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores malformed url without throwing", async () => {
    const cb = vi.fn();
    const handler = await register(cb);
    expect(() => handler(["not a url::"])).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("defaults missing startTime and subtitleLang to null", async () => {
    const cb = vi.fn();
    const handler = await register(cb);
    const video = encodeURIComponent("https://example.com/v.mp4");
    handler([`floatpip://open?url=${video}`]);
    expect(cb).toHaveBeenCalledWith("https://example.com/v.mp4", null, null);
  });

  it("decodes region lang subtitleLang", async () => {
    const cb = vi.fn();
    const handler = await register(cb);
    const video = encodeURIComponent("https://example.com/v.mp4");
    handler([`floatpip://open?url=${video}&subtitleLang=en-US`]);
    expect(cb).toHaveBeenCalledWith("https://example.com/v.mp4", "en-US", null);
  });
});
