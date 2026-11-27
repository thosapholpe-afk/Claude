import { Plus, RotateCw, Search, Trash2, Wand2, Copy, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import { BOARDS, getBoard } from "../core/boards";
import { BOARD_ID, isBoard } from "../core/circuit";
import { allParts, getPart, type PartDef } from "../core/parts";
import { engine } from "../core/sim";
import type { PartCategory } from "../core/types";
import { autoWirePart } from "../core/wiring";
import { useStudio } from "../store";
import { Board2D, SvgDefs } from "./render/Board2D";
import { Part2D } from "./render/Parts2D";

const CATS: { id: PartCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sensor", label: "Sensors" },
  { id: "output", label: "Outputs" },
  { id: "actuator", label: "Motion" },
  { id: "display", label: "Displays" },
  { id: "input", label: "Inputs" },
  { id: "passive", label: "Passives" },
  { id: "prototyping", label: "Breadboard" },
  { id: "custom", label: "My sensors" },
];

export function PartThumb({ def }: { def: PartDef }) {
  const pad = 3;
  const vb = `${-pad - (def.type === "flame" ? 4 : def.type === "sound" ? 6 : 0)} ${-pad} ${def.w + pad * 2 + (def.type === "flame" ? 4 : def.type === "sound" ? 6 : 0)} ${def.h + pad * 2}`;
  return (
    <svg viewBox={vb} className="thumb" aria-hidden>
      <SvgDefs />
      <Part2D inst={{ id: "t", type: def.type, label: "", x: 0, y: 0, rot: 0, props: Object.fromEntries(def.props.map((p) => [p.key, p.default])) }} def={def} live={def.type === "led" ? { brightness: 0.9 } : undefined} t={0} />
    </svg>
  );
}

export function PartsPanel() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<PartCategory | "all">("all");
  const project = useStudio((s) => s.project);
  const custom = useStudio((s) => s.customSensors);
  const setBoard = useStudio((s) => s.setBoard);
  const set = useStudio((s) => s.set);
  const parts = useMemo(() => {
    void custom;
    const ql = q.trim().toLowerCase();
    return allParts().filter((p) => (cat === "all" || p.category === cat) && (!ql || p.name.toLowerCase().includes(ql) || p.keywords.some((k) => k.includes(ql)) || p.description.toLowerCase().includes(ql)));
  }, [q, cat, custom]);
  const addCenter = (type: string) => {
    const b = getBoard(project.boardId);
    const bi = project.parts.find(isBoard);
    const n = project.parts.length;
    useStudio.getState().addPart(type, { x: (bi?.x ?? 20) + b.width + 30 + (n % 3) * 18, y: (bi?.y ?? 30) + 10 + (n % 4) * 16 });
  };
  return (
    <div className="panel parts-panel">
      <div className="panel-head">
        <h2>Components</h2>
      </div>
      <label className="search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sensors, servo, LCD…" aria-label="Search components" />
      </label>
      <div className="chips" role="tablist">
        {CATS.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {!q && cat === "all" && (
          <>
            <h3 className="group-title">Boards</h3>
            <div className="card-grid boards">
              {BOARDS.map((b) => (
                <button key={b.id} className={`card-pick ${project.boardId === b.id ? "on" : ""}`} onClick={() => setBoard(b.id)} title={`${b.name} · ${b.mcu}`}>
                  <svg viewBox={`-2 -2 ${b.width + 4} ${b.height + 4}`} className="thumb">
                    <SvgDefs />
                    <Board2D board={b} powered={false} ledOn={false} showLabels={false} />
                  </svg>
                  <span>{b.short}</span>
                </button>
              ))}
            </div>
            <button className="btn ghost wide" onClick={() => set("modal", "scan")}>
              <Plus size={15} /> Scan a board to import it
            </button>
          </>
        )}
        <h3 className="group-title">{cat === "all" ? "Parts" : CATS.find((c) => c.id === cat)?.label}</h3>
        <div className="card-grid">
          {parts
            .filter((p) => p.type !== "breadboard" || cat === "all" || cat === "prototyping")
            .map((p) => (
              <button
                key={p.type}
                className="card-pick"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-tconnect-part", p.type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => addCenter(p.type)}
                onClick={(e) => e.detail === 1 && setTimeout(() => {}, 0)}
                title={`${p.description}\nDrag onto the canvas or double-click to add`}
              >
                <PartThumb def={p} />
                <span>{p.name}</span>
              </button>
            ))}
        </div>
        {(cat === "custom" || cat === "all") && (
          <button className="btn ghost wide" onClick={() => set("modal", "custom-sensor")}>
            <Plus size={15} /> Create a custom sensor
          </button>
        )}
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useStudio((s) => s.selection);
  const selectedWire = useStudio((s) => s.selectedWire);
  const project = useStudio((s) => s.project);
  const snap = useStudio((s) => s.snap);
  const running = useStudio((s) => s.sim.running);
  const st = useStudio.getState();
  const inst = project.parts.find((p) => p.id === selection[0]);
  const wire = project.wires.find((w) => w.id === selectedWire);
  if (wire) {
    const label = (part: string, pin: string) => {
      const i = project.parts.find((p) => p.id === part);
      if (!i) return pin;
      if (isBoard(i)) return `${getBoard(project.boardId).short} ${getBoard(project.boardId).pins.find((p) => p.id === pin)?.label ?? pin}`;
      return `${i.label}.${getPart(i.type)?.pins.find((p) => p.id === pin)?.label ?? pin}`;
    };
    return (
      <div className="panel inspector">
        <div className="panel-head">
          <h2>Wire</h2>
        </div>
        <p className="muted">
          {label(wire.from.part, wire.from.pin)} → {label(wire.to.part, wire.to.pin)}
        </p>
        <div className="swatches">
          {["#ef3b36", "#2b2f33", "#ff9f1c", "#ffd23f", "#3ddc97", "#2ec4ff", "#b388ff", "#f4f4f4", "#ff6fb5"].map((c) => (
            <button key={c} className="swatch" style={{ background: c }} aria-label={`Wire color ${c}`} onClick={() => st.commit((p) => ({ ...p, wires: p.wires.map((w) => (w.id === wire.id ? { ...w, color: c } : w)) }))} />
          ))}
        </div>
        {snap?.wireV[wire.id] !== undefined && running && <p className="readout">{snap.wireV[wire.id].toFixed(2)} V on this net</p>}
        <div className="row">
          <button className="btn" onClick={() => st.tidyWires([wire.id])}>
            <Ruler size={15} /> Route neatly
          </button>
          <button className="btn danger" onClick={() => st.deleteSelection()}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    );
  }
  if (!inst) return null;
  if (isBoard(inst)) {
    const b = getBoard(project.boardId);
    return (
      <div className="panel inspector">
        <div className="panel-head">
          <h2>{b.name}</h2>
        </div>
        <dl className="spec">
          <dt>MCU</dt>
          <dd>{b.mcu}</dd>
          <dt>Logic</dt>
          <dd>{b.logicV} V</dd>
          <dt>ADC</dt>
          <dd>{b.adcBits ? `${b.adcBits}-bit` : "none"}</dd>
          <dt>Size</dt>
          <dd>
            {b.width} × {b.height} mm
          </dd>
          <dt>Code</dt>
          <dd>{b.languages.map((l) => (l === "arduino" ? "Arduino C++" : l === "micropython" ? "MicroPython" : "Python")).join(", ")}</dd>
        </dl>
        <ul className="notes">
          {b.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <button className="btn" onClick={() => st.set("modal", "drawing")}>
          <Ruler size={15} /> Dimension drawing
        </button>
      </div>
    );
  }
  const def = getPart(inst.type);
  if (!def) return null;
  const live = snap?.live[inst.id];
  return (
    <div className="panel inspector">
      <div className="panel-head">
        <input className="title-input" value={inst.label} onChange={(e) => st.setLabel(inst.id, e.target.value)} aria-label="Part label" />
        <span className="tag">{def.name}</span>
      </div>
      <p className="muted small">{def.description}</p>
      {def.props.map((s) => (
        <label key={s.key} className="field">
          <span>
            {s.label}
            {s.type === "range" && <em>{Math.round(Number(inst.props[s.key] ?? s.default) * 100)}%</em>}
          </span>
          {s.type === "select" ? (
            <select value={String(inst.props[s.key] ?? s.default)} onChange={(e) => st.setProp(inst.id, s.key, e.target.value)}>
              {s.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : s.type === "range" ? (
            <input type="range" min={s.min} max={s.max} step={s.step} value={Number(inst.props[s.key] ?? s.default)} onChange={(e) => st.setProp(inst.id, s.key, Number(e.target.value))} />
          ) : s.type === "boolean" ? (
            <input type="checkbox" checked={Boolean(inst.props[s.key])} onChange={(e) => st.setProp(inst.id, s.key, e.target.checked)} />
          ) : (
            <div className="num">
              <input type="number" min={s.min} max={s.max} step={s.step} value={Number(inst.props[s.key] ?? s.default)} onChange={(e) => st.setProp(inst.id, s.key, Number(e.target.value))} />
              {s.unit && <span>{s.unit}</span>}
            </div>
          )}
        </label>
      ))}
      {inst.type === "button" && running && (
        <button className="btn" onPointerDown={() => engine.setInput(inst.id, { pressed: true })} onPointerUp={() => engine.setInput(inst.id, { pressed: false })} onPointerLeave={() => engine.setInput(inst.id, { pressed: false })}>
          Hold to press
        </button>
      )}
      {live && running && (
        <div className="live-box">
          {live.reading !== undefined && (
            <div>
              <span>Reading</span>
              <strong>
                {Number.isInteger(live.reading) ? live.reading : live.reading.toFixed(2)} {live.readingUnit}
              </strong>
            </div>
          )}
          {live.outV !== undefined && (
            <div>
              <span>Output</span>
              <strong>{live.outV.toFixed(3)} V</strong>
            </div>
          )}
          {live.angle !== undefined && (
            <div>
              <span>Angle</span>
              <strong>{live.angle.toFixed(0)}°</strong>
            </div>
          )}
          {live.brightness !== undefined && (
            <div>
              <span>Brightness</span>
              <strong>{Math.round(Math.min(1, live.brightness) * 100)}%</strong>
            </div>
          )}
          {live.powered !== undefined && (
            <div>
              <span>Power</span>
              <strong className={live.powered ? "ok" : "bad"}>{live.powered ? "OK" : "no supply"}</strong>
            </div>
          )}
          {live.warn && <p className="warn-text">{live.warn}</p>}
        </div>
      )}
      <h3 className="group-title">Pins</h3>
      <ul className="pin-list">
        {def.pins
          .filter((p) => inst.type !== "breadboard")
          .map((p) => {
            const w = project.wires.find((x) => (x.from.part === inst.id && x.from.pin === p.id) || (x.to.part === inst.id && x.to.pin === p.id));
            const other = w ? (w.from.part === inst.id ? w.to : w.from) : null;
            const otherLabel = other ? (other.part === BOARD_ID ? getBoard(project.boardId).pins.find((x) => x.id === other.pin)?.label : `${project.parts.find((x) => x.id === other.part)?.label}.${other.pin}`) : null;
            return (
              <li key={p.id}>
                <span className="mono">{p.label}</span>
                <span className={otherLabel ? "conn" : "muted"}>{otherLabel ?? (p.need ? `needs ${p.need.toUpperCase()}` : "—")}</span>
              </li>
            );
          })}
      </ul>
      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            const r = autoWirePart(st.project, inst.id);
            st.commit((p) => ({ ...p, parts: r.parts, wires: r.wires }));
            st.toast(r.log.length ? r.log.join(" · ") : "Everything is already connected", "ok");
          }}
        >
          <Wand2 size={15} /> Auto-wire
        </button>
        <button className="btn icon" onClick={() => st.rotateSelection()} aria-label="Rotate">
          <RotateCw size={15} />
        </button>
        <button className="btn icon" onClick={() => st.duplicateSelection()} aria-label="Duplicate">
          <Copy size={15} />
        </button>
        <button className="btn icon danger" onClick={() => st.deleteSelection()} aria-label="Delete">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
