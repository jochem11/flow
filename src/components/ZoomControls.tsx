import { fitView, resetZoom, zoomBy } from "../lib/camera";
import { board } from "../lib/store";
import { IconFit, IconMinus, IconPlus } from "./icons";

export function ZoomControls() {
  return (
    <div class="zoom panel">
      <button class="icon-btn" title="Uitzoomen (-)" onClick={() => zoomBy(1 / 1.2)}>
        <IconMinus />
      </button>
      <button class="zoom-value" title="Terug naar 100% (0)" onClick={resetZoom}>
        {Math.round(board.camera.zoom * 100)}%
      </button>
      <button class="icon-btn" title="Inzoomen (+)" onClick={() => zoomBy(1.2)}>
        <IconPlus />
      </button>
      <span class="divider" />
      <button class="icon-btn" title="Alles in beeld (Shift+1)" onClick={() => fitView()}>
        <IconFit />
      </button>
    </div>
  );
}
