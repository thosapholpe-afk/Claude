import {
  Box,
  Cable,
  Cpu,
  FolderOpen,
  LayoutTemplate,
  LogOut,
  Maximize,
  Moon,
  Orbit,
  Pause,
  Play,
  Radio,
  Redo2,
  RotateCw,
  Ruler,
  Sparkles,
  Square,
  Sun,
  ThermometerSun,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Wrench,
  ZoomIn,
  ZoomOut,
  Copy,
  Spline,
  Gauge,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Brand } from "./Logo";
import { runWireCommand } from "../core/wiring";
import { click, isMuted, setMuted, setTone, stopAll, stopTone } from "../lib/audio";
import { useStudio, type LeftTab } from "../store";
import { AIChat } from "./AIChat";
import { Canvas } from "./Canvas";
import { Dock } from "./Dock";
import { EnvPanel } from "./EnvPanel";
import { CustomSensorModal, ProjectsModal, ScanModal } from "./Modals";
import { Inspector, PartsPanel } from "./SidePanels";
import { DrawingPanel, DrawingPreview, MqttPanel, TemplatesPanel } from "./Studios";

const Twin3D = lazy(() => import("./Twin3D").then((m) => ({ default: m.Twin3D })));
const CasePreview = lazy(() => import("./CaseStudio").then((m) => ({ default: m.CasePreview })));
const CasePanel = lazy(() => import("./CaseStudio").then((m) => ({ default: m.CasePanel })));
const Loading = () => <div className="stage-msg">Loading 3D engine…</div>;

const RAIL: { id: LeftTab; label: string; icon: typeof Cpu }[] = [
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "ai", label: "Copilot", icon: Sparkles },
  { id: "env", label: "Stimuli", icon: ThermometerSun },
  { id: "mqtt", label: "MQTT", icon: Radio },
  { id: "case", label: "Case", icon: Box },
  { id: "drawing", label: "Drawing", icon: Ruler },
];

function SimClock() {
  const t = useStudio((s) => s.snap?.t ?? 0);
  const lag = useStudio((s) => s.snap?.lag);
  const s = t / 1000;
  return (
    <span className={`clock mono ${lag ? "lag" : ""}`} title={lag ? "Simulation is running slower than real time" : "Simulated time"}>
      {Math.floor(s / 60)
        .toString()
        .padStart(2, "0")}
      :{(s % 60).toFixed(1).padStart(4, "0")}
    </span>
  );
}

function TopBar() {
  const project = useStudio((s) => s.project);
  const running = useStudio((s) => s.sim.running);
  const paused = useStudio((s) => s.sim.paused);
  const speed = useStudio((s) => s.sim.speed);
  const view = useStudio((s) => s.view);
  const theme = useStudio((s) => s.theme);
  const user = useStudio((s) => s.user);
  const st = useStudio.getState();
  const [muted, setM] = useState(isMuted());
  const [menu, setMenu] = useState(false);
  return (
    <header className="topbar">
      <Brand size={30} />
      <input className="proj-name" value={project.name} onChange={(e) => st.commit((p) => ({ ...p, name: e.target.value }), false)} aria-label="Project name" />
      <span className="saved muted small">Saved locally</span>
      <span className="spacer" />
      <button className="btn ghost" onClick={() => st.set("modal", "projects")}>
        <FolderOpen size={16} /> <span className="hide-sm">Saved works</span>
      </button>
      <div className="seg view-seg" role="tablist" aria-label="View">
        {(
          [
            ["2d", "2D", Cable],
            ["3d", "3D twin", Orbit],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => st.set("view", id)}>
            {view === id && <motion.span layoutId="view-pill" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {running && (
        <div className="sim-ctl">
          <SimClock />
          <button className="btn icon" onClick={() => st.togglePause()} aria-label={paused ? "Resume" : "Pause"}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <select value={speed} onChange={(e) => st.setSpeed(Number(e.target.value))} aria-label="Simulation speed">
            {[0.25, 0.5, 1, 2, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      )}
      <button className={`btn run ${running ? "stop" : ""}`} onClick={() => (running ? void st.stopSim() : void st.startSim())}>
        {running ? <Square size={15} /> : <Play size={15} />}
        {running ? "Stop" : "Start Simulation"}
      </button>
      <button
        className="btn icon ghost"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => {
          setMuted(!muted);
          setM(!muted);
        }}
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <button
        className="btn icon ghost"
        aria-label="Toggle theme"
        onClick={() => {
          const t = theme === "dark" ? "light" : "dark";
          st.set("theme", t);
          try {
            localStorage.setItem("tconnect.theme", t);
          } catch {
            /* ignore */
          }
        }}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      {user && (
        <div className="user">
          <button className="avatar" onClick={() => setMenu((m) => !m)} aria-label="Account">
            {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <p>
                <strong>{user.name}</strong>
                <small>{user.local ? "Local account" : `via ${user.provider}`}</small>
              </p>
              <button
                className="btn ghost wide"
                onClick={async () => {
                  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
                  try {
                    localStorage.removeItem("tconnect.localUser");
                  } catch {
                    /* ignore */
                  }
                  st.set("user", null);
                }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function Toolbar() {
  const st = useStudio.getState();
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const hasSel = useStudio((s) => s.selection.length > 0 || !!s.selectedWire);
  const wireColor = useStudio((s) => s.wireColor);
  const diag = useStudio((s) => s.snap?.diags ?? []);
  const [cmd, setCmd] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const run = () => {
    const text = cmd.trim();
    if (!text) return;
    const cur = useStudio.getState().project;
    const r = runWireCommand(cur, text);
    const changed = r.wires.length !== cur.wires.length || r.parts.length !== cur.parts.length;
    if (changed) {
      st.commit((p) => ({ ...p, parts: r.parts, wires: r.wires }));
      st.toast(r.log.join(" · "), r.ok ? "ok" : "warn");
      setCmd("");
      setHint(null);
    } else {
      // not a wiring command — hand it to the copilot
      useStudio.setState({ leftTab: "ai" });
      setTimeout(() => window.dispatchEvent(new CustomEvent("tconnect:ask", { detail: text })), 80);
      setCmd("");
    }
  };
  const errs = diag.filter((d) => d.level === "error").length;
  return (
    <div className="toolbar">
      <div className="tool-group">
        <button className="btn icon ghost" disabled={!canUndo} onClick={() => st.undo()} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button className="btn icon ghost" disabled={!canRedo} onClick={() => st.redo()} aria-label="Redo" title="Redo (Ctrl+Y)">
          <Redo2 size={16} />
        </button>
        <button className="btn icon ghost" disabled={!hasSel} onClick={() => st.deleteSelection()} aria-label="Delete" title="Delete">
          <Trash2 size={16} />
        </button>
        <button className="btn icon ghost" disabled={!hasSel} onClick={() => st.rotateSelection()} aria-label="Rotate" title="Rotate (R)">
          <RotateCw size={16} />
        </button>
        <button className="btn icon ghost" disabled={!hasSel} onClick={() => st.duplicateSelection()} aria-label="Duplicate" title="Duplicate (Ctrl+D)">
          <Copy size={16} />
        </button>
      </div>
      <div className="tool-group">
        <label className="wire-color" title="Color for new wires">
          <span style={{ background: wireColor ?? "conic-gradient(#ef3b36, #ffd23f, #3ddc97, #2ec4ff, #b388ff, #ef3b36)" }} />
          <select value={wireColor ?? ""} onChange={(e) => st.set("wireColor", e.target.value || null)} aria-label="Wire color">
            <option value="">Wire: auto</option>
            <option value="#ef3b36">Red</option>
            <option value="#2b2f33">Black</option>
            <option value="#ff9f1c">Orange</option>
            <option value="#ffd23f">Yellow</option>
            <option value="#3ddc97">Green</option>
            <option value="#2ec4ff">Blue</option>
            <option value="#b388ff">Purple</option>
            <option value="#f4f4f4">White</option>
          </select>
        </label>
      </div>
      <form
        className="cmdbar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Spline size={15} />
        <input
          value={cmd}
          onChange={(e) => {
            setCmd(e.target.value);
            setHint(e.target.value ? "Enter to wire · e.g. GP10 -> LED1 · LED1 -> auto · auto wire all" : null);
          }}
          placeholder="Type a wire: GP10 -> LED1   ·   servo1 -> auto   ·   or ask anything"
          aria-label="Wiring command"
          spellCheck={false}
        />
        {hint && <span className="cmd-hint">{hint}</span>}
      </form>
      <div className="tool-group">
        <button className="btn ghost" onClick={() => st.tidyWires()} title="Route every wire neatly">
          <Wrench size={15} /> <span className="hide-sm">Tidy wires</span>
        </button>
        <button className="btn icon ghost" onClick={() => window.dispatchEvent(new CustomEvent("tconnect:zoom", { detail: 1.25 }))} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button className="btn icon ghost" onClick={() => window.dispatchEvent(new CustomEvent("tconnect:zoom", { detail: 0.8 }))} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button className="btn icon ghost" onClick={() => window.dispatchEvent(new Event("tconnect:fit"))} aria-label="Fit to screen" title="Fit (F)">
          <Maximize size={16} />
        </button>
        <button className={`btn ghost diag-pill ${errs ? "bad" : diag.length ? "warn" : ""}`} onClick={() => useStudio.setState({ dockTab: "diag", dockOpen: true })} title="Electrical checks">
          <Gauge size={15} /> {errs ? `${errs} issue${errs > 1 ? "s" : ""}` : diag.length ? `${diag.length} note${diag.length > 1 ? "s" : ""}` : "Circuit OK"}
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  const drop = useStudio((s) => s.dropToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.kind}`}
            onClick={() => drop(t.id)}
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Drives buzzer tones and relay clicks from the live simulation. */
function SoundEngine() {
  const prevRelay = useRef(new Map<string, boolean>());
  useEffect(() => {
    let lastOn = new Set<string>();
    const unsub = useStudio.subscribe((s) => {
      const snap = s.snap;
      if (!snap?.running) {
        if (lastOn.size) stopAll();
        lastOn = new Set();
        return;
      }
      const on = new Set<string>();
      for (const p of s.project.parts) {
        const lv = snap.live[p.id];
        if (!lv) continue;
        if (p.type === "buzzer" && lv.on && lv.freq) {
          setTone(p.id, lv.freq);
          on.add(p.id);
        }
        if (p.type === "relay") {
          const was = prevRelay.current.get(p.id) ?? false;
          if (was !== !!lv.on) click();
          prevRelay.current.set(p.id, !!lv.on);
        }
      }
      for (const id of lastOn) if (!on.has(id)) stopTone(id);
      lastOn = on;
    });
    return () => {
      unsub();
      stopAll();
    };
  }, []);
  return null;
}

export function Editor() {
  const leftTab = useStudio((s) => s.leftTab);
  const view = useStudio((s) => s.view);
  const theme = useStudio((s) => s.theme);
  const modal = useStudio((s) => s.modal);
  const hasSel = useStudio((s) => s.selection.length > 0 || !!s.selectedWire);
  const running = useStudio((s) => s.sim.running);
  const set = useStudio((s) => s.set);
  const [rightTab, setRightTab] = useState<"auto" | "parts">("auto");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (hasSel) setRightTab("auto");
  }, [hasSel]);
  const stage = view === "3d" ? <Twin3D /> : leftTab === "case" ? <CasePreview /> : leftTab === "drawing" ? <DrawingPreview /> : <Canvas />;
  return (
    <div className={`app ${running ? "is-running" : ""}`}>
      <TopBar />
      <Toolbar />
      <div className={`workspace ${leftTab ? "" : "no-drawer"}`}>
        <nav className="rail" aria-label="Tools">
          {RAIL.map((r) => (
            <motion.button key={r.id} className={leftTab === r.id ? "on" : ""} onClick={() => set("leftTab", leftTab === r.id ? null : r.id)} aria-pressed={leftTab === r.id} title={r.label} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}>
              {leftTab === r.id && <motion.span layoutId="rail-pill" className="rail-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <r.icon size={19} />
              <span>{r.label}</span>
            </motion.button>
          ))}
        </nav>
        <AnimatePresence mode="wait" initial={false}>
        {leftTab && leftTab !== "parts" && leftTab !== "custom" && (
          <motion.aside
            className="drawer"
            key={leftTab}
            initial={{ opacity: 0, x: -24, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -16, filter: "blur(4px)", transition: { duration: 0.14 } }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {leftTab === "templates" && <TemplatesPanel />}
            {leftTab === "ai" && <AIChat />}
            {leftTab === "env" && <EnvPanel />}
            {leftTab === "mqtt" && <MqttPanel />}
            {leftTab === "case" && (
              <Suspense fallback={<Loading />}>
                <CasePanel />
              </Suspense>
            )}
            {leftTab === "drawing" && <DrawingPanel />}
          </motion.aside>
        )}
        </AnimatePresence>
        <main className="center">
          <div className="stage">
            <Suspense fallback={<Loading />}>{stage}</Suspense>
          </div>
          <Dock />
        </main>
        <aside className="right">
          <AnimatePresence mode="wait" initial={false}>
            {hasSel && rightTab === "auto" ? (
              <motion.div key="inspector" className="right-inner" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.12 } }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
                <button className="btn ghost back-to-parts" onClick={() => setRightTab("parts")}>
                  ← Components
                </button>
                <Inspector />
              </motion.div>
            ) : (
              <motion.div key="parts" className="right-inner" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.12 } }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
                <PartsPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
      {modal === "custom-sensor" && <CustomSensorModal />}
      {modal === "scan" && <ScanModal />}
      {modal === "projects" && <ProjectsModal />}
      <Toasts />
      <SoundEngine />
    </div>
  );
}
