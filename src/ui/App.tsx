import {
  Box,
  CircuitBoard,
  Code2,
  Cpu,
  Factory,
  MoreHorizontal,
  PanelRight,
  Plus,
  SlidersHorizontal,
  Workflow,
  X,
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
  Link2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import { getBoard } from "../core/boards";
import { runWireCommand } from "../core/wiring";
import { click, isMuted, setMuted, setTone, stopAll, stopTone } from "../lib/audio";
import { initClaudeLink } from "../lib/claudeLink";
import { useStudio, type LeftTab } from "../store";
import { AIChat } from "./AIChat";
import { ClaudeLinkModal, ClaudePill } from "./ClaudeLink";
import { Canvas } from "./Canvas";
import { Dock } from "./Dock";
import { EnvPanel } from "./EnvPanel";
import { CustomSensorModal, ProjectsModal, ScanModal } from "./Modals";
import { Inspector, PartsPanel } from "./SidePanels";
import { DrawingPanel, DrawingPreview, MqttPanel, TemplatesPanel } from "./Studios";

const Twin3D = lazy(() => import("./Twin3D").then((m) => ({ default: m.Twin3D })));
const CasePreview = lazy(() => import("./CaseStudio").then((m) => ({ default: m.CasePreview })));
const Viewer3DModal = lazy(() => import("./Viewer3D").then((m) => ({ default: m.Viewer3DModal })));
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

/** Tabs that fit the phone's bottom bar; the rest live in the ⋯ menu. */
const PHONE_RAIL = new Set<LeftTab>(["templates", "ai", "env"]);

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

/** Narrow layouts: "phone" ≤ 700 px, "tablet" ≤ 1100 px. */
function useLayout() {
  const get = () => (typeof window === "undefined" ? "desktop" : window.innerWidth <= 700 ? "phone" : window.innerWidth <= 1100 ? "tablet" : "desktop");
  const [l, setL] = useState<"phone" | "tablet" | "desktop">(get);
  useEffect(() => {
    const on = () => setL(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return l;
}

function AppBar({ onParts, layout }: { onParts: () => void; layout: string }) {
  const project = useStudio((s) => s.project);
  const running = useStudio((s) => s.sim.running);
  const paused = useStudio((s) => s.sim.paused);
  const view = useStudio((s) => s.view);
  const diag = useStudio((s) => s.snap?.diags ?? []);
  const st = useStudio.getState();
  const plc = getBoard(project.boardId).family === "plc";
  const errs = diag.filter((d) => d.level === "error").length;
  const phone = layout === "phone";
  return (
    <header className="appbar">
      <div className="brand">
        <LogoMark size={24} />
        <span className="wordmark">Thosaphol Connect</span>
      </div>
      <input className="proj-name" value={project.name} onChange={(e) => st.commit((p) => ({ ...p, name: e.target.value }), false)} aria-label="Project name" />
      <div className="seg mode-seg" role="tablist" aria-label="Workspace">
        {(
          [
            ["mcu", "MCU", Cpu, "Microcontroller boards (Arduino, ESP32, Pico, Pi)"],
            ["plc", "PLC", Factory, "PLC, ladder logic and electrical control"],
          ] as const
        ).map(([id, label, Icon, title]) => {
          const on = (id === "plc") === plc;
          return (
            <button key={id} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => st.setMode(id)} title={title}>
              {on && <motion.span layoutId="mode-pill" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <Icon size={14} />
              <span className="seg-lbl">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="seg view-seg" role="tablist" aria-label="View">
        {(
          [
            ["2d", "Board", CircuitBoard, "Realistic board view"],
            ["diagram", "Wiring", Workflow, "Wiring diagram only"],
            ["3d", "3D", Orbit, "3D twin"],
          ] as const
        ).map(([id, label, Icon, title]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => st.set("view", id)} title={title}>
            {view === id && <motion.span layoutId="view-pill" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={14} />
            <span className="seg-lbl">{label}</span>
          </button>
        ))}
      </div>
      {!phone && <CommandBar />}
      <span className="spacer" />
      <ClaudePill compact={phone} />
      <button className={`btn ghost icon-ish diag-pill ${errs ? "bad" : diag.length ? "warn" : ""}`} onClick={() => useStudio.setState({ dockTab: "diag", dockOpen: true })} title={errs ? `${errs} electrical issue(s)` : diag.length ? `${diag.length} note(s)` : "Circuit OK"}>
        <Gauge size={15} />
        {diag.length ? <b>{diag.length}</b> : null}
      </button>
      {running && (
        <div className="sim-ctl">
          <SimClock />
          <button className="btn icon ghost" onClick={() => st.togglePause()} aria-label={paused ? "Resume" : "Pause"}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      )}
      <button className={`btn run ${running ? "stop" : ""}`} onClick={() => (running ? void st.stopSim() : void st.startSim())} aria-label={running ? "Stop simulation" : "Start simulation"}>
        {running ? <Square size={15} /> : <Play size={15} />}
        <span className="run-lbl">{running ? "Stop" : "Run"}</span>
      </button>
      {layout === "tablet" && (
        <button className="btn icon ghost" onClick={onParts} aria-label="Components and inspector" title="Components">
          <PanelRight size={17} />
        </button>
      )}
      <MoreMenu phone={phone} />
    </header>
  );
}

/** Everything that used to crowd the toolbar: projects, wire color, tidy, speed, sound, theme, account. */
function MoreMenu({ phone }: { phone: boolean }) {
  const [open, setOpen] = useState(false);
  const theme = useStudio((s) => s.theme);
  const user = useStudio((s) => s.user);
  const speed = useStudio((s) => s.sim.speed);
  const wireColor = useStudio((s) => s.wireColor);
  const st = useStudio.getState();
  const [muted, setM] = useState(isMuted());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const item = (icon: React.ReactNode, label: string, fn: () => void) => (
    <button
      className="mm-item"
      onClick={() => {
        fn();
        setOpen(false);
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div className="more" ref={ref}>
      <button className={`btn icon ghost ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} aria-label="More" aria-expanded={open}>
        <MoreHorizontal size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="more-menu" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }}>
            {user && (
              <div className="mm-user">
                <span className="avatar">{user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : user.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.local ? "Local account" : `via ${user.provider}`}</small>
                </span>
              </div>
            )}
            {phone && <CommandBar />}
            {phone &&
              RAIL.filter((r) => !PHONE_RAIL.has(r.id)).map((r) => (
                <button
                  key={r.id}
                  className="mm-item"
                  onClick={() => {
                    st.set("leftTab", r.id);
                    setOpen(false);
                  }}
                >
                  <r.icon size={15} />
                  <span>{r.label}</span>
                </button>
              ))}
            <button
              className="mm-item"
              onClick={() => {
                st.set("modal", "claude");
                setOpen(false);
              }}
            >
              <Link2 size={15} />
              <span>Claude link</span>
              <i className={`cl-dot s-${st.link.status}`} />
            </button>
            {item(<FolderOpen size={15} />, "Saved works", () => st.set("modal", "projects"))}
            {item(<Wrench size={15} />, "Tidy all wires", () => st.tidyWires())}
            <label className="mm-row">
              <Spline size={15} />
              <span>New wire color</span>
              <select value={wireColor ?? ""} onChange={(e) => st.set("wireColor", e.target.value || null)} aria-label="Wire color">
                <option value="">Auto</option>
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
            <label className="mm-row">
              <Gauge size={15} />
              <span>Simulation speed</span>
              <select value={speed} onChange={(e) => st.setSpeed(Number(e.target.value))} aria-label="Simulation speed">
                {[0.25, 0.5, 1, 2, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            {item(muted ? <VolumeX size={15} /> : <Volume2 size={15} />, muted ? "Sound off" : "Sound on", () => {
              setMuted(!muted);
              setM(!muted);
            })}
            {item(theme === "dark" ? <Sun size={15} /> : <Moon size={15} />, theme === "dark" ? "Light theme" : "Dark theme", () => {
              const t = theme === "dark" ? "light" : "dark";
              st.set("theme", t);
              try {
                localStorage.setItem("tconnect.theme", t);
              } catch {
                /* ignore */
              }
            })}
            {user &&
              item(<LogOut size={15} />, "Sign out", async () => {
                await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
                try {
                  localStorage.removeItem("tconnect.localUser");
                } catch {
                  /* ignore */
                }
                st.set("user", null);
              })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Type-to-wire command bar ("GP10 -> LED1"); anything else goes to the copilot. */
function CommandBar() {
  const st = useStudio.getState();
  const plc = useStudio((s) => getBoard(s.project.boardId).family === "plc");
  const [cmd, setCmd] = useState("");
  const run = () => {
    const text = cmd.trim();
    if (!text) return;
    const cur = useStudio.getState().project;
    const r = runWireCommand(cur, text);
    const changed = r.wires.length !== cur.wires.length || r.parts.length !== cur.parts.length;
    if (changed) {
      st.commit((p) => ({ ...p, parts: r.parts, wires: r.wires }));
      st.toast(r.log.join(" · "), r.ok ? "ok" : "warn");
    } else {
      useStudio.setState({ leftTab: "ai" });
      setTimeout(() => window.dispatchEvent(new CustomEvent("tconnect:ask", { detail: text })), 80);
    }
    setCmd("");
  };
  return (
    <form
      className="cmdbar"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <Spline size={14} />
      <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={plc ? "X0 -> S1  ·  Y0 -> K1  ·  ask anything" : "GP10 -> LED1  ·  servo1 -> auto  ·  ask anything"} aria-label="Wiring command" spellCheck={false} />
    </form>
  );
}

/** Edit and zoom tools floating over the canvas. */
function CanvasTools({ onInspect, layout }: { onInspect: () => void; layout: string }) {
  const st = useStudio.getState();
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const hasSel = useStudio((s) => s.selection.length > 0 || !!s.selectedWire);
  const zoom = (k: number) => window.dispatchEvent(new CustomEvent("tconnect:zoom", { detail: k }));
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Edit">
      <button className="ct" disabled={!canUndo} onClick={() => st.undo()} aria-label="Undo" title="Undo (Ctrl+Z)">
        <Undo2 size={16} />
      </button>
      <button className="ct" disabled={!canRedo} onClick={() => st.redo()} aria-label="Redo" title="Redo (Ctrl+Y)">
        <Redo2 size={16} />
      </button>
      <span className="ct-sep" />
      <button className="ct" disabled={!hasSel} onClick={() => st.rotateSelection()} aria-label="Rotate" title="Rotate (R)">
        <RotateCw size={16} />
      </button>
      <button className="ct" disabled={!hasSel} onClick={() => st.duplicateSelection()} aria-label="Duplicate" title="Duplicate (Ctrl+D)">
        <Copy size={16} />
      </button>
      <button className="ct danger" disabled={!hasSel} onClick={() => st.deleteSelection()} aria-label="Delete" title="Delete">
        <Trash2 size={16} />
      </button>
      {layout === "phone" && (
        <button className="ct" disabled={!hasSel} onClick={onInspect} aria-label="Inspect" title="Inspect">
          <SlidersHorizontal size={16} />
        </button>
      )}
      <span className="ct-sep" />
      <button className="ct" onClick={() => zoom(0.8)} aria-label="Zoom out">
        <ZoomOut size={16} />
      </button>
      <button className="ct" onClick={() => zoom(1.25)} aria-label="Zoom in">
        <ZoomIn size={16} />
      </button>
      <button className="ct" onClick={() => window.dispatchEvent(new Event("tconnect:fit"))} aria-label="Fit to screen" title="Fit (F)">
        <Maximize size={16} />
      </button>
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
        if (p.type === "relay" || p.type === "contactor" || p.type === "timer-relay") {
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
  const dockOpen = useStudio((s) => s.dockOpen);
  const set = useStudio((s) => s.set);
  const layout = useLayout();
  const [rightTab, setRightTab] = useState<"auto" | "parts">("auto");
  const [rightOpen, setRightOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => initClaudeLink(), []);
  const selKey = useStudio((s) => s.selKey);
  useEffect(() => {
    if (hasSel) setRightTab("auto");
    // tablets slide the inspector in on selection; phones wait for the Inspect button
    if (hasSel && layout === "tablet") setRightOpen(true);
  }, [hasSel, selKey, layout]);
  useEffect(() => {
    // phones start with the canvas, not the code panel
    if (layout === "phone") useStudio.setState({ dockOpen: false });
  }, [layout]);
  const narrow = layout !== "desktop";
  const stage = view === "3d" ? <Twin3D /> : leftTab === "case" ? <CasePreview /> : leftTab === "drawing" ? <DrawingPreview /> : <Canvas />;
  const editing = view !== "3d" && leftTab !== "case" && leftTab !== "drawing";
  const pickRail = (id: LeftTab) => set("leftTab", leftTab === id ? null : id);
  return (
    <div className={`app layout-${layout} ${running ? "is-running" : ""} ${leftTab ? "has-drawer" : ""}`}>
      <AppBar layout={layout} onParts={() => setRightOpen((o) => !o)} />
      <div className={`workspace ${leftTab ? "" : "no-drawer"}`}>
        <nav className="rail" aria-label="Tools">
          {RAIL.filter((r) => layout !== "phone" || PHONE_RAIL.has(r.id)).map((r) => (
            <motion.button key={r.id} className={leftTab === r.id ? "on" : ""} onClick={() => pickRail(r.id)} aria-pressed={leftTab === r.id} title={r.label} whileTap={{ scale: 0.9 }}>
              {leftTab === r.id && <motion.span layoutId="rail-pill" className="rail-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <r.icon size={19} />
              <span>{r.label}</span>
            </motion.button>
          ))}
          {layout === "phone" && (
            <>
              <motion.button className={rightOpen ? "on" : ""} onClick={() => setRightOpen((o) => !o)} title="Components" whileTap={{ scale: 0.9 }}>
                <Plus size={19} />
                <span>Parts</span>
              </motion.button>
              <motion.button className={dockOpen ? "on" : ""} onClick={() => set("dockOpen", !dockOpen)} title="Code" whileTap={{ scale: 0.9 }}>
                <Code2 size={19} />
                <span>Code</span>
              </motion.button>
            </>
          )}
        </nav>
        <AnimatePresence mode="wait" initial={false}>
          {leftTab && leftTab !== "parts" && leftTab !== "custom" && (
            <motion.aside
              className="drawer"
              key={leftTab}
              initial={layout === "phone" ? { y: 40, opacity: 0 } : { opacity: 0, x: -24 }}
              animate={layout === "phone" ? { y: 0, opacity: 1 } : { opacity: 1, x: 0 }}
              exit={layout === "phone" ? { y: 40, opacity: 0, transition: { duration: 0.14 } } : { opacity: 0, x: -16, transition: { duration: 0.14 } }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {narrow && (
                <button className="sheet-close" onClick={() => set("leftTab", null)} aria-label="Close panel">
                  <X size={16} />
                </button>
              )}
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
            {editing && <CanvasTools layout={layout} onInspect={() => setRightOpen(true)} />}
          </div>
          <Dock />
        </main>
        {narrow && rightOpen && <div className="scrim" onClick={() => setRightOpen(false)} />}
        <aside className={`right ${rightOpen ? "open" : ""}`}>
          {narrow && (
            <button className="sheet-close" onClick={() => setRightOpen(false)} aria-label="Close components">
              <X size={16} />
            </button>
          )}
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
      {modal === "claude" && <ClaudeLinkModal />}
      {modal === "viewer3d" && (
        <Suspense fallback={null}>
          <Viewer3DModal />
        </Suspense>
      )}
      <Toasts />
      <SoundEngine />
    </div>
  );
}
