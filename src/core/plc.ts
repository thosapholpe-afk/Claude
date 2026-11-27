/**
 * PLC ladder logic: data model, power-flow evaluation and the scan-cycle runtime.
 *
 * A rung is a grid: `cells[row][col]` hold contacts or wire, `links[row][b]`
 * joins row and row+1 at column boundary b (0 = left rail … COLS = before the
 * outputs), and each row can end in an output instruction. Power flows from the
 * left rail through passing cells; vertical links OR the rows they join.
 *
 * Addresses (Mitsubishi FX style): X0–X7 inputs, Y0–Y7 outputs, M0–M31 relays,
 * T0–T15 timers (preset in seconds), C0–C15 counters.
 */
import type { Hal } from "./runtime/hal";
import { STOP } from "./runtime/hal";

export const LADDER_COLS = 6;
export type ContactKind = "no" | "nc" | "rise" | "fall";
export type Cell = null | { t: "wire" } | { t: ContactKind; a: string };
export type OutKind = "coil" | "set" | "reset" | "ton" | "tof" | "ctu" | "rst";
export type Out = null | { t: OutKind; a: string; pre?: number };
export interface Rung {
  id: string;
  comment?: string;
  cells: Cell[][];
  links: boolean[][];
  outs: Out[];
}
export interface LadderProgram {
  kind: "ladder";
  rungs: Rung[];
  /** Symbol names shown next to addresses, e.g. { X0: "START" }. */
  symbols: Record<string, string>;
}

export interface PlcState {
  bits: Record<string, boolean>;
  /** Timer accumulated ms / counter value. */
  acc: Record<string, number>;
  power: Record<string, { cells: boolean[][]; outs: boolean[]; links: boolean[][] }>;
  scans: number;
}

export const ADDRESS_GROUPS: { prefix: string; n: number; label: string }[] = [
  { prefix: "X", n: 8, label: "Inputs" },
  { prefix: "Y", n: 8, label: "Outputs" },
  { prefix: "M", n: 32, label: "Internal relays" },
  { prefix: "T", n: 16, label: "Timers" },
  { prefix: "C", n: 16, label: "Counters" },
];
export const isAddress = (a: string) => /^(X[0-7]|Y[0-7]|M([0-9]|[12][0-9]|3[01])|T([0-9]|1[0-5])|C([0-9]|1[0-5]))$/.test(a);

let uid = 0;
export const rungId = () => `r${Date.now().toString(36)}${(uid++).toString(36)}`;

export function emptyRung(rows = 1): Rung {
  return {
    id: rungId(),
    cells: Array.from({ length: rows }, () => Array<Cell>(LADDER_COLS).fill(null)),
    links: Array.from({ length: Math.max(0, rows - 1) }, () => Array<boolean>(LADDER_COLS + 1).fill(false)),
    outs: Array<Out>(rows).fill(null),
  };
}

/** Build a rung from a compact description: rows of cells left-to-right, wire-filled to the outputs. */
export function rung(rows: { cells: Cell[]; out?: Out }[], links: [row: number, boundary: number][] = [], comment?: string): Rung {
  const r = emptyRung(rows.length);
  rows.forEach((row, ri) => {
    row.cells.forEach((c, ci) => (r.cells[ri][ci] = c));
    if (row.out) {
      // fill the gap between the last contact and the output with wire
      let last = -1;
      row.cells.forEach((c, ci) => c && (last = ci));
      for (let c = last + 1; c < LADDER_COLS; c++) r.cells[ri][c] = { t: "wire" };
      r.outs[ri] = row.out;
    }
  });
  for (const [ri, b] of links) r.links[ri][b] = true;
  r.comment = comment;
  return r;
}
export const NO = (a: string): Cell => ({ t: "no", a });
export const NC = (a: string): Cell => ({ t: "nc", a });
export const W: Cell = { t: "wire" };

export function parseLadder(code: string | undefined): LadderProgram {
  try {
    const p = JSON.parse(code ?? "") as LadderProgram;
    if (p && p.kind === "ladder" && Array.isArray(p.rungs)) return normalise(p);
  } catch {
    /* fall through */
  }
  return { kind: "ladder", rungs: [emptyRung()], symbols: {} };
}

/** Make sure every rung has consistent dimensions (older or hand-edited JSON). */
function normalise(p: LadderProgram): LadderProgram {
  for (const r of p.rungs) {
    const rows = Math.max(1, r.cells?.length ?? 1);
    r.cells = Array.from({ length: rows }, (_, i) => Array.from({ length: LADDER_COLS }, (_, c) => r.cells?.[i]?.[c] ?? null));
    r.links = Array.from({ length: rows - 1 }, (_, i) => Array.from({ length: LADDER_COLS + 1 }, (_, b) => !!r.links?.[i]?.[b]));
    r.outs = Array.from({ length: rows }, (_, i) => r.outs?.[i] ?? null);
    r.id ||= rungId();
  }
  p.symbols ??= {};
  return p;
}

export const serialiseLadder = (p: LadderProgram) => JSON.stringify(p);

/** OR together rows joined by vertical links at boundary b. */
function mergeLinks(node: boolean[], links: boolean[][], b: number) {
  const out = [...node];
  // links are only between neighbours, so two sweeps settle every chain
  for (let pass = 0; pass < 2; pass++)
    for (let r = 0; r < links.length; r++) {
      if (!links[r][b]) continue;
      const v = out[r] || out[r + 1];
      out[r] = v;
      out[r + 1] = v;
    }
  return out;
}

/** Evaluate one rung. `pass` decides whether a contact conducts. */
export function evalRung(r: Rung, pass: (cell: Exclude<Cell, null | { t: "wire" }>, row: number, col: number) => boolean) {
  const rows = r.cells.length;
  let node = mergeLinks(Array<boolean>(rows).fill(true), r.links, 0);
  const cells: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(LADDER_COLS).fill(false));
  for (let c = 0; c < LADDER_COLS; c++) {
    const next = node.map((on, ri) => {
      const cell = r.cells[ri][c];
      const ok = on && !!cell && (cell.t === "wire" || pass(cell, ri, c));
      cells[ri][c] = ok;
      return ok;
    });
    node = mergeLinks(next, r.links, c + 1);
  }
  const outs = node.map((on, ri) => on && !!r.outs[ri]);
  // a link conducts when the node it joins is live
  const links = r.links.map((row, ri) => row.map((l, b) => l && (b === 0 || cells[ri][b - 1] || cells[ri + 1][b - 1] || (b === LADDER_COLS && (outs[ri] || outs[ri + 1])))));
  return { cells, outs, links };
}

/**
 * One PLC: reads inputs, solves every rung top to bottom, then writes outputs —
 * the classic input-scan / program-scan / output-scan cycle (10 ms).
 */
export class LadderMachine {
  bits: Record<string, boolean> = {};
  acc: Record<string, number> = {};
  private prev: Record<string, boolean> = {};
  private prevIn: Record<string, boolean> = {};
  power: PlcState["power"] = {};
  scans = 0;
  constructor(public prog: LadderProgram) {}

  bit(a: string) {
    return !!this.bits[a];
  }

  scan(inputs: Record<string, boolean>, dtMs: number) {
    Object.assign(this.bits, inputs);
    for (const r of this.prog.rungs) {
      const res = evalRung(r, (cell, ri, ci) => {
        const v = this.bit(cell.a);
        const key = `${r.id}:${ri}:${ci}`;
        if (cell.t === "no") return v;
        if (cell.t === "nc") return !v;
        const was = this.prev[key] ?? v;
        this.prev[key] = v;
        return cell.t === "rise" ? v && !was : !v && was;
      });
      res.outs.forEach((on, ri) => {
        const o = r.outs[ri];
        if (o) this.output(o, on, `${r.id}:${ri}:out`, dtMs);
      });
      this.power[r.id] = res;
    }
    this.scans++;
  }

  private output(o: Exclude<Out, null>, on: boolean, key: string, dtMs: number) {
    const a = o.a;
    if (a.startsWith("X")) return; // inputs can't be driven by the program
    switch (o.t) {
      case "coil":
        this.bits[a] = on;
        break;
      case "set":
        if (on) this.bits[a] = true;
        break;
      case "reset":
        if (on) this.bits[a] = false;
        break;
      case "ton": {
        const pre = Math.max(0, (o.pre ?? 1) * 1000);
        this.acc[a] = on ? Math.min(pre, (this.acc[a] ?? 0) + dtMs) : 0;
        this.bits[a] = on && this.acc[a] >= pre;
        break;
      }
      case "tof": {
        const pre = Math.max(0, (o.pre ?? 1) * 1000);
        if (on) {
          this.bits[a] = true;
          this.acc[a] = 0;
        } else if (this.bits[a]) {
          this.acc[a] = (this.acc[a] ?? 0) + dtMs;
          if (this.acc[a] >= pre) this.bits[a] = false;
        }
        break;
      }
      case "ctu": {
        const was = this.prevIn[key] ?? false;
        if (on && !was) this.acc[a] = (this.acc[a] ?? 0) + 1;
        this.bits[a] = (this.acc[a] ?? 0) >= (o.pre ?? 1);
        break;
      }
      case "rst":
        if (on) {
          this.acc[a] = 0;
          this.bits[a] = false;
        }
        break;
    }
    this.prevIn[key] = on;
  }

  state(): PlcState {
    return { bits: { ...this.bits }, acc: { ...this.acc }, power: this.power, scans: this.scans };
  }
}

/** Run a ladder program against the simulated PLC's X/Y terminals until stopped. */
export async function runLadder(hal: Hal, prog: LadderProgram, publish: (s: PlcState) => void) {
  const xs = hal.board.pins.filter((p) => /^X\d+$/.test(p.label));
  const ys = hal.board.pins.filter((p) => /^Y\d+$/.test(p.label));
  if (!xs.length) throw new Error(`${hal.board.short} has no PLC inputs — switch to PLC mode to run ladder logic`);
  for (const p of xs) hal.setMode(p.id, "INPUT_PULLDOWN");
  for (const p of ys) hal.setMode(p.id, "OUTPUT");
  const m = new LadderMachine(prog);
  let last = hal.nowMs();
  for (;;) {
    await hal.sleep(10);
    if (hal.isStopped()) throw STOP;
    const now = hal.nowMs();
    const inputs: Record<string, boolean> = {};
    for (const p of xs) inputs[p.label] = hal.readDigital(p.id) === 1;
    m.scan(inputs, now - last);
    last = now;
    for (const p of ys) hal.writeDigital(p.id, m.bit(p.label) ? 1 : 0);
    publish(m.state());
  }
}

// ---------------------------------------------------------------------------
// text form for the AI agent / MCP:  rows of contact tokens + an output token
// ---------------------------------------------------------------------------
export interface RowSpec {
  /** Contacts left→right (AND): "X0", "NC X1" (or "/X1"), "P X2" rising, "N X2" falling, "-" wire, "" empty. */
  contacts?: string[];
  /** "OUT Y0" (or "Y0"), "SET Y0", "RST Y0", "TON T0 3", "TOF T1 2", "CTU C0 5", "RST C0". */
  output?: string;
  /** Column the row starts at (0 = left rail). Cells before it stay empty. */
  start?: number;
}
export interface RungSpec {
  comment?: string;
  rows: RowSpec[];
  /** [row, boundary]: join row and row+1 at boundary b (0 = left rail, 6 = just before the outputs). */
  branches?: [number, number][];
}

const ADDR_HELP = "X0–X7 inputs, Y0–Y7 outputs, M0–M31 relays, T0–T15 timers, C0–C15 counters";

export function parseContact(tok: string): Cell {
  const s = String(tok ?? "").trim();
  if (!s) return null;
  if (s === "-" || s === "—" || /^wire$/i.test(s)) return W;
  let kind: ContactKind = "no";
  let a = s;
  const m = s.match(/^(NO|NC|XIC|XIO|P|N|RISE|FALL|LD|LDI|AND|ANI)\s+(\S+)$/i);
  if (m) {
    const k = m[1].toUpperCase();
    kind = k === "NC" || k === "XIO" || k === "LDI" || k === "ANI" ? "nc" : k === "P" || k === "RISE" ? "rise" : k === "N" || k === "FALL" ? "fall" : "no";
    a = m[2];
  } else if (/^[!/~¬]/.test(s)) {
    kind = "nc";
    a = s.slice(1);
  } else if (/^[↑^]/.test(s)) {
    kind = "rise";
    a = s.slice(1);
  } else if (/^↓/.test(s)) {
    kind = "fall";
    a = s.slice(1);
  }
  a = a.trim().toUpperCase();
  if (!isAddress(a)) throw new Error(`"${tok}" is not a contact (${ADDR_HELP}; prefix NC/P/N)`);
  return { t: kind, a };
}

export function parseOutput(tok: string): Out {
  const words = String(tok ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let op = "OUT";
  if (/^(OUT|OTE|COIL|SET|S|OTL|RST|R|RES|OTU|TON|TOF|CTU)$/i.test(words[0]) && words.length > 1) op = words.shift()!.toUpperCase();
  const a = (words[0] ?? "").toUpperCase();
  if (!isAddress(a)) throw new Error(`"${tok}" is not an output (${ADDR_HELP})`);
  if (a.startsWith("X")) throw new Error(`"${tok}": inputs (X) can't be driven by the program`);
  const pre = words[1] !== undefined ? Number(words[1].replace(/s$/i, "")) : undefined;
  const timerOrCounter = /^[TC]/.test(a);
  switch (op) {
    case "OUT":
    case "OTE":
    case "COIL":
      if (timerOrCounter) throw new Error(`"${tok}": drive timers with "TON ${a} <seconds>" and counters with "CTU ${a} <count>"`);
      return { t: "coil", a };
    case "SET":
    case "S":
    case "OTL":
      return { t: "set", a };
    case "RST":
    case "R":
    case "RES":
    case "OTU":
      return timerOrCounter ? { t: "rst", a } : { t: "reset", a };
    case "TON":
    case "TOF":
      if (!a.startsWith("T")) throw new Error(`"${tok}": timers are T0–T15`);
      if (!(pre !== undefined && pre > 0)) throw new Error(`"${tok}": give the preset in seconds, e.g. "${op} ${a} 3"`);
      return { t: op === "TON" ? "ton" : "tof", a, pre };
    case "CTU":
      if (!a.startsWith("C")) throw new Error(`"${tok}": counters are C0–C15`);
      if (!(pre !== undefined && pre >= 1)) throw new Error(`"${tok}": give the preset count, e.g. "CTU ${a} 5"`);
      return { t: "ctu", a, pre: Math.round(pre) };
  }
  return null;
}

/** Build a ladder program from the text form (validates every token). */
export function ladderFromSpec(rungs: RungSpec[], symbols: Record<string, string> = {}): LadderProgram {
  if (!Array.isArray(rungs) || !rungs.length) throw new Error("give at least one rung");
  const out = rungs.map((rs, i) => {
    const rows = rs?.rows;
    if (!Array.isArray(rows) || !rows.length) throw new Error(`rung ${i}: needs rows`);
    if (rows.length > 8) throw new Error(`rung ${i}: at most 8 rows`);
    const r = emptyRung(rows.length);
    rows.forEach((row, ri) => {
      const start = Math.max(0, Math.min(LADDER_COLS, Math.round(Number(row.start ?? 0)) || 0));
      const cs = (row.contacts ?? []).map((tok) => {
        try {
          return parseContact(tok);
        } catch (e) {
          throw new Error(`rung ${i} row ${ri}: ${(e as Error).message}`);
        }
      });
      if (start + cs.length > LADDER_COLS) throw new Error(`rung ${i} row ${ri}: at most ${LADDER_COLS} columns per row — move part of the logic into an M relay on its own rung`);
      cs.forEach((c, k) => (r.cells[ri][start + k] = c));
      if (row.output) {
        try {
          r.outs[ri] = parseOutput(row.output);
        } catch (e) {
          throw new Error(`rung ${i} row ${ri}: ${(e as Error).message}`);
        }
        for (let c = start + cs.length; c < LADDER_COLS; c++) r.cells[ri][c] = W;
      }
    });
    for (const br of rs.branches ?? []) {
      const [row, b] = br.map(Number);
      if (!(row >= 0 && row < rows.length - 1)) throw new Error(`rung ${i}: branch row ${row} must be between 0 and ${rows.length - 2}`);
      if (!(b >= 0 && b <= LADDER_COLS)) throw new Error(`rung ${i}: branch boundary ${b} must be 0–${LADDER_COLS}`);
      r.links[row][b] = true;
    }
    if (!r.outs.some(Boolean)) throw new Error(`rung ${i}: no output — every rung needs at least one output`);
    if (rs.comment) r.comment = String(rs.comment).slice(0, 200);
    return r;
  });
  const sym: Record<string, string> = {};
  for (const [k, v] of Object.entries(symbols ?? {})) {
    const a = k.trim().toUpperCase();
    if (isAddress(a) && v) sym[a] = String(v).slice(0, 16);
  }
  return { kind: "ladder", rungs: out, symbols: sym };
}

const fmtCell = (c: Cell) => (!c ? "" : c.t === "wire" ? "-" : c.t === "no" ? c.a : `${c.t === "nc" ? "NC" : c.t === "rise" ? "P" : "N"} ${c.a}`);
const fmtOut = (o: Exclude<Out, null>) =>
  o.t === "coil" ? `OUT ${o.a}` : o.t === "set" ? `SET ${o.a}` : o.t === "reset" || o.t === "rst" ? `RST ${o.a}` : `${o.t.toUpperCase()} ${o.a} ${o.pre ?? 1}`;

/** The reverse of ladderFromSpec. */
export function ladderToSpec(p: LadderProgram): { rungs: RungSpec[]; symbols: Record<string, string> } {
  return {
    symbols: p.symbols,
    rungs: p.rungs.map((r) => {
      const rows: RowSpec[] = r.cells.map((row, ri) => {
        const out = r.outs[ri];
        let first = row.findIndex(Boolean);
        if (first < 0) first = LADDER_COLS;
        let end = first - 1;
        row.forEach((c, ci) => {
          if (c && (!out || c.t !== "wire")) end = ci;
        });
        // with an output, trailing wire is implied
        const spec: RowSpec = { contacts: row.slice(first, end + 1).map(fmtCell) };
        if (first > 0) spec.start = first;
        if (out) spec.output = fmtOut(out);
        return spec;
      });
      const branches: [number, number][] = [];
      r.links.forEach((row, ri) => row.forEach((on, b) => on && branches.push([ri, b])));
      return { ...(r.comment ? { comment: r.comment } : {}), rows, ...(branches.length ? { branches } : {}) };
    }),
  };
}

/** A plain-text drawing of the program, for reading it back without a screen. */
export function ladderAscii(p: LadderProgram): string {
  const cell = (c: Cell) => {
    if (!c) return "        ";
    if (c.t === "wire") return "--------";
    const tag = c.t === "no" ? c.a : `${c.t === "nc" ? "/" : c.t === "rise" ? "↑" : "↓"}${c.a}`;
    return `-[${tag.padEnd(4)}]-`;
  };
  const lines: string[] = [];
  p.rungs.forEach((r, i) => {
    lines.push(`R${i}${r.comment ? `  ; ${r.comment}` : ""}`);
    r.cells.forEach((row, ri) => {
      let s = "|";
      for (let b = 0; b <= LADDER_COLS; b++) {
        const joint = (ri > 0 && r.links[ri - 1]?.[b]) || r.links[ri]?.[b];
        const left = b === 0 || !!row[b - 1];
        const right = b < LADDER_COLS ? !!row[b] : !!r.outs[ri];
        s += joint ? "+" : left && right ? "-" : " ";
        if (b < LADDER_COLS) s += cell(row[b]);
      }
      const o = r.outs[ri];
      if (o) s += `( ${fmtOut(o)} )`;
      lines.push(s.replace(/\s+$/, ""));
    });
  });
  const sym = Object.entries(p.symbols ?? {});
  if (sym.length) lines.push("", "Symbols: " + sym.map(([a, n]) => `${a}=${n}`).join(", "));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// starter programs
// ---------------------------------------------------------------------------
export function startStopProgram(): LadderProgram {
  return {
    kind: "ladder",
    symbols: { X0: "START", X1: "STOP (NC)", X2: "OL 95-96", Y0: "K1 MOTOR", Y1: "RUN LAMP", Y2: "STOP LAMP" },
    rungs: [
      rung([{ cells: [NO("X0"), NO("X1"), NO("X2")], out: { t: "coil", a: "Y0" } }, { cells: [NO("Y0")] }], [[0, 1]], "Start/stop with seal-in. STOP and the overload are NC contacts wired to X1/X2, so the program examines them as NO (fail-safe: a broken wire stops the motor)."),
      rung([{ cells: [NO("Y0")], out: { t: "coil", a: "Y1" } }], [], "Green lamp while the motor runs"),
      rung([{ cells: [NC("Y0")], out: { t: "coil", a: "Y2" } }], [], "Red lamp while stopped"),
    ],
  };
}

export function forwardReverseProgram(): LadderProgram {
  return {
    kind: "ladder",
    symbols: { X0: "FWD", X1: "REV", X2: "STOP (NC)", X3: "OL 95-96", Y0: "K1 FWD", Y1: "K2 REV", Y2: "FWD LAMP", Y3: "REV LAMP" },
    rungs: [
      rung([{ cells: [NO("X0"), NO("X2"), NO("X3"), NC("Y1")], out: { t: "coil", a: "Y0" } }, { cells: [NO("Y0")] }], [[0, 1]], "Forward: seal-in, interlocked by K2 (NC Y1) so both contactors can never pull in together"),
      rung([{ cells: [NO("X1"), NO("X2"), NO("X3"), NC("Y0")], out: { t: "coil", a: "Y1" } }, { cells: [NO("Y1")] }], [[0, 1]], "Reverse: seal-in, interlocked by K1 (NC Y0)"),
      rung([{ cells: [NO("Y0")], out: { t: "coil", a: "Y2" } }]),
      rung([{ cells: [NO("Y1")], out: { t: "coil", a: "Y3" } }]),
    ],
  };
}

export function selectorTimerProgram(): LadderProgram {
  return {
    kind: "ladder",
    symbols: { X0: "SEL MAN", X1: "SEL AUTO", X2: "PB RUN", Y0: "PUMP", Y1: "AUTO LAMP", Y2: "BLINK", T0: "ON 3s", T1: "OFF 1s", T2: "BLINK ON", T3: "BLINK OFF" },
    rungs: [
      rung([{ cells: [NO("X0"), NO("X2")], out: { t: "coil", a: "M0" } }], [], "MANUAL: the pump runs only while RUN is held"),
      rung([{ cells: [NO("X1"), NC("T1")], out: { t: "ton", a: "T0", pre: 3 } }], [], "AUTO: 3 s on …"),
      rung([{ cells: [NO("T0")], out: { t: "ton", a: "T1", pre: 1 } }], [], "… then 1 s off, repeating"),
      rung([{ cells: [NO("M0")], out: { t: "coil", a: "Y0" } }, { cells: [NO("X1"), NC("T0")] }], [[0, 2]], "Pump output from either mode"),
      rung([{ cells: [NO("X1")], out: { t: "coil", a: "Y1" } }], [], "Amber lamp in AUTO"),
      rung([{ cells: [NC("T3")], out: { t: "ton", a: "T2", pre: 0.5 } }]),
      rung([{ cells: [NO("T2")], out: { t: "ton", a: "T3", pre: 0.5 } }]),
      rung([{ cells: [NO("X0"), NO("T2")], out: { t: "coil", a: "Y2" } }], [], "Blink the white lamp in MANUAL"),
    ],
  };
}

/** 5/2 spring-return valve on Y0 cycling a cylinder between its reed switches a0 (X2) and a1 (X3). */
export function pneumaticCycleProgram(): LadderProgram {
  return {
    kind: "ladder",
    symbols: { X0: "START", X1: "STOP (NC)", X2: "a0 HOME", X3: "a1 END", Y0: "YV1 EXTEND", Y1: "RUN LAMP", M0: "RUN", T0: "DWELL", C0: "STROKES" },
    rungs: [
      rung([{ cells: [NO("X0"), NO("X1")], out: { t: "coil", a: "M0" } }, { cells: [NO("M0")] }], [[0, 1]], "RUN latch: START sets it, STOP drops it (STOP is wired NC, so the program examines it as NO)."),
      rung([{ cells: [NO("X3")], out: { t: "ton", a: "T0", pre: 0.5 } }], [], "Dwell 0.5 s at the extended end (a1)."),
      rung([{ cells: [NO("M0"), NO("X2"), NC("T0")], out: { t: "coil", a: "Y0" } }, { cells: [null, NO("Y0")] }], [[0, 1], [0, 2]], "Extend from home (a0) and keep extending until the dwell at a1 is over; the valve spring then retracts the cylinder. Repeats while RUN."),
      rung([{ cells: [NO("M0")], out: { t: "coil", a: "Y1" } }], [], "RUN lamp."),
      rung([{ cells: [{ t: "rise", a: "X3" }], out: { t: "ctu", a: "C0", pre: 9999 } }, { cells: [NO("X0")], out: { t: "rst", a: "C0" } }], [], "Count strokes in C0; START clears the count."),
    ],
  };
}

