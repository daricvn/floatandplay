import { Component } from "solid-js";

interface IconProps {
  size?: number;
}

const base = (size = 16) => ({
  width: `${size}px`,
  height: `${size}px`,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.6",
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
});

export const PlayIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
  </svg>
);

export const PauseIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
  </svg>
);

export const VolumeHighIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16.5 8.5a4.5 4.5 0 0 1 0 7" />
    <path d="M19 6a8 8 0 0 1 0 12" />
  </svg>
);

export const VolumeLowIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16.5 9.5a3.2 3.2 0 0 1 0 5" />
  </svg>
);

export const VolumeMuteIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="m17 9.5 4 5M21 9.5l-4 5" />
  </svg>
);

export const SettingsIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V20a1.8 1.8 0 1 1-3.6 0v-.07a1.5 1.5 0 0 0-1-1.37 1.5 1.5 0 0 0-1.65.3l-.05.05A1.8 1.8 0 1 1 4 16.35l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H2.9a1.8 1.8 0 0 1 0-3.6h.07a1.5 1.5 0 0 0 1.37-1 1.5 1.5 0 0 0-.3-1.65L4 7.45A1.8 1.8 0 1 1 6.55 4.9l.05.05a1.5 1.5 0 0 0 1.65.3H8.3a1.5 1.5 0 0 0 .9-1.37V3.8a1.8 1.8 0 0 1 3.6 0v.07a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.08a1.5 1.5 0 0 0 1.37.9h.13a1.8 1.8 0 0 1 0 3.6h-.07a1.5 1.5 0 0 0-1.37.9Z" />
  </svg>
);

export const MinimizeIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M6 12h12" />
  </svg>
);

export const CloseIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const GlobeIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </svg>
);

export const LogoIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)} fill="none">
    <rect x="3" y="5" width="18" height="14" rx="3.5" stroke-width="1.4" />
    <path d="M10 9.5v5l4-2.5-4-2.5Z" fill="currentColor" stroke="none" />
  </svg>
);

export const ArrowIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const VolumeBoostIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)} fill="none">
    <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <circle cx="20" cy="4" r="3" fill="#ff5b8c" stroke="none" />
  </svg>
);

export const PrevIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M19 5v14M5 12l10-7v14L5 12Z" fill="currentColor" stroke="none" />
  </svg>
);

export const NextIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M5 5v14M19 12 9 5v14l10-7Z" fill="currentColor" stroke="none" />
  </svg>
);

export const PlaylistIcon: Component<IconProps> = (p) => (
  <svg {...base(p.size)}>
    <path d="M3 6h18M3 12h12M3 18h8" />
    <path d="M16 16l5-3-5-3v6Z" fill="currentColor" stroke="none" />
  </svg>
);
