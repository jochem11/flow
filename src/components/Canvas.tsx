import { FlowPresence, trackPointer as trackPresence } from "./Presence";
import { FlowCommentPins, PlacingOverlay } from "./Comments";
import { canEdit } from "../lib/access";
import { createMemo, For, onCleanup, onMount, Show } from "solid-js";
import { panBy, setPointer, setViewport, toWorld, zoomAt } from "../lib/camera";
import { beginLine, beginMarquee, beginPan, blurActive } from "../lib/interactions";
import { addNode, board, createNode, isContainer, select, setUi, ui } from "../lib/store";
import { EdgeEnds, EdgeLabels, EdgesLayer, MessagesLayer } from "./Edges";
import { FRAMES, NodeView } from "./NodeView";
import { addImages } from "../lib/files";
import { ContextBar } from "./ContextBar";

/** The strip at the top of a section where a double-click renames it */
const FRAME_HEADER = 48;

export function Canvas() {
  let el!: HTMLDivElement;

  onMount(() => {
    setViewport(el);
    // The wheel listener must be non-passive to prevent browser zoom/scroll
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        // A trackpad pinch arrives as ctrl+wheel
        const dy = Math.max(-25, Math.min(25, e.deltaY * unit));
        zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.01));
      } else if (e.shiftKey && !e.deltaX) {
        panBy(-e.deltaY * unit, 0);
      } else {
        panBy(-e.deltaX * unit, -e.deltaY * unit);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    trackPresence(el, toWorld);
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  });

  const onPointerDown = (e: PointerEvent) => {
    blurActive();
    if (e.button === 1 || (e.button === 0 && ui.spaceDown)) {
      e.preventDefault();
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    // Viewing only: dragging the canvas moves it
    if (!canEdit()) {
      beginPan(e);
      return;
    }
    if (ui.tool === "line") {
      beginLine(e);
      return;
    }
    if (ui.tool !== "select") {
      // No focus change from the press itself: it would close the new block's text field at once
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      const node = createNode(ui.tool, w.x, w.y);
      addNode(node);
      setUi({ tool: "select", editingNode: node.id });
      return;
    }
    beginMarquee(e);
  };

  const onDblClick = (e: MouseEvent) => {
    if (!canEdit()) return;
    const w = toWorld(e.clientX, e.clientY);
    // In the strip along the top of a section (beside its title): rename it
    const frame = board.nodes
      .filter((n) => FRAMES.includes(n.kind) && w.x >= n.x && w.x <= n.x + n.w && w.y >= n.y && w.y <= n.y + FRAME_HEADER)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (frame) {
      select([frame.id]);
      setUi("editingNode", frame.id);
      return;
    }
    const node = createNode("box", w.x, w.y);
    addNode(node);
    setUi("editingNode", node.id);
  };

  // Sections and swimlanes go in a layer below the edges, the largest at the back
  const containers = createMemo(() =>
    board.nodes.filter((n) => isContainer(n.kind)).sort((a, b) => b.w * b.h - a.w * a.h),
  );
  const blocks = createMemo(() => board.nodes.filter((n) => !isContainer(n.kind)));

  const worldTransform = () =>
    `translate(${board.camera.x}px, ${board.camera.y}px) scale(${board.camera.zoom})`;

  const grid = () => {
    const c = board.camera;
    const size = 20 * c.zoom;
    return {
      "background-size": `${size}px ${size}px`,
      "background-position": `${c.x}px ${c.y}px`,
    };
  };

  return (
    <div
      ref={el}
      class="viewport"
      classList={{
        "tool-place": ui.tool !== "select",
        "can-pan": ui.spaceDown,
        panning: ui.panning,
        connecting: !!ui.connecting,
      }}
      style={grid()}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => setPointer(toWorld(e.clientX, e.clientY))}
      // Pictures dropped from the computer
      onDragOver={(e) => {
        if (canEdit() && e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!canEdit() || !files.length) return;
        e.preventDefault();
        void addImages(files, toWorld(e.clientX, e.clientY));
      }}
      onPointerLeave={() => setPointer(null)}
      onDblClick={onDblClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="world" style={{ transform: worldTransform() }}>
        <For each={containers()}>{(n) => <NodeView node={n} />}</For>
      </div>
      <EdgesLayer />
      <div class="world" style={{ transform: worldTransform() }}>
        <For each={blocks()}>{(n) => <NodeView node={n} />}</For>
      </div>
      {/* Messages above the lifelines, so stacked activation bars never hide their ends */}
      <MessagesLayer />
      {/*
        On top of everything: labels (never hidden), the ends of the selected line,
        comments and the others' cursors. A layer of its own, because each layer
        stacks by itself (its transform), so a z-index cannot lift things out of it.
      */}
      <div class="world" style={{ transform: worldTransform() }}>
        <EdgeLabels />
        <EdgeEnds />
        <FlowCommentPins />
        <FlowPresence />
      </div>
      <Show when={canEdit()}>
        <ContextBar />
      </Show>
      <PlacingOverlay kind="flow" />
    </div>
  );
}
