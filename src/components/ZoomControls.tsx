import { fitView, resetZoom, zoomBy } from "../lib/camera";
import { board } from "../lib/store";
import { IconFit, IconMinus, IconPlus } from "./icons";

export function ZoomControls() {
  return (
    <div class="zoom panel">
      <button class="icon-btn" title="Zoom out (-)" onClick={() => zoomBy(1 / 1.2)}>
        <IconMinus />
      </button>
      <button class="zoom-value" title="Reset to 100% (0)" onClick={resetZoom}>
        {Math.round(board.camera.zoom * 100)}%
      </button>
      <button class="icon-btn" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
        <IconPlus />
      </button>
      <span class="divider" />
      <button class="icon-btn" title="Zoom to fit (Shift+1)" onClick={() => fitView()}>
        <IconFit />
      </button>
    </div>
  );
}
