import { Camera, FilePlus2, FolderOpen, ImageUp, Plus, ScanLine, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allBoards, BOARDS, getBoard, registerCustomBoard } from "../core/boards";
import { ENV_VARS } from "../core/env";
import { compileSensorExpr, customSensorToPart } from "../core/parts";
import type { BoardDef, BoardPin, Cap, CustomSensorDef, EnvKey, PinRole } from "../core/types";
import { ENV_DEFAULT } from "../core/env";
import { deleteProject, download, listProjects, openProject } from "../lib/persist";
import { blankProject, useStudio } from "../store";
import { PartThumb } from "./SidePanels";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- custom sensor
const EXPR_PRESETS: Record<string, { expr: string; params: CustomSensorDef["params"] }> = {
  temperature: { expr: "clamp(p.offset + p.gain * env.temperature, 0, 1) + noise(0.002)", params: [{ key: "offset", label: "Offset", default: 0.1, min: 0, max: 1, unit: "" }, { key: "gain", label: "Gain per °C", default: 0.01, min: 0, max: 0.05, unit: "/°C" }] },
  humidity: { expr: "clamp(env.humidity / 100, 0, 1)", params: [] },
  flame: { expr: "1 - 0.9 * Math.pow(env.flame, 0.7)", params: [] },
  smoke: { expr: "clamp(Math.log10(Math.max(1, env.smoke) / 10) / 3, 0, 1)", params: [] },
  gas: { expr: "clamp(Math.log10(Math.max(1, env.gas) / 100) / 2, 0, 1)", params: [] },
  water: { expr: "clamp(env.water * p.k, 0, 1)", params: [{ key: "k", label: "Sensitivity", default: 0.9, min: 0.1, max: 2, unit: "" }] },
  soil: { expr: "0.9 - 0.55 * env.soil", params: [] },
  lux: { expr: "clamp(Math.log10(env.lux + 1) / 5, 0, 1)", params: [] },
  sound: { expr: "clamp((env.sound - 30) / 90, 0, 1)", params: [] },
  distance: { expr: "clamp(1 - env.distance / p.range, 0, 1)", params: [{ key: "range", label: "Range", default: 200, min: 10, max: 600, unit: "cm" }] },
  motion: { expr: "env.motion", params: [] },
  vibration: { expr: "clamp(0.5 + 0.15 * Math.sin(2 * Math.PI * env.vibFreq * t) * env.vibRms, 0, 1)", params: [] },
  none: { expr: "0.5 + 0.4 * Math.sin(t * p.speed)", params: [{ key: "speed", label: "Speed", default: 1, min: 0.1, max: 10, unit: "rad/s" }] },
};
const ENV_RANGE: Record<string, [number, number]> = { temperature: [-20, 120], humidity: [0, 100], flame: [0, 1], smoke: [0, 4000], gas: [0, 10000], water: [0, 1], soil: [0, 1], lux: [0, 20000], sound: [30, 120], distance: [2, 400], motion: [0, 1], vibration: [0, 3] };

export function CustomSensorModal() {
  const set = useStudio((s) => s.set);
  const save = useStudio((s) => s.saveCustomSensor);
  const existing = useStudio((s) => s.customSensors);
  const user = useStudio((s) => s.user);
  const [d, setD] = useState<CustomSensorDef>(() => ({
    type: "",
    name: "My sensor",
    model: "XS-01",
    description: "",
    color: "#1d5fa8",
    w: 26,
    h: 16,
    pins: [
      { id: "VCC", label: "VCC", role: "vcc" },
      { id: "GND", label: "GND", role: "gnd" },
      { id: "AO", label: "AO", role: "analog" },
      { id: "DO", label: "DO", role: "digital-out" },
    ],
    params: EXPR_PRESETS.temperature.params,
    env: "temperature",
    output: "both",
    expr: EXPR_PRESETS.temperature.expr,
    threshold: 0.6,
    activeLow: true,
    createdAt: Date.now(),
  }));
  const upd = (p: Partial<CustomSensorDef>) => setD((x) => ({ ...x, ...p }));
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sensor";
  const full: CustomSensorDef = { ...d, type: `custom:${slug}`, createdBy: user?.name, createdAt: Date.now() };
  const preview = useMemo(() => {
    const key = d.env === "none" ? null : d.env;
    const [a, b] = key ? ENV_RANGE[key] : [0, 10];
    const pts: [number, number][] = [];
    let err: string | null = null;
    try {
      const fn = compileSensorExpr(d.expr);
      const params = Object.fromEntries(d.params.map((p) => [p.key, p.default]));
      for (let i = 0; i <= 60; i++) {
        const x = a + ((b - a) * i) / 60;
        const env = { ...ENV_DEFAULT } as Record<string, number | string>;
        if (key) env[key === "vibration" ? "vibRms" : key] = x;
        if (key === "vibration") env.vibFreq = 25;
        const y = Math.max(0, Math.min(1, fn(env as never, params, key ? 0.13 : x)));
        pts.push([i / 60, y]);
      }
    } catch (e) {
      err = (e as Error).message;
    }
    return { pts, err, a, b };
  }, [d.expr, d.env, d.params]);
  const partPreview = useMemo(() => customSensorToPart(full), [full.pins.length, full.color, full.name, full.model, full.w, full.h]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Custom sensor" onClose={() => set("modal", null)} wide>
      <div className="cs-grid">
        <div className="cs-form">
          <div className="two">
            <label className="field">
              <span>Name</span>
              <input value={d.name} onChange={(e) => upd({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Model / part no.</span>
              <input value={d.model} onChange={(e) => upd({ model: e.target.value })} />
            </label>
          </div>
          <div className="two">
            <label className="field">
              <span>Responds to</span>
              <select
                value={d.env}
                onChange={(e) => {
                  const env = e.target.value as EnvKey | "none";
                  const pre = EXPR_PRESETS[env];
                  upd({ env, expr: pre.expr, params: pre.params });
                }}
              >
                <option value="none">Nothing (signal generator)</option>
                {Object.keys(ENV_RANGE).map((k) => (
                  <option key={k} value={k}>
                    {ENV_VARS.find((v) => v.key === k || (k === "vibration" && v.key === "vibRms"))?.label ?? k}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Outputs</span>
              <select value={d.output} onChange={(e) => {
                const output = e.target.value as CustomSensorDef["output"];
                const pins = d.pins.filter((p) => p.role === "vcc" || p.role === "gnd" || p.role === "nc");
                if (output !== "digital") pins.push({ id: "AO", label: "AO", role: "analog" });
                if (output !== "analog") pins.push({ id: "DO", label: "DO", role: "digital-out" });
                upd({ output, pins });
              }}>
                <option value="analog">Analog</option>
                <option value="digital">Digital</option>
                <option value="both">Analog + digital</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Output model — fraction of VCC (0…1)</span>
            <textarea className="mono" rows={3} value={d.expr} onChange={(e) => upd({ expr: e.target.value })} spellCheck={false} />
            <small className="muted">Use env.temperature, env.flame, env.distance…, p.&lt;param&gt;, t (s), noise(sd), clamp(), lerp(), Math.*</small>
          </label>
          <h3 className="group-title">Parameters</h3>
          {d.params.map((p, i) => (
            <div key={i} className="param-row">
              <input value={p.key} onChange={(e) => upd({ params: d.params.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)) })} aria-label="Key" placeholder="key" />
              <input value={p.label} onChange={(e) => upd({ params: d.params.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} aria-label="Label" placeholder="label" />
              {(["default", "min", "max"] as const).map((k) => (
                <input key={k} type="number" value={p[k]} onChange={(e) => upd({ params: d.params.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })} aria-label={k} title={k} />
              ))}
              <input value={p.unit} onChange={(e) => upd({ params: d.params.map((x, k) => (k === i ? { ...x, unit: e.target.value } : x)) })} aria-label="Unit" placeholder="unit" />
              <button className="btn icon sm" onClick={() => upd({ params: d.params.filter((_, k) => k !== i) })} aria-label="Remove parameter">
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => upd({ params: [...d.params, { key: `k${d.params.length + 1}`, label: "Parameter", default: 1, min: 0, max: 10, unit: "" }] })}>
            <Plus size={13} /> Add parameter
          </button>
          <h3 className="group-title">Pins</h3>
          {d.pins.map((p, i) => (
            <div key={i} className="param-row pins">
              <input value={p.label} onChange={(e) => upd({ pins: d.pins.map((x, k) => (k === i ? { ...x, label: e.target.value, id: e.target.value.toUpperCase().replace(/\W/g, "") || x.id } : x)) })} aria-label="Pin label" />
              <select value={p.role} onChange={(e) => upd({ pins: d.pins.map((x, k) => (k === i ? { ...x, role: e.target.value as PinRole } : x)) })} aria-label="Pin role">
                <option value="vcc">Power (VCC)</option>
                <option value="gnd">Ground</option>
                <option value="analog">Analog out</option>
                <option value="digital-out">Digital out</option>
                <option value="nc">Not connected</option>
              </select>
              <button className="btn icon sm" onClick={() => upd({ pins: d.pins.filter((_, k) => k !== i) })} aria-label="Remove pin">
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => upd({ pins: [...d.pins, { id: `P${d.pins.length + 1}`, label: `P${d.pins.length + 1}`, role: "nc" }] })}>
            <Plus size={13} /> Add pin
          </button>
          {d.output !== "analog" && (
            <div className="two">
              <label className="field">
                <span>
                  Digital threshold <em>{Math.round(d.threshold * 100)}%</em>
                </span>
                <input type="range" min={0} max={1} step={0.01} value={d.threshold} onChange={(e) => upd({ threshold: Number(e.target.value) })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={d.activeLow} onChange={(e) => upd({ activeLow: e.target.checked })} /> DO active LOW
              </label>
            </div>
          )}
        </div>
        <aside className="cs-side">
          <div className="cs-thumb">
            <PartThumb def={partPreview} />
          </div>
          <label className="field">
            <span>PCB color</span>
            <input type="color" value={d.color} onChange={(e) => upd({ color: e.target.value })} />
          </label>
          <h4>Response</h4>
          <svg viewBox="0 0 100 60" className="resp" role="img" aria-label="Sensor response curve">
            <rect x="0" y="0" width="100" height="60" fill="none" />
            {[0, 0.5, 1].map((g) => (
              <line key={g} x1={0} x2={100} y1={56 - g * 52} y2={56 - g * 52} stroke="var(--chart-grid)" strokeWidth={0.4} />
            ))}
            {d.output !== "analog" && <line x1={0} x2={100} y1={56 - d.threshold * 52} y2={56 - d.threshold * 52} stroke="var(--warn)" strokeDasharray="2 1.5" strokeWidth={0.5} />}
            <polyline points={preview.pts.map(([x, y]) => `${x * 100},${56 - y * 52}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeLinejoin="round" />
          </svg>
          <p className="small muted">
            {d.env === "none" ? "x: time" : `x: ${d.env} ${preview.a}…${preview.b}`} · y: output / VCC
          </p>
          {preview.err && <p className="warn-text">Expression error: {preview.err}</p>}
          <button
            className="btn primary wide"
            disabled={!!preview.err}
            onClick={() => {
              save(full);
              const st = useStudio.getState();
              st.addPart(full.type, { x: 140, y: 60 });
              st.toast(`“${full.name}” added to My sensors`, "ok");
              set("modal", null);
            }}
          >
            Save & add to canvas
          </button>
          <button className="btn wide" onClick={() => download(`${slug}.xtwin-sensor.json`, JSON.stringify(full, null, 2), "application/json")}>
            Export JSON
          </button>
          <label className="btn wide">
            <Upload size={14} /> Import JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const def = JSON.parse(await f.text()) as CustomSensorDef;
                  setD({ ...def });
                } catch {
                  useStudio.getState().toast("That file is not a sensor definition", "err");
                }
              }}
            />
          </label>
          {existing.length > 0 && (
            <>
              <h4>My sensors</h4>
              <ul className="mini-list">
                {existing.map((s) => (
                  <li key={s.type}>
                    <button className="link" onClick={() => setD(s)}>
                      {s.name}
                    </button>
                    <button className="btn icon sm" onClick={() => useStudio.getState().deleteCustomSensor(s.type)} aria-label={`Delete ${s.name}`}>
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- scan a board
interface ScanResult {
  match: string;
  name: string;
  confidence: number;
  width_mm: number;
  height_mm: number;
  logic_v: number;
  pins_top: string[];
  pins_bottom: string[];
  notes: string;
}

export function boardFromScan(r: ScanResult): BoardDef {
  const W = Math.max(20, r.width_mm || 50);
  const H = Math.max(12, r.height_mm || 25);
  const pins: BoardPin[] = [];
  const mk = (label: string, x: number, y: number, side: string, i: number): BoardPin => {
    const L = label.toUpperCase();
    const id = `${side}${i}`;
    if (/^(GND|G|VSS|AGND)$/.test(L)) return { id, label, x, y, kind: "gnd", volts: 0, caps: [], aliases: ["GND"] };
    if (/^(5V|VIN|VBUS|VUSB|VCC5)$/.test(L)) return { id, label, x, y, kind: "power", volts: 5, caps: [], aliases: [L] };
    if (/^(3V3|3\.3V|VCC|3V)$/.test(L)) return { id, label, x, y, kind: "power", volts: 3.3, caps: [], aliases: [L, "3V3"] };
    const n = L.match(/(\d+)$/);
    if (n && /^(GP|GPIO|IO|D|P|A)?\d+$/.test(L)) {
      const caps: Cap[] = ["digital", "pwm"];
      if (/^A\d/.test(L) || /ADC/.test(L)) caps.push("adc");
      return { id, label, x, y, kind: "gpio", gpio: Number(n[1]), caps, aliases: [L, `GPIO${n[1]}`, `D${n[1]}`, String(Number(n[1]))] };
    }
    return { id, label, x, y, kind: "ctrl", caps: [], aliases: [L] };
  };
  const row = (labels: string[], y: number, side: string) => {
    const x0 = W / 2 - ((labels.length - 1) * 2.54) / 2;
    labels.forEach((l, i) => pins.push(mk(l, x0 + i * 2.54, y, side, i)));
  };
  row(r.pins_top, 1.4, "t");
  row(r.pins_bottom, H - 1.4, "b");
  const id = `custom-${(r.name || "board").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const gp = pins.filter((p) => p.kind === "gpio");
  return {
    id,
    name: r.name || "Scanned board",
    short: (r.name || "Board").split(" ")[0].slice(0, 10),
    vendor: "Scanned",
    mcu: "Unknown MCU",
    family: "esp32",
    width: W,
    height: H,
    thickness: 1.6,
    logicV: r.logic_v || 3.3,
    adcBits: 12,
    adcVref: r.logic_v || 3.3,
    intBits: 32,
    pcbColor: "#2b3a4a",
    silkColor: "#eef3f7",
    pins,
    holes: [],
    connectors: [],
    chips: [{ x: W * 0.35, y: H * 0.3, w: W * 0.3, h: H * 0.4, label: "MCU", color: "#1b1d20", z: 1.2 }],
    languages: ["arduino", "micropython"],
    defaultLang: "arduino",
    constants: { LED_BUILTIN: gp[0]?.gpio ?? 2 },
    i2c: { sda: gp[0]?.id ?? pins[0]?.id ?? "t0", scl: gp[1]?.id ?? pins[1]?.id ?? "t1" },
    notes: [r.notes || "Imported from a photo — check the pin map against the datasheet."],
    maxComponentZ: 4,
  };
}

export function ScanModal() {
  const set = useStudio((s) => s.set);
  const setBoard = useStudio((s) => s.setBoard);
  const toast = useStudio((s) => s.toast);
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  const openCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = s;
      setCam(true);
      setTimeout(() => {
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      }, 50);
    } catch {
      setErr("Camera unavailable — upload a photo instead.");
    }
  };
  const snapPhoto = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setImg(c.toDataURL("image/jpeg", 0.85));
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCam(false);
  };
  const identify = async () => {
    if (!img) return;
    setBusy(true);
    setErr(null);
    try {
      const [meta, data] = img.split(",");
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
      const r = await fetch("/api/ai/identify-board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: data, mediaType }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Identification failed");
      setRes(j as ScanResult);
    } catch (e) {
      setErr(`${(e as Error).message}. You can still pick the board manually below.`);
    }
    setBusy(false);
  };
  return (
    <Modal title="Scan a board" onClose={() => set("modal", null)}>
      <p className="muted small">Take a photo of the top of your board. The AI reads the silkscreen and either matches a supported board or builds a new board from its pin labels.</p>
      <div className="scan-area">
        {cam ? (
          <video ref={video} playsInline muted className="scan-media" />
        ) : img ? (
          <img src={img} alt="Board to identify" className="scan-media" />
        ) : (
          <div className="scan-empty">
            <ScanLine size={36} />
          </div>
        )}
      </div>
      <div className="row">
        {cam ? (
          <button className="btn primary" onClick={snapPhoto}>
            <Camera size={15} /> Capture
          </button>
        ) : (
          <button className="btn" onClick={openCam}>
            <Camera size={15} /> Use camera
          </button>
        )}
        <label className="btn">
          <ImageUp size={15} /> Upload photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const rd = new FileReader();
              rd.onload = () => setImg(String(rd.result));
              rd.readAsDataURL(f);
            }}
          />
        </label>
        <button className="btn primary" disabled={!img || busy} onClick={identify}>
          {busy ? "Reading the board…" : "Identify"}
        </button>
      </div>
      {err && <p className="warn-text">{err}</p>}
      {res && (
        <div className="scan-result">
          <p>
            <strong>{res.name}</strong> · {Math.round(res.confidence * 100)}% confident · {res.width_mm} × {res.height_mm} mm
          </p>
          <p className="small muted">{res.notes}</p>
          {res.match !== "unknown" && BOARDS.some((b) => b.id === res.match) ? (
            <button
              className="btn primary"
              onClick={() => {
                setBoard(res.match);
                toast(`Switched to ${getBoard(res.match).name}`, "ok");
                set("modal", null);
              }}
            >
              Use {getBoard(res.match).name}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => {
                const def = boardFromScan(res);
                registerCustomBoard(def);
                try {
                  const list = JSON.parse(localStorage.getItem("xtwin.customBoards") ?? "[]") as BoardDef[];
                  localStorage.setItem("xtwin.customBoards", JSON.stringify([...list.filter((b) => b.id !== def.id), def]));
                } catch {
                  /* ignore */
                }
                setBoard(def.id);
                toast(`Imported ${def.name} with ${def.pins.length} pins`, "ok");
                set("modal", null);
              }}
            >
              Import as a new board ({res.pins_top.length + res.pins_bottom.length} pins)
            </button>
          )}
        </div>
      )}
      <h3 className="group-title">Or pick it yourself</h3>
      <div className="row wrap">
        {allBoards().map((b) => (
          <button
            key={b.id}
            className="btn sm"
            onClick={() => {
              setBoard(b.id);
              set("modal", null);
            }}
          >
            {b.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function loadCustomBoards() {
  try {
    const list = JSON.parse(localStorage.getItem("xtwin.customBoards") ?? "[]") as BoardDef[];
    for (const b of list) registerCustomBoard(b);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- projects
export function ProjectsModal() {
  const set = useStudio((s) => s.set);
  const setProject = useStudio((s) => s.setProject);
  const cur = useStudio((s) => s.project);
  const [list, setList] = useState(listProjects());
  return (
    <Modal title="Saved works" onClose={() => set("modal", null)}>
      <div className="row wrap">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            className="btn sm"
            onClick={() => {
              setProject(blankProject(b.id, `New ${b.short} circuit`));
              set("modal", null);
              window.dispatchEvent(new Event("xtwin:fit"));
            }}
          >
            <FilePlus2 size={13} /> New {b.short}
          </button>
        ))}
        <label className="btn sm">
          <Upload size={13} /> Import project
          <input
            type="file"
            accept=".json,.tcproj,.xtwin"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setProject(JSON.parse(await f.text()));
                set("modal", null);
              } catch {
                useStudio.getState().toast("That file is not an Thosaphol Connect project", "err");
              }
            }}
          />
        </label>
        <button className="btn sm" onClick={() => download(`${cur.name.replace(/\W+/g, "_")}.tcproj`, JSON.stringify(cur, null, 2), "application/json")}>
          Export current
        </button>
      </div>
      <ul className="proj-list">
        {list.map((m) => (
          <li key={m.id} className={m.id === cur.id ? "on" : ""}>
            <button
              className="link"
              onClick={() => {
                const p = openProject(m.id);
                if (p) {
                  setProject(p);
                  set("modal", null);
                }
              }}
            >
              <FolderOpen size={14} /> {m.name}
            </button>
            <small>
              {getBoard(m.boardId).short} · {new Date(m.updatedAt).toLocaleString()}
            </small>
            {m.id !== cur.id && (
              <button
                className="btn icon sm"
                aria-label={`Delete ${m.name}`}
                onClick={() => {
                  deleteProject(m.id);
                  setList(listProjects());
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
        {!list.length && <li className="muted">Nothing saved yet — your work saves automatically as you build.</li>}
      </ul>
    </Modal>
  );
}

export { Modal };
