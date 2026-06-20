import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Notice } from "./Toast";

describe("Notice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows notice--visible class when title set, removes when cleared", () => {
    const [title, setTitle] = createSignal("Hello");
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(() => <Notice title={title()} setTitle={setTitle} />, root);

    const el = root.querySelector(".notice")!;
    expect(el.classList.contains("notice--visible")).toBe(true);

    setTitle("");
    expect(el.classList.contains("notice--visible")).toBe(false);
  });

  it("auto-dismisses after autoDismiss ms", () => {
    const [title, setTitle] = createSignal("Hello");
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(() => <Notice title={title()} setTitle={setTitle} autoDismiss={5000} />, root);

    expect(title()).toBe("Hello");
    vi.advanceTimersByTime(5000);
    expect(title()).toBe("");
  });

  it("close button click clears title", () => {
    const [title, setTitle] = createSignal("Hello");
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(() => <Notice title={title()} setTitle={setTitle} />, root);

    root.querySelector<HTMLButtonElement>(".notice__close")!.click();
    expect(title()).toBe("");
  });
});
