// Swimlanes: lanes of a pool, and resizing nodes (a pool resizes its last lane).

import { produce } from "solid-js/store";
import type { Lane } from "../types";
import { checkpoint } from "./history";
import { LANE_SIZE, MIN_LANE, uid } from "./nodes";
import { nodeById, setBoard, touch } from "./state";

export function resizeNode(id: string, w: number, h: number) {
  const n = nodeById(id);
  // A fragment's parts are rows: it resizes as any block (its last part takes the change)
  if (!n?.lanes?.length || n.kind === "fragment") {
    setBoard("nodes", (x) => x.id === id, { w, h });
  } else {
    // Swimlanes: the width comes from the lanes, so resizing changes the rightmost lane
    const others = laneTotal(n.lanes) - n.lanes[n.lanes.length - 1].size;
    setLanes(id, (lanes) => (lanes[lanes.length - 1].size = Math.max(MIN_LANE, w - others)));
    setBoard("nodes", (x) => x.id === id, "h", h);
  }
  touch();
}

// ---------- swimlanes ----------

const laneTotal = (lanes: Lane[]) => lanes.reduce((s, l) => s + l.size, 0);

/** Changes the lanes of a node and keeps its width equal to their total. */
function setLanes(id: string, fn: (lanes: Lane[]) => void) {
  setBoard(
    "nodes",
    (n) => n.id === id,
    produce((n) => {
      n.lanes ??= [];
      fn(n.lanes);
      n.w = laneTotal(n.lanes);
    }),
  );
}

export function addLane(id: string) {
  checkpoint();
  setLanes(id, (lanes) => lanes.push({ id: uid(), title: "", size: lanes[lanes.length - 1]?.size ?? LANE_SIZE }));
  touch();
}

export function removeLane(id: string, laneId: string) {
  if ((nodeById(id)?.lanes?.length ?? 0) < 2) return;
  checkpoint();
  setLanes(id, (lanes) => lanes.splice(lanes.findIndex((l) => l.id === laneId), 1));
  touch();
}

export function setLaneTitle(id: string, laneId: string, title: string) {
  const lane = nodeById(id)?.lanes?.find((l) => l.id === laneId);
  if (!lane || lane.title === title) return;
  checkpoint();
  setLanes(id, (lanes) => (lanes.find((l) => l.id === laneId)!.title = title));
  touch();
}

export function resizeLane(id: string, index: number, size: number) {
  setLanes(id, (lanes) => (lanes[index].size = Math.max(MIN_LANE, size)));
  touch();
}
