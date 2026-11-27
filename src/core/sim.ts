import { getBoard } from "./boards";
import { buildTopology, epKey, isBoard, type Topology } from "./circuit";
import { type EnvState, sampleEnv } from "./env";
import { getPart, type PartLive } from "./parts";
import { CircuitSolver, type Diagnostic, type Drive, type PinMode, type SolveResult } from "./solver";
import type { BoardDef, BoardPin, Lang, PartInstance, ScenarioState, Wire } from "./types";
import { createArduinoGlobals, topicMatch } from "./runtime/arduino-api";
import { transpileArduino, TranspileError } from "./runtime/cxx";
import { STOP, type Hal, type MqttHal } from "./runtime/hal";
import { createPythonGlobals, patchPythonPrototypes } from "./runtime/python-api";
import { transpilePython } from "./runtime/python";

export interface SerialLine {
  t: number;
  text: string;
  kind: "out" | "err" | "sys" | "in";
}

export interface SimSnapshot {
  t: number;
  running: boolean;
  paused: boolean;
  lag: boolean;
  live: Record<string, PartLive>;
  pinV: Record<string, number>;
  drives: Record<string, Drive>;
  diags: Diagnostic[];
  env: EnvState;
  wireV: Record<string, number>;
  inserted: Topology["inserted"];
  frameDt: number;
}

export interface MqttMessage {
  t: number;
  dir: "out" | "in";
  topic: string;
  payload: string;
}

// macrotask that is not throttled like setTimeout(0)
const macrotask: () => Promise<void> = (() => {
  if (typeof MessageChannel !== "undefined" && typeof window !== "undefined") {
    const ch = new MessageChannel();
    const q: (() => void)[] = [];
    ch.port1.onmessage = () => q.shift()?.();
    return () =>
      new Promise<void>((r) => {
        q.push(r);
        ch.port2.postMessage(0);
      });
  }
  return () => new Promise<void>((r) => setTimeout(r, 0));
})();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

interface Sleeper {
  t: number;
  seq: number;
  resolve: () => void;
  reject: (e: unknown) => void;
}

export class SimEngine implements Hal {
  board: BoardDef = getBoard("esp32-devkit-v1");
  parts: PartInstance[] = [];
  wires: Wire[] = [];
  scenario: ScenarioState = { id: "lab", intensity: 1, duration: 1, startedAt: 0, params: {} };
  overrides: Partial<Record<string, number>> = {};
  topo!: Topology;
  solver = new CircuitSolver();
  drives = new Map<string, Drive>();
  edges = new Map<string, { rise: number; fall: number }>();
  inputs = new Map<string, Record<string, number | boolean>>();
  mems = new Map<string, Record<string, number>>();
  lib = new Map<string, Record<string, unknown>>();
  interrupts = new Map<string, { fn: () => unknown; mode: string; last: number }>();
  t = 0;
  running = false;
  paused = false;
  speed = 1;
  /** Drive frames with requestAnimationFrame (disabled in tests, which call frame() directly). */
  autoFrames = true;
  wifiStart: number | null = null;
  private sleepers: Sleeper[] = [];
  private seq = 0;
  private stopRequested = false;
  private version = 0;
  private lastSolve: { t: number; version: number; res: SolveResult } | null = null;
  private lastYieldWall = 0;
  private serialPending = "";
  private serialIn: number[] = [];
  private rafId: number | null = null;
  private lastFrameWall = 0;
  private inFrame = false;
  private switchKey = "";
  private toneTimers = new Map<string, number>();
  private envCache: { t: number; env: EnvState } | null = null;
  private frameListeners = new Set<(s: SimSnapshot) => void>();
  private serialListeners = new Set<(lines: SerialLine[]) => void>();
  private mqttListeners = new Set<(m: MqttMessage) => void>();
  private runListeners = new Set<(running: boolean) => void>();
  private mqttSubscribers = new Set<(topic: string, payload: string) => void>();
  private serialLinesPending: SerialLine[] = [];
  private lastSnapshot: SimSnapshot | null = null;
  /** External MQTT bridge (a real broker connection); set by the UI. */
  bridge: { connected(): boolean; publish(t: string, p: string, r?: boolean): void; subscribe(t: string): void; unsubscribe(t: string): void; url(): string } | null = null;

  constructor() {
    this.topo = buildTopology(this.board, [], [], new Map());
  }

  // ------------------------------------------------------------------ circuit
  setCircuit(boardId: string, parts: PartInstance[], wires: Wire[]) {
    const board = getBoard(boardId);
    if (board.id !== this.board.id) {
      this.drives.clear();
      this.solver = new CircuitSolver();
    }
    this.board = board;
    this.parts = parts;
    this.wires = wires;
    const ids = new Set(parts.map((p) => p.id));
    for (const k of [...this.mems.keys()]) if (!ids.has(k)) this.mems.delete(k);
    this.rebuildTopology(true);
    if (!this.running) this.publishFrame(0, false);
  }

  setEnvironment(scenario: ScenarioState, overrides: Partial<Record<string, number>>) {
    this.scenario = scenario;
    this.overrides = overrides;
    this.envCache = null;
    this.version++;
    if (!this.running) this.publishFrame(0, false);
  }

  setInput(partId: string, patch: Record<string, number | boolean>) {
    this.inputs.set(partId, { ...(this.inputs.get(partId) ?? {}), ...patch });
    this.version++;
    this.rebuildTopology(false);
    this.checkInterrupts();
    if (!this.running) this.publishFrame(0, false);
  }

  resetPart(partId: string) {
    this.mems.delete(partId);
    this.version++;
  }

  private computeSwitches() {
    const map = new Map<string, [string, string][]>();
    for (const inst of this.parts) {
      if (isBoard(inst)) continue;
      const def = getPart(inst.type);
      if (!def?.switches) continue;
      map.set(inst.id, def.switches(inst.props, this.inputs.get(inst.id) ?? {}, this.mems.get(inst.id) ?? {}));
    }
    return map;
  }

  private rebuildTopology(force: boolean) {
    const sw = this.computeSwitches();
    const key = JSON.stringify([...sw.entries()]);
    if (!force && key === this.switchKey) return;
    this.switchKey = key;
    this.topo = buildTopology(this.board, this.parts, this.wires, sw);
    this.version++;
  }

  envAt(tMs: number): EnvState {
    return sampleEnv(tMs / 1000, this.scenario, this.overrides);
  }

  env(): EnvState {
    if (this.envCache && this.envCache.t === this.t) return this.envCache.env;
    const env = this.envAt(this.t);
    this.envCache = { t: this.t, env };
    return env;
  }

  private solve(withPost: boolean, dt = 0): SolveResult {
    if (!withPost && this.lastSolve && this.lastSolve.t === this.t && this.lastSolve.version === this.version) return this.lastSolve.res;
    const res = this.solver.solve({
      board: this.board,
      parts: this.parts,
      topo: this.topo,
      drives: this.drives,
      env: this.env(),
      t: this.t / 1000,
      dt,
      inputs: this.inputs,
      mems: this.mems,
      lib: this.lib,
      withPost,
    });
    this.lastSolve = { t: this.t, version: this.version, res };
    return res;
  }

  // ------------------------------------------------------------------ HAL
  nowMs() {
    return this.t;
  }

  isStopped() {
    return this.stopRequested;
  }

  sleep(ms: number): Promise<void> {
    if (this.stopRequested) return Promise.reject(STOP);
    if (ms <= 0) return this.yieldNow(true);
    return new Promise<void>((resolve, reject) => {
      const s: Sleeper = { t: this.t + ms, seq: this.seq++, resolve, reject };
      // sorted insert
      let i = this.sleepers.length;
      while (i > 0 && (this.sleepers[i - 1].t > s.t || (this.sleepers[i - 1].t === s.t && this.sleepers[i - 1].seq > s.seq))) i--;
      this.sleepers.splice(i, 0, s);
    }).then(() => {
      if (this.stopRequested) throw STOP;
    });
  }

  async yieldNow(force = false) {
    if (this.stopRequested) throw STOP;
    const now = performance.now();
    if (force || now - this.lastYieldWall > 6) {
      this.lastYieldWall = now;
      await macrotask();
      while (this.paused && !this.stopRequested) await new Promise((r) => setTimeout(r, 50));
      if (this.stopRequested) throw STOP;
    }
  }

  pin(n: number | string): BoardPin | undefined {
    if (typeof n === "string") {
      const s = n.toUpperCase();
      const byAlias = this.board.pins.find((p) => p.kind === "gpio" && p.aliases.some((a) => a.toUpperCase() === s));
      if (byAlias) return byAlias;
      if (s in this.board.constants) return this.pin(this.board.constants[s]);
      const m = s.match(/(\d+)$/);
      return m ? this.pin(Number(m[1])) : undefined;
    }
    if (this.board.family === "rp2040" && n === 25) return { id: "LED", label: "LED", x: 0, y: 0, kind: "gpio", gpio: 25, caps: ["digital", "pwm"], aliases: ["LED"] };
    return this.board.pins.find((p) => p.kind === "gpio" && p.gpio === n);
  }

  physPin(n: number) {
    return this.board.pins.find((p) => p.phys === n);
  }

  private drive(pinId: string): Drive {
    let d = this.drives.get(pinId);
    if (!d) {
      d = { mode: "INPUT", level: 0 };
      this.drives.set(pinId, d);
    }
    return d;
  }

  setMode(pinId: string, mode: PinMode) {
    const d = this.drive(pinId);
    d.mode = mode;
    if (mode !== "OUTPUT") {
      d.pwm = undefined;
      d.servoUs = undefined;
      d.toneHz = undefined;
      d.dacV = undefined;
    }
    this.version++;
  }

  getMode(pinId: string) {
    return this.drives.get(pinId)?.mode;
  }

  writeDigital(pinId: string, level: number) {
    const d = this.drive(pinId);
    if (d.mode !== "OUTPUT") d.mode = "OUTPUT";
    const prev = d.level;
    d.level = level ? 1 : 0;
    d.pwm = undefined;
    d.servoUs = undefined;
    d.dacV = undefined;
    if (d.toneHz) d.toneHz = undefined;
    const e = this.edges.get(pinId) ?? { rise: -1e9, fall: -1e9 };
    if (!prev && d.level) e.rise = this.t;
    if (prev && !d.level) e.fall = this.t;
    this.edges.set(pinId, e);
    this.version++;
  }

  writePwm(pinId: string, duty: number) {
    const d = this.drive(pinId);
    d.mode = "OUTPUT";
    d.servoUs = undefined;
    d.dacV = undefined;
    if (duty <= 0) {
      d.pwm = undefined;
      d.level = 0;
    } else if (duty >= 1) {
      d.pwm = undefined;
      d.level = 1;
    } else {
      d.pwm = duty;
      d.level = 1;
    }
    this.version++;
  }

  writeServo(pinId: string, us: number) {
    const d = this.drive(pinId);
    d.mode = "OUTPUT";
    d.servoUs = us;
    d.pwm = us / 20000;
    d.level = 1;
    this.version++;
  }

  writeTone(pinId: string, hz: number, durMs?: number) {
    const d = this.drive(pinId);
    d.mode = "OUTPUT";
    if (hz > 0) {
      d.toneHz = hz;
      d.pwm = 0.5;
      d.level = 1;
      if (durMs) this.toneTimers.set(pinId, this.t + durMs);
      else this.toneTimers.delete(pinId);
    } else {
      d.toneHz = undefined;
      d.pwm = undefined;
      d.level = 0;
      this.toneTimers.delete(pinId);
    }
    this.version++;
  }

  writeDac(pinId: string, volts: number) {
    const d = this.drive(pinId);
    d.mode = "OUTPUT";
    d.dacV = volts;
    this.version++;
  }

  readVolts(pinId: string) {
    const res = this.solve(false);
    const n = this.topo.nodeOf.get(epKey(this.boardInstId(), pinId));
    return n === undefined ? 0 : res.V[n] ?? 0;
  }

  readDigital(pinId: string): 0 | 1 {
    const d = this.drives.get(pinId);
    if (d?.mode === "OUTPUT") return d.level ? 1 : 0;
    const v = this.readVolts(pinId);
    return v > this.board.logicV * 0.5 ? 1 : 0;
  }

  private boardInstId() {
    return this.parts.find(isBoard)?.id ?? "board";
  }

  findPart(pinId: string, types: string[]) {
    const n = this.topo.nodeOf.get(epKey(this.boardInstId(), pinId));
    if (n === undefined) return undefined;
    for (const ep of this.topo.members[n]) {
      const [partId, pin] = ep.split(":");
      const inst = this.parts.find((p) => p.id === partId);
      if (inst && types.includes(inst.type)) return { id: inst.id, pin, props: inst.props };
    }
    return undefined;
  }

  findI2C(types: string[], sda?: string, scl?: string) {
    const b = this.boardInstId();
    const nSda = this.topo.nodeOf.get(epKey(b, sda ?? this.board.i2c.sda));
    const nScl = this.topo.nodeOf.get(epKey(b, scl ?? this.board.i2c.scl));
    for (const inst of this.parts) {
      if (!types.includes(inst.type)) continue;
      if (this.topo.nodeOf.get(epKey(inst.id, "SDA")) === nSda && this.topo.nodeOf.get(epKey(inst.id, "SCL")) === nScl) {
        if (this.partSupply(inst.id, "VCC", "GND") < 2.9) return undefined;
        return { id: inst.id, props: inst.props };
      }
    }
    return undefined;
  }

  partSupply(partId: string, vcc: string, gnd: string) {
    const res = this.solve(false);
    const a = this.topo.nodeOf.get(epKey(partId, vcc));
    const b = this.topo.nodeOf.get(epKey(partId, gnd));
    return (a === undefined ? 0 : res.V[a]) - (b === undefined ? 0 : res.V[b]);
  }

  trigFired(partId: string, trigPin: string) {
    const n = this.topo.nodeOf.get(epKey(partId, trigPin));
    if (n === undefined) return false;
    const b = this.boardInstId();
    for (const ep of this.topo.members[n]) {
      const [pid, pin] = ep.split(":");
      if (pid !== b) continue;
      const e = this.edges.get(pin);
      if (e && this.t - e.rise < 100) return true;
    }
    return false;
  }

  setLib(partId: string, patch: Record<string, unknown>) {
    this.lib.set(partId, { ...(this.lib.get(partId) ?? {}), ...patch });
  }

  getLib(partId: string) {
    return this.lib.get(partId) ?? {};
  }

  serialOut(text: string) {
    if (!text) return;
    this.serialPending += text;
    const parts = this.serialPending.split(/\r?\n/);
    this.serialPending = parts.pop() ?? "";
    for (const p of parts) this.serialLinesPending.push({ t: this.t, text: p, kind: "out" });
    if (this.serialPending.length > 400) {
      this.serialLinesPending.push({ t: this.t, text: this.serialPending, kind: "out" });
      this.serialPending = "";
    }
    if (this.serialLinesPending.length > 2000) this.serialLinesPending.splice(0, this.serialLinesPending.length - 2000);
  }

  serialAvailable() {
    return this.serialIn.length;
  }

  serialRead() {
    return this.serialIn.length ? this.serialIn.shift()! : -1;
  }

  serialPeek() {
    return this.serialIn.length ? this.serialIn[0] : -1;
  }

  sendSerial(text: string) {
    for (const ch of text) this.serialIn.push(ch.charCodeAt(0));
    this.emitSerial([{ t: this.t, text, kind: "in" }]);
  }

  attachInterrupt(pinId: string, fn: () => unknown, mode: "RISING" | "FALLING" | "CHANGE") {
    this.interrupts.set(pinId, { fn, mode, last: this.readDigital(pinId) });
  }

  detachInterrupt(pinId: string) {
    this.interrupts.delete(pinId);
  }

  private checkInterrupts() {
    if (!this.running) return;
    for (const [pinId, irq] of this.interrupts) {
      const v = this.readDigital(pinId);
      if (v !== irq.last) {
        const rising = v === 1;
        irq.last = v;
        if (irq.mode === "CHANGE" || (irq.mode === "RISING" && rising) || (irq.mode === "FALLING" && !rising)) {
          void Promise.resolve(irq.fn()).catch((e) => e !== STOP && this.reportError(e));
        }
      }
    }
  }

  warn(msg: string) {
    this.emitSerial([{ t: this.t, text: `⚠ ${msg}`, kind: "sys" }]);
  }

  mqtt: MqttHal = {
    connected: () => true,
    broker: () => this.bridge?.url() ?? "local loopback",
    publish: (topic, payload, retain) => {
      this.mqttListeners.forEach((l) => l({ t: this.t, dir: "out", topic, payload }));
      if (this.bridge?.connected()) this.bridge.publish(topic, payload, retain);
      else for (const s of this.mqttSubscribers) s(topic, payload); // loopback
    },
    subscribe: (topic) => this.bridge?.subscribe(topic),
    unsubscribe: (topic) => this.bridge?.unsubscribe(topic),
    onMessage: (cb) => {
      this.mqttSubscribers.add(cb);
      return () => void this.mqttSubscribers.delete(cb);
    },
  };

  /** Deliver a message that arrived from the real broker. */
  deliverMqtt(topic: string, payload: string) {
    this.mqttListeners.forEach((l) => l({ t: this.t, dir: "in", topic, payload }));
    for (const s of this.mqttSubscribers) s(topic, payload);
  }

  // ------------------------------------------------------------------ program
  async start(lang: Lang, code: string) {
    await this.stop();
    this.stopRequested = false;
    this.setRunning(true);
    this.paused = false;
    this.t = 0;
    this.drives.clear();
    this.edges.clear();
    this.mems.clear();
    this.lib.clear();
    this.interrupts.clear();
    this.serialIn = [];
    this.wifiStart = null;
    this.mqttSubscribers.clear();
    this.scenario = { ...this.scenario, startedAt: 0 };
    this.envCache = null;
    this.solver = new CircuitSolver();
    this.rebuildTopology(true);
    this.emitSerial([{ t: 0, text: `▶ ${this.board.name} · ${lang === "arduino" ? "Arduino C++" : lang === "micropython" ? "MicroPython" : "Python 3"}`, kind: "sys" }]);
    this.lastFrameWall = performance.now();
    if (this.autoFrames) this.loopFrames();
    void this.runProgram(lang, code);
  }

  private async runProgram(lang: Lang, code: string) {
    let globals: Record<string, unknown>;
    let js: string;
    try {
      if (lang === "arduino") {
        globals = createArduinoGlobals(this);
        const tr = transpileArduino(code, { intBits: this.board.intBits });
        js = tr.js + "\nreturn { setup: typeof setup === 'function' ? setup : null, loop: typeof loop === 'function' ? loop : null };";
        for (const w of tr.warnings) this.warn(w);
        for (const inc of tr.includes) {
          if (!KNOWN_INCLUDES.has(inc)) this.warn(`#include <${inc}> is not simulated — calls into it will fail`);
        }
      } else {
        patchPythonPrototypes();
        globals = createPythonGlobals(this);
        js = transpilePython(code).js;
      }
    } catch (e) {
      const line = e instanceof TranspileError ? ` (line ${e.line})` : "";
      this.emitSerial([{ t: this.t, text: `✖ Compile error${line}: ${(e as Error).message}`, kind: "err" }]);
      this.setRunning(false);
      this.publishFrame(0, false);
      return;
    }
    const names = Object.keys(globals);
    let fn: (...a: unknown[]) => Promise<unknown>;
    try {
      fn = new AsyncFunction(...names, js);
    } catch (e) {
      this.emitSerial([{ t: this.t, text: `✖ Compile error: ${(e as Error).message}`, kind: "err" }]);
      console.debug("[thosaphol-connect] generated JS:\n" + js);
      this.setRunning(false);
      this.publishFrame(0, false);
      return;
    }
    try {
      const values = names.map((n) => globals[n]);
      if (lang === "arduino") {
        const prog = (await fn(...values)) as { setup: (() => Promise<void>) | null; loop: (() => Promise<void>) | null };
        if (!prog.setup || !prog.loop) throw new Error("A sketch needs both setup() and loop()");
        await prog.setup();
        for (;;) {
          await prog.loop();
          // cooperative: only hand control back when this burst has used its wall-time slice
          await this.yieldNow(false);
        }
      } else {
        await fn(...values);
        this.emitSerial([{ t: this.t, text: "■ Program finished", kind: "sys" }]);
        // keep the circuit live so outputs stay visible
      }
    } catch (e) {
      if (e === STOP) return;
      this.reportError(e);
      this.setRunning(false);
      this.stopFrames();
      this.publishFrame(0, false);
    }
  }

  private reportError(e: unknown) {
    const err = e as Error & { pyName?: string };
    const msg = err?.pyName ? `${err.pyName}: ${err.message}` : err?.message ?? String(e);
    let hint = "";
    const undef = msg.match(/^(\w+) is not defined/);
    if (undef) hint = ` — '${undef[1]}' is not declared or not supported by the simulator`;
    this.emitSerial([{ t: this.t, text: `✖ Runtime error: ${msg}${hint}`, kind: "err" }]);
  }

  async stop() {
    if (!this.running && !this.sleepers.length) return;
    this.stopRequested = true;
    const s = this.sleepers;
    this.sleepers = [];
    for (const x of s) x.reject(STOP);
    this.setRunning(false);
    this.paused = false;
    this.stopFrames();
    this.drives.clear();
    this.interrupts.clear();
    this.lib.clear();
    this.version++;
    await macrotask();
    this.publishFrame(0, false);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.lastFrameWall = performance.now();
  }

  setSpeed(s: number) {
    this.speed = s;
  }

  private loopFrames() {
    const raf = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
    const step = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(100, now - this.lastFrameWall);
      this.lastFrameWall = now;
      void this.frame(dt);
      this.rafId = raf(step);
    };
    this.rafId = raf(step);
  }

  private stopFrames() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.rafId);
      else clearTimeout(this.rafId);
    }
    this.rafId = null;
  }

  /** Advance simulated time by `realDt` ms of wall time. */
  async frame(realDt: number) {
    if (this.inFrame || this.paused || !this.running) return;
    this.inFrame = true;
    const target = this.t + realDt * this.speed;
    const wall0 = performance.now();
    let lag = false;
    try {
      let settle = 0;
      for (;;) {
        if (!this.running) break;
        if (performance.now() - wall0 > 12) {
          lag = !!(this.sleepers.length && this.sleepers[0].t <= target);
          break;
        }
        if (!this.sleepers.length || this.sleepers[0].t > target) {
          // the program may be mid-yield on its way to the next delay(): give it two more slices
          if (settle++ >= 2) break;
          await macrotask();
          continue;
        }
        settle = 0;
        const s = this.sleepers.shift()!;
        this.t = Math.max(this.t, s.t);
        s.resolve();
        await macrotask();
        this.checkInterrupts();
      }
      if (!lag) this.t = target;
      for (const [pinId, until] of this.toneTimers) {
        if (this.t >= until) this.writeTone(pinId, 0);
      }
      this.rebuildTopology(false);
      this.checkInterrupts();
      this.publishFrame(realDt * this.speed, lag);
    } finally {
      this.inFrame = false;
    }
  }

  private publishFrame(dtMs: number, lag: boolean) {
    this.version++;
    const res = this.solve(true, dtMs / 1000);
    const b = this.boardInstId();
    const pinV: Record<string, number> = {};
    for (const p of this.board.pins) {
      const n = this.topo.nodeOf.get(epKey(b, p.id));
      if (n !== undefined) pinV[p.id] = res.V[n] ?? 0;
    }
    const wireV: Record<string, number> = {};
    for (const w of this.wires) {
      const n = this.topo.nodeOf.get(epKey(w.from.part, w.from.pin));
      if (n !== undefined) wireV[w.id] = n === this.topo.ground ? 0 : res.V[n] ?? 0;
    }
    const live: Record<string, PartLive> = {};
    for (const [k, v] of res.live) live[k] = v;
    const drives: Record<string, Drive> = {};
    for (const [k, v] of this.drives) drives[k] = { ...v };
    const snap: SimSnapshot = {
      t: this.t,
      running: this.running,
      paused: this.paused,
      lag,
      live,
      pinV,
      drives,
      diags: dedupe(res.diags),
      env: this.env(),
      wireV,
      inserted: this.topo.inserted,
      frameDt: dtMs,
    };
    this.lastSnapshot = snap;
    this.frameListeners.forEach((l) => l(snap));
    if (this.serialLinesPending.length) {
      const lines = this.serialLinesPending;
      this.serialLinesPending = [];
      this.emitSerial(lines);
    }
  }

  snapshot() {
    return this.lastSnapshot;
  }

  private emitSerial(lines: SerialLine[]) {
    this.serialListeners.forEach((l) => l(lines));
  }

  onFrame(cb: (s: SimSnapshot) => void) {
    this.frameListeners.add(cb);
    return () => void this.frameListeners.delete(cb);
  }

  onSerial(cb: (lines: SerialLine[]) => void) {
    this.serialListeners.add(cb);
    return () => void this.serialListeners.delete(cb);
  }

  onRunState(cb: (running: boolean) => void) {
    this.runListeners.add(cb);
    return () => void this.runListeners.delete(cb);
  }

  private setRunning(v: boolean) {
    if (this.running === v) return;
    this.running = v;
    this.runListeners.forEach((l) => l(v));
  }

  onMqtt(cb: (m: MqttMessage) => void) {
    this.mqttListeners.add(cb);
    return () => void this.mqttListeners.delete(cb);
  }
}

function dedupe(d: Diagnostic[]) {
  const seen = new Set<string>();
  return d.filter((x) => {
    if (seen.has(x.msg)) return false;
    seen.add(x.msg);
    return true;
  });
}

const KNOWN_INCLUDES = new Set([
  "Arduino.h", "Servo.h", "ESP32Servo.h", "DHT.h", "DHT_U.h", "Adafruit_Sensor.h", "Wire.h", "LiquidCrystal_I2C.h", "Adafruit_NeoPixel.h",
  "WiFi.h", "PubSubClient.h", "SPI.h", "WiFiClientSecure.h", "HTTPClient.h", "Preferences.h", "math.h", "stdio.h", "stdlib.h", "string.h",
]);

export { topicMatch };
export const engine = new SimEngine();
