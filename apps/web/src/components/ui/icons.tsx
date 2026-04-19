/**
 * Inline SVG icon set — kept minimal so we don't ship a dependency.
 * All icons inherit currentColor and accept any SVGProps.
 */
import type { ReactElement, SVGProps } from "react";

type Icon = (_props: SVGProps<SVGSVGElement>) => ReactElement;

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

export const LeafIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M11 20A7 7 0 0 1 4 13c0-7 7-9 16-9 0 9-2 16-9 16Z" />
    <path d="M2 21c2-4 6-9 16-12" />
  </svg>
);

export const ScopeIcon: Icon = (props) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const TrendIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M14 7h7v7" />
  </svg>
);

export const ChatIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />
  </svg>
);

export const BellIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
);

export const HomeIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v10h14V10" />
  </svg>
);

export const SettingsIcon: Icon = (props) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const SunIcon: Icon = (props) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

export const SystemIcon: Icon = (props) => (
  <svg {...base(props)}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export const PlusIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowRightIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

export const ArrowLeftIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M19 12H5M11 5l-7 7 7 7" />
  </svg>
);

export const SparklesIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
    <path d="M5 18l.7 1.8L7.5 20l-1.8.7L5 22.5 4.3 20.7 2.5 20l1.8-.7Z" />
  </svg>
);

export const UploadIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8 12 3 7 8M12 3v12" />
  </svg>
);

export const CheckCircleIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
    <path d="m9 11 3 3L22 4" />
  </svg>
);

export const ImageIcon: Icon = (props) => (
  <svg {...base(props)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

export const MenuIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const CloseIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const SendIcon: Icon = (props) => (
  <svg {...base(props)}>
    <path d="M22 2 11 13" />
    <path d="m22 2-7 20-4-9-9-4Z" />
  </svg>
);
