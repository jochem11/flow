import { createMemo, For, onCleanup, onMount } from "solid-js";
import { panBy, setViewport, toWorld, zoomAt } from "../lib/camera";
import { beginLine, beginMarquee, beginPan, blurActive } from "../lib/interactions";
import { addNode, board, createNode, isContainer, setUi, ui } from "../lib/store";
import { EdgeEnds, EdgeLabels, EdgesLayer } from "./Edges";
import { NodeView } from "./NodeView";
import { ContextBar } from "./ContextBar";

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
    if (ui.tool === "line") {
      beginLine(e);
      return;
    }
    if (ui.tool !== "select") {
      const w = toWorld(e.clientX, e.clientY);
      const node = createNode(ui.tool, w.x, w.y);
      addNode(node);
      setUi({ tool: "select", editingNode: node.id });
      return;
    }
    beginMarquee(e);
  };

  const onDblClick = (e: MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
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
      onDblClick={onDblClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="world" style={{ transform: worldTransform() }}>
        <For each={containers()}>{(n) => <NodeView node={n} />}</For>
      </div>
      <EdgesLayer />
      <div class="world" style={{ transform: worldTransform() }}>
        <EdgeLabels />
        <For each={blocks()}>{(n) => <NodeView node={n} />}</For>
        <EdgeEnds />
      </div>
      <ContextBar />
    </div>
  );
}
