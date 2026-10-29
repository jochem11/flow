import type { JSX } from "solid-js";
import type { EdgeCap, KanbanIcon, NodeKind } from "../lib/types";
import { CAP_PATHS } from "./Edges";

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
export const IconStart = () => (
  <Svg>
    <circle cx="12" cy="12" r="6.5" fill="currentColor" />
  </Svg>
);
export const IconEnd = () => (
  <Svg>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </Svg>
);
export const IconSection = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="15" rx="2" stroke-dasharray="3 2.5" />
    <path d="M6.5 8.5h6" />
  </Svg>
);
export const IconLanes = () => (
  <Svg>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <path d="M3 9h18M12 9v10.5" />
  </Svg>
);
// ---------- UML shapes (toolbar panel) ----------

export const IconUml = () => (
  <Svg>
    <circle cx="7.5" cy="6.5" r="3" />
    <rect x="13" y="3.5" width="8" height="6" rx="1" />
    <path d="M3 14.5h8M7 14.5v6M16.5 13.5l4 4-4 4-4-4z" />
  </Svg>
);
const UmlSvg = (p: { children: JSX.Element }) => <Svg size={20}>{p.children}</Svg>;

export const UML_ICONS: Partial<Record<NodeKind, () => JSX.Element>> = {
  bar: () => (
    <UmlSvg>
      <rect x="3" y="10" width="18" height="4" rx="1" fill="currentColor" />
    </UmlSvg>
  ),
  flowfinal: () => (
    <UmlSvg>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </UmlSvg>
  ),
  object: () => (
    <UmlSvg>
      <rect x="3.5" y="7" width="17" height="10" />
    </UmlSvg>
  ),
  pin: () => (
    <UmlSvg>
      <rect x="3.5" y="7" width="13" height="10" rx="1.5" />
      <rect x="14" y="10" width="5" height="5" fill="currentColor" />
    </UmlSvg>
  ),
  sendsignal: () => (
    <UmlSvg>
      <path d="M3.5 7h13l4 5-4 5h-13z" />
    </UmlSvg>
  ),
  receivesignal: () => (
    <UmlSvg>
      <path d="M3.5 7h17v10h-17l4-5z" />
    </UmlSvg>
  ),
  timeevent: () => (
    <UmlSvg>
      <path d="M6 3.5h12L6 20.5h12z" />
    </UmlSvg>
  ),
  circle: () => (
    <UmlSvg>
      <circle cx="12" cy="12" r="7" />
      <path d="M10 15.5V8.5M14 15.5V8.5M10 12h4" />
    </UmlSvg>
  ),
  comment: () => (
    <UmlSvg>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M16 4v4h4" />
    </UmlSvg>
  ),
  actor: () => (
    <UmlSvg>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5v7M6.5 10.5h11M12 14.5l-4 6M12 14.5l4 6" />
    </UmlSvg>
  ),
  usecase: () => (
    <UmlSvg>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" />
    </UmlSvg>
  ),
  boundary: () => (
    <UmlSvg>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
      <path d="M8 7.5h8" />
    </UmlSvg>
  ),
  class: () => (
    <UmlSvg>
      <rect x="4" y="3.5" width="16" height="17" rx="1" />
      <path d="M4 8.5h16M4 14h16" />
    </UmlSvg>
  ),
  package: () => (
    <UmlSvg>
      <path d="M3.5 8.5V5h7v3.5M3.5 8.5h17v11h-17z" />
    </UmlSvg>
  ),
  lifeline: () => (
    <UmlSvg>
      <rect x="6" y="2.5" width="12" height="6" rx="1" />
      <path d="M12 8.5v13" stroke-dasharray="2 2" />
    </UmlSvg>
  ),
  activation: () => (
    <UmlSvg>
      <path d="M12 2v4M12 18v4" stroke-dasharray="2 2" />
      <rect x="9.5" y="6" width="5" height="12" />
    </UmlSvg>
  ),
  fragment: () => (
    <UmlSvg>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 9h6l2-2V4" />
    </UmlSvg>
  ),
  destroy: () => (
    <UmlSvg>
      <path d="M6 6l12 12M18 6L6 18" stroke-width="2.4" />
    </UmlSvg>
  ),
};

export const IconCode = () => (
  <Svg size={16}>
    <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15" />
  </Svg>
);
export const IconLine = () => (
  <Svg>
    <path d="M5 19L18 6" />
    <path d="M11 6h7v7" />
  </Svg>
);
export const IconCurved = () => (
  <Svg size={16}>
    <path d="M4 19C12 19 12 5 20 5" />
  </Svg>
);
export const IconStraight = () => (
  <Svg size={16}>
    <path d="M4 19L20 5" />
  </Svg>
);
export const IconElbow = () => (
  <Svg size={16}>
    <path d="M4 19h8V5h8" />
  </Svg>
);
/** What sits at one end of a connector: nothing, an arrowhead or a dot. */
export const IconCap = (p: { cap: EdgeCap; side: "start" | "end" }) => (
  <Svg size={16}>
    <g transform={p.side === "start" ? "rotate(180 12 12)" : undefined}>
      <path d="M3 12h17" />
      {p.cap === "dot" && <circle cx="18" cy="12" r="3" fill="currentColor" />}
      {p.cap !== "dot" && p.cap !== "none" && (
        <path
          d={CAP_PATHS[p.cap]}
          transform="translate(21 12) scale(0.75)"
          stroke-width="2.2"
          fill={p.cap === "arrow" || p.cap === "diamond" ? "currentColor" : p.cap === "open" ? "none" : "var(--panel)"}
        />
      )}
    </g>
  </Svg>
);
/** Small texts at both ends of a line, like "1" and "0..*". */
export const IconEndLabels = () => (
  <Svg size={16}>
    <path d="M3 15h18" />
    <path d="M4.5 6.5l1.5-1v6" />
    <path d="M15 11V7.5a1.5 1.5 0 013 0V11M18 9h3" />
  </Svg>
);
export const IconPattern = (p: { pattern: "solid" | "dashed" | "dotted" }) => (
  <Svg size={16}>
    <path
      d="M3 12h18"
      stroke-width={p.pattern === "dotted" ? 2.6 : 1.8}
      stroke-dasharray={p.pattern === "dashed" ? "4.5 3.5" : p.pattern === "dotted" ? "0 4.5" : undefined}
    />
  </Svg>
);
/** A line with a block of text on it, above it or below it. */
export const IconLabelSide = (p: { side: "on" | "above" | "below" }) => (
  <Svg size={16}>
    <path d="M2 14h20" />
    <rect x="7" y={p.side === "above" ? 4 : p.side === "below" ? 17 : 12.5} width="10" height="3" rx="1" fill="currentColor" />
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
/** An arrow into a tray: the opposite of IconExport */
export const IconImport = () => (
  <Svg>
    <path d="M12 3v12M7 10l5 5 5-5" />
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

// ---------- sidebar & document kinds ----------

export const IconChevronRight = () => (
  <Svg size={14}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconFolder = () => (
  <Svg size={16}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </Svg>
);
export const IconProject = () => (
  <Svg size={16}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 9h18" />
  </Svg>
);
export const IconFlow = () => (
  <Svg size={16}>
    <rect x="3" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="16" width="7" height="5" rx="1.5" />
    <path d="M6.5 8v5.5a2 2 0 002 2H14" />
  </Svg>
);
export const IconText = () => (
  <Svg size={16}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Svg>
);
export const IconKanban = () => (
  <Svg size={16}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="10" rx="1.5" />
    <rect x="17" y="4" width="4" height="13" rx="1.5" />
  </Svg>
);
export const IconEer = () => (
  <Svg size={16}>
    <rect x="3" y="4" width="8" height="10" rx="1.5" />
    <path d="M3 8h8" />
    <rect x="15" y="10" width="6" height="10" rx="1.5" />
    <path d="M15 14h6M11 9h2v6h2" />
  </Svg>
);
export const IconNewFolder = () => (
  <Svg size={16}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <path d="M12 10v6M9 13h6" />
  </Svg>
);

// ---------- kanban ----------

export const IconMore = () => (
  <Svg size={16}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Svg>
);
export const IconClock = () => (
  <Svg size={13}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconComment = () => (
  <Svg size={13}>
    <path d="M4 5h16v11H9l-5 4z" />
  </Svg>
);
export const IconSubtasks = () => (
  <Svg size={13}>
    <path d="M5 4v12a2 2 0 002 2h4M5 9h6" />
    <rect x="13" y="6" width="7" height="6" rx="1.5" />
    <rect x="13" y="15" width="7" height="6" rx="1.5" />
  </Svg>
);
export const IconChecklist = () => (
  <Svg size={13}>
    <path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8" />
  </Svg>
);
export const IconClose = () => (
  <Svg size={16}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

/** Drawings for the `KanbanIcon` values from Rust; adding a variant there makes TypeScript ask for one here. */
export const KANBAN_ICONS: Record<KanbanIcon, { label: string; icon: () => JSX.Element }> = {
  bug: {
    label: "Bug",
    icon: () => (
      <Svg size={14}>
        <rect x="7" y="7" width="10" height="13" rx="5" />
        <path d="M12 11v9M7 12H3M21 12h-4M7 17l-3 2M17 17l3 2M8 8L5 5M16 8l3-3M9.5 7a2.5 2.5 0 015 0" />
      </Svg>
    ),
  },
  feature: {
    label: "Feature",
    icon: () => (
      <Svg size={14}>
        <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z" />
      </Svg>
    ),
  },
  idea: {
    label: "Idea",
    icon: () => (
      <Svg size={14}>
        <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z" />
      </Svg>
    ),
  },
  design: {
    label: "Design",
    icon: () => (
      <Svg size={14}>
        <path d="M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.6 0-1-.8-1.4-.8-2.4 0-1 .8-1.5 1.8-1.5H17a4 4 0 004-4c0-4.7-4-8.5-9-8.5z" />
        <circle cx="7.5" cy="11" r="1" />
        <circle cx="10.5" cy="7" r="1" />
        <circle cx="15" cy="7.5" r="1" />
      </Svg>
    ),
  },
  research: {
    label: "Research",
    icon: () => (
      <Svg size={14}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5L21 21" />
      </Svg>
    ),
  },
  docs: {
    label: "Docs",
    icon: () => (
      <Svg size={14}>
        <path d="M4 5a2 2 0 012-2h5v18H6a2 2 0 01-2-2zM20 5a2 2 0 00-2-2h-5v18h5a2 2 0 002-2z" />
      </Svg>
    ),
  },
  test: {
    label: "Test",
    icon: () => (
      <Svg size={14}>
        <path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3M7 15h10" />
      </Svg>
    ),
  },
  deploy: {
    label: "Deploy",
    icon: () => (
      <Svg size={14}>
        <path d="M12 15l-3-3c1.5-5 5-8.5 11-9-0.5 6-4 9.5-9 11zM9 12H5l2-4h4M12 15v4l4-2v-4M5.5 16.5C4 18 4 20 4 20s2 0 3.5-1.5" />
      </Svg>
    ),
  },
  star: {
    label: "Important",
    icon: () => (
      <Svg size={14}>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5" />
      </Svg>
    ),
  },
  flag: {
    label: "Flag",
    icon: () => (
      <Svg size={14}>
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </Svg>
    ),
  },
};

export const KANBAN_ICON_KEYS = Object.keys(KANBAN_ICONS) as KanbanIcon[];

export const IconCheck = () => (
  <Svg size={14}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
);
export const IconStop = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" />
  </svg>
);
