import { createStore } from "solid-js/store";

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
}

export interface SubTrack {
  lang: string;
  label: string;
  url: string;
  ext: string;
}

export interface StreamInfo {
  title: string;
  duration: number | null;
  is_live: boolean;
  video_url: string;
  audio_url: string | null;
  subtitles: SubTrack[];
  http_headers: Record<string, string>;
  thumbnail: string | null;
}

export interface SubCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleStyle {
  fontSize: number;
  color: string;
  background: string;
  position: "bottom" | "top";
}

export interface AppState {
  pageUrl: string;
  loading: boolean;
  videoLoading: boolean;
  error: string | null;
  stream: StreamInfo | null;
  proxyVideoUrl: string | null;

  subtitleTracks: SubTrack[];
  activeSubTrack: number;
  subtitleCues: SubCue[];
  subtitleOffset: number;
  subtitleStyle: SubtitleStyle;
  currentCues: SubCue[];

  clickThrough: boolean;
  alwaysOnTop: boolean;
  opacity: number;

  showSettings: boolean;
  showVolumeBooster: boolean;
  showPlaylist: boolean;

  playlist: PlaylistEntry[];
  playlistId: string | null;
  playlistTitle: string | null;
  playlistIndex: number;

  volumeBoost: number;
  volumeBoostMode: "generic" | "voice" | "bass";
  volumeBoostAuto: boolean;
}

export const [state, setState] = createStore<AppState>({
  pageUrl: "",
  loading: false,
  videoLoading: false,
  error: null,
  stream: null,
  proxyVideoUrl: null,

  subtitleTracks: [],
  activeSubTrack: -1,
  subtitleCues: [],
  subtitleOffset: 0,
  subtitleStyle: {
    fontSize: 16,
    color: "#ffffff",
    background: "rgba(0,0,0,0.3)",
    position: "bottom",
  },
  currentCues: [],

  clickThrough: false,
  alwaysOnTop: true,
  opacity: 1,

  showSettings: false,
  showVolumeBooster: false,
  showPlaylist: false,

  playlist: [],
  playlistId: null,
  playlistTitle: null,
  playlistIndex: -1,

  volumeBoost: 100,
  volumeBoostMode: "generic",
  volumeBoostAuto: false,
});
