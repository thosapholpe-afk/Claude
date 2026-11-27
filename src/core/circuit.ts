import { getBoard } from "./boards";
import { getPart, type PartDef } from "./parts";
import type { BoardDef, PartInstance, PartPin, Wire } from "./types";

export const BOARD_ID = "board";
export const isBoard = (inst: PartInstance) => inst.type.startsWith("board:");

export interface Footprint {
  w: number;
  h: number;
  pins: PartPin[];
  ties?: [string, string][];
}

export function boardAsPart(board: BoardDef): Footprint {
  return {
    w: board.width,
    h: board.height,
    pins: board.pins.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, role: p.kind === "gnd" ? "gnd" : p.kind === "power" ? "vcc" : "signal" })),
  };
}

const fpCache = new Map<string, Footprint>();
export function footprintOf(inst: PartInstance): Footprint | undefined {
  if (isBoard(inst)) {
    const id = inst.type.slice(6);
    let fp = fpCache.get(id);
    if (!fp) {
      fp = boardAsPart(getBoard(id));
      fpCache.set(id, fp);
    }
    return fp;
  }
  const def = getPart(inst.type);
  if (def?.layout) return def.layout(inst.props);
  return def;
}

export const isHost = (inst: PartInstance) => !!getPart(inst.type)?.host;

export function rotatePoint(dx: number, dy: number, rot: number) {
  switch (rot) {
    case 90:
      return { x: -dy, y: dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

export function pinWorld(inst: PartInstance, fp: Footprint, p: { x: number; y: number }) {
  const cx = fp.w / 2;
  const cy = fp.h / 2;
  const r = rotatePoint(p.x - cx, p.y - cy, inst.rot);
  return { x: inst.x + cx + r.x, y: inst.y + cy + r.y };
}

export function endpointPos(parts: PartInstance[], part: string, pinId: string) {
  const inst = parts.find((p) => p.id === part);
  if (!inst) return undefined;
  const fp = footprintOf(inst);
  const pin = fp?.pins.find((p) => p.id === pinId);
  if (!fp || !pin) return undefined;
  return pinWorld(inst, fp, pin);
}

/** Axis-aligned bounds of a (possibly rotated) instance. */
export function instBounds(inst: PartInstance) {
  const fp = footprintOf(inst);
  if (!fp) return { x: inst.x, y: inst.y, w: 10, h: 10 };
  const swap = inst.rot === 90 || inst.rot === 270;
  const w = swap ? fp.h : fp.w;
  const h = swap ? fp.w : fp.h;
  const cx = inst.x + fp.w / 2;
  const cy = inst.y + fp.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------
class DSU {
  parent: number[] = [];
  add() {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export interface Topology {
  key: string;
  nodeOf: Map<string, number>;
  members: string[][];
  count: number;
  ground: number;
  /** Implicit connections made by inserting pins into breadboard holes. */
  inserted: { part: string; pin: string; bb: string; hole: string }[];
}

export const epKey = (part: string, pin: string) => `${part}:${pin}`;

export function buildTopology(
  board: BoardDef,
  parts: PartInstance[],
  wires: Wire[],
  switches: Map<string, [string, string][]>,
): Topology {
  const dsu = new DSU();
  const idx = new Map<string, number>();
  const ensure = (k: string) => {
    let i = idx.get(k);
    if (i === undefined) {
      i = dsu.add();
      idx.set(k, i);
    }
    return i;
  };
  for (const inst of parts) {
    const fp = footprintOf(inst);
    if (!fp) continue;
    for (const p of fp.pins) ensure(epKey(inst.id, p.id));
  }
  // board internal ties
  const boardInst = parts.find(isBoard);
  if (boardInst) {
    const byClass = new Map<string, string[]>();
    for (const p of board.pins) {
      let cls: string | null = null;
      if (p.kind === "gnd") cls = "gnd";
      else if (p.kind === "power") cls = `pwr:${p.label}`;
      else if (p.gpio !== undefined) cls = `gpio:${p.gpio}`;
      if (!cls) continue;
      const arr = byClass.get(cls) ?? [];
      arr.push(p.id);
      byClass.set(cls, arr);
    }
    for (const ids of byClass.values()) for (let i = 1; i < ids.length; i++) dsu.union(ensure(epKey(boardInst.id, ids[0])), ensure(epKey(boardInst.id, ids[i])));
  }
  // part ties + switches
  for (const inst of parts) {
    if (isBoard(inst)) continue;
    const def = getPart(inst.type);
    const fpTies = def?.layout ? def.layout(inst.props).ties : def?.ties;
    for (const [a, b] of fpTies ?? []) dsu.union(ensure(epKey(inst.id, a)), ensure(epKey(inst.id, b)));
    for (const [a, b] of switches.get(inst.id) ?? []) dsu.union(ensure(epKey(inst.id, a)), ensure(epKey(inst.id, b)));
  }
  // wires
  for (const w of wires) {
    if (!idx.has(epKey(w.from.part, w.from.pin)) || !idx.has(epKey(w.to.part, w.to.pin))) continue;
    dsu.union(ensure(epKey(w.from.part, w.from.pin)), ensure(epKey(w.to.part, w.to.pin)));
  }
  // breadboard insertion by proximity
  const inserted: Topology["inserted"] = [];
  const bbs = parts.filter(isHost);
  if (bbs.length) {
    const grid = new Map<string, { bb: string; hole: string }>();
    const gk = (x: number, y: number) => `${Math.round(x * 2)}_${Math.round(y * 2)}`;
    for (const bb of bbs) {
      const fp = footprintOf(bb)!;
      for (const h of fp.pins) {
        const w = pinWorld(bb, fp, h);
        grid.set(gk(w.x, w.y), { bb: bb.id, hole: h.id });
      }
    }
    for (const inst of parts) {
      if (isHost(inst)) continue;
      const fp = footprintOf(inst);
      if (!fp) continue;
      for (const p of fp.pins) {
        const w = pinWorld(inst, fp, p);
        const hit = grid.get(gk(w.x, w.y));
        if (hit) {
          dsu.union(ensure(epKey(inst.id, p.id)), ensure(epKey(hit.bb, hit.hole)));
          inserted.push({ part: inst.id, pin: p.id, bb: hit.bb, hole: hit.hole });
        }
      }
    }
  }
  // compact
  const rootToNode = new Map<number, number>();
  const nodeOf = new Map<string, number>();
  const members: string[][] = [];
  for (const [k, i] of idx) {
    const r = dsu.find(i);
    let n = rootToNode.get(r);
    if (n === undefined) {
      n = members.length;
      rootToNode.set(r, n);
      members.push([]);
    }
    nodeOf.set(k, n);
    members[n].push(k);
  }
  const gndPin = board.pins.find((p) => p.kind === "gnd");
  const ground = boardInst && gndPin ? nodeOf.get(epKey(boardInst.id, gndPin.id)) ?? 0 : 0;
  const swKey = [...switches.entries()].map(([k, v]) => `${k}=${v.map((s) => s.join("-")).join(",")}`).join(";");
  return { key: swKey, nodeOf, members, count: members.length, ground, inserted };
}

export function partDefOrNull(inst: PartInstance): PartDef | null {
  if (isBoard(inst)) return null;
  return getPart(inst.type) ?? null;
}

/** Role of a part pin (undefined for board pins and unknown parts). */
export function pinRoleOf(parts: PartInstance[], partId: string, pinId: string) {
  const inst = parts.find((p) => p.id === partId);
  if (!inst || isBoard(inst)) return undefined;
  return getPart(inst.type)?.pins.find((p) => p.id === pinId)?.role;
}

/** A compressed-air tube rather than an electrical wire. */
export const isAirWire = (parts: PartInstance[], w: Pick<Wire, "from" | "to">) => pinRoleOf(parts, w.from.part, w.from.pin) === "air" || pinRoleOf(parts, w.to.part, w.to.pin) === "air";

