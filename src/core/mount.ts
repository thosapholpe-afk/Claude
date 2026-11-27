import { getBoard } from "./boards";
import { BB_ROWS, layoutBreadboard } from "./parts";
import type { BoardDef, BoardPin, PartInstance } from "./types";

const P = 2.54;
const snapP = (v: number) => Math.round(v / P) * P;

export interface MountPlan {
  ok: boolean;
  reason?: string;
  host?: { type: "breadboard" | "perfboard"; x: number; y: number; props: Record<string, number | string | boolean> };
  board?: { x: number; y: number };
  summary?: string;
}

/** Header pins (GPIO/power) as integer lattice coordinates relative to the first pin. */
function lattice(board: BoardDef) {
  const pins = board.pins.filter((p) => p.kind !== "nc");
  const p0 = pins.reduce((a, b) => (b.y < a.y - 0.01 || (Math.abs(b.y - a.y) < 0.01 && b.x < a.x) ? b : a));
  const cells: { pin: BoardPin; c: number; r: number }[] = [];
  for (const p of pins) {
    const c = (p.x - p0.x) / P;
    const r = (p.y - p0.y) / P;
    if (Math.abs(c - Math.round(c)) > 0.04 || Math.abs(r - Math.round(r)) > 0.04) return null;
    cells.push({ pin: p, c: Math.round(c), r: Math.round(r) });
  }
  return { p0, cells };
}

export function planMount(boardInst: PartInstance, kind: "breadboard" | "perfboard"): MountPlan {
  const board = getBoard(boardInst.type.slice(6));
  const lat = lattice(board);
  if (!lat) {
    return { ok: false, reason: `${board.short} headers are not on a 2.54 mm grid (the Uno's digital header has a 0.16″ gap) — it can't plug into ${kind === "breadboard" ? "a breadboard" : "a perfboard"}.` };
  }
  if (board.family === "avr") return { ok: false, reason: "The Uno R3 has female headers on top — wire it to the board instead, or stack a proto shield." };
  const minC = Math.min(...lat.cells.map((x) => x.c));
  const maxC = Math.max(...lat.cells.map((x) => x.c));
  const minR = Math.min(...lat.cells.map((x) => x.r));
  const maxR = Math.max(...lat.cells.map((x) => x.r));
  const spanR = maxR - minR;
  const nCols = maxC - minC + 1;

  if (kind === "breadboard") {
    const rowsUsed = [...new Set(lat.cells.map((x) => x.r))];
    if (rowsUsed.length !== 2) return { ok: false, reason: `${board.short} needs exactly two header rows to straddle a breadboard.` };
    // breadboard row y-index (with rails): a..e = 0..4, f..j = 7..11
    const yIdx = (i: number) => (i < 5 ? i : i + 2);
    let best = -1;
    let bestScore = -1;
    for (let r1 = 0; r1 < 5; r1++) {
      const target = yIdx(r1) + spanR;
      const r2 = [5, 6, 7, 8, 9].find((i) => yIdx(i) === target);
      if (r2 === undefined) continue;
      const score = Math.min(r1, 9 - r2);
      if (score > bestScore) {
        bestScore = score;
        best = r1;
      }
    }
    if (best < 0) return { ok: false, reason: `${board.short}'s header rows are ${spanR} holes apart — too ${spanR < 7 ? "close; both rows would land in the same connected strips" : "far apart for a breadboard"}.` };
    const r2 = [5, 6, 7, 8, 9].find((i) => yIdx(i) === yIdx(best) + spanR)!;
    const cols = Math.max(30, nCols + 4);
    const c0 = Math.floor((cols - nCols) / 2) + 1;
    const L = layoutBreadboard({ cols, rails: true });
    const hx = snapP(boardInst.x + lat.p0.x - P * (c0 + 1));
    const top = 4;
    const hy = snapP(boardInst.y + lat.p0.y - P * (top + yIdx(best)));
    return {
      ok: true,
      host: { type: "breadboard", x: hx, y: hy, props: { cols, rails: true } },
      board: { x: hx + P * (c0 + 1) - lat.p0.x - minC * P, y: hy + P * (top + yIdx(best)) - lat.p0.y - minR * P },
      summary: `${board.short} on a ${cols}-column breadboard: rows ${BB_ROWS[best]} and ${BB_ROWS[r2]}, columns ${c0}–${c0 + nCols - 1}`,
      ...(L.w ? {} : {}),
    };
  }

  const margin = 3;
  const cols = nCols + margin * 2;
  const rows = spanR + 1 + margin * 2;
  const hx = snapP(boardInst.x + lat.p0.x - P * (margin + 1));
  const hy = snapP(boardInst.y + lat.p0.y - P * (margin + 1));
  return {
    ok: true,
    host: { type: "perfboard", x: hx, y: hy, props: { cols, rows, kind: "perfboard", finish: "fr4" } },
    board: { x: hx + P * (margin + 1) - lat.p0.x - minC * P, y: hy + P * (margin + 1) - lat.p0.y - minR * P },
    summary: `${board.short} on a ${cols} × ${rows} perfboard`,
  };
}
