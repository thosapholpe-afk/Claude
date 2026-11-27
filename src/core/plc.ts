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
