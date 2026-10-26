import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };

let next = 1;

export function toast(text: string, kind: Toast["kind"] = "info") {
  const id = next++;
  setToasts((t) => [...t, { id, text, kind }].slice(-4));
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3000);
}

export function dismiss(id: number) {
  setToasts((t) => t.filter((x) => x.id !== id));
}
