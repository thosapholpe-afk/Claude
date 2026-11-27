import { epKey, isBoard, type Topology } from "./circuit";
import type { EnvState } from "./env";
import { getPart, type PartLive, type PostCtx, type StampCtx } from "./parts";
import type { BoardDef, PartInstance } from "./types";

export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP" | "INPUT_PULLDOWN" | "ANALOG";

export interface Drive {
  mode: PinMode;
  level: number; // 0/1
  pwm?: number; // 0..1 duty when PWM is active
  servoUs?: number;
  toneHz?: number;
  dacV?: number;
}

export interface Diagnostic {
  level: "error" | "warn" | "info";
  msg: string;
  part?: string;
  pin?: string;
}

export interface SolveResult {
  V: Float64Array;
  live: Map<string, PartLive>;
  diags: Diagnostic[];
  pinCurrent: Map<string, number>;
}

const GPIO_R = 25;
const PWR_R = 0.05;
const GMIN = 1e-9;

interface Entry {
  i: number;
  j: number;
  g: number;
}

interface DiodeRec {
  a: number;
  c: number;
  vf: number;
  rs: number;
}

/**
 * Nodal-analysis DC solver. Every element is stamped as a conductance or a
 * Norton current source; LEDs and opto-couplers are piecewise-linear diodes
 * resolved by iterating until their on/off states stop changing.
 */
export class CircuitSolver {
  prevV = new Float64Array(0);
  diodeOn = new Map<string, boolean>();
  topoKey = "";

  solve(args: {
    board: BoardDef;
    parts: PartInstance[];
    topo: Topology;
    drives: Map<string, Drive>;
    env: EnvState;
    t: number;
    dt: number;
    inputs: Map<string, Record<string, number | boolean>>;
    mems: Map<string, Record<string, number>>;
    lib: Map<string, Record<string, unknown>>;
    withPost: boolean;
  }): SolveResult {
    const { board, parts, topo, drives, env, t, dt, inputs, mems, lib } = args;
    const N = topo.count;
    if (this.prevV.length !== N) {
      this.prevV = new Float64Array(N);
      this.diodeOn.clear();
    }
    const boardInst = parts.find(isBoard);
    const bId = boardInst?.id ?? "board";
    const nodeOfBoard = (pinId: string) => topo.nodeOf.get(epKey(bId, pinId)) ?? -1;

    let V = this.prevV;
    let diodes = new Map<string, DiodeRec>();
    let adjacency = new Map<number, Set<number>>();
    const pinCurrent = new Map<string, number>();

    for (let iter = 0; iter < 8; iter++) {
      const G: Entry[] = [];
      const I = new Float64Array(N);
      const touched = new Uint8Array(N);
      diodes = new Map();
      adjacency = new Map();
      const link = (a: number, b: number) => {
        if (a < 0 || b < 0) return;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      };
      const addG = (a: number, b: number, g: number) => {
        if (a >= 0) {
          G.push({ i: a, j: a, g });
          touched[a] = 1;
        }
        if (b >= 0) {
          G.push({ i: b, j: b, g });
          touched[b] = 1;
        }
        if (a >= 0 && b >= 0) {
          G.push({ i: a, j: b, g: -g });
          G.push({ i: b, j: a, g: -g });
        }
      };
      const addI = (a: number, cur: number) => {
        if (a >= 0) {
          I[a] += cur;
          touched[a] = 1;
        }
      };
      const prev = V;
      const v = (n: number) => (n >= 0 && n < prev.length ? prev[n] : 0);

      // --- board sources
      for (const p of board.pins) {
        const n = nodeOfBoard(p.id);
        if (n < 0) continue;
        if (p.kind === "power" && p.volts) {
          addG(n, topo.ground, 1 / PWR_R);
          addI(n, p.volts / PWR_R);
          addI(topo.ground, -p.volts / PWR_R);
        }
      }
      for (const [pinId, d] of drives) {
        const n = nodeOfBoard(pinId);
        if (n < 0) continue;
        if (d.mode === "OUTPUT") {
          const volts = d.dacV !== undefined ? d.dacV : d.pwm !== undefined ? (d.pwm > 0 ? board.logicV : 0) : d.level ? board.logicV : 0;
          addG(n, topo.ground, 1 / GPIO_R);
          addI(n, volts / GPIO_R);
        } else if (d.mode === "INPUT_PULLUP") {
          addG(n, topo.ground, 1 / 45_000);
          addI(n, board.logicV / 45_000);
        } else if (d.mode === "INPUT_PULLDOWN") {
          addG(n, topo.ground, 1 / 45_000);
        }
      }

      // --- parts
      for (const inst of parts) {
        if (isBoard(inst)) continue;
        const def = getPart(inst.type);
        if (!def?.stamp) continue;
        const ctx = this.makeStamp(inst, topo, v, env, t, dt, board, inputs, mems, addG, addI, link, (key, a, c, vf, rs) => {
          const k = `${inst.id}:${key}`;
          diodes.set(k, { a, c, vf, rs });
          link(a, c);
          const wasOn = this.diodeOn.get(k) ?? false;
          const vd = v(a) - v(c);
          const on = wasOn ? (vd - vf) / rs > -1e-6 : vd > vf;
          this.diodeOn.set(k, on);
          if (on) {
            const g = 1 / rs;
            addG(a, c, g);
            addI(a, g * vf);
            addI(c, -g * vf);
          } else {
            addG(a, c, 1e-7);
          }
        });
        def.stamp(ctx);
      }

      // --- assemble compact system (ground removed)
      const map = new Int32Array(N).fill(-1);
      let m = 0;
      for (let k = 0; k < N; k++) if (touched[k] && k !== topo.ground) map[k] = m++;
      const A = new Float64Array(m * m);
      const b = new Float64Array(m);
      for (const e of G) {
        const ri = map[e.i];
        const cj = map[e.j];
        if (ri < 0 || cj < 0) continue;
        A[ri * m + cj] += e.g;
      }
      for (let k = 0; k < N; k++) {
        const r = map[k];
        if (r < 0) continue;
        A[r * m + r] += GMIN;
        b[r] = I[k];
      }
      const x = gauss(A, b, m);
      const next = new Float64Array(N);
      for (let k = 0; k < N; k++) if (map[k] >= 0) next[k] = x[map[k]];
      // convergence: diode states stable and voltages close
      let delta = 0;
      for (let k = 0; k < N; k++) delta = Math.max(delta, Math.abs(next[k] - prev[k]));
      V = next;
      let stable = true;
      for (const [k, d] of diodes) {
        const on = this.diodeOn.get(k) ?? false;
        const vd = V[d.a >= 0 ? d.a : 0] * (d.a >= 0 ? 1 : 0) - (d.c >= 0 ? V[d.c] : 0);
        const shouldOn = on ? (vd - d.vf) / d.rs > -1e-6 : vd > d.vf;
        if (shouldOn !== on) stable = false;
      }
      if (stable && delta < 1e-4 && iter > 0) break;
    }
    this.prevV = V;

    // --- currents & diagnostics
    const diags: Diagnostic[] = [];
    const live = new Map<string, PartLive>();
    for (const [pinId, d] of drives) {
      const n = nodeOfBoard(pinId);
      if (n < 0 || d.mode !== "OUTPUT") continue;
      const volts = d.dacV !== undefined ? d.dacV : d.pwm !== undefined ? (d.pwm > 0 ? board.logicV : 0) : d.level ? board.logicV : 0;
      const cur = (volts - V[n]) / GPIO_R;
      pinCurrent.set(pinId, cur);
      if (Math.abs(cur) > 0.04) {
        const p = board.pins.find((x) => x.id === pinId);
        diags.push({ level: "error", pin: pinId, msg: `${p?.label ?? pinId} ${cur > 0 ? "sources" : "sinks"} ${Math.abs(cur * 1000).toFixed(0)} mA (max 40 mA) — add a resistor or a driver` });
      }
    }
    for (const p of board.pins) {
      const n = nodeOfBoard(p.id);
      if (n < 0) continue;
      if (p.kind === "power" && p.volts) {
        const cur = (p.volts - V[n]) / PWR_R;
        if (cur > 0.6) diags.push({ level: "error", pin: p.id, msg: `Short circuit: ${p.label} is shorted (${cur.toFixed(1)} A)` });
      }
      if (p.kind === "gpio" && V[n] > board.logicV + 0.45) {
        diags.push({ level: "error", pin: p.id, msg: `${p.label} sees ${V[n].toFixed(2)} V — above the ${board.logicV} V logic level. Use a divider or level shifter.` });
      }
    }

    if (args.withPost) {
      const dutyOf = (n: number): number | undefined => {
        for (const [pinId, d] of drives) {
          if (d.mode !== "OUTPUT") continue;
          if (nodeOfBoard(pinId) === n) return d.pwm !== undefined ? d.pwm : d.level ? 1 : 0;
        }
        return undefined;
      };
      const signalOf = (n: number) => {
        for (const [pinId, d] of drives) {
          if (d.mode !== "OUTPUT") continue;
          if (nodeOfBoard(pinId) === n) {
            const p = board.pins.find((x) => x.id === pinId);
            return { servoUs: d.servoUs, toneHz: d.toneHz, level: d.level, gpio: p?.gpio };
          }
        }
        return undefined;
      };
      const bfs = <T>(start: number, f: (n: number) => T | undefined, depth: number): T | undefined => {
        const seen = new Set([start]);
        let frontier = [start];
        for (let dpt = 0; dpt <= depth; dpt++) {
          const nextF: number[] = [];
          for (const n of frontier) {
            const r = f(n);
            if (r !== undefined) return r;
            for (const nb of adjacency.get(n) ?? []) {
              if (!seen.has(nb) && nb !== topo.ground) {
                seen.add(nb);
                nextF.push(nb);
              }
            }
          }
          frontier = nextF;
        }
        return undefined;
      };
      const vv = (n: number) => (n >= 0 ? V[n] : 0);
      for (const inst of parts) {
        if (isBoard(inst)) continue;
        const def = getPart(inst.type);
        if (!def?.post) continue;
        const noop = () => {};
        const base = this.makeStamp(inst, topo, vv, env, t, dt, board, inputs, mems, noop, noop, noop, noop);
        const ctx: PostCtx = {
          ...base,
          diodeI: (key) => {
            const d = diodes.get(`${inst.id}:${key}`);
            if (!d || !this.diodeOn.get(`${inst.id}:${key}`)) return 0;
            return Math.max(0, (vv(d.a) - vv(d.c) - d.vf) / d.rs);
          },
          duty: (pinId) => {
            const n = topo.nodeOf.get(epKey(inst.id, pinId)) ?? -1;
            if (n < 0) return 1;
            return bfs(n, dutyOf, 3) ?? 1;
          },
          signal: (pinId) => {
            const n = topo.nodeOf.get(epKey(inst.id, pinId)) ?? -1;
            if (n < 0) return undefined;
            return bfs(n, signalOf, 1);
          },
          lib: lib.get(inst.id) ?? {},
        };
        const out = def.post(ctx);
        live.set(inst.id, out);
        if (out.warn) diags.push({ level: "warn", part: inst.id, msg: `${inst.label}: ${out.warn}` });
        if (out.burnt) diags.push({ level: "error", part: inst.id, msg: `${inst.label} burned out — too much current without a resistor` });
      }
    }
    return { V, live, diags, pinCurrent };
  }

  private makeStamp(
    inst: PartInstance,
    topo: Topology,
    v: (n: number) => number,
    env: EnvState,
    t: number,
    dt: number,
    board: BoardDef,
    inputs: Map<string, Record<string, number | boolean>>,
    mems: Map<string, Record<string, number>>,
    addG: (a: number, b: number, g: number) => void,
    addI: (a: number, i: number) => void,
    link: (a: number, b: number) => void,
    diode: (key: string, a: number, c: number, vf: number, rs: number) => void,
  ): StampCtx {
    let mem = mems.get(inst.id);
    if (!mem) {
      mem = {};
      mems.set(inst.id, mem);
    }
    const n = (pin: string) => topo.nodeOf.get(epKey(inst.id, pin)) ?? -1;
    return {
      n,
      R: (a, b, ohms) => {
        addG(a, b, 1 / Math.max(1e-3, ohms));
        link(a, b);
      },
      V: (a, ref, volts, r) => {
        const g = 1 / Math.max(1e-3, r);
        addG(a, ref, g);
        addI(a, volts * g);
        addI(ref, -volts * g);
      },
      D: (a, c, vf, rs, key) => diode(key, a, c, vf, rs),
      v,
      supply: (vcc, gnd) => v(n(vcc)) - v(n(gnd)),
      env,
      t,
      dt,
      props: inst.props,
      input: inputs.get(inst.id) ?? {},
      mem,
      board,
    };
  }
}

/** Dense Gaussian elimination with partial pivoting. */
export function gauss(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(A[r * n + col]);
      if (val > best) {
        best = val;
        piv = r;
      }
    }
    if (best < 1e-18) continue;
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = A[col * n + c];
        A[col * n + c] = A[piv * n + c];
        A[piv * n + c] = tmp;
      }
      const tb = b[col];
      b[col] = b[piv];
      b[piv] = tb;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c];
    const d = A[r * n + r];
    x[r] = Math.abs(d) < 1e-18 ? 0 : s / d;
  }
  return x;
}
