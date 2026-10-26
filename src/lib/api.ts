// Alle communicatie met Rust loopt via dit bestand.
// In de desktop-app (`npm run tauri dev`) gaat alles via de gegenereerde, getypte
// `commands` uit `src/bindings.ts`. Hernoem je een command of verander je een
// parameter in Rust, dan geeft TypeScript hier meteen een fout.
// In een gewone browser (`npm run dev`) valt het terug op localStorage, zodat je
// de frontend los kunt ontwikkelen.

import { commands } from "../bindings";
import type { Board, BoardMeta, ExportFormat, FlowEdge, FlowNode, Position } from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Api {
  listBoards(): Promise<BoardMeta[]>;
  loadBoard(id: string): Promise<Board>;
  saveBoard(board: Board): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  autoLayout(nodes: FlowNode[], edges: FlowEdge[]): Promise<Position[]>;
  /** Geeft het pad terug van het bestand dat Rust heeft weggeschreven */
  exportBoard(board: Board, format: ExportFormat): Promise<string>;
}

type CmdResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

/** Maakt van `{ status: "error" }` een gewone exception, zodat de rest van de app try/catch kan gebruiken. */
async function unwrap<T>(p: Promise<CmdResult<T>>): Promise<T> {
  const r = await p;
  if (r.status === "error") throw r.error;
  return r.data;
}

const tauriApi: Api = {
  listBoards: () => unwrap(commands.listBoards()),
  loadBoard: (id) => unwrap(commands.loadBoard(id)),
  saveBoard: async (board) => void (await unwrap(commands.saveBoard(board))),
  deleteBoard: async (id) => void (await unwrap(commands.deleteBoard(id))),
  autoLayout: (nodes, edges) => unwrap(commands.autoLayout(nodes, edges)),
  exportBoard: (board, format) => unwrap(commands.exportBoard(board, format)),
};

const KEY = "flowapp:board:";
const onlyInDesktop = (what: string) =>
  Promise.reject(`${what} draait in Rust. Start de app met \`npm run tauri dev\`.`);

const browserApi: Api = {
  async listBoards() {
    const out: BoardMeta[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(KEY)) continue;
      try {
        const b = JSON.parse(localStorage.getItem(k)!) as Board;
        out.push({ id: b.id, name: b.name, updatedAt: b.updatedAt ?? 0 });
      } catch {
        /* kapotte entry overslaan */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async loadBoard(id) {
    const raw = localStorage.getItem(KEY + id);
    if (!raw) throw `Bord ${id} niet gevonden`;
    return JSON.parse(raw);
  },
  async saveBoard(board) {
    localStorage.setItem(KEY + board.id, JSON.stringify({ ...board, updatedAt: Date.now() }));
  },
  async deleteBoard(id) {
    localStorage.removeItem(KEY + id);
  },
  autoLayout: () => onlyInDesktop("Auto-layout"),
  exportBoard: () => onlyInDesktop("Exporteren"),
};

export const api: Api = inTauri ? tauriApi : browserApi;

/** Tauri geeft `Err(String)` door als string; maak er altijd een leesbare tekst van. */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
