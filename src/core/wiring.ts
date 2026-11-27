import { getBoard, resolveBoardPin } from "./boards";
import { BOARD_ID, endpointPos, footprintOf, instBounds, isBoard } from "./circuit";
import { getPart, type PartDef } from "./parts";
import type { BoardDef, BoardPin, Cap, PartInstance, PartPin, Project, Wire } from "./types";

export const WIRE_COLORS = {
  vcc: "#ef3b36",
  gnd: "#2b2f33",
  signal: ["#ff9f1c", "#ffd23f", "#3ddc97", "#2ec4ff", "#b388ff", "#f4f4f4", "#ff6fb5", "#7bd389"],
};

let uid = Date.now() % 100000;
export const newId = (prefix: string) => `${prefix}${(uid++).toString(36)}`;

export function usedBoardPins(project: Pick<Project, "parts" | "wires">): Set<string> {
  const used = new Set<string>();
  for (const w of project.wires) {
    if (w.from.part === BOARD_ID) used.add(w.from.pin);
    if (w.to.part === BOARD_ID) used.add(w.to.pin);
  }
  return used;
}

export function connectedPartPins(project: Pick<Project, "wires">): Set<string> {
  const s = new Set<string>();
  for (const w of project.wires) {
    s.add(`${w.from.part}:${w.from.pin}`);
    s.add(`${w.to.part}:${w.to.pin}`);
  }
  return s;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** MCU pin drives this part pin (output from the board's perspective). */
const boardDrives = (role: PartPin["role"]) => ["digital-in", "pwm-in", "anode", "signal", "sda", "scl"].includes(role);

export function choosePin(
  board: BoardDef,
  project: Pick<Project, "parts" | "wires">,
  need: Cap,
  role: PartPin["role"],
  near: { x: number; y: number } | undefined,
  reserved: Set<string> = new Set(),
): BoardPin | undefined {
  if (need === "sda") return board.pins.find((p) => p.id === board.i2c.sda);
  if (need === "scl") return board.pins.find((p) => p.id === board.i2c.scl);
  const used = usedBoardPins(project);
  const boardInst = project.parts.find(isBoard);
  // only sensor outputs may land on input-only pins
  const outputs = !["analog", "digital-out"].includes(role);
  const candidates = board.pins.filter((p) => {
    if (p.kind !== "gpio" || used.has(p.id) || reserved.has(p.id)) return false;
    if (!p.caps.includes(need)) return false;
    if (outputs && p.inputOnly) return false;
    // keep shared I2C pins free unless asked
    if (p.id === board.i2c.sda || p.id === board.i2c.scl) return false;
    return true;
  });
  const score = (p: BoardPin) => {
    let s = 0;
    if (p.avoid) s += 1000;
    if (board.family === "esp32" && need === "adc" && !(p.gpio! >= 32 && p.gpio! <= 39)) s += 400; // ADC2 conflicts with Wi-Fi
    if (!outputs && p.inputOnly) s -= 50; // use input-only pins for sensors first
    if (near && boardInst) {
      const pos = endpointPos(project.parts, boardInst.id, p.id);
      if (pos) s += dist(pos, near);
    }
    // prefer single-purpose pins
    s += p.caps.length * 0.5;
    return s;
  };
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

export function choosePowerPin(board: BoardDef, want5v: boolean, near?: { x: number; y: number }, parts?: PartInstance[]): BoardPin | undefined {
  const fives = board.pins.filter((p) => p.kind === "power" && (p.volts ?? 0) >= 4.5);
  const threes = board.pins.filter((p) => p.kind === "power" && p.volts === 3.3);
  const list = want5v ? (fives.length ? fives : threes) : threes.length ? threes : fives;
  return nearest(list, near, parts);
}

export function chooseGnd(board: BoardDef, near?: { x: number; y: number }, parts?: PartInstance[]) {
  return nearest(board.pins.filter((p) => p.kind === "gnd"), near, parts);
}

function nearest(list: BoardPin[], near?: { x: number; y: number }, parts?: PartInstance[]) {
  if (!near || !parts) return list[0];
  const b = parts.find(isBoard);
  if (!b) return list[0];
  return [...list].sort((a, c) => dist(endpointPos(parts, b.id, a.id) ?? near, near) - dist(endpointPos(parts, b.id, c.id) ?? near, near))[0];
}

function wireColor(role: PartPin["role"], i: number) {
  if (role === "vcc") return WIRE_COLORS.vcc;
  if (role === "gnd" || role === "cathode") return WIRE_COLORS.gnd;
  return WIRE_COLORS.signal[i % WIRE_COLORS.signal.length];
}

export interface AutoWireResult {
  parts: PartInstance[];
  wires: Wire[];
  log: string[];
}

/** Connect every unconnected pin of a part to sensible free board pins. */
export function autoWirePart(project: Project, partId: string, prefer?: Partial<Record<string, string>>): AutoWireResult {
  const board = getBoard(project.boardId);
  const parts = [...project.parts];
  const wires = [...project.wires];
  const log: string[] = [];
  const inst = parts.find((p) => p.id === partId);
  const def = inst ? getPart(inst.type) : undefined;
  if (!inst || !def) return { parts, wires, log: ["Part not found"] };
  const connected = connectedPartPins({ wires });
  const reserved = new Set<string>();
  let colorIdx = wires.length;
  const want5v = !!def.prefer5v || (def.supplyMin ?? 0) > 3.6 || board.logicV === 5;
  for (const pin of def.pins) {
    if (connected.has(`${inst.id}:${pin.id}`)) continue;
    if (pin.role === "nc" || pin.role === "passive") continue;
    const at = endpointPos(parts, inst.id, pin.id);
    let target: BoardPin | undefined;
    const pref = prefer?.[pin.id];
    if (pref) target = resolveBoardPin(board, pref);
    if (!target) {
      if (pin.role === "vcc") target = choosePowerPin(board, want5v, at, parts);
      else if (pin.role === "gnd" || pin.role === "cathode") target = chooseGnd(board, at, parts);
      else if (pin.need) target = choosePin(board, { parts, wires }, pin.need, pin.role, at, reserved);
    }
    if (!target) {
      log.push(`No free pin with ${pin.need ?? pin.role} for ${inst.label}.${pin.label}`);
      continue;
    }
    reserved.add(target.id);
    // LEDs get a current-limiting resistor automatically
    if ((inst.type === "led" || inst.type === "rgb-led") && pin.role === "anode") {
      const rId = newId("R");
      const fp = footprintOf(inst)!;
      const pinPos = endpointPos(parts, inst.id, pin.id)!;
      const r: PartInstance = {
        id: rId,
        type: "resistor",
        label: nextLabel(parts, "R"),
        x: snap(pinPos.x - 1.27 - 12),
        y: snap(inst.y + fp.h + 4 + parts.filter((p) => p.type === "resistor").length * 0),
        rot: 0,
        props: { ohms: board.logicV >= 5 ? 220 : 100 },
      };
      parts.push(r);
      wires.push({ id: newId("w"), from: { part: BOARD_ID, pin: target.id }, to: { part: rId, pin: "1" }, color: wireColor(pin.role, colorIdx++), points: [] });
      wires.push({ id: newId("w"), from: { part: rId, pin: "2" }, to: { part: inst.id, pin: pin.id }, color: wireColor(pin.role, colorIdx - 1), points: [] });
      log.push(`${target.label} → ${r.label} (${r.props.ohms} Ω) → ${inst.label}.${pin.label}`);
      continue;
    }
    wires.push({ id: newId("w"), from: { part: BOARD_ID, pin: target.id }, to: { part: inst.id, pin: pin.id }, color: wireColor(pin.role, colorIdx++), points: [] });
    log.push(`${target.label} → ${inst.label}.${pin.label}`);
  }
  if (def.prefer5v && board.logicV < 5) {
    const ao = def.pins.find((p) => p.role === "analog" || p.role === "digital-out");
    if (ao && ["mq2", "hc-sr04"].includes(def.type)) log.push(`Note: ${def.name} runs on 5 V; its ${ao.label} output can exceed ${board.logicV} V — add a voltage divider for real hardware.`);
  }
  return { parts, wires, log };
}

export const snap = (v: number) => Math.round(v / 2.54) * 2.54;

export function nextLabel(parts: PartInstance[], prefix: string) {
  let n = 1;
  const labels = new Set(parts.map((p) => p.label.toUpperCase()));
  while (labels.has(`${prefix}${n}`.toUpperCase())) n++;
  return `${prefix}${n}`;
}

export function labelPrefix(def: PartDef) {
  const map: Record<string, string> = {
    led: "LED",
    "rgb-led": "RGB",
    buzzer: "BZ",
    "servo-sg90": "SERVO",
    "servo-mg996r": "SERVO",
    relay: "RELAY",
    "dc-motor": "M",
    lcd1602: "LCD",
    "neopixel-ring": "RING",
    button: "BTN",
    pot: "POT",
    resistor: "R",
    ldr: "LDR",
    lm35: "TEMP",
    dht22: "DHT",
    "hc-sr04": "SONAR",
    flame: "FLAME",
    water: "WATER",
    soil: "SOIL",
    mq2: "GAS",
    pir: "PIR",
    sw420: "VIB",
    adxl335: "ACC",
    sound: "MIC",
    breadboard: "BB",
  };
  return map[def.type] ?? (def.custom ? def.custom.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "X" : "U");
}

// ---------------------------------------------------------------------------
// Command bar:  "GP10 -> LED1",  "led1 ไป auto",  "D5 ต่อ servo1 sig"
// ---------------------------------------------------------------------------
export interface CommandResult {
  ok: boolean;
  parts: PartInstance[];
  wires: Wire[];
  log: string[];
}

const SEP = /\s*(?:->|→|=>|⟶|\bto\b|\binto\b|\bwith\b|ไปที่|ไปยัง|ไป|ต่อเข้ากับ|ต่อกับ|เข้ากับ|เข้า|ต่อ|กับ|=)\s*/i;
const AUTO = /^(auto|any|free|อัตโนมัติ|ออโต้|ว่าง|ขาว่าง|pin ?ว่าง|\?)$/i;

interface Ep {
  kind: "board" | "part" | "auto";
  board?: BoardPin;
  part?: PartInstance;
  pin?: PartPin;
}

function findPartByText(parts: PartInstance[], txt: string): PartInstance | undefined {
  const q = txt.toLowerCase().replace(/\s+/g, "");
  const nonBoard = parts.filter((p) => !isBoard(p));
  return (
    nonBoard.find((p) => p.label.toLowerCase() === q) ??
    nonBoard.find((p) => p.id.toLowerCase() === q) ??
    nonBoard.find((p) => p.label.toLowerCase().startsWith(q)) ??
    nonBoard.find((p) => {
      const def = getPart(p.type);
      return def?.keywords.some((k) => k === q) || p.type === q;
    })
  );
}

function findPinOnPart(inst: PartInstance, txt: string): PartPin | undefined {
  const def = getPart(inst.type);
  if (!def) return undefined;
  const q = txt.toLowerCase().replace(/[\s()]/g, "");
  const syn: Record<string, string[]> = {
    A: ["a", "anode", "+", "plus", "long", "ขายาว", "บวก"],
    C: ["c", "k", "cathode", "-", "minus", "short", "ขาสั้น", "ลบ"],
    SIG: ["sig", "signal", "s", "pwm", "data", "orange", "สัญญาณ"],
    VCC: ["vcc", "v", "v+", "+", "5v", "3v3", "power", "ไฟ"],
    GND: ["gnd", "ground", "-", "g", "กราวด์"],
  };
  return (
    def.pins.find((p) => p.id.toLowerCase() === q) ??
    def.pins.find((p) => p.label.toLowerCase().replace(/[\s()]/g, "") === q) ??
    def.pins.find((p) => p.label.toLowerCase().startsWith(q)) ??
    def.pins.find((p) => (syn[p.id] ?? []).includes(q)) ??
    def.pins.find((p) => (p.role === "vcc" && syn.VCC.includes(q)) || (p.role === "gnd" && syn.GND.includes(q)) || (p.role === "anode" && syn.A.includes(q)))
  );
}

function parseEndpoint(board: BoardDef, parts: PartInstance[], raw: string): Ep | undefined {
  const txt = raw.trim().replace(/^(pin|ขา)\s*/i, "");
  if (!txt) return undefined;
  if (AUTO.test(txt)) return { kind: "auto" };
  // part.pin  or  part pin
  const m = txt.match(/^([\w-]+?)[.:]\s*([\w+\-()]+)$/) ?? txt.match(/^([\w-]+)\s+([\w+\-()]+)$/);
  if (m) {
    const inst = findPartByText(parts, m[1]);
    if (inst) {
      const pin = findPinOnPart(inst, m[2]);
      if (pin) return { kind: "part", part: inst, pin };
    }
  }
  const bp = resolveBoardPin(board, txt);
  if (bp) return { kind: "board", board: bp };
  const inst = findPartByText(parts, txt);
  if (inst) return { kind: "part", part: inst };
  return undefined;
}

export function runWireCommand(project: Project, text: string): CommandResult {
  const board = getBoard(project.boardId);
  let parts = [...project.parts];
  let wires = [...project.wires];
  const log: string[] = [];
  let ok = true;
  const statements = text.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const st of statements) {
    // "auto" alone or "auto wire all"
    if (/^(auto|auto ?wire( all)?|wire all|ต่ออัตโนมัติ|ต่อสายทั้งหมด|ต่อทั้งหมด)$/i.test(st)) {
      for (const p of parts.filter((x) => !isBoard(x) && x.type !== "breadboard")) {
        const r = autoWirePart({ ...project, parts, wires }, p.id);
        parts = r.parts;
        wires = r.wires;
        log.push(...r.log);
      }
      continue;
    }
    const single = st.match(/^(?:auto ?wire|wire|ต่อสาย|ต่อ)\s+(.+)$/i);
    if (single && !SEP.test(single[1])) {
      const inst = findPartByText(parts, single[1]);
      if (inst) {
        const r = autoWirePart({ ...project, parts, wires }, inst.id);
        parts = r.parts;
        wires = r.wires;
        log.push(...r.log);
        continue;
      }
    }
    const sides = st.split(SEP).filter((s) => s.trim());
    if (sides.length !== 2) {
      log.push(`Could not read "${st}". Try: GP10 -> LED1, or LED1 -> auto`);
      ok = false;
      continue;
    }
    let a = parseEndpoint(board, parts, sides[0]);
    let b = parseEndpoint(board, parts, sides[1]);
    if (!a || !b) {
      log.push(`Unknown ${!a ? `"${sides[0]}"` : `"${sides[1]}"`} — use a pin name like GP10/D5/A0 or a part label like LED1`);
      ok = false;
      continue;
    }
    // normalise: board/auto on the left, part on the right
    if (a.kind === "part" && b.kind !== "part") [a, b] = [b, a];
    if (b.kind !== "part" || !b.part) {
      log.push(`Connect a board pin to a part, e.g. GP10 -> LED1`);
      ok = false;
      continue;
    }
    const inst = b.part;
    const def = getPart(inst.type)!;
    const connected = connectedPartPins({ wires });
    const pin = b.pin ?? def.pins.find((p) => p.need && !connected.has(`${inst.id}:${p.id}`)) ?? def.pins.find((p) => p.need);
    if (!pin) {
      log.push(`${inst.label} has no signal pin to connect`);
      ok = false;
      continue;
    }
    if (a.kind === "part" && a.part) {
      const apin = a.pin ?? getPart(a.part.type)?.pins.find((p) => p.need);
      if (!apin) continue;
      wires.push({ id: newId("w"), from: { part: a.part.id, pin: apin.id }, to: { part: inst.id, pin: pin.id }, color: wireColor(pin.role, wires.length), points: [] });
      log.push(`${a.part.label}.${apin.label} → ${inst.label}.${pin.label}`);
      continue;
    }
    const prefer: Record<string, string> = {};
    if (a.kind === "board" && a.board) {
      const bp = a.board;
      if (pin.need && bp.kind === "gpio" && !bp.caps.includes(pin.need)) {
        log.push(`⚠ ${bp.label} lacks ${pin.need.toUpperCase()} — ${inst.label}.${pin.label} may not work there`);
      }
      if (bp.inputOnly && boardDrives(pin.role)) log.push(`⚠ ${bp.label} is input-only; it cannot drive ${inst.label}`);
      if (usedBoardPins({ parts, wires }).has(bp.id) && bp.kind === "gpio") log.push(`⚠ ${bp.label} is already in use`);
      prefer[pin.id] = bp.id;
    }
    const r = autoWirePart({ ...project, parts, wires }, inst.id, prefer);
    parts = r.parts;
    wires = r.wires;
    log.push(...r.log);
  }
  return { ok, parts, wires, log };
}

// ---------------------------------------------------------------------------
// Orthogonal A* router for tidy wires
// ---------------------------------------------------------------------------
export function routeWire(parts: PartInstance[], w: Wire, others: Wire[] = []): { x: number; y: number }[] {
  const a = endpointPos(parts, w.from.part, w.from.pin);
  const b = endpointPos(parts, w.to.part, w.to.pin);
  if (!a || !b) return [];
  const G = 1.27;
  const pad = 12;
  const minX = Math.min(a.x, b.x) - 40;
  const minY = Math.min(a.y, b.y) - 40;
  const maxX = Math.max(a.x, b.x) + 40;
  const maxY = Math.max(a.y, b.y) + 40;
  const W = Math.ceil((maxX - minX) / G) + 1;
  const H = Math.ceil((maxY - minY) / G) + 1;
  if (W * H > 250_000) return [];
  const blocked = new Uint8Array(W * H);
  const cost = new Float32Array(W * H);
  const toCell = (x: number, y: number) => [Math.round((x - minX) / G), Math.round((y - minY) / G)] as const;
  for (const p of parts) {
    if (p.type === "breadboard") continue;
    const bb = instBounds(p);
    const [x0, y0] = toCell(bb.x + 0.6, bb.y + 0.6);
    const [x1, y1] = toCell(bb.x + bb.w - 0.6, bb.y + bb.h - 0.6);
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) blocked[y * W + x] = 1;
  }
  // existing wires add a soft cost so routes spread out
  for (const o of others) {
    const pts = o.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = toCell(pts[i].x, pts[i].y);
      const [x1, y1] = toCell(pts[i + 1].x, pts[i + 1].y);
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / Math.max(1, n));
        const y = Math.round(y0 + ((y1 - y0) * k) / Math.max(1, n));
        if (x >= 0 && y >= 0 && x < W && y < H) cost[y * W + x] += 3;
      }
    }
  }
  const [sx, sy] = toCell(a.x, a.y);
  const [tx, ty] = toCell(b.x, b.y);
  // carve start/target plus a short escape corridor
  const carve = (cx: number, cy: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && (dx === 0 || dy === 0)) blocked[y * W + x] = 0;
    }
  };
  carve(sx, sy);
  carve(tx, ty);
  void pad;
  const N = W * H;
  const g = new Float32Array(N * 4).fill(Infinity);
  const came = new Int32Array(N * 4).fill(-1);
  const open: { k: number; f: number }[] = [];
  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const h = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty);
  for (let d = 0; d < 4; d++) {
    const k = (sy * W + sx) * 4 + d;
    g[k] = 0;
    open.push({ k, f: h(sx, sy) });
  }
  let found = -1;
  let iter = 0;
  while (open.length && iter++ < 200_000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const cell = Math.floor(cur.k / 4);
    const dir = cur.k % 4;
    const cx = cell % W;
    const cy = Math.floor(cell / W);
    if (cx === tx && cy === ty) {
      found = cur.k;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === dir) continue;
      const nx = cx + DIRS[nd][0];
      const ny = cy + DIRS[nd][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ncell = ny * W + nx;
      if (blocked[ncell]) continue;
      const nk = ncell * 4 + nd;
      const ng = g[cur.k] + 1 + (nd !== dir ? 6 : 0) + cost[ncell];
      if (ng < g[nk]) {
        g[nk] = ng;
        came[nk] = cur.k;
        open.push({ k: nk, f: ng + h(nx, ny) });
      }
    }
  }
  if (found < 0) return lShape(a, b);
  const cells: { x: number; y: number }[] = [];
  let k = found;
  while (k >= 0) {
    const cell = Math.floor(k / 4);
    cells.push({ x: minX + (cell % W) * G, y: minY + Math.floor(cell / W) * G });
    k = came[k];
  }
  cells.reverse();
  // keep corners only
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const p = cells[i - 1];
    const c = cells[i];
    const n = cells[i + 1];
    if ((p.x === c.x) !== (c.x === n.x)) pts.push(c);
  }
  return pts;
}

function lShape(a: { x: number; y: number }, b: { x: number; y: number }) {
  return [{ x: b.x, y: a.y }];
}
