import { BOARDS, getBoard } from "../core/boards";
import { BOARD_ID, instBounds, isBoard, isHost } from "../core/circuit";
import { ENV_VARS, SCENARIOS } from "../core/env";
import { allParts, getPart, PARTS } from "../core/parts";
import { ladderAscii, ladderFromSpec, ladderToSpec, parseLadder, type RungSpec, serialiseLadder } from "../core/plc";
import { engine } from "../core/sim";
import { TEMPLATES } from "../core/templates";
import type { CaseFeature, CustomSensorDef, EnvKey, Lang, PartInstance } from "../core/types";
import { autoWirePart, connectedPartPins, nextLabel, labelPrefix, newId, resolveEndpoint, runWireCommand, usedBoardPins } from "../core/wiring";
import { blankProject, DEFAULT_CASE, useStudio } from "../store";
import { saveProject } from "./persist";

export interface ChatAction {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  pending?: boolean;
}

type Block = { type: string; [k: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: string | Block[] };

const thai = (s: string) => /[฀-๿]/.test(s);

// ---------------------------------------------------------------------------
// circuit snapshot for the model
// ---------------------------------------------------------------------------
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** The interesting bits of a part's live state, for the model. */
export function liveSummary(id: string): Record<string, unknown> | undefined {
  const st = useStudio.getState();
  const l = st.snap?.live[id];
  if (!l) return undefined;
  const o: Record<string, unknown> = {};
  if (l.on !== undefined) o.on = l.on;
  if (l.brightness !== undefined) o.brightness = round(l.brightness, 2);
  if (l.rgb) o.rgb = l.rgb.map((v) => Math.round(v));
  if (l.angle !== undefined) o.angle = Math.round(l.angle);
  if (l.speed !== undefined && l.speed !== 0) o.speed = Math.round(l.speed);
  if (l.freq) o.freq_hz = Math.round(l.freq);
  if (l.text?.length) o.display = l.text;
  if (l.reading !== undefined && Number.isFinite(l.reading)) o.reading = `${round(l.reading, 2)}${l.readingUnit ? ` ${l.readingUnit}` : ""}`;
  if (l.powered !== undefined) o.powered = l.powered;
  if (l.burnt) o.burnt = true;
  if (l.warn) o.warn = l.warn;
  const def = getPart(st.project.parts.find((x) => x.id === id)?.type ?? "");
  if (def?.toggleLabel) o.position = def.toggleLabel(engine.getInput(id));
  else if (def?.pressable) o.pressed = !!engine.getInput(id).pressed;
  return Object.keys(o).length ? o : undefined;
}

/** PLC bits worth reporting: every X/Y plus the M/T/C that are set or counting. */
function plcSummary() {
  const plc = useStudio.getState().snap?.plc;
  if (!plc) return undefined;
  const bits: Record<string, boolean> = {};
  for (let i = 0; i < 8; i++) bits[`X${i}`] = !!plc.bits[`X${i}`];
  for (let i = 0; i < 8; i++) bits[`Y${i}`] = !!plc.bits[`Y${i}`];
  for (const [k, v] of Object.entries(plc.bits)) if (/^[MTC]/.test(k) && v) bits[k] = true;
  const acc: Record<string, number> = {};
  for (const [k, v] of Object.entries(plc.acc)) if (v) acc[k] = k.startsWith("T") ? round(v / 1000, 2) : v;
  return { scans: plc.scans, bits, ...(Object.keys(acc).length ? { timers_s_counters: acc } : {}) };
}

const macrotask = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

/** Wait while the simulation runs. In a background tab requestAnimationFrame stops, so step the engine by hand. */
export async function simWait(ms: number) {
  if (ms <= 0) return;
  const hidden = typeof document !== "undefined" && document.hidden;
  if (!hidden || !useStudio.getState().sim.running) {
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  const end = performance.now() + ms;
  let last = performance.now();
  while (performance.now() < end && useStudio.getState().sim.running) {
    await macrotask();
    const now = performance.now();
    await engine.frame(Math.min(100, now - last));
    last = now;
  }
}

async function ensureRunning() {
  if (useStudio.getState().sim.running) return false;
  await useStudio.getState().startSim();
  await simWait(250);
  return true;
}

/** A quick sparkle where Claude touched the canvas. */
function flash(id: string) {
  const inst = useStudio.getState().project.parts.find((x) => x.id === id);
  if (!inst) return;
  const b = instBounds(inst);
  useStudio.setState({ burst: { x: b.x + b.w / 2, y: b.y + b.h / 2, t: Date.now() } });
}

/** Keep the user's current work in Saved works before a tool replaces it. */
function keepCurrent() {
  const p = useStudio.getState().project;
  if (p.parts.filter((x) => !isBoard(x)).length) saveProject(p);
}

export function circuitSummary() {
  const st = useStudio.getState();
  const p = st.project;
  const board = getBoard(p.boardId);
  const snap = st.snap;
  const label = (part: string, pin: string) => {
    if (part === BOARD_ID) return `${board.short}:${board.pins.find((x) => x.id === pin)?.label ?? pin}`;
    const inst = p.parts.find((x) => x.id === part);
    return `${inst?.label ?? part}.${pin}`;
  };
  const used = usedBoardPins(p);
  const conn = connectedPartPins(p);
  return {
    project: p.name,
    board: { id: board.id, name: board.name, logic_v: board.logicV, adc_bits: board.adcBits, languages: board.languages },
    mode: board.family === "plc" ? "plc" : "mcu",
    view: st.view === "2d" ? "board" : st.view === "diagram" ? "wiring" : "3d",
    language: p.lang,
    board_at: (() => {
      const bi = p.parts.find(isBoard);
      return bi ? { x: round(bi.x), y: round(bi.y), w: board.width, h: board.height } : undefined;
    })(),
    parts: p.parts
      .filter((x) => !isBoard(x))
      .map((x) => {
        const def = getPart(x.type);
        const b = instBounds(x);
        return {
          label: x.label,
          type: x.type,
          at: { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), ...(x.rot ? { rot: x.rot } : {}) },
          props: x.props,
          pins: def?.host
            ? undefined
            : def?.pins.map((pin) => {
                const others = p.wires
                  .filter((wr) => (wr.from.part === x.id && wr.from.pin === pin.id) || (wr.to.part === x.id && wr.to.pin === pin.id))
                  .map((wr) => (wr.from.part === x.id && wr.from.pin === pin.id ? wr.to : wr.from))
                  .map((o) => label(o.part, o.pin));
                const to = others.length > 1 ? others : others.length ? others[0] : conn.has(`${x.id}:${pin.id}`) ? "(breadboard)" : null;
                return { pin: pin.id, role: pin.role, to };
              }),
          ...(st.sim.running ? { live: liveSummary(x.id) } : {}),
        };
      }),
    board_pins_in_use: [...used].map((id) => {
      const bp = board.pins.find((x) => x.id === id);
      return bp ? `${bp.label}${bp.gpio !== undefined ? ` (GPIO${bp.gpio})` : ""}` : id;
    }),
    free_gpio: board.pins.filter((x) => x.kind === "gpio" && !used.has(x.id)).map((x) => `${x.label}${x.gpio !== undefined ? `=GPIO${x.gpio}` : ""}[${x.caps.join("/")}]${x.inputOnly ? "(input-only)" : ""}${x.avoid ? "(avoid)" : ""}`),
    scenario: p.scenario,
    environment: snap?.env,
    env_overrides: p.envOverrides,
    simulation_running: st.sim.running,
    ...(board.family === "plc" && st.sim.running ? { plc: plcSummary() } : {}),
    diagnostics: snap?.diags.map((d) => d.msg) ?? [],
    recent_serial: st.serial.slice(-8).map((l) => l.text),
    code_excerpt: (p.code[p.lang] ?? "").slice(0, 1500),
  };
}

// ---------------------------------------------------------------------------
// tool execution
// ---------------------------------------------------------------------------
const findInst = (label: string) => {
  const p = useStudio.getState().project;
  const q = label.trim().toLowerCase();
  const board = getBoard(p.boardId);
  if (["board", "plc", "mcu", board.short.toLowerCase(), board.id].includes(q)) return p.parts.find(isBoard);
  return p.parts.find((x) => x.label.toLowerCase() === q) ?? p.parts.find((x) => x.id.toLowerCase() === q) ?? p.parts.find((x) => !isBoard(x) && x.label.toLowerCase().startsWith(q));
};

function placeNear(): { x: number; y: number } {
  const p = useStudio.getState().project;
  const board = getBoard(p.boardId);
  const bi = p.parts.find(isBoard);
  const others = p.parts.filter((x) => !isBoard(x)).length;
  return { x: (bi?.x ?? 20) + board.width + 26 + (others % 3) * 22, y: (bi?.y ?? 30) + 4 + Math.floor(others / 3) * 24 + (others % 2) * 6 };
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<{ result: unknown; summary: string; ok: boolean }> {
  const st = useStudio.getState();
  try {
    switch (name) {
      case "get_circuit":
        return { result: circuitSummary(), summary: "Read the circuit", ok: true };
      case "set_board": {
        const b = getBoard(String(input.board));
        st.setBoard(b.id);
        return { result: { ok: true, board: b.id }, summary: `Board → ${b.name}`, ok: true };
      }
      case "load_template": {
        const t = TEMPLATES.find((x) => x.id === input.template);
        if (!t) throw new Error("unknown template");
        keepCurrent();
        st.setProject(blankProject(st.project.boardId, t.name));
        const log = useStudio.getState().loadTemplate(t.id);
        window.dispatchEvent(new Event("tconnect:fit"));
        return { result: { ok: true, notes: log, circuit: circuitSummary() }, summary: `Loaded template: ${t.name}`, ok: true };
      }
      case "add_part": {
        const type = String(input.type);
        const def = getPart(type) ?? allParts().find((p) => p.keywords.includes(type.toLowerCase()));
        if (!def) throw new Error(`unknown part type ${type}`);
        const id = st.addPart(def.type, placeNear(), (input.props as PartInstance["props"]) ?? undefined);
        if (input.label) st.setLabel(id, String(input.label));
        const inst = useStudio.getState().project.parts.find((x) => x.id === id)!;
        if (input.x !== undefined || input.y !== undefined) st.movePart(id, Number(input.x ?? inst.x), Number(input.y ?? inst.y), false);
        return { result: { ok: true, label: inst.label, pins: def.pins.map((p) => ({ id: p.id, role: p.role, needs: p.need })) }, summary: `Added ${inst.label} (${def.name})`, ok: true };
      }
      case "remove_part": {
        const inst = findInst(String(input.label));
        if (!inst || isBoard(inst)) throw new Error("part not found");
        st.select([inst.id]);
        st.deleteSelection();
        return { result: { ok: true }, summary: `Removed ${inst.label}`, ok: true };
      }
      case "connect": {
        const r = runWireCommand(st.project, `${input.from} -> ${input.to}`);
        st.commit((p) => ({ ...p, parts: r.parts, wires: r.wires }));
        return { result: { ok: r.ok, log: r.log }, summary: r.log.join(" · ") || `${input.from} → ${input.to}`, ok: r.ok };
      }
      case "auto_wire": {
        let parts = st.project.parts;
        let wires = st.project.wires;
        const log: string[] = [];
        const targets = input.label ? [findInst(String(input.label))].filter(Boolean) : parts.filter((x) => !isBoard(x) && !isHost(x));
        for (const t of targets) {
          const r = autoWirePart({ ...st.project, parts, wires }, t!.id);
          parts = r.parts;
          wires = r.wires;
          log.push(...r.log);
        }
        st.commit((p) => ({ ...p, parts, wires }));
        return { result: { ok: true, log }, summary: log.length ? `Wired: ${log.slice(0, 4).join(" · ")}${log.length > 4 ? " …" : ""}` : "Nothing left to wire", ok: true };
      }
      case "set_part_property": {
        const inst = findInst(String(input.label));
        if (!inst) throw new Error("part not found");
        st.setProp(inst.id, String(input.key), input.value as string | number | boolean);
        return { result: { ok: true }, summary: `${inst.label}.${input.key} = ${input.value}`, ok: true };
      }
      case "write_code": {
        const lang = String(input.language) as Lang;
        st.setCode(lang, String(input.code));
        if (getBoard(st.project.boardId).languages.includes(lang)) st.setLang(lang);
        useStudio.setState({ dockTab: "code", dockOpen: true });
        return { result: { ok: true, lines: String(input.code).split("\n").length }, summary: `Wrote ${lang === "arduino" ? "Arduino" : lang === "micropython" ? "MicroPython" : "Python"} code (${String(input.code).split("\n").length} lines)`, ok: true };
      }
      case "set_scenario": {
        const sc = SCENARIOS.find((s) => s.id === input.scenario);
        if (!sc) throw new Error("unknown scenario");
        st.setScenario({ id: sc.id });
        useStudio.getState().setScenario({
          ...(input.intensity !== undefined ? { intensity: Number(input.intensity) } : {}),
          ...(input.duration_s !== undefined ? { duration: Number(input.duration_s) } : {}),
          ...(input.params ? { params: input.params as Record<string, number | string> } : {}),
        });
        if (input.view_3d !== false) useStudio.setState({ view: "3d" });
        return { result: { ok: true, scenario: sc.id }, summary: `Scenario → ${sc.name}`, ok: true };
      }
      case "set_environment": {
        if (input.clear) st.commit((p) => ({ ...p, envOverrides: {} }), false);
        const set: string[] = [];
        for (const v of ENV_VARS) {
          if (typeof input[v.key] === "number") {
            st.setOverride(v.key, Number(input[v.key]));
            set.push(`${v.label} ${input[v.key]}${v.unit}`);
          }
        }
        return { result: { ok: true }, summary: set.length ? `Environment: ${set.join(", ")}` : "Cleared overrides", ok: true };
      }
      case "simulation": {
        const a = String(input.action);
        if (a === "stop") await st.stopSim();
        else {
          await st.startSim();
        }
        return { result: { ok: true, running: a !== "stop" }, summary: a === "stop" ? "Stopped simulation" : "Simulation running", ok: true };
      }
      case "design_case": {
        const cur = useStudio.getState().caseParams;
        const features: CaseFeature[] = Array.isArray(input.holes)
          ? (input.holes as Record<string, unknown>[]).map((h, i) => ({ id: `f${Date.now()}${i}`, face: h.face as CaseFeature["face"], shape: (h.shape as CaseFeature["shape"]) ?? "circle", u: Number(h.u), v: Number(h.v ?? 0), w: Number(h.w), h: Number(h.h ?? h.w), label: String(h.label ?? "") }))
          : cur.features;
        const next = {
          ...DEFAULT_CASE,
          ...cur,
          ...(input.wall !== undefined && { wall: Number(input.wall) }),
          ...(input.floor !== undefined && { floor: Number(input.floor) }),
          ...(input.clearance !== undefined && { clearance: Number(input.clearance) }),
          ...(input.corner_radius !== undefined && { cornerRadius: Number(input.corner_radius) }),
          ...(input.inner_height !== undefined && { innerHeight: Number(input.inner_height) }),
          ...(input.vents !== undefined && { vents: input.vents as typeof cur.vents }),
          ...(input.waterproof !== undefined && { waterproof: Boolean(input.waterproof) }),
          ...(input.mounting_ears !== undefined && { mountingEars: Boolean(input.mounting_ears) }),
          ...(input.include_breadboard !== undefined && { includeBreadboard: Boolean(input.include_breadboard) }),
          ...(input.label !== undefined && { label: String(input.label) }),
          features,
        };
        useStudio.setState({ caseParams: next, leftTab: "case" });
        return { result: { ok: true, params: next }, summary: `Case: ${next.wall} mm walls${next.waterproof ? ", waterproof" : ""}${next.vents !== "none" ? `, ${next.vents}` : ""}${features.length ? `, ${features.length} openings` : ""}`, ok: true };
      }
      case "show_plot":
        useStudio.setState({ dockTab: "plot", dockOpen: true });
        if (input.spectrum) window.dispatchEvent(new Event("tconnect:spectrum"));
        return { result: { ok: true }, summary: "Opened the plotter", ok: true };
      case "mqtt_configure": {
        const m = { ...st.mqtt };
        if (input.broker_url) m.url = String(input.broker_url);
        if (input.topic_prefix) m.prefix = String(input.topic_prefix);
        if (input.interval_ms) m.intervalMs = Number(input.interval_ms);
        useStudio.setState({ mqtt: m, leftTab: "mqtt" });
        if (input.connect) window.dispatchEvent(new Event("tconnect:mqtt-connect"));
        return { result: { ok: true, topics: { telemetry: `${m.prefix}/telemetry`, commands: `${m.prefix}/cmd/#` } }, summary: `MQTT → ${m.url} (${m.prefix}/…)`, ok: true };
      }
      case "create_custom_sensor": {
        const slug = String(input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sensor";
        const output = (input.output as CustomSensorDef["output"]) ?? "analog";
        const pins: CustomSensorDef["pins"] = [
          { id: "VCC", label: "VCC", role: "vcc" },
          { id: "GND", label: "GND", role: "gnd" },
        ];
        if (output !== "digital") pins.push({ id: "AO", label: "AO", role: "analog" });
        if (output !== "analog") pins.push({ id: "DO", label: "DO", role: "digital-out" });
        const def: CustomSensorDef = {
          type: `custom:${slug}`,
          name: String(input.name),
          model: String(input.model ?? input.name),
          description: `Custom sensor responding to ${input.env ?? "none"}`,
          color: "#1d5fa8",
          w: 26,
          h: 16,
          pins,
          params: ((input.params as Record<string, unknown>[]) ?? []).map((p) => ({ key: String(p.key), label: String(p.label ?? p.key), default: Number(p.default), min: Number(p.min ?? 0), max: Number(p.max ?? 100), unit: String(p.unit ?? "") })),
          env: (input.env as EnvKey | "none") ?? "none",
          output,
          expr: String(input.expr),
          threshold: Number(input.threshold ?? 0.5),
          activeLow: Boolean(input.active_low),
          createdAt: Date.now(),
        };
        st.saveCustomSensor(def);
        let label: string | undefined;
        if (input.add_to_canvas !== false) {
          const id = st.addPart(def.type, placeNear());
          label = useStudio.getState().project.parts.find((x) => x.id === id)?.label;
        }
        return { result: { ok: true, type: def.type, label }, summary: `Created sensor “${def.name}”${label ? ` as ${label}` : ""}`, ok: true };
      }
      case "get_catalog": {
        const type = input.type ? String(input.type) : "";
        if (type) {
          const def = getPart(type) ?? allParts().find((p) => p.keywords.includes(type.toLowerCase()));
          if (!def) throw new Error(`unknown part type ${type}`);
          return {
            result: {
              type: def.type,
              name: def.name,
              category: def.category,
              description: def.description,
              size_mm: { w: def.w, h: def.h },
              pins: def.pins.map((p) => ({ id: p.id, label: p.label, role: p.role, ...(p.need ? { needs: p.need } : {}) })),
              props: def.props.map((pr) => ({ key: pr.key, type: pr.type, default: pr.default, ...(pr.min !== undefined ? { min: pr.min, max: pr.max } : {}), ...(pr.unit ? { unit: pr.unit } : {}), ...(pr.options ? { options: pr.options.map((o) => o.value) } : {}), ...(pr.live ? { live: true } : {}) })),
              ...(def.pressable ? { operate: "press / release / click" } : def.toggle ? { operate: "toggle", states: def.toggleLabel?.({}) } : {}),
            },
            summary: `Catalog: ${def.name}`,
            ok: true,
          };
        }
        const cat = input.category ? String(input.category) : "";
        if (cat === "boards")
          return { result: BOARDS.map((b) => ({ id: b.id, name: b.name, family: b.family, logic_v: b.logicV, languages: b.languages, size_mm: { w: b.width, h: b.height } })), summary: "Catalog: boards", ok: true };
        if (cat === "templates") return { result: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, boards: t.boards ?? "any microcontroller" })), summary: "Catalog: templates", ok: true };
        if (cat === "scenarios") return { result: SCENARIOS.map((x) => ({ id: x.id, name: x.name })), summary: "Catalog: scenarios", ok: true };
        const list = allParts().filter((p) => !cat || p.category === cat);
        return { result: list.map((p) => ({ type: p.type, name: p.name, category: p.category, pins: p.pins.map((x) => x.id).join(" ") })), summary: `Catalog: ${cat || "all"} parts`, ok: true };
      }
      case "set_mode": {
        const mode = String(input.mode) === "plc" ? "plc" : "mcu";
        const isPlc = getBoard(st.project.boardId).family === "plc";
        if ((mode === "plc") !== isPlc) {
          keepCurrent();
          st.setProject(blankProject(st.project.boardId, st.project.name));
          useStudio.getState().setMode(mode);
        }
        return { result: { ok: true, mode, circuit: circuitSummary() }, summary: mode === "plc" ? "PLC mode" : "Microcontroller mode", ok: true };
      }
      case "set_view": {
        const v = String(input.view);
        useStudio.setState({ view: v === "wiring" ? "diagram" : v === "3d" ? "3d" : "2d" });
        if (input.fit) setTimeout(() => window.dispatchEvent(new Event("tconnect:fit")), 80);
        return { result: { ok: true, view: v }, summary: `View → ${v}`, ok: true };
      }
      case "new_project": {
        const b = getBoard(String(input.board));
        keepCurrent();
        st.setProject(blankProject(b.id, String(input.name ?? `New ${b.short} circuit`)));
        if (b.family === "plc") useStudio.getState().setLang("ladder");
        setTimeout(() => window.dispatchEvent(new Event("tconnect:fit")), 80);
        return { result: { ok: true, board: b.id, circuit: circuitSummary() }, summary: `New project on ${b.name}`, ok: true };
      }
      case "rename_project": {
        const name = String(input.name).trim().slice(0, 80);
        if (!name) throw new Error("name is empty");
        st.commit((p) => ({ ...p, name }));
        return { result: { ok: true }, summary: `Renamed to “${name}”`, ok: true };
      }
      case "move_part": {
        const inst = findInst(String(input.label));
        if (!inst) throw new Error("part not found");
        let x = input.x !== undefined ? Number(input.x) : inst.x;
        let y = input.y !== undefined ? Number(input.y) : inst.y;
        if (input.dx !== undefined) x += Number(input.dx);
        if (input.dy !== undefined) y += Number(input.dy);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("x/y must be numbers");
        const rot = input.rotation !== undefined && !isBoard(inst) ? ((((Math.round(Number(input.rotation) / 90) * 90) % 360) + 360) % 360 as PartInstance["rot"]) : inst.rot;
        st.commit((p) => ({ ...p, parts: p.parts.map((q) => (q.id === inst.id ? { ...q, x, y, rot } : q)) }));
        flash(inst.id);
        const b = instBounds(useStudio.getState().project.parts.find((q) => q.id === inst.id)!);
        return { result: { ok: true, at: { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), rot } }, summary: `Moved ${inst.label}`, ok: true };
      }
      case "wire": {
        const a = resolveEndpoint(st.project, String(input.from));
        const b = resolveEndpoint(st.project, String(input.to));
        if ("error" in a) throw new Error(a.error);
        if ("error" in b) throw new Error(b.error);
        if (a.part === b.part && a.pin === b.pin) throw new Error("both ends are the same terminal");
        const before = st.project.wires.length;
        st.addWire({ from: { part: a.part, pin: a.pin }, to: { part: b.part, pin: b.pin }, color: input.color ? String(input.color) : undefined });
        const added = useStudio.getState().project.wires.length > before;
        if (b.part !== BOARD_ID) flash(b.part);
        else if (a.part !== BOARD_ID) flash(a.part);
        return { result: { ok: true, wire: `${a.text} — ${b.text}`, ...(added ? {} : { note: "already wired" }) }, summary: `Wire ${a.text} — ${b.text}`, ok: true };
      }
      case "disconnect": {
        const a = resolveEndpoint(st.project, String(input.from));
        if ("error" in a) throw new Error(a.error);
        const b = input.to ? resolveEndpoint(st.project, String(input.to)) : null;
        if (b && "error" in b) throw new Error(b.error);
        const on = (e: { part: string; pin: string }, x: { part: string; pin: string }) => e.part === x.part && e.pin === x.pin;
        const hit = (w: (typeof st.project.wires)[number]) => (b ? (on(w.from, a) && on(w.to, b)) || (on(w.from, b) && on(w.to, a)) : on(w.from, a) || on(w.to, a));
        const n = st.project.wires.filter(hit).length;
        if (!n) throw new Error("no wire there");
        st.commit((p) => ({ ...p, wires: p.wires.filter((w) => !hit(w)) }));
        return { result: { ok: true, removed: n }, summary: `Removed ${n} wire${n > 1 ? "s" : ""} at ${a.text}`, ok: true };
      }
      case "tidy_wires": {
        st.tidyWires();
        return { result: { ok: true, wires: st.project.wires.length }, summary: "Tidied wires", ok: true };
      }
      case "write_ladder": {
        if (getBoard(st.project.boardId).family !== "plc") throw new Error("this project is not on a PLC — call set_mode plc (or new_project with board plc-fx16) first");
        let prog = ladderFromSpec(input.rungs as RungSpec[], (input.symbols as Record<string, string>) ?? {});
        if (input.append) {
          const cur = parseLadder(st.project.code.ladder);
          prog = { kind: "ladder", rungs: [...cur.rungs, ...prog.rungs], symbols: { ...cur.symbols, ...prog.symbols } };
        }
        st.setCode("ladder", serialiseLadder(prog));
        st.setLang("ladder");
        useStudio.setState({ dockTab: "code", dockOpen: true });
        const wasRunning = useStudio.getState().sim.running;
        if (wasRunning) {
          await useStudio.getState().stopSim();
          await useStudio.getState().startSim();
        }
        return { result: { ok: true, rungs: prog.rungs.length, restarted: wasRunning, drawing: ladderAscii(prog) }, summary: `Wrote ladder (${prog.rungs.length} rung${prog.rungs.length > 1 ? "s" : ""})`, ok: true };
      }
      case "get_ladder": {
        const prog = parseLadder(st.project.code.ladder);
        return { result: { ...ladderToSpec(prog), drawing: ladderAscii(prog), ...(st.sim.running ? { live: plcSummary() } : {}) }, summary: "Read the ladder", ok: true };
      }
      case "operate": {
        const inst = findInst(String(input.label));
        if (!inst || isBoard(inst)) throw new Error("part not found");
        const def = getPart(inst.type)!;
        const action = String(input.action);
        const started = await ensureRunning();
        const id = inst.id;
        if (action === "press" || action === "release" || action === "click") {
          if (!def.pressable) throw new Error(`${inst.label} is not a push control${def.toggle ? " — use toggle" : ""}`);
          if (action === "release") engine.setInput(id, { pressed: false });
          else {
            engine.setInput(id, { pressed: true });
            if (action === "click") {
              await simWait(Math.max(50, Math.min(10000, Number(input.hold_ms ?? 300))));
              engine.setInput(id, { pressed: false });
            }
          }
        } else if (action === "toggle") {
          if (!def.toggle) throw new Error(`${inst.label} does not latch${def.pressable ? " — use press/click" : ""}`);
          engine.setInput(id, def.toggle(engine.getInput(id)));
        } else if (action === "set") {
          const key = String(input.key ?? "");
          if (!key || input.value === undefined) throw new Error("set needs key and value");
          if (def.props.some((p) => p.key === key)) useStudio.getState().setProp(id, key, input.value as number | boolean);
          else engine.setInput(id, { [key]: input.value as number | boolean });
        } else throw new Error(`unknown action ${action}`);
        flash(id);
        await simWait(250);
        return {
          result: { ok: true, ...(started ? { note: "simulation started" } : {}), state: liveSummary(id), ...(getBoard(st.project.boardId).family === "plc" ? { plc: plcSummary() } : {}) },
          summary: `${action === "toggle" ? "Switched" : action === "set" ? "Set" : action === "release" ? "Released" : "Pressed"} ${inst.label}${def.toggleLabel ? ` → ${def.toggleLabel(engine.getInput(id))}` : ""}`,
          ok: true,
        };
      }
      case "observe": {
        const secs = Math.max(0, Math.min(30, Number(input.seconds ?? 2)));
        const started = await ensureRunning();
        const n0 = useStudio.getState().serial.length;
        const t0 = useStudio.getState().snap?.t ?? 0;
        await simWait(secs * 1000);
        const now = useStudio.getState();
        const p = now.project;
        const board = getBoard(p.boardId);
        const used = usedBoardPins(p);
        const pins: Record<string, number> = {};
        for (const bp of board.pins) if (used.has(bp.id) && now.snap?.pinV[bp.id] !== undefined) pins[bp.label] = round(now.snap.pinV[bp.id], 2);
        const parts: Record<string, unknown> = {};
        for (const x of p.parts) if (!isBoard(x) && !isHost(x)) {
          const l = liveSummary(x.id);
          if (l) parts[x.label] = l;
        }
        return {
          result: {
            ok: true,
            ...(started ? { note: "simulation started" } : {}),
            sim_time_s: round((now.snap?.t ?? 0) / 1000, 2),
            elapsed_s: round(((now.snap?.t ?? 0) - t0) / 1000, 2),
            parts,
            board_pins_v: pins,
            ...(board.family === "plc" ? { plc: plcSummary() } : {}),
            serial: now.serial.slice(n0).slice(-40).map((l) => l.text),
            diagnostics: now.snap?.diags.map((d) => d.msg) ?? [],
          },
          summary: secs ? `Watched ${secs}s of simulation` : "Read the live state",
          ok: true,
        };
      }
      default:
        throw new Error(`unknown tool ${name}`);
    }
  } catch (e) {
    return { result: { ok: false, error: (e as Error).message }, summary: `${name} failed: ${(e as Error).message}`, ok: false };
  }
}

// ---------------------------------------------------------------------------
// remote (Claude) agent loop — the browser runs the tools, the server holds the key
// ---------------------------------------------------------------------------
let history: ApiMessage[] = [];

export function resetAgent() {
  history = [];
}

export async function agentAvailable(): Promise<boolean> {
  try {
    const r = await fetch("/api/ai/status");
    if (!r.ok) return false;
    const j = (await r.json()) as { configured: boolean };
    return j.configured;
  } catch {
    return false;
  }
}

export function validate(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
  const req: Record<string, string[]> = {
    set_board: ["board"],
    load_template: ["template"],
    add_part: ["type"],
    remove_part: ["label"],
    connect: ["from", "to"],
    set_part_property: ["label", "key", "value"],
    write_code: ["language", "code"],
    set_scenario: ["scenario"],
    simulation: ["action"],
    create_custom_sensor: ["name", "expr"],
    set_mode: ["mode"],
    set_view: ["view"],
    new_project: ["board"],
    rename_project: ["name"],
    move_part: ["label"],
    wire: ["from", "to"],
    disconnect: ["from"],
    write_ladder: ["rungs"],
    operate: ["label", "action"],
  };
  for (const k of req[name] ?? []) if ((input as Record<string, unknown>)[k] === undefined) return `missing ${k}`;
  return null;
}

export async function runRemoteAgent(text: string, onAction: (a: ChatAction) => void): Promise<string> {
  const context = JSON.stringify(circuitSummary());
  history.push({ role: "user", content: [{ type: "text", text }, { type: "text", text: `<circuit_state>${context}</circuit_state>` }] });
  let finalText = "";
  for (let turn = 0; turn < 10; turn++) {
    const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error((err as { error?: string }).error ?? `AI request failed (${r.status})`);
    }
    const msg = (await r.json()) as { content: Block[]; stop_reason: string };
    history.push({ role: "assistant", content: msg.content });
    const texts = msg.content.filter((b) => b.type === "text").map((b) => String(b.text));
    if (texts.length) finalText = texts.join("\n");
    if (msg.stop_reason === "refusal") return finalText || "I can't help with that request.";
    if (msg.stop_reason === "max_tokens") return finalText || "The answer was cut off — try asking for a smaller step.";
    const uses = msg.content.filter((b) => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !uses.length) break;
    const results: Block[] = [];
    for (const u of uses) {
      const bad = validate(String(u.name), u.input);
      if (bad) {
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: bad }) });
        continue;
      }
      const res = await executeTool(String(u.name), u.input as Record<string, unknown>);
      if (u.name !== "get_circuit") onAction({ tool: String(u.name), summary: res.summary, ok: res.ok });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(res.result).slice(0, 12000), ...(res.ok ? {} : { is_error: true }) });
    }
    history.push({ role: "user", content: results });
  }
  // keep the conversation bounded: drop whole old exchanges, starting at a plain user turn
  if (history.length > 40) {
    let cut = history.length - 30;
    while (cut < history.length) {
      const m = history[cut];
      if (m.role === "user" && Array.isArray(m.content) && (m.content as Block[])[0]?.type === "text") break;
      cut++;
    }
    history = history.slice(cut);
  }
  return finalText;
}

// ---------------------------------------------------------------------------
// local agent: keyword intent engine (works offline, Thai + English)
// ---------------------------------------------------------------------------
const TPL_WORDS: [RegExp, string][] = [
  [/mg\s?996|mgrr|mg99|high.?torque|แรงบิด/i, "servo-mg996r"],
  [/sg\s?90|servo|เซอร์โว|เซอโว/i, "servo-sg90"],
  [/traffic|จราจร/i, "traffic-light"],
  [/fire alarm|flame|เปลวไฟ|ไฟไหม้|แจ้งเตือนไฟ/i, "flame-alarm"],
  [/water|leak|flood|น้ำรั่ว|น้ำท่วม|ระดับน้ำ/i, "water-leak"],
  [/ultrasonic|hc-?sr04|distance|วัดระยะ|อัลตรา/i, "ultrasonic"],
  [/\bpir\b|motion|กันขโมย|ตรวจจับคน|เคลื่อนไหว/i, "pir-alarm"],
  [/dht|weather|lcd|humidity|อุณหภูมิ.*ความชื้น|สถานีอากาศ|จอ/i, "weather-lcd"],
  [/vibration|accelero|adxl|สั่น|มอเตอร์/i, "vibration-monitor"],
  [/neopixel|ws2812|rainbow|สีรุ้ง|ไฟวง/i, "neopixel"],
  [/mqtt|iot|cloud|ไอโอที/i, "iot-mqtt"],
  [/\bled\b|blink|กะพริบ|ไฟ ?led|หลอดไฟ/i, "blink"],
];

export async function runLocalAgent(text: string, onAction: (a: ChatAction) => void): Promise<string> {
  const th = thai(text);
  const t = text.toLowerCase();
  const done: string[] = [];
  const act = async (tool: string, input: Record<string, unknown>) => {
    const r = await executeTool(tool, input);
    onAction({ tool, summary: r.summary, ok: r.ok });
    done.push(r.summary);
    return r;
  };
  const st = useStudio.getState();

  // 1. wiring commands  e.g. "GP10 ไป LED1", "D5 -> servo1"
  if (/(->|→|=>|\bto\b|ไป|ต่อ)/i.test(text) && /\b(gp|gpio|d|a|io|bcm|pin)?\d{1,2}\b|auto|3v3|5v|gnd/i.test(text) && st.project.parts.some((p) => !isBoard(p) && t.includes(p.label.toLowerCase()))) {
    const r = runWireCommand(st.project, text);
    st.commit((p) => ({ ...p, parts: r.parts, wires: r.wires }));
    onAction({ tool: "connect", summary: r.log.join(" · "), ok: r.ok });
    return th ? `ต่อสายให้แล้ว: ${r.log.join(" · ")}` : `Wired it: ${r.log.join(" · ")}`;
  }

  // 2. board switch
  const boardMatch = /(esp32|uno|arduino|pico|raspberry ?pi ?4|pi ?4|rpi)/i.exec(text);
  if (boardMatch && /(switch|use|change|เปลี่ยน|ใช้|เลือก)/i.test(text)) {
    const id = /esp32/i.test(boardMatch[1]) ? "esp32-devkit-v1" : /uno|arduino/i.test(boardMatch[1]) ? "arduino-uno" : /pico/i.test(boardMatch[1]) ? "rpi-pico" : "rpi-4b";
    await act("set_board", { board: id });
  }

  // 3. case design
  if (/(case|enclosure|stl|เคส|กล่อง|ฝาครอบ)/i.test(text)) {
    const wall = Number(/(?:wall|ผนัง|หนา)\D{0,6}(\d+(?:\.\d+)?)/i.exec(text)?.[1] ?? NaN);
    await act("design_case", {
      ...(Number.isFinite(wall) ? { wall } : {}),
      waterproof: /(waterproof|กันน้ำ|ip6)/i.test(text),
      vents: /(no vent|ไม่ต้องระบาย|ปิดสนิท)/i.test(text) ? "none" : /(honeycomb|รังผึ้ง)/i.test(text) ? "honeycomb" : /(vent|ระบาย|รู)/i.test(text) ? "side-slots" : undefined,
      mounting_ears: /(ear|mount|หู|ยึด|ติดผนัง)/i.test(text),
      include_breadboard: /(breadboard|เบรดบอร์ด)/i.test(text),
    });
    return th ? `ออกแบบเคสให้แล้ว (${done.join(", ")}) เปิดแท็บ Case Studio เพื่อดูโมเดล 3 มิติแล้วกด Export STL ได้เลย` : `Case designed (${done.join(", ")}). Open Case Studio to inspect it in 3D and export the STL.`;
  }

  // 4. templates / build requests
  const wantsBuild = /(make|build|create|template|example|circuit|สร้าง|ทำ|ขอ|อยาก|วงจร|ตัวอย่าง|เทมเพลต)/i.test(text);
  const tpl = TPL_WORDS.find(([re]) => re.test(text));
  const scenarioHit = SCENARIOS.find((s) => s.id !== "lab" && s.keywords.some((k) => t.includes(k.toLowerCase())));
  const situational = /(put|place|into|inside|simulate|ไปไว้|ใส่ไว้|ไว้ใน|อยู่ใน|จำลอง|เอาไป|ลองเอา|เข้าไปใน)/i.test(text);
  if (tpl && wantsBuild && !(situational && scenarioHit && !/(สร้าง|build|make|create)/i.test(text))) {
    await act("load_template", { template: tpl[1] });
  }

  // 5. add a part
  const addMatch = /(add|เพิ่ม|ใส่|วาง)\s*(.+)/i.exec(text);
  if (addMatch && !done.length) {
    const words = addMatch[2].toLowerCase();
    const def = PARTS.find((p) => !p.host && p.keywords.some((k) => words.includes(k))) ?? PARTS.find((p) => p.host && p.keywords.some((k) => words.includes(k)));
    if (def) {
      const r = await act("add_part", { type: def.type });
      const label = (r.result as { label?: string }).label;
      if (label) await act("auto_wire", { label });
    }
  }

  // 6. environment numbers
  const temp = /(?:temp(?:erature)?|อุณหภูมิ)\D{0,8}(-?\d+(?:\.\d+)?)/i.exec(text);
  if (temp) await act("set_environment", { temperature: Number(temp[1]) });
  const dist = /(?:distance|ระยะ)\D{0,8}(\d+(?:\.\d+)?)/i.exec(text);
  if (dist && !tpl) await act("set_environment", { distance: Number(dist[1]) });

  // 7. scenario
  if (scenarioHit && (situational || !tpl || !wantsBuild || done.length)) {
    const params: Record<string, string | number> = {};
    if (scenarioHit.id === "motor-vibration") {
      if (/(bearing|แบริ่ง|ลูกปืน)/i.test(text)) params.fault = "bearing";
      else if (/(imbalance|unbalance|ไม่สมดุล)/i.test(text)) params.fault = "imbalance";
      else if (/(misalign|ศูนย์)/i.test(text)) params.fault = "misalignment";
      else if (/(loose|หลวม)/i.test(text)) params.fault = "looseness";
      const rpm = /(\d{3,4})\s*rpm/i.exec(text);
      if (rpm) params.rpm = Number(rpm[1]);
    }
    await act("set_scenario", { scenario: scenarioHit.id, params, view_3d: true });
    if (!useStudio.getState().sim.running) await act("simulation", { action: "start" });
  }

  // 8. run / stop / plot
  if (/(stop|หยุด)/i.test(text) && !done.length) await act("simulation", { action: "stop" });
  else if (/(start|run|เริ่ม|รัน|เปิดจำลอง)/i.test(text) && !useStudio.getState().sim.running && !done.some((d) => d.includes("running"))) await act("simulation", { action: "start" });
  if (/(plot|graph|chart|กราฟ|พล็อต|fft|spectrum)/i.test(text)) await act("show_plot", { spectrum: /(fft|spectrum|ความถี่)/i.test(text) });

  if (!done.length) {
    return th
      ? "ยังไม่ได้เชื่อมต่อ AI เต็มรูปแบบ (ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์) ตอนนี้ลองพิมพ์คำสั่งแบบนี้ได้: “สร้างวงจรเซอร์โว SG90”, “เอาบอร์ดไปไว้ในตึกไฟไหม้”, “GP10 ไป LED1”, “ทำเคสกันน้ำ ผนัง 3 มม.”"
      : "Full AI isn't connected (set ANTHROPIC_API_KEY on the server). Try: “build a servo SG90 circuit”, “put my board in a burning building”, “GP10 to LED1”, “make a waterproof case with 3 mm walls”.";
  }
  return th ? `เรียบร้อย: ${done.join(" · ")}` : `Done: ${done.join(" · ")}`;
}

export const SUGGESTIONS = [
  { th: "เอาบอร์ดไปไว้ในตึกที่ไฟไหม้", en: "Put my circuit in a burning building" },
  { th: "สร้างวงจรเซอร์โว MG996R คุมด้วยโพเทนชิโอ", en: "Build an MG996R servo with a knob" },
  { th: "จำลองมอเตอร์ 1480 rpm แบริ่งเสีย แล้วเปิดกราฟ FFT", en: "Motor at 1480 rpm with a bearing fault, show the FFT" },
  { th: "ทำเคสกันน้ำ ผนัง 3 มม. มีหูยึด", en: "Waterproof case, 3 mm walls, mounting ears" },
];

export { newId, nextLabel, labelPrefix };
