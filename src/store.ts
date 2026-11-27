import { create } from "zustand";
import { getBoard } from "./core/boards";
import { BOARD_ID, buildTopology, instBounds, isBoard, isHost } from "./core/circuit";
import { defaultScenarioState } from "./core/env";
import { customSensorToPart, getPart, registerPart } from "./core/parts";
import { engine, type SerialLine, type SimSnapshot } from "./core/sim";
import { BOARD_ORIGIN, instantiateTemplate, templateFor, templateSupports } from "./core/templates";
import type { CaseParams, CustomSensorDef, Lang, MqttConfig, PartInstance, Project, ScenarioState, Wire } from "./core/types";
import { labelPrefix, newId, nextLabel, routeWire, snap } from "./core/wiring";
import { planMount } from "./core/mount";
import { loadCustomSensors, loadProject, saveCustomSensors, saveProject } from "./lib/persist";

export type LeftTab = "parts" | "templates" | "ai" | "env" | "mqtt" | "case" | "drawing" | "custom";
export type DockTab = "code" | "serial" | "plot" | "diag" | "mqtt";

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  provider: string;
  needsProfile?: boolean;
  local?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "warn" | "err";
}

export const DEFAULT_CASE: CaseParams = {
  wall: 2,
  floor: 2,
  clearance: 0.8,
  cornerRadius: 3,
  innerHeight: 0,
  lidThickness: 2,
  standoffHeight: 4,
  screwHole: 2.6,
  vents: "lid-slots",
  waterproof: false,
  mountingEars: false,
  connectorCutouts: true,
  includeBreadboard: false,
  features: [],
  label: "Thosaphol Connect",
};

export const DEFAULT_MQTT: MqttConfig = {
  url: "wss://broker.hivemq.com:8884/mqtt",
  clientId: `tconnect-${Math.random().toString(16).slice(2, 8)}`,
  username: "",
  password: "",
  prefix: "thosaphol/demo",
  intervalMs: 1000,
  retain: false,
  qos: 0,
  publishPins: true,
  publishSensors: true,
  publishEnv: true,
  publishSerial: false,
  acceptCommands: true,
};

export function blankProject(boardId = "esp32-devkit-v1", name = "Untitled circuit"): Project {
  const board = getBoard(boardId);
  return {
    id: newId("p"),
    name,
    boardId: board.id,
    parts: [{ id: BOARD_ID, type: `board:${board.id}`, label: board.short, x: BOARD_ORIGIN.x, y: BOARD_ORIGIN.y, rot: 0, props: {} }],
    wires: [],
    lang: board.defaultLang,
    code: {},
    scenario: defaultScenarioState("lab"),
    envOverrides: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selection: string[];
  selectedWire: string | null;
  view: "2d" | "diagram" | "3d";
  leftTab: LeftTab | null;
  dockTab: DockTab;
  dockOpen: boolean;
  theme: "dark" | "light";
  sim: { running: boolean; paused: boolean; speed: number };
  snap: SimSnapshot | null;
  serial: SerialLine[];
  customSensors: CustomSensorDef[];
  user: User | null;
  authChecked: boolean;
  toasts: Toast[];
  mqtt: MqttConfig;
  mqttStatus: "offline" | "connecting" | "online" | "error";
  caseParams: CaseParams;
  wireColor: string | null;
  modal: null | "custom-sensor" | "scan" | "drawing" | "projects" | "export" | "viewer3d";
  /** Instance shown in the 3D viewer (null = whole circuit). */
  viewerFocus: string | null;
  /** Bumped on every select() call, even when the selection is unchanged (re-opens the inspector). */
  selKey: number;
  openViewer(id: string | null): void;
  burst: { x: number; y: number; t: number } | null;

  commit(fn: (p: Project) => Project, history?: boolean): void;
  undo(): void;
  redo(): void;
  setProject(p: Project): void;
  addPart(type: string, at: { x: number; y: number }, props?: PartInstance["props"]): string;
  movePart(id: string, x: number, y: number, history?: boolean): void;
  rotateSelection(): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  setProp(id: string, key: string, value: number | string | boolean): void;
  mountBoard(kind: "breadboard" | "perfboard"): void;
  /** Switch between microcontroller and PLC workspaces (loads a starter circuit). */
  setMode(mode: "mcu" | "plc"): void;
  setLabel(id: string, label: string): void;
  addWire(w: Omit<Wire, "id" | "points" | "color"> & { color?: string }): void;
  tidyWires(ids?: string[]): void;
  setBoard(boardId: string): void;
  setCode(lang: Lang, code: string): void;
  setLang(lang: Lang): void;
  setScenario(s: Partial<ScenarioState> & { id?: string }): void;
  setOverride(key: string, v: number | undefined): void;
  loadTemplate(id: string): string[];
  select(ids: string[], wire?: string | null): void;
  startSim(): Promise<void>;
  stopSim(): Promise<void>;
  togglePause(): void;
  setSpeed(s: number): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dropToast(id: number): void;
  saveCustomSensor(d: CustomSensorDef): void;
  deleteCustomSensor(type: string): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
}

function initialProject(): Project {
  const saved = loadProject();
  if (saved) return saved;
  const p = blankProject();
  const t = instantiateTemplate(templateFor("flame-alarm")!, p.boardId);
  return { ...p, name: "Fire alarm demo", ...t };
}

// register custom sensors before the first project loads so their parts resolve
const initialCustom = loadCustomSensors();
for (const d of initialCustom) registerPart(customSensorToPart(d));

let toastSeq = 1;

export const useStudio = create<State>((set, get) => ({
  project: initialProject(),
  past: [],
  future: [],
  selection: [],
  selectedWire: null,
  view: "2d",
  leftTab: "parts",
  dockTab: "code",
  dockOpen: true,
  theme: (typeof localStorage !== "undefined" && (localStorage.getItem("tconnect.theme") as "dark" | "light")) || "dark",
  sim: { running: false, paused: false, speed: 1 },
  snap: null,
  serial: [],
  customSensors: initialCustom,
  user: null,
  authChecked: false,
  toasts: [],
  mqtt: DEFAULT_MQTT,
  mqttStatus: "offline",
  caseParams: DEFAULT_CASE,
  wireColor: null,
  modal: null,
  viewerFocus: null,
  selKey: 0,
  openViewer: (id) => set({ viewerFocus: id, modal: "viewer3d" }),
  burst: null,

  set: (k, v) => set({ [k]: v } as Partial<State>),

  commit: (fn, history = true) => {
    const cur = get().project;
    const next = { ...fn(cur), updatedAt: Date.now() };
    if (history) set({ project: next, past: [...get().past.slice(-80), cur], future: [] });
    else set({ project: next });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
  },
  setProject: (p) => {
    void get().stopSim();
    set({ project: p, past: [], future: [], selection: [], selectedWire: null, serial: [] });
  },

  addPart: (type, at, props) => {
    const def = getPart(type);
    if (!def) return "";
    const id = newId("u");
    const props0 = { ...Object.fromEntries(def.props.map((s) => [s.key, s.default])), ...(props ?? {}) };
    const fp = def.layout ? def.layout(props0) : def;
    const p0 = fp.pins[0];
    const x = p0 ? snap(at.x - fp.w / 2 + p0.x) - p0.x : at.x - fp.w / 2;
    const y = p0 ? snap(at.y - fp.h / 2 + p0.y) - p0.y : at.y - fp.h / 2;
    get().commit((p) => ({
      ...p,
      parts: [
        ...p.parts,
        {
          id,
          type,
          label: nextLabel(p.parts, labelPrefix(def)),
          x,
          y,
          rot: 0,
          props: props0,
        },
      ],
    }));
    set((st) => ({ selection: [id], selectedWire: null, selKey: st.selKey + 1, burst: { x: x + fp.w / 2, y: y + fp.h / 2, t: Date.now() } }));
    return id;
  },
  movePart: (id, x, y, history = false) => get().commit((p) => ({ ...p, parts: p.parts.map((q) => (q.id === id ? { ...q, x, y } : q)) }), history),
  rotateSelection: () => {
    const sel = new Set(get().selection);
    get().commit((p) => ({ ...p, parts: p.parts.map((q) => (sel.has(q.id) && !isBoard(q) ? { ...q, rot: ((q.rot + 90) % 360) as PartInstance["rot"] } : q)) }));
  },
  deleteSelection: () => {
    const { selection, selectedWire } = get();
    const sel = new Set(selection.filter((id) => id !== BOARD_ID));
    if (!sel.size && !selectedWire) return;
    get().commit((p) => ({
      ...p,
      parts: p.parts.filter((q) => !sel.has(q.id)),
      wires: p.wires.filter((w) => w.id !== selectedWire && !sel.has(w.from.part) && !sel.has(w.to.part)),
    }));
    set({ selection: [], selectedWire: null });
  },
  duplicateSelection: () => {
    const sel = get().selection.filter((id) => id !== BOARD_ID);
    const ids: string[] = [];
    get().commit((p) => {
      const add: PartInstance[] = [];
      for (const id of sel) {
        const q = p.parts.find((x) => x.id === id);
        const def = q && getPart(q.type);
        if (!q || !def) continue;
        const nid = newId("u");
        ids.push(nid);
        add.push({ ...q, id: nid, x: q.x + 7.62, y: q.y + 7.62, label: nextLabel([...p.parts, ...add], labelPrefix(def)) });
      }
      return { ...p, parts: [...p.parts, ...add] };
    });
    set({ selection: ids });
  },
  setProp: (id, key, value) => {
    const def = getPart(get().project.parts.find((p) => p.id === id)?.type ?? "");
    const spec = def?.props.find((s) => s.key === key);
    if (spec?.live && get().sim.running) engine.setInput(id, { [key]: value as number });
    get().commit((p) => ({ ...p, parts: p.parts.map((q) => (q.id === id ? { ...q, props: { ...q.props, [key]: value } } : q)) }), !spec?.live);
  },
  setMode: (mode) => {
    const isPlcNow = getBoard(get().project.boardId).family === "plc";
    if ((mode === "plc") === isPlcNow) return;
    get().loadTemplate(mode === "plc" ? "plc-start-stop" : "blink");
    setTimeout(() => window.dispatchEvent(new Event("tconnect:fit")), 60);
  },
  mountBoard: (kind) => {
    const st = get();
    let boardInst = st.project.parts.find(isBoard);
    if (!boardInst) return;
    // Already plugged in somewhere? Replace that host if nothing else uses it.
    const topo = buildTopology(getBoard(st.project.boardId), st.project.parts, [], new Map());
    const curHost = topo.inserted.find((i) => i.part === boardInst!.id)?.bb;
    const dropHost = curHost && !topo.inserted.some((i) => i.bb === curHost && i.part !== boardInst!.id) ? curHost : null;
    let plan = planMount(boardInst, kind);
    if (!plan.ok || !plan.host || !plan.board) {
      st.toast(plan.reason ?? "This board can't be mounted", "warn");
      return;
    }
    // The new host must not land on another breadboard/perfboard — slide the board to free space below.
    const others = st.project.parts.filter((p) => p.id !== boardInst!.id && p.id !== dropHost);
    const hostRect = (pl: typeof plan) => {
      const L = getPart(pl.host!.type)!.layout!(pl.host!.props);
      return { x: pl.host!.x, y: pl.host!.y, w: L.w, h: L.h };
    };
    const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    if (others.filter(isHost).some((h) => hit(instBounds(h), hostRect(plan)))) {
      const maxY = Math.max(...others.map((p) => instBounds(p)).map((b) => b.y + b.h));
      boardInst = { ...boardInst, y: snap(maxY + 25) };
      plan = planMount(boardInst, kind);
      if (!plan.ok || !plan.host || !plan.board) return;
    }
    const hostId = newId("u");
    const def = getPart(plan.host.type)!;
    st.commit((p) => ({
      ...p,
      parts: [
        ...p.parts.filter((q) => q.id !== dropHost).map((q) => (isBoard(q) ? { ...q, x: plan.board!.x, y: plan.board!.y, rot: 0 as const } : q)),
        { id: hostId, type: plan.host!.type, label: nextLabel(p.parts, labelPrefix(def)), x: plan.host!.x, y: plan.host!.y, rot: 0, props: { ...Object.fromEntries(def.props.map((s) => [s.key, s.default])), ...plan.host!.props } },
      ],
    }));
    set((s) => ({ selection: [hostId], selKey: s.selKey + 1 }));
    st.toast(`Mounted ${plan.summary}${dropHost ? " (replaced the old one)" : ""}`, "ok");
    setTimeout(() => window.dispatchEvent(new Event("tconnect:fit")), 50);
  },
  setLabel: (id, label) => get().commit((p) => ({ ...p, parts: p.parts.map((q) => (q.id === id ? { ...q, label } : q)) })),
  addWire: (w) => {
    if (w.from.part === w.to.part && w.from.pin === w.to.pin) return;
    const exists = get().project.wires.some((x) => (x.from.part === w.from.part && x.from.pin === w.from.pin && x.to.part === w.to.part && x.to.pin === w.to.pin) || (x.to.part === w.from.part && x.to.pin === w.from.pin && x.from.part === w.to.part && x.from.pin === w.to.pin));
    if (exists) return;
    const color = w.color ?? get().wireColor ?? guessWireColor(w.from.pin, w.to.pin, get().project.wires.length);
    get().commit((p) => ({ ...p, wires: [...p.wires, { id: newId("w"), from: w.from, to: w.to, color, points: [] }] }));
  },
  tidyWires: (ids) => {
    get().commit((p) => {
      const done: Wire[] = [];
      const wires = p.wires.map((w) => {
        if (ids && !ids.includes(w.id)) return w;
        const points = routeWire(p.parts, w, done);
        const nw = { ...w, points };
        done.push(nw);
        return nw;
      });
      return { ...p, wires };
    });
  },
  setBoard: (boardId) => {
    const board = getBoard(boardId);
    void get().stopSim();
    get().commit((p) => {
      const parts = p.parts.map((q) => (isBoard(q) ? { ...q, type: `board:${board.id}`, label: board.short } : q));
      const pinIds = new Set(board.pins.map((x) => x.id));
      const wires = p.wires.filter((w) => (w.from.part !== BOARD_ID || pinIds.has(w.from.pin)) && (w.to.part !== BOARD_ID || pinIds.has(w.to.pin)));
      return { ...p, boardId: board.id, parts, wires, lang: board.languages.includes(p.lang) ? p.lang : board.defaultLang };
    });
  },
  setCode: (lang, code) => get().commit((p) => ({ ...p, code: { ...p.code, [lang]: code } }), false),
  setLang: (lang) => get().commit((p) => ({ ...p, lang })),
  setScenario: (s) => {
    get().commit((p) => {
      const base = s.id && s.id !== p.scenario.id ? defaultScenarioState(s.id) : p.scenario;
      return { ...p, scenario: { ...base, ...s, params: { ...base.params, ...(s.params ?? {}) }, startedAt: engine.t / 1000 } };
    });
  },
  setOverride: (key, v) =>
    get().commit((p) => {
      const o = { ...p.envOverrides };
      if (v === undefined) delete o[key];
      else o[key] = v;
      return { ...p, envOverrides: o };
    }, false),
  loadTemplate: (id) => {
    const t = templateFor(id);
    if (!t) return [];
    const cur = get().project;
    const boardId = templateSupports(t, cur.boardId) ? cur.boardId : t.boards?.[0] ?? "esp32-devkit-v1";
    const inst = instantiateTemplate(t, boardId, cur.lang);
    void get().stopSim();
    get().commit((p) => ({ ...p, boardId, name: t.name, parts: inst.parts, wires: inst.wires, lang: inst.lang, code: inst.code, scenario: inst.scenario, envOverrides: {} }));
    set({ selection: [], selectedWire: null, dockTab: "code", dockOpen: true });
    // control-panel templates have many wires: route them orthogonally right away
    if (getBoard(boardId).family === "plc") get().tidyWires();
    return inst.log;
  },
  select: (ids, wire = null) => set((s) => ({ selection: ids, selectedWire: wire, selKey: s.selKey + 1 })),

  startSim: async () => {
    const { project } = get();
    const code = project.code[project.lang] ?? "";
    set({ serial: [], sim: { ...get().sim, running: true, paused: false } });
    engine.setCircuit(project.boardId, project.parts, project.wires);
    engine.setEnvironment({ ...project.scenario, startedAt: 0 }, project.envOverrides);
    get().commit((p) => ({ ...p, scenario: { ...p.scenario, startedAt: 0 } }), false);
    await engine.start(project.lang, code);
  },
  stopSim: async () => {
    await engine.stop();
    set({ sim: { ...get().sim, running: false, paused: false } });
  },
  togglePause: () => {
    const paused = !get().sim.paused;
    engine.setPaused(paused);
    set({ sim: { ...get().sim, paused } });
  },
  setSpeed: (s) => {
    engine.setSpeed(s);
    set({ sim: { ...get().sim, speed: s } });
  },
  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dropToast(id), kind === "err" ? 7000 : 3800);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  saveCustomSensor: (d) => {
    registerPart(customSensorToPart(d));
    const list = [...get().customSensors.filter((x) => x.type !== d.type), d];
    saveCustomSensors(list);
    set({ customSensors: list });
  },
  deleteCustomSensor: (type) => {
    const list = get().customSensors.filter((x) => x.type !== type);
    saveCustomSensors(list);
    set({ customSensors: list });
  },
}));

function guessWireColor(a: string, b: string, n: number) {
  const s = `${a} ${b}`.toUpperCase();
  if (/GND|NEG|BN|TN/.test(s)) return "#2b2f33";
  if (/VCC|5V|3V3|VIN|VBUS|VSYS|\bV\b/.test(s)) return "#ef3b36";
  const pal = ["#ff9f1c", "#ffd23f", "#3ddc97", "#2ec4ff", "#b388ff", "#f4f4f4", "#ff6fb5"];
  return pal[n % pal.length];
}

// ---------------------------------------------------------------------------
// keep the engine in sync with the project, and the UI in sync with the engine
// ---------------------------------------------------------------------------
let lastCircuit: unknown = null;
let lastEnv: unknown = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStudio.subscribe((s) => {
  const p = s.project;
  const circuitKey = [p.boardId, p.parts, p.wires];
  if (lastCircuit === null || (lastCircuit as unknown[])[0] !== circuitKey[0] || (lastCircuit as unknown[])[1] !== circuitKey[1] || (lastCircuit as unknown[])[2] !== circuitKey[2]) {
    lastCircuit = circuitKey;
    engine.setCircuit(p.boardId, p.parts, p.wires);
  }
  const envKey = [p.scenario, p.envOverrides];
  if (lastEnv === null || (lastEnv as unknown[])[0] !== envKey[0] || (lastEnv as unknown[])[1] !== envKey[1]) {
    lastEnv = envKey;
    engine.setEnvironment(p.scenario, p.envOverrides);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(useStudio.getState().project), 600);
});

let lastSnapAt = 0;
engine.onFrame((snap) => {
  const now = performance.now();
  if (snap.running && now - lastSnapAt < 30) return;
  lastSnapAt = now;
  useStudio.setState({ snap });
});
engine.onRunState((running) => {
  useStudio.setState({ sim: { ...useStudio.getState().sim, running, paused: running ? useStudio.getState().sim.paused : false } });
});
engine.onSerial((lines) => {
  const cur = useStudio.getState().serial;
  const next = cur.length + lines.length > 1500 ? [...cur.slice(-(1500 - lines.length)), ...lines] : [...cur, ...lines];
  useStudio.setState({ serial: next });
});
// initial sync
{
  const p = useStudio.getState().project;
  engine.setCircuit(p.boardId, p.parts, p.wires);
  engine.setEnvironment(p.scenario, p.envOverrides);
}
