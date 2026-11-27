import { Building2, CloudRain, Factory, Flame, Footprints, Leaf, Mountain, RotateCcw, Snowflake, Sun, TestTubeDiagonal } from "lucide-react";
import { ENV_VARS, getScenario, SCENARIOS } from "../core/env";
import { engine } from "../core/sim";
import { useStudio } from "../store";

export const SCENARIO_ICON: Record<string, typeof Flame> = {
  lab: TestTubeDiagonal,
  "building-fire": Flame,
  flood: CloudRain,
  "motor-vibration": Factory,
  "day-night": Sun,
  "cold-storage": Snowflake,
  "gas-leak": Building2,
  intruder: Footprints,
  earthquake: Mountain,
  greenhouse: Leaf,
};

export function EnvPanel() {
  const project = useStudio((s) => s.project);
  const env = useStudio((s) => s.snap?.env);
  const running = useStudio((s) => s.sim.running);
  const setScenario = useStudio((s) => s.setScenario);
  const setOverride = useStudio((s) => s.setOverride);
  const sc = project.scenario;
  const def = getScenario(sc.id);
  const local = Math.max(0, (engine.t / 1000) - sc.startedAt);
  return (
    <div className="panel env-panel">
      <div className="panel-head">
        <h2>Stimuli & scenarios</h2>
      </div>
      <p className="muted small">Put the circuit somewhere: the environment drives every sensor model — flame IR, heat, smoke, water depth, vibration, distance and more.</p>
      <div className="scenario-grid">
        {SCENARIOS.map((s, i) => {
          const Icon = SCENARIO_ICON[s.id] ?? TestTubeDiagonal;
          return (
            <button key={s.id} style={{ ["--i" as string]: i }} className={`card-pick scenario stagger tilt ${sc.id === s.id ? "on" : ""}`} onClick={() => setScenario({ id: s.id })} title={s.description}>
              <Icon size={20} />
              <span>{s.name}</span>
              <small>{s.thai}</small>
            </button>
          );
        })}
      </div>
      {sc.id !== "lab" && (
        <div className="scenario-ctl">
          <p className="small">{def.description}</p>
          <label className="field">
            <span>
              Intensity <em>{Math.round(sc.intensity * 100)}%</em>
            </span>
            <input type="range" min={0} max={1} step={0.01} value={sc.intensity} onChange={(e) => setScenario({ intensity: Number(e.target.value), startedAt: sc.startedAt })} />
          </label>
          <label className="field">
            <span>
              Timeline <em>{sc.duration}s</em>
            </span>
            <input type="range" min={2} max={180} step={1} value={sc.duration} onChange={(e) => setScenario({ duration: Number(e.target.value), startedAt: sc.startedAt })} />
          </label>
          {def.params?.map((p) =>
            p.options ? (
              <label key={p.key} className="field">
                <span>{p.label}</span>
                <select value={String(sc.params[p.key] ?? p.default)} onChange={(e) => setScenario({ params: { [p.key]: e.target.value }, startedAt: sc.startedAt })}>
                  {p.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={p.key} className="field">
                <span>
                  {p.label} <em>{String(sc.params[p.key] ?? p.default)}</em>
                </span>
                <input type="range" min={p.min} max={p.max} step={p.max! > 10 ? 10 : 0.01} value={Number(sc.params[p.key] ?? p.default)} onChange={(e) => setScenario({ params: { [p.key]: Number(e.target.value) }, startedAt: sc.startedAt })} />
              </label>
            ),
          )}
          <div className="timeline">
            <div className="bar">
              <i style={{ width: `${Math.min(100, (local / sc.duration) * 100)}%` }} />
            </div>
            <button className="btn sm" onClick={() => setScenario({ startedAt: engine.t / 1000 })} disabled={!running}>
              <RotateCcw size={13} /> Restart timeline
            </button>
          </div>
        </div>
      )}
      <h3 className="group-title">Live environment</h3>
      <p className="muted small">Drag a slider to override the scenario. Double-click it to hand control back.</p>
      <div className="env-vars">
        {ENV_VARS.map((v) => {
          const ov = project.envOverrides[v.key];
          const val = ov ?? (env ? (env[v.key] as number) : 0);
          return (
            <label key={v.key} className={`env-var ${ov !== undefined ? "override" : ""}`} onDoubleClick={() => setOverride(v.key, undefined)}>
              <span>{v.label}</span>
              <input type="range" min={v.min} max={v.key === "lux" ? 5000 : v.max} step={v.step} value={Math.min(val, v.key === "lux" ? 5000 : v.max)} onChange={(e) => setOverride(v.key, Number(e.target.value))} />
              <b>
                {v.max <= 1 && v.unit === "" ? `${Math.round(val * 100)}%` : Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(1)}
                <em>{v.unit}</em>
              </b>
            </label>
          );
        })}
      </div>
    </div>
  );
}
