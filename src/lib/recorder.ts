import { vibAccel } from "../core/env";
import { engine, type SerialLine, type SimSnapshot } from "../core/sim";
import { getPart } from "../core/parts";

export interface Series {
  id: string;
  label: string;
  unit: string;
  t: number[]; // seconds
  v: number[];
  group: "serial" | "sensor" | "pin" | "env" | "vibration";
}

const MAX = 24000;

class Recorder {
  series = new Map<string, Series>();
  version = 0;
  private listeners = new Set<() => void>();
  private lastVibT = 0;
  private lastFrameT = -1;

  constructor() {
    engine.onFrame((s) => this.onFrame(s));
    engine.onSerial((ls) => this.onSerial(ls));
  }

  clear() {
    this.series.clear();
    this.lastVibT = 0;
    this.lastFrameT = -1;
    this.bump();
  }

  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private push(id: string, label: string, unit: string, group: Series["group"], t: number, v: number) {
    if (!Number.isFinite(v)) return;
    let s = this.series.get(id);
    if (!s) {
      s = { id, label, unit, group, t: [], v: [] };
      this.series.set(id, s);
    }
    if (s.t.length && t < s.t[s.t.length - 1]) return;
    s.t.push(t);
    s.v.push(v);
    if (s.t.length > MAX) {
      s.t.splice(0, s.t.length - MAX);
      s.v.splice(0, s.v.length - MAX);
    }
  }

  private onFrame(snap: SimSnapshot) {
    if (!snap.running) return;
    const t = snap.t / 1000;
    if (t < this.lastFrameT) this.clear();
    if (t === this.lastFrameT) return;
    this.lastFrameT = t;
    for (const inst of engine.parts) {
      const live = snap.live[inst.id];
      if (live?.reading !== undefined) this.push(`part:${inst.id}`, `${inst.label}`, live.readingUnit ?? "", "sensor", t, live.reading);
      if (live?.outV !== undefined) this.push(`out:${inst.id}`, `${inst.label} out`, "V", "sensor", t, live.outV);
      const def = getPart(inst.type);
      // high-rate vibration probe straight from the physical model
      if (def?.env?.includes("vibration")) {
        const from = Math.max(this.lastVibT, t - 0.25);
        for (let tt = from; tt < t; tt += 0.002) {
          const env = engine.envAt(tt * 1000);
          this.push(`vib:${inst.id}`, `${inst.label} accel`, "g", "vibration", tt, vibAccel(tt, env, 0));
        }
      }
    }
    this.lastVibT = t;
    for (const [pin, v] of Object.entries(snap.pinV)) {
      const p = engine.board.pins.find((x) => x.id === pin);
      if (!p || p.kind !== "gpio") continue;
      if (!snap.drives[pin] && Math.abs(v) < 0.001) continue;
      this.push(`pin:${pin}`, `${p.label} voltage`, "V", "pin", t, v);
    }
    const env = snap.env;
    this.push("env:temperature", "Temperature", "°C", "env", t, env.temperature);
    this.push("env:humidity", "Humidity", "%RH", "env", t, env.humidity);
    if (env.flame > 0.001 || this.series.has("env:flame")) this.push("env:flame", "Flame IR", "", "env", t, env.flame);
    if (env.smoke > 6 || this.series.has("env:smoke")) this.push("env:smoke", "Smoke", "ppm", "env", t, env.smoke);
    if (env.water > 0.001 || this.series.has("env:water")) this.push("env:water", "Water depth", "", "env", t, env.water);
    if (env.vibRms > 0.011 || this.series.has("env:vibRms")) this.push("env:vibRms", "Vibration RMS", "g", "env", t, env.vibRms);
    if (this.series.has("env:distance") || env.distance !== 120) this.push("env:distance", "Distance", "cm", "env", t, env.distance);
    this.push("env:lux", "Light", "lx", "env", t, env.lux);
    this.bump();
  }

  private onSerial(lines: SerialLine[]) {
    let changed = false;
    for (const l of lines) {
      if (l.kind !== "out") continue;
      const t = l.t / 1000;
      const text = l.text.trim();
      if (!text) continue;
      // name:value pairs (Arduino serial-plotter style) or plain numbers
      const pairs = [...text.matchAll(/([A-Za-z_][\w ]{0,24}?)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/g)];
      if (pairs.length) {
        for (const m of pairs) {
          const name = m[1].trim();
          this.push(`serial:${name}`, name, "", "serial", t, Number(m[2]));
        }
        changed = true;
        continue;
      }
      const nums = text.split(/[\s,;\t]+/).filter(Boolean);
      if (nums.length && nums.length <= 8 && nums.every((n) => /^-?\d+(?:\.\d+)?$/.test(n))) {
        nums.forEach((n, i) => this.push(`serial:value ${i + 1}`, `value ${i + 1}`, "", "serial", t, Number(n)));
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  latest(id: string) {
    const s = this.series.get(id);
    return s && s.v.length ? s.v[s.v.length - 1] : undefined;
  }
}

export const recorder = new Recorder();

// ---------------------------------------------------------------------------
// Historian: saved runs in IndexedDB
// ---------------------------------------------------------------------------
export interface HistorianRun {
  id: string;
  name: string;
  createdAt: number;
  boardId: string;
  scenario: string;
  series: Series[];
}

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("thosaphol-connect-historian", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("runs", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveRun(run: HistorianRun) {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const tx = d.transaction("runs", "readwrite");
    tx.objectStore("runs").put(run);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listRuns(): Promise<HistorianRun[]> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction("runs").objectStore("runs").getAll();
      r.onsuccess = () => res((r.result as HistorianRun[]).sort((a, b) => b.createdAt - a.createdAt));
      r.onerror = () => rej(r.error);
    });
  } catch {
    return [];
  }
}

export async function deleteRun(id: string) {
  const d = await db();
  d.transaction("runs", "readwrite").objectStore("runs").delete(id);
}

export function seriesToCsv(series: Series[]): string {
  // union of timestamps, sample-and-hold per column
  const times = [...new Set(series.flatMap((s) => s.t))].sort((a, b) => a - b);
  const idx = series.map(() => 0);
  const rows = [["t_s", ...series.map((s) => `${s.label}${s.unit ? ` (${s.unit})` : ""}`)].join(",")];
  for (const t of times) {
    const vals = series.map((s, k) => {
      while (idx[k] + 1 < s.t.length && s.t[idx[k] + 1] <= t) idx[k]++;
      return s.t[idx[k]] <= t ? String(s.v[idx[k]]) : "";
    });
    rows.push([t.toFixed(4), ...vals].join(","));
  }
  return rows.join("\n");
}

export function csvToSeries(csv: string): Series[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const out: Series[] = head.slice(1).map((h, i) => ({ id: `csv:${i}:${h}`, label: h.replace(/\s*\(.*\)$/, ""), unit: h.match(/\(([^)]*)\)/)?.[1] ?? "", group: "serial", t: [], v: [] }));
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const t = Number(cols[0]);
    cols.slice(1).forEach((c, i) => {
      if (c !== "" && Number.isFinite(Number(c))) {
        out[i].t.push(t);
        out[i].v.push(Number(c));
      }
    });
  }
  return out;
}

/** Magnitude spectrum of an evenly resampled signal (radix-2 FFT, Hann window). */
export function spectrum(t: number[], v: number[], seconds = 2): { f: number[]; a: number[]; fs: number } {
  if (t.length < 16) return { f: [], a: [], fs: 0 };
  const end = t[t.length - 1];
  let start = Math.max(t[0], end - seconds);
  let i0 = t.findIndex((x) => x >= start);
  const dtAvg = (end - t[i0]) / Math.max(1, t.length - 1 - i0);
  const fs = Math.min(2000, 1 / Math.max(1e-4, dtAvg));
  let n = 1;
  while (n * 2 <= (end - t[i0]) * fs && n < 8192) n *= 2;
  if (n < 16) return { f: [], a: [], fs };
  start = end - n / fs;
  i0 = Math.max(0, t.findIndex((x) => x >= start));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let k = i0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const tt = start + i / fs;
    while (k + 1 < t.length && t[k + 1] <= tt) k++;
    re[i] = v[k];
    mean += v[k];
  }
  mean /= n;
  for (let i = 0; i < n; i++) re[i] = (re[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j);
        const wi = Math.sin(ang * j);
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const vi = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
      }
    }
  }
  const f: number[] = [];
  const a: number[] = [];
  for (let i = 1; i < n / 2; i++) {
    f.push((i * fs) / n);
    a.push((2 * Math.hypot(re[i], im[i])) / (n * 0.5));
  }
  return { f, a, fs };
}

export function stats(v: number[]) {
  if (!v.length) return { min: 0, max: 0, mean: 0, rms: 0, p2p: 0, crest: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  const mean = sum / v.length;
  let sq = 0;
  for (const x of v) sq += (x - mean) ** 2;
  const rms = Math.sqrt(sq / v.length);
  return { min, max, mean, rms, p2p: max - min, crest: rms > 0 ? Math.max(Math.abs(max - mean), Math.abs(min - mean)) / rms : 0 };
}
