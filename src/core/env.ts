import type { EnvKey, ScenarioState } from "./types";

export type VibFault = "none" | "imbalance" | "misalignment" | "bearing" | "looseness";

export interface EnvState {
  temperature: number; // °C
  humidity: number; // %RH
  flame: number; // 0..1 infrared flame intensity at the sensor
  smoke: number; // ppm
  gas: number; // ppm (LPG/CH4 equivalent)
  water: number; // 0..1 immersion depth of a water sensor
  soil: number; // 0..1 volumetric moisture
  lux: number; // illuminance
  sound: number; // dB SPL
  distance: number; // cm to nearest object in front of a ranging sensor
  motion: number; // 0/1 a warm body is moving in view
  vibRms: number; // g (RMS)
  vibFreq: number; // Hz shaft speed
  vibFault: VibFault;
  shake: number; // 0..1 visual shake amount (earthquake etc.)
}

export const ENV_DEFAULT: EnvState = {
  temperature: 26,
  humidity: 55,
  flame: 0,
  smoke: 5,
  gas: 120,
  water: 0,
  soil: 0.35,
  lux: 420,
  sound: 38,
  distance: 120,
  motion: 0,
  vibRms: 0.01,
  vibFreq: 0,
  vibFault: "none",
  shake: 0,
};

export interface EnvVarSpec {
  key: keyof EnvState;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export const ENV_VARS: EnvVarSpec[] = [
  { key: "temperature", label: "Temperature", unit: "°C", min: -40, max: 150, step: 0.5 },
  { key: "humidity", label: "Humidity", unit: "%RH", min: 0, max: 100, step: 1 },
  { key: "flame", label: "Flame IR", unit: "", min: 0, max: 1, step: 0.01 },
  { key: "smoke", label: "Smoke", unit: "ppm", min: 0, max: 5000, step: 10 },
  { key: "gas", label: "Gas (LPG)", unit: "ppm", min: 0, max: 10000, step: 10 },
  { key: "water", label: "Water depth", unit: "", min: 0, max: 1, step: 0.01 },
  { key: "soil", label: "Soil moisture", unit: "", min: 0, max: 1, step: 0.01 },
  { key: "lux", label: "Light", unit: "lx", min: 0, max: 100000, step: 10 },
  { key: "sound", label: "Sound", unit: "dB", min: 20, max: 120, step: 1 },
  { key: "distance", label: "Distance", unit: "cm", min: 2, max: 400, step: 1 },
  { key: "motion", label: "Motion", unit: "", min: 0, max: 1, step: 1 },
  { key: "vibRms", label: "Vibration", unit: "g", min: 0, max: 4, step: 0.01 },
  { key: "vibFreq", label: "Shaft speed", unit: "Hz", min: 0, max: 100, step: 0.5 },
];

export const ENV_KEY_FOR: Record<EnvKey, keyof EnvState> = {
  temperature: "temperature",
  humidity: "humidity",
  flame: "flame",
  smoke: "smoke",
  gas: "gas",
  water: "water",
  soil: "soil",
  lux: "lux",
  sound: "sound",
  distance: "distance",
  motion: "motion",
  vibration: "vibRms",
};

export interface ScenarioDef {
  id: string;
  name: string;
  thai: string;
  description: string;
  keywords: string[];
  defaultDuration: number;
  params?: { key: string; label: string; options?: string[]; min?: number; max?: number; default: number | string }[];
  sample: (t: number, s: ScenarioState) => Partial<EnvState>;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, x: number) => a + (b - a) * clamp(x, 0, 1);
const smooth = (x: number) => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};
/** Deterministic pseudo-noise in [-1, 1]. */
export function vnoise(t: number, seed = 0) {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "lab",
    name: "Lab bench",
    thai: "โต๊ะแล็บ",
    description: "Room temperature, office lighting, nothing happening.",
    keywords: ["lab", "normal", "reset", "ปกติ", "แล็บ", "ห้อง"],
    defaultDuration: 1,
    sample: () => ({}),
  },
  {
    id: "building-fire",
    name: "Building fire",
    thai: "ตึกไฟไหม้",
    description: "A fire starts in the room: flame IR, heat and smoke build up over the timeline.",
    keywords: ["fire", "burn", "flame", "smoke", "ไฟไหม้", "ไฟ", "ควัน", "เพลิง", "ไหม้"],
    defaultDuration: 40,
    sample: (t, s) => {
      const k = smooth((t - 3) / s.duration) * s.intensity;
      const flick = 0.5 + 0.5 * vnoise(t * 6, 3);
      return {
        flame: clamp(k * (0.78 + 0.22 * flick), 0, 1),
        temperature: lerp(26, 26 + 95 * s.intensity, smooth((t - 6) / (s.duration * 1.2))),
        smoke: lerp(5, 3200 * s.intensity, smooth((t - 5) / s.duration)),
        gas: lerp(120, 900 * s.intensity, smooth((t - 8) / s.duration)),
        humidity: lerp(55, 22, k),
        lux: 420 + 1600 * k * flick,
        sound: 38 + 42 * k,
      };
    },
  },
  {
    id: "flood",
    name: "Flood / water tank",
    thai: "น้ำท่วม / ถังน้ำ",
    description: "Water rises around the sensor, humidity climbs to saturation.",
    keywords: ["water", "flood", "rain", "tank", "leak", "น้ำ", "ท่วม", "ฝน", "รั่ว", "ถัง"],
    defaultDuration: 30,
    params: [{ key: "maxLevel", label: "Max level", min: 0, max: 1, default: 1 }],
    sample: (t, s) => {
      const maxL = Number(s.params.maxLevel ?? 1);
      const k = smooth(t / s.duration) * s.intensity * maxL;
      return {
        water: clamp(k + 0.015 * Math.sin(t * 2.2), 0, 1),
        humidity: lerp(55, 98, k * 1.4),
        soil: lerp(0.35, 1, k * 1.2),
        temperature: lerp(26, 23, k),
      };
    },
  },
  {
    id: "motor-vibration",
    name: "Motor vibration",
    thai: "มอเตอร์สั่น",
    description: "Sensor mounted on an induction motor. Pick a fault to see its vibration signature.",
    keywords: ["motor", "vibration", "vibrate", "bearing", "pump", "fan", "มอเตอร์", "สั่น", "แบริ่ง", "ปั๊ม", "พัดลม"],
    defaultDuration: 6,
    params: [
      { key: "rpm", label: "Speed (RPM)", min: 300, max: 6000, default: 1480 },
      { key: "fault", label: "Fault", options: ["none", "imbalance", "misalignment", "bearing", "looseness"], default: "none" },
    ],
    sample: (t, s) => {
      const rpm = Number(s.params.rpm ?? 1480);
      const fault = String(s.params.fault ?? "none") as VibFault;
      const k = smooth(t / Math.max(0.5, s.duration));
      const base = { none: 0.18, imbalance: 0.9, misalignment: 0.7, bearing: 0.55, looseness: 0.8 }[fault] ?? 0.2;
      return {
        // speed is held constant (phase = 2πft stays coherent); the run-up shows in amplitude
        vibFreq: rpm / 60,
        vibRms: base * s.intensity * k + 0.01,
        vibFault: fault,
        sound: 38 + 34 * k,
        temperature: 26 + 18 * smooth(t / 120) * (fault === "bearing" ? 1.6 : 1),
        shake: 0.15 * k * s.intensity,
      };
    },
  },
  {
    id: "day-night",
    name: "Day / night cycle",
    thai: "กลางวัน / กลางคืน",
    description: "Sunlight sweeps from midnight to noon and back over the timeline.",
    keywords: ["day", "night", "sun", "light", "dark", "กลางคืน", "กลางวัน", "แสง", "มืด", "สว่าง", "พระอาทิตย์"],
    defaultDuration: 60,
    sample: (t, s) => {
      const phase = (t / s.duration) % 1;
      const sun = Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI / 2) * -1);
      const elev = Math.max(0, -Math.cos(phase * Math.PI * 2));
      return {
        lux: 0.5 + 60000 * s.intensity * Math.pow(elev, 1.6) + 20 * sun,
        temperature: 24 + 9 * elev,
        humidity: 75 - 25 * elev,
      };
    },
  },
  {
    id: "cold-storage",
    name: "Cold storage",
    thai: "ห้องเย็น",
    description: "The circuit is moved into a freezer room at −18 °C.",
    keywords: ["cold", "freezer", "fridge", "ice", "หนาว", "เย็น", "ตู้แช่", "แช่แข็ง"],
    defaultDuration: 25,
    sample: (t, s) => {
      const k = smooth(t / s.duration) * s.intensity;
      return { temperature: lerp(26, -18, k), humidity: lerp(55, 85, k), lux: lerp(420, 180, k), sound: 52 };
    },
  },
  {
    id: "gas-leak",
    name: "Gas leak",
    thai: "แก๊สรั่ว",
    description: "LPG concentration climbs past the lower explosive limit.",
    keywords: ["gas", "lpg", "leak", "methane", "แก๊ส", "ก๊าซ", "รั่ว"],
    defaultDuration: 30,
    sample: (t, s) => {
      const k = smooth(t / s.duration) * s.intensity;
      return { gas: lerp(120, 8500, k), smoke: lerp(5, 40, k) };
    },
  },
  {
    id: "intruder",
    name: "Intruder walk-by",
    thai: "มีคนเดินผ่าน",
    description: "A person walks toward the sensor and away again every few seconds.",
    keywords: ["intruder", "person", "motion", "walk", "security", "ขโมย", "คน", "เดิน", "เคลื่อนไหว", "ผู้บุกรุก"],
    defaultDuration: 8,
    sample: (t, s) => {
      const phase = (t % s.duration) / s.duration;
      const approach = Math.sin(phase * Math.PI);
      const present = phase > 0.08 && phase < 0.92;
      return {
        distance: present ? lerp(380, 25 + 40 * (1 - s.intensity), approach) : 400,
        motion: present ? 1 : 0,
        sound: present ? 45 + 10 * approach : 38,
      };
    },
  },
  {
    id: "earthquake",
    name: "Earthquake",
    thai: "แผ่นดินไหว",
    description: "Low-frequency ground shaking with aftershocks.",
    keywords: ["earthquake", "quake", "shake", "seismic", "แผ่นดินไหว", "สั่นสะเทือน"],
    defaultDuration: 20,
    sample: (t, s) => {
      const env = Math.exp(-Math.pow((t - 6) / 4, 2)) + 0.4 * Math.exp(-Math.pow((t - 15) / 2, 2));
      return { vibRms: 1.2 * env * s.intensity + 0.01, vibFreq: 2.2, vibFault: "looseness", shake: env * s.intensity, sound: 38 + 40 * env };
    },
  },
  {
    id: "greenhouse",
    name: "Greenhouse dry-out",
    thai: "โรงเรือนดินแห้ง",
    description: "Soil dries out under a hot sun until someone waters the plants.",
    keywords: ["soil", "plant", "greenhouse", "garden", "dry", "ดิน", "ต้นไม้", "โรงเรือน", "แห้ง", "รดน้ำ"],
    defaultDuration: 40,
    sample: (t, s) => {
      const k = smooth(t / s.duration) * s.intensity;
      return { soil: lerp(0.7, 0.08, k), temperature: lerp(28, 39, k), humidity: lerp(70, 35, k), lux: lerp(20000, 70000, k) };
    },
  },
];

export function getScenario(id: string) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

export function defaultScenarioState(id = "lab"): ScenarioState {
  const def = getScenario(id);
  const params: Record<string, number | string> = {};
  for (const p of def.params ?? []) params[p.key] = p.default;
  return { id: def.id, intensity: 1, duration: def.defaultDuration, startedAt: 0, params };
}

/** Evaluate the environment at sim time `t` (seconds). */
export function sampleEnv(t: number, scenario: ScenarioState, overrides: Partial<Record<string, number>>): EnvState {
  const def = getScenario(scenario.id);
  const local = Math.max(0, t - scenario.startedAt);
  const env: EnvState = { ...ENV_DEFAULT, ...def.sample(local, scenario) };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null || Number.isNaN(v)) continue;
    if (k in env && k !== "vibFault") (env as unknown as Record<string, number>)[k] = v;
  }
  // gentle sensor-level noise so plots look alive
  env.temperature += 0.05 * vnoise(t * 0.7, 1);
  env.humidity += 0.3 * vnoise(t * 0.5, 2);
  return env;
}

/**
 * Instantaneous acceleration in g along an axis (0=x,1=y,2=z, z excludes gravity)
 * for the vibration model. Evaluated at arbitrary sim time for high-rate sampling.
 */
export function vibAccel(t: number, env: EnvState, axis = 0): number {
  if (env.vibRms <= 0.0105 && env.vibFreq <= 0) return 0.01 * vnoise(t * 400, axis + 5);
  const f = Math.max(0.1, env.vibFreq);
  const w = 2 * Math.PI * f;
  const ph = axis * 1.7;
  let a = 0;
  switch (env.vibFault) {
    case "imbalance":
      a = 1.0 * Math.sin(w * t + ph) + 0.12 * Math.sin(2 * w * t + ph);
      break;
    case "misalignment":
      a = 0.55 * Math.sin(w * t + ph) + 0.9 * Math.sin(2 * w * t + ph * 2) + 0.25 * Math.sin(3 * w * t);
      break;
    case "bearing": {
      const bpfo = 3.58 * f;
      const imp = Math.pow(Math.max(0, Math.sin(2 * Math.PI * bpfo * t)), 24);
      a = 0.35 * Math.sin(w * t + ph) + 1.6 * imp * Math.sin(2 * Math.PI * 1800 * t) + 0.25 * Math.sin(2 * Math.PI * bpfo * t);
      break;
    }
    case "looseness":
      a = 0.5 * Math.sin(w * t + ph) + 0.4 * Math.sin(0.5 * w * t) + 0.35 * Math.sin(2 * w * t) + 0.3 * Math.sin(3 * w * t) + 0.2 * Math.sin(1.5 * w * t);
      break;
    default:
      a = 0.7 * Math.sin(w * t + ph) + 0.08 * Math.sin(2 * w * t);
  }
  // scale so RMS ≈ env.vibRms (sine RMS = 0.707)
  return (a * env.vibRms) / 0.75 + 0.02 * vnoise(t * 900, axis + 11);
}
