import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Box, Download, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { getBoard } from "../core/boards";
import type { CaseFeature, CaseParams } from "../core/types";
import { generateCase, toStl } from "../lib/caseGen";
import { download } from "../lib/persist";
import { DEFAULT_CASE, useStudio } from "../store";

const ask = (text: string) => {
  useStudio.setState({ leftTab: "ai" });
  setTimeout(() => window.dispatchEvent(new CustomEvent("xtwin:ask", { detail: text })), 60);
};

// ---------------------------------------------------------------- case studio
function useCaseResult() {
  const params = useStudio((s) => s.caseParams);
  const boardId = useStudio((s) => s.project.boardId);
  return useMemo(() => {
    try {
      return { res: generateCase(getBoard(boardId), params), err: null as string | null };
    } catch (e) {
      return { res: null, err: (e as Error).message };
    }
  }, [params, boardId]);
}

export function CasePanel() {
  const params = useStudio((s) => s.caseParams);
  const boardId = useStudio((s) => s.project.boardId);
  const set = (patch: Partial<CaseParams>) => useStudio.setState({ caseParams: { ...useStudio.getState().caseParams, ...patch } });
  const [prompt, setPrompt] = useState("");
  const { res } = useCaseResult();
  const num = (k: keyof CaseParams, label: string, min: number, max: number, step = 0.2) => (
    <label className="field">
      <span>
        {label} <em>{Number(params[k]) === 0 && k === "innerHeight" ? "auto" : `${params[k]} mm`}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={Number(params[k])} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<CaseParams>)} />
    </label>
  );
  const addFeature = (face: CaseFeature["face"]) => set({ features: [...params.features, { id: `f${Date.now()}`, face, shape: "circle", u: 15, v: face === "lid" ? 15 : 8, w: 6, h: 6, label: "" }] });
  return (
    <div className="panel case-panel">
      <div className="panel-head">
        <h2>Case Studio</h2>
      </div>
      <form
        className="ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) ask(`Design a case for this ${getBoard(boardId).name}: ${prompt}`);
          setPrompt("");
        }}
      >
        <Sparkles size={15} />
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe it: waterproof, vents, a window for the sensor…" aria-label="Describe the case for the AI" />
      </form>
      {num("wall", "Wall", 1.2, 5)}
      {num("floor", "Floor", 1.2, 5)}
      {num("clearance", "Clearance", 0.2, 4)}
      {num("cornerRadius", "Corner radius", 0, 10, 0.5)}
      {num("standoffHeight", "Standoff height", 2, 12, 0.5)}
      {num("innerHeight", "Inner height (0 = auto)", 0, 60, 1)}
      {num("lidThickness", "Lid thickness", 1.2, 5)}
      {num("screwHole", "Screw pilot hole", 1.6, 3.6, 0.1)}
      <label className="field">
        <span>Ventilation</span>
        <select value={params.vents} onChange={(e) => set({ vents: e.target.value as CaseParams["vents"] })}>
          <option value="none">None</option>
          <option value="lid-slots">Slots in the lid</option>
          <option value="side-slots">Slots in the sides</option>
          <option value="honeycomb">Honeycomb lid</option>
        </select>
      </label>
      <div className="toggles">
        {(
          [
            ["waterproof", "Waterproof (gasket + gland)"],
            ["connectorCutouts", "Connector cut-outs"],
            ["mountingEars", "Mounting ears"],
            ["includeBreadboard", "Room for a breadboard"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={Boolean(params[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<CaseParams>)} />
            {l}
          </label>
        ))}
      </div>
      <h3 className="group-title">Openings</h3>
      {params.features.map((f, i) => (
        <div key={f.id} className="feature-row">
          <select value={f.face} onChange={(e) => set({ features: params.features.map((x, k) => (k === i ? { ...x, face: e.target.value as CaseFeature["face"] } : x)) })} aria-label="Face">
            {["lid", "front", "back", "left", "right"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={f.shape} onChange={(e) => set({ features: params.features.map((x, k) => (k === i ? { ...x, shape: e.target.value as CaseFeature["shape"] } : x)) })} aria-label="Shape">
            <option value="circle">⌀</option>
            <option value="rect">▭</option>
          </select>
          {(["u", "v", "w", "h"] as const).map((k) => (
            <input key={k} type="number" step={0.5} value={f[k]} aria-label={k} title={{ u: "from left (mm)", v: "from bottom (mm)", w: "width / diameter", h: "height" }[k]} onChange={(e) => set({ features: params.features.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })} />
          ))}
          <button className="btn icon sm" onClick={() => set({ features: params.features.filter((_, k) => k !== i) })} aria-label="Remove opening">
            ×
          </button>
        </div>
      ))}
      <div className="row wrap">
        {(["lid", "front", "back", "left", "right"] as const).map((f) => (
          <button key={f} className="btn sm" onClick={() => addFeature(f)}>
            + {f}
          </button>
        ))}
      </div>
      {res && (
        <ul className="notes">
          {res.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn primary" disabled={!res} onClick={() => res && download(`${getBoard(boardId).id}-case-base.stl`, toStl(res.base).buffer as ArrayBuffer, "model/stl")}>
          <Download size={15} /> Base STL
        </button>
        <button className="btn primary" disabled={!res} onClick={() => res && download(`${getBoard(boardId).id}-case-lid.stl`, toStl(res.lid, true).buffer as ArrayBuffer, "model/stl")}>
          <Download size={15} /> Lid STL
        </button>
        <button className="btn sm" onClick={() => useStudio.setState({ caseParams: DEFAULT_CASE })}>
          Reset
        </button>
      </div>
    </div>
  );
}

export function CasePreview() {
  const { res, err } = useCaseResult();
  const [explode, setExplode] = useState(true);
  if (err) return <div className="stage-msg">Could not build the case: {err}</div>;
  if (!res) return null;
  const S = 0.1;
  return (
    <div className="twin3d case-stage">
      <Canvas shadows camera={{ position: [res.outer.w * S * 1.4, res.outer.w * S * 1.1, res.outer.d * S * 1.8], fov: 38 }}>
        <color attach="background" args={[getComputedStyle(document.documentElement).getPropertyValue("--stage-bg").trim() || "#0a120e"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 10, 5]} intensity={2.4} castShadow />
        <directionalLight position={[-6, 4, -5]} intensity={0.6} />
        <group scale={S}>
          <mesh geometry={res.base} castShadow receiveShadow>
            <meshStandardMaterial color="#2ecf8a" roughness={0.55} metalness={0.05} />
          </mesh>
          <mesh geometry={res.lid} position={[0, res.outer.h + (explode ? 18 : 0.01), 0]} castShadow>
            <meshStandardMaterial color="#d9efe4" roughness={0.6} transparent opacity={0.92} />
          </mesh>
        </group>
        <Grid args={[40, 40]} cellSize={0.5} sectionSize={2.5} position={[0, -0.01, 0]} cellColor="#1f3a2c" sectionColor="#2c6a4b" fadeDistance={30} infiniteGrid />
        <OrbitControls makeDefault enableDamping />
      </Canvas>
      <div className="twin-hud">
        <div className="seg">
          <button className={explode ? "on" : ""} onClick={() => setExplode(true)}>
            Exploded
          </button>
          <button className={!explode ? "on" : ""} onClick={() => setExplode(false)}>
            Closed
          </button>
        </div>
      </div>
      <div className="twin-card">
        <div className="twin-title">
          <Box size={16} />
          <strong>Enclosure</strong>
        </div>
        <dl>
          <dt>Outer</dt>
          <dd>
            {res.outer.w.toFixed(1)} × {res.outer.d.toFixed(1)} mm
          </dd>
          <dt>Height</dt>
          <dd>{(res.outer.h + res.outer.lid).toFixed(1)} mm</dd>
          <dt>Inner</dt>
          <dd>
            {res.inner.w.toFixed(1)} × {res.inner.d.toFixed(1)} × {res.inner.h.toFixed(1)}
          </dd>
        </dl>
      </div>
    </div>
  );
}

