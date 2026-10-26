import type { JSX } from "solid-js";

const Svg = (p: { children: JSX.Element; size?: number }) => (
  <svg
    width={p.size ?? 18}
    height={p.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {p.children}
  </svg>
);

export const IconPointer = () => (
  <Svg>
    <path d="M5 3l14 8-6 1.5L10 19z" />
  </Svg>
);
export const IconBox = () => (
  <Svg>
    <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
  </Svg>
);
export const IconDiamond = () => (
  <Svg>
    <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />
  </Svg>
);
export const IconNote = () => (
  <Svg>
    <path d="M5 4h14v11l-5 5H5z" />
    <path d="M14 20v-5h5" />
  </Svg>
);
export const IconPill = () => (
  <Svg>
    <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
  </Svg>
);
export const IconUndo = () => (
  <Svg>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </Svg>
);
export const IconRedo = () => (
  <Svg>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </Svg>
);
export const IconLayout = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-2h12v2" />
  </Svg>
);
export const IconExport = () => (
  <Svg>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
  </Svg>
);
export const IconTrash = () => (
  <Svg size={16}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const IconCopy = () => (
  <Svg size={16}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </Svg>
);
export const IconChevron = () => (
  <Svg size={14}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const IconPlus = () => (
  <Svg size={16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = () => (
  <Svg size={16}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconFit = () => (
  <Svg size={16}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconLabel = () => (
  <Svg size={16}>
    <path d="M4 7V5h16v2M12 5v14M9 19h6" />
  </Svg>
);
