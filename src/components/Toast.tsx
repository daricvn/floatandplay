import { Component, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { CloseIcon } from "./Icons";

const [toastMsg, setToastMsg] = createSignal("");
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(msg: string, durationMs = 2200) {
  if (dismissTimer) clearTimeout(dismissTimer);
  setToastMsg(msg);
  dismissTimer = setTimeout(() => setToastMsg(""), durationMs);
}

export const Toast: Component = () => (
  <Show when={toastMsg()}>
    <div class="toast">{toastMsg()}</div>
  </Show>
);

interface Props {
  title: string;
  setTitle: (title: string) => void;
  autoDismiss?: number;
}

export const Notice: Component<Props> = (props: Props) => {
  const dismissNotice = () => {
    props.setTitle("");
  };

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(
    on(
      () => props.title,
      (title) => {
        if (noticeTimer) clearTimeout(noticeTimer);
        if (title && props.autoDismiss) {
          noticeTimer = setTimeout(() => props.setTitle(""), props.autoDismiss);
        }
      },
    ),
  );
  onCleanup(() => {
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  return (
    <div class="notice" classList={{ "notice--visible": !!props.title }}>
      <div class="notice__body">
        <span class="notice__label">Now playing</span>
        <span class="notice__title">{props.title}</span>
      </div>
      <button
        class="notice__close"
        onClick={dismissNotice}
        aria-label="Dismiss"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
};
