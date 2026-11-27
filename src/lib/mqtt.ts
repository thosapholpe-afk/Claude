import mqtt, { type MqttClient } from "mqtt";
import { getBoard } from "../core/boards";
import { engine } from "../core/sim";
import { topicMatch } from "../core/runtime/arduino-api";
import { useStudio } from "../store";

let client: MqttClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let offSerial: (() => void) | null = null;
const fwSubs = new Set<string>();

function status(s: "offline" | "connecting" | "online" | "error") {
  useStudio.setState({ mqttStatus: s });
}

export function telemetry() {
  const st = useStudio.getState();
  const snap = st.snap;
  const p = st.project;
  const board = getBoard(p.boardId);
  const pins: Record<string, unknown> = {};
  for (const bp of board.pins) {
    if (bp.kind !== "gpio") continue;
    const d = snap?.drives[bp.id];
    const v = snap?.pinV[bp.id];
    if (!d && (v === undefined || Math.abs(v) < 0.001)) continue;
    pins[bp.label] = { v: v !== undefined ? +v.toFixed(3) : null, mode: d?.mode ?? "INPUT", level: d?.level ?? null, pwm: d?.pwm ?? null };
  }
  const sensors: Record<string, unknown> = {};
  for (const inst of p.parts) {
    const lv = snap?.live[inst.id];
    if (!lv || (lv.reading === undefined && lv.outV === undefined && lv.on === undefined)) continue;
    sensors[inst.label] = { type: inst.type, reading: lv.reading ?? null, unit: lv.readingUnit ?? "", out_v: lv.outV ?? null, on: lv.on ?? null, angle: lv.angle ?? null };
  }
  const env = snap?.env;
  return {
    ts: new Date().toISOString(),
    t_sim: (snap?.t ?? 0) / 1000,
    project: p.name,
    board: board.id,
    running: st.sim.running,
    scenario: p.scenario.id,
    pins,
    sensors,
    env: env
      ? { temperature: +env.temperature.toFixed(2), humidity: +env.humidity.toFixed(1), flame: +env.flame.toFixed(3), smoke: Math.round(env.smoke), gas: Math.round(env.gas), water: +env.water.toFixed(3), lux: Math.round(env.lux), distance_cm: +env.distance.toFixed(1), vibration_g: +env.vibRms.toFixed(3) }
      : null,
  };
}

export function connectMqtt() {
  const cfg = useStudio.getState().mqtt;
  disconnectMqtt();
  status("connecting");
  try {
    client = mqtt.connect(cfg.url, {
      clientId: cfg.clientId,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      clean: true,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
    });
  } catch (e) {
    status("error");
    useStudio.getState().toast(`MQTT: ${(e as Error).message}`, "err");
    return;
  }
  const c = client;
  c.on("connect", () => {
    status("online");
    useStudio.getState().toast(`MQTT connected to ${new URL(cfg.url).host}`, "ok");
    if (cfg.acceptCommands) c.subscribe(`${cfg.prefix}/cmd/#`, { qos: cfg.qos });
    for (const t of fwSubs) c.subscribe(t);
    if (timer) clearInterval(timer);
    timer = setInterval(() => publishTelemetry(), Math.max(100, cfg.intervalMs));
  });
  c.on("error", (e) => {
    status("error");
    useStudio.getState().toast(`MQTT: ${e.message}`, "err");
  });
  c.on("close", () => {
    if (useStudio.getState().mqttStatus !== "offline") status("connecting");
  });
  c.on("message", (topic, buf) => {
    const payload = buf.toString();
    const prefix = `${cfg.prefix}/cmd/`;
    if (topic.startsWith(prefix)) {
      handleCommand(topic.slice(prefix.length), payload);
      return;
    }
    if ([...fwSubs].some((s) => topicMatch(s, topic))) engine.deliverMqtt(topic, payload);
  });
  engine.bridge = {
    connected: () => !!client?.connected,
    publish: (t, p, r) => client?.publish(t, p, { retain: !!r, qos: cfg.qos }),
    subscribe: (t) => {
      fwSubs.add(t);
      client?.subscribe(t);
    },
    unsubscribe: (t) => {
      fwSubs.delete(t);
      client?.unsubscribe(t);
    },
    url: () => cfg.url,
  };
  offSerial?.();
  offSerial = engine.onSerial((lines) => {
    if (!useStudio.getState().mqtt.publishSerial || !client?.connected) return;
    for (const l of lines) if (l.kind === "out") client.publish(`${cfg.prefix}/serial`, l.text);
  });
}

export function publishTelemetry() {
  const cfg = useStudio.getState().mqtt;
  if (!client?.connected) return;
  const tel = telemetry();
  const body: Record<string, unknown> = { ts: tel.ts, t_sim: tel.t_sim, board: tel.board, running: tel.running, scenario: tel.scenario };
  if (cfg.publishPins) body.pins = tel.pins;
  if (cfg.publishSensors) body.sensors = tel.sensors;
  if (cfg.publishEnv) body.env = tel.env;
  client.publish(`${cfg.prefix}/telemetry`, JSON.stringify(body), { retain: cfg.retain, qos: cfg.qos });
  if (cfg.publishSensors)
    for (const [label, s] of Object.entries(tel.sensors)) {
      const r = (s as { reading: number | null }).reading;
      if (r !== null) client.publish(`${cfg.prefix}/sensors/${label}`, String(+r.toFixed(4)), { retain: cfg.retain, qos: cfg.qos });
    }
}

function handleCommand(sub: string, payload: string) {
  const st = useStudio.getState();
  let data: unknown = payload;
  try {
    data = JSON.parse(payload);
  } catch {
    /* plain text */
  }
  if (sub === "env" && data && typeof data === "object") {
    const o = data as Record<string, number | boolean>;
    if (o.clear) st.commit((p) => ({ ...p, envOverrides: {} }), false);
    for (const [k, v] of Object.entries(o)) if (typeof v === "number") st.setOverride(k, v);
  } else if (sub === "scenario") {
    if (typeof data === "string") st.setScenario({ id: data });
    else if (data && typeof data === "object") st.setScenario(data as never);
  } else if (sub === "sim") {
    if (String(data) === "start") void st.startSim();
    if (String(data) === "stop") void st.stopSim();
  } else if (sub === "serial") engine.sendSerial(String(payload) + "\n");
  else if (sub.startsWith("input/")) {
    const label = sub.slice(6);
    const inst = st.project.parts.find((p) => p.label.toLowerCase() === label.toLowerCase());
    if (inst && data && typeof data === "object") engine.setInput(inst.id, data as Record<string, number | boolean>);
  }
  st.toast(`MQTT command: ${sub}`, "info");
}

export function disconnectMqtt() {
  if (timer) clearInterval(timer);
  timer = null;
  offSerial?.();
  offSerial = null;
  client?.end(true);
  client = null;
  engine.bridge = null;
  status("offline");
}

export function twinConfig() {
  const st = useStudio.getState();
  const cfg = st.mqtt;
  const board = getBoard(st.project.boardId);
  return {
    name: st.project.name,
    board: { id: board.id, name: board.name },
    broker: cfg.url,
    topics: {
      telemetry: `${cfg.prefix}/telemetry`,
      sensors: `${cfg.prefix}/sensors/<label>`,
      serial: `${cfg.prefix}/serial`,
      commands: {
        env: `${cfg.prefix}/cmd/env  {"temperature": 80} | {"clear": true}`,
        scenario: `${cfg.prefix}/cmd/scenario  "building-fire" | {"id":"flood","intensity":0.8}`,
        sim: `${cfg.prefix}/cmd/sim  start | stop`,
        serial: `${cfg.prefix}/cmd/serial  <text>`,
        input: `${cfg.prefix}/cmd/input/<label>  {"pressed": true} | {"position": 0.7}`,
      },
    },
    sample: telemetry(),
    parts: st.project.parts.map((p) => ({ label: p.label, type: p.type })),
  };
}
