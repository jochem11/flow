import { For, onCleanup, onMount } from "solid-js";
import { panBy, setViewport, toWorld, zoomAt } from "../lib/camera";
import { beginMarquee, beginPan, blurActive } from "../lib/interactions";
import { addNode, board, createNode, setUi, ui } from "../lib/store";
import { EdgeLabels, EdgesLayer } from "./Edges";
import { NodeView } from "./NodeView";
import { ContextBar } from "./ContextBar";

export function Canvas() {
  let el!: HTMLDivElement;

  onMount(() => {
    setViewport(el);
    // wheel moet non-passive zijn om browser-zoom/scroll te voorkomen
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        // trackpad-pinch komt binnen als ctrl+wheel
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
      <EdgesLayer />
      <div
        class="world"
        style={{
          transform: `translate(${board.camera.x}px, ${board.camera.y}px) scale(${board.camera.zoom})`,
        }}
      >
        <EdgeLabels />
        <For each={board.nodes}>{(n) => <NodeView node={n} />}</For>
      </div>
      <ContextBar />
    </div>
  );
}
