import { Component, createEffect, onMount } from "solid-js";
import { showToast } from "./Toast";

interface Props {
  src?: string;
  onTimeUpdate: (currentTimeMs: number) => void;
  onRef: (el: HTMLVideoElement) => void;
  onLoadingChange: (loading: boolean) => void;
  onReady?: () => void;
  onAspectRatio?: (ratio: number) => void;
  onEnded?: () => void;
  onError?: (code: number, message: string, currentTime: number) => void;
}

export const VideoPlayer: Component<Props> = (props) => {
  let videoEl!: HTMLVideoElement;

  onMount(() => {
    props.onRef(videoEl);
  });

  createEffect(() => {
    const src = props.src;
    if (src && videoEl) {
      props.onLoadingChange(true);
      videoEl.src = src;
      videoEl.load();
      videoEl.play().catch((e) => {
        // ignore autoplay-gesture rejection; surface real playback failures
        if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
          showToast(`Playback failed: ${e?.message ?? e}`);
        }
      });
    }
  });

  return (
    <video
      ref={videoEl}
      class="video"
      crossOrigin="anonymous"
      onTimeUpdate={() => props.onTimeUpdate(videoEl.currentTime * 1000)}
      onLoadedMetadata={() => {
        if (videoEl.videoWidth && videoEl.videoHeight) {
          props.onAspectRatio?.(videoEl.videoWidth / videoEl.videoHeight);
        }
      }}
      onCanPlay={() => { props.onLoadingChange(false); props.onReady?.(); }}
      onPlaying={() => props.onLoadingChange(false)}
      onWaiting={() => props.onLoadingChange(true)}
      onEnded={() => props.onEnded?.()}
      onError={() => {
        props.onLoadingChange(false);
        const err = videoEl.error;
        const code = err?.code ?? 0;
        const msg = err?.message ?? "";
        console.error("Video error", code, msg);
        props.onError?.(code, msg, videoEl.currentTime);
      }}
      preload="metadata"
    />
  );
};
