import { Download, FileJson, Link2, Plug, PlugZap, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { getBoard } from "../core/boards";
import { isBoard } from "../core/circuit";
import { getPart } from "../core/parts";
import { TEMPLATES, templateSupports } from "../core/templates";
import { drawingDxf, drawingSvg, specFromBoard, specFromPart } from "../lib/drawing";
import { connectMqtt, disconnectMqtt, twinConfig } from "../lib/mqtt";
import { download } from "../lib/persist";
import { useStudio } from "../store";

// ---------------------------------------------------------------- templates
export function TemplatesPanel() {
  const project = useStudio((s) => s.project);
  const load = useStudio((s) => s.loadTemplate);
  const toast = useStudio((s) => s.toast);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Starter templates</h2>
      </div>
      <p className="muted small">Each template wires itself to free pins on the current board ({getBoard(project.boardId).short}) and writes matching code.</p>
      <div className="tpl-list">
        {TEMPLATES.map((t) => {
          const ok = templateSupports(t, project.boardId);
          return (
            <button
              key={t.id}
              className="tpl card-pick"
              onClick={() => {
                const log = load(t.id);
                window.dispatchEvent(new Event("xtwin:fit"));
                toast(log.length ? log.join(" · ") : `Loaded “${t.name}” — press Start Simulation`, log.length ? "warn" : "ok");
              }}
            >
              <strong>{t.name}</strong>
              <small>{t.thai}</small>
              <span>{t.description}</span>
              {!ok && <em>switches to {getBoard(t.boards![0]).short}</em>}
              {t.scenario && <em className="sc">scenario: {t.scenario}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- drawing
export function DrawingPanel() {
  const project = useStudio((s) => s.project);
  const selection = useStudio((s) => s.selection);
  const [target, setTarget] = useState<string>("board");
  useEffect(() => {
    const sel = project.parts.find((p) => p.id === selection[0] && !isBoard(p));
    if (sel) setTarget(sel.type);
  }, [selection, project.parts]);
  const spec = target === "board" ? specFromBoard(getBoard(project.boardId)) : specFromPart(getPart(target)!);
  const types = [...new Set(project.parts.filter((p) => !isBoard(p)).map((p) => p.type))];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Dimension drawing</h2>
      </div>
      <p className="muted small">True-scale mechanical drawing in millimetres — outline, mounting holes, connectors and header pins. The SVG prints 1:1; the DXF opens in CAD.</p>
      <label className="field">
        <span>Item</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="board">{getBoard(project.boardId).name}</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {getPart(t)?.name}
            </option>
          ))}
        </select>
      </label>
      <dl className="spec">
        <dt>Size</dt>
        <dd>
          {spec.width.toFixed(2)} × {spec.height.toFixed(2)} mm
        </dd>
        <dt>Holes</dt>
        <dd>{spec.holes.length ? spec.holes.map((h) => `⌀${h.d}`).join(", ") : "none"}</dd>
        <dt>Height</dt>
        <dd>{(spec.thickness + spec.maxZ).toFixed(1)} mm overall</dd>
      </dl>
      <div className="row">
        <button className="btn primary" onClick={() => download(`${spec.title.replace(/\W+/g, "_")}.svg`, drawingSvg(spec), "image/svg+xml")}>
          <Download size={15} /> SVG
        </button>
        <button className="btn primary" onClick={() => download(`${spec.title.replace(/\W+/g, "_")}.dxf`, drawingDxf(spec), "application/dxf")}>
          <Download size={15} /> DXF
        </button>
      </div>
      <DrawingStageBridge svg={drawingSvg(spec)} />
    </div>
  );
}

let currentSvg = "";
const svgListeners = new Set<() => void>();
function DrawingStageBridge({ svg }: { svg: string }) {
  useEffect(() => {
    currentSvg = svg;
    svgListeners.forEach((l) => l());
  }, [svg]);
  return null;
}

export function DrawingPreview() {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    svgListeners.add(l);
    return () => void svgListeners.delete(l);
  }, []);
  return <div className="drawing-stage" dangerouslySetInnerHTML={{ __html: currentSvg.replace(/width="[^"]+mm" height="[^"]+mm"/, 'width="100%" height="100%"') }} />;
}

// ---------------------------------------------------------------- MQTT
export function MqttPanel() {
  const cfg = useStudio((s) => s.mqtt);
  const status = useStudio((s) => s.mqttStatus);
  const set = (patch: Partial<typeof cfg>) => useStudio.setState({ mqtt: { ...useStudio.getState().mqtt, ...patch } });
  useEffect(() => {
    const onC = () => connectMqtt();
    window.addEventListener("xtwin:mqtt-connect", onC);
    return () => window.removeEventListener("xtwin:mqtt-connect", onC);
  }, []);
  const on = status === "online";
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>MQTT bridge</h2>
        <span className={`status-dot ${on ? "on" : status === "error" ? "err" : ""}`}>{status}</span>
      </div>
      <p className="muted small">Stream the twin to any broker over WebSockets and control it back. Firmware using PubSubClient, umqtt or paho also talks through this connection.</p>
      <label className="field">
        <span>Broker URL (ws/wss)</span>
        <input value={cfg.url} onChange={(e) => set({ url: e.target.value })} spellCheck={false} />
      </label>
      <div className="two">
        <label className="field">
          <span>Topic prefix</span>
          <input value={cfg.prefix} onChange={(e) => set({ prefix: e.target.value })} spellCheck={false} />
        </label>
        <label className="field">
          <span>Interval (ms)</span>
          <input type="number" min={100} step={100} value={cfg.intervalMs} onChange={(e) => set({ intervalMs: Number(e.target.value) })} />
        </label>
      </div>
      <div className="two">
        <label className="field">
          <span>Username</span>
          <input value={cfg.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={cfg.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
        </label>
      </div>
      <div className="toggles">
        {(
          [
            ["publishSensors", "Sensors"],
            ["publishPins", "Pins"],
            ["publishEnv", "Environment"],
            ["publishSerial", "Serial lines"],
            ["acceptCommands", "Accept commands"],
            ["retain", "Retain"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={Boolean(cfg[k])} onChange={(e) => set({ [k]: e.target.checked } as never)} />
            {l}
          </label>
        ))}
      </div>
      <div className="row">
        {on || status === "connecting" ? (
          <button className="btn danger" onClick={() => disconnectMqtt()}>
            <Unplug size={15} /> Disconnect
          </button>
        ) : (
          <button className="btn primary" onClick={() => connectMqtt()}>
            <PlugZap size={15} /> Connect
          </button>
        )}
        <button className="btn" onClick={() => download("xtwin-twin.json", JSON.stringify(twinConfig(), null, 2), "application/json")}>
          <FileJson size={15} /> Export twin config
        </button>
      </div>
      <h3 className="group-title">
        <Link2 size={14} /> Topics
      </h3>
      <ul className="topics mono">
        <li>
          <b>⇡</b> {cfg.prefix}/telemetry
        </li>
        <li>
          <b>⇡</b> {cfg.prefix}/sensors/&lt;label&gt;
        </li>
        <li>
          <b>⇣</b> {cfg.prefix}/cmd/env · scenario · sim · serial · input/&lt;label&gt;
        </li>
      </ul>
      <p className="muted small">
        <Plug size={12} /> Try it: publish <code>{`{"temperature": 85}`}</code> to <code>{cfg.prefix}/cmd/env</code> from any MQTT client.
      </p>
    </div>
  );
}
