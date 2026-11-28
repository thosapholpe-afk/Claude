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
  Check,
  LayoutGrid,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";
import { getBoard } from "../core/boards";
import { bomOf, usd } from "../core/prices";
import { runWireCommand } from "../core/wiring";
import { fx, isMuted, setHiss, setHum, setMuted, setTone, setWhine, stopAll, stopTone } from "../lib/audio";
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
  const lastFlat = useRef<"2d" | "diagram">("2d");
  if (view !== "3d") lastFlat.current = view;
  return (
    <header className="appbar">
      <button className="brand home-btn" onClick={() => st.goHome()} title="All projects" aria-label="Back to all projects">
        <LogoMark size={24} />
        <span className="wordmark">Thosaphol Connect</span>
      </button>
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
      <Steps phone={phone} onParts={onParts} layout={layout} />
      <div className="seg view-seg" role="tablist" aria-label="View">
        {(
          [
            ["flat", "2D", CircuitBoard, "Board and wiring view"],
            ["3d", "3D", Orbit, "3D bench"],
          ] as const
        ).map(([id, label, Icon, title]) => {
          const on = id === "3d" ? view === "3d" : view !== "3d";
          return (
            <button key={id} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => st.set("view", id === "3d" ? "3d" : lastFlat.current)} title={title}>
              {on && <motion.span layoutId="view-pill" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <Icon size={14} />
              <span className="seg-lbl">{label}</span>
            </button>
          );
        })}
      </div>
      {layout === "desktop" && <CommandBar />}
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
        <span className="run-lbl">{running ? "Stop" : "Simulate"}</span>
      </button>
      {layout === "tablet" && (
        <button className="btn icon ghost" onClick={onParts} aria-label="Components and inspector" title="Components">
          <PanelRight size={17} />
        </button>
      )}
      <MoreMenu phone={phone} cmd={layout !== "desktop"} />
    </header>
  );
}

/** The build → wire → code → simulate workflow as numbered steps; done steps get a check. */
function Steps({ phone, onParts, layout }: { phone: boolean; onParts: () => void; layout: string }) {
  const view = useStudio((s) => s.view);
  const project = useStudio((s) => s.project);
  const st = useStudio.getState();
  const hasParts = project.parts.filter((p) => !p.type.startsWith("board:")).length > 0;
  const hasWires = project.wires.length > 0;
  const code = project.code[project.lang] ?? "";
  const codeDone = code.trim().length > 20;
  const steps = [
    { id: "build", n: 1, label: "Build", done: hasParts, on: view === "2d", go: () => {
      st.set("view", "2d");
      st.select([]);
      if (layout !== "desktop") onParts();
    } },
    { id: "wire", n: 2, label: "Wire", done: hasWires, on: view === "diagram", go: () => st.set("view", "diagram") },
    { id: "code", n: 3, label: "Code", done: codeDone, on: false, go: () => useStudio.setState({ dockTab: "code", dockOpen: true }) },
  ];
  return (
    <nav className="steps" aria-label="Workflow">
      {steps.map((x) => (
        <button key={x.id} className={`step ${x.on ? "on" : ""} ${x.done ? "done" : ""}`} onClick={x.go} title={x.label}>
          <i>{x.done ? <Check size={11} strokeWidth={3} /> : x.n}</i>
          {!phone && <span>{x.label}</span>}
        </button>
      ))}
    </nav>
  );
}

/** Bottom status line: run state, counts, selection, estimated cost, problems. */
function StatusBar() {
  const project = useStudio((s) => s.project);
  const running = useStudio((s) => s.sim.running);
  const paused = useStudio((s) => s.sim.paused);
  const speed = useStudio((s) => s.sim.speed);
  const selection = useStudio((s) => s.selection);
  const diags = useStudio((s) => s.snap?.diags ?? []);
  const t = useStudio((s) => s.snap?.t ?? 0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const board = getBoard(project.boardId);
  const parts = project.parts.filter((p) => !p.type.startsWith("board:")).length;
  const sel = project.parts.find((p) => p.id === selection[0]);
  const bom = bomOf(project);
  const errs = diags.filter((d) => d.level === "error").length;
  return (
    <footer className="statusbar">
      <span className={`sb-run ${running ? (paused ? "paused" : "on") : ""}`}>
        <i />
        {running ? `${paused ? "Paused" : "Running"} · ${(t / 1000).toFixed(1)} s · ${speed}×` : "Ready"}
      </span>
      <span>{board.short}</span>
      <span>Parts {parts}</span>
      <span>Wires {project.wires.length}</span>
      <span>{sel ? `${sel.label} selected` : "Nothing selected"}</span>
      <button className="sb-bom" onClick={() => useStudio.setState({ modal: "projects" })} title={bom.lines.map((l) => `${l.qty}× ${l.name} ${usd(l.each * l.qty)}`).join("\n")}>
        Build cost ≈ {usd(bom.total)}
      </button>
      <span className="spacer" />
      <button className={`sb-diag ${errs ? "bad" : diags.length ? "warn" : "ok"}`} onClick={() => useStudio.setState({ dockTab: "diag", dockOpen: true })}>
        {errs ? `✕ ${errs} problem${errs > 1 ? "s" : ""}` : diags.length ? `! ${diags.length} note${diags.length > 1 ? "s" : ""}` : "✓ No problems"}
      </button>
      <span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    </footer>
  );
}

/** Everything that used to crowd the toolbar: projects, wire color, tidy, speed, sound, theme, account. */
function MoreMenu({ phone, cmd }: { phone: boolean; cmd: boolean }) {
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
            {cmd && <CommandBar />}
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
            {item(<LayoutGrid size={15} />, "All projects", () => st.goHome())}
            {item(<FolderOpen size={15} />, "Import / export", () => st.set("modal", "projects"))}
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
/** Sound effects that follow the live simulation: every part sounds like what it is doing. */
const SENSOR_FX = new Set(["pir", "flame", "water", "rain", "sw420", "mq2", "mq135", "pulse", "touch", "hall", "ir-obstacle", "sound"]);
function SoundEngine() {
  useEffect(() => {
    const prev = new Map<string, number | boolean>();
    const lastShot = new Map<string, number>();
    const servoIdle = new Map<string, ReturnType<typeof setTimeout>>();
    let recent: number[] = [];
    let lastSnap: unknown = null;
    let wasRunning = false;
    const voiced = new Set<string>();
    /** Rate-limited one-shot: max one per part per 70 ms, ten per 100 ms overall. */
    const shot = (id: string, play: () => void, gap = 70) => {
      const now = performance.now();
      if (now - (lastShot.get(id) ?? 0) < gap) return;
      recent = recent.filter((t) => now - t < 100);
      if (recent.length >= 10) return;
      recent.push(now);
      lastShot.set(id, now);
      play();
    };
    /** Rising/falling edge of a boolean; the first sighting only sets the baseline. */
    const edge = (key: string, v: boolean): -1 | 0 | 1 => {
      const was = prev.get(key);
      prev.set(key, v);
      if (was === undefined || was === v) return 0;
      return v ? 1 : -1;
    };
    const change = (key: string, v: number): boolean => {
      const was = prev.get(key);
      prev.set(key, v);
      return was !== undefined && was !== v;
    };
    const unsub = useStudio.subscribe((s) => {
      const running = s.sim.running;
      if (running !== wasRunning) {
        wasRunning = running;
        if (running) fx.powerOn();
        else fx.powerOff();
      }
      const snap = s.snap;
      if (snap === lastSnap) return;
      lastSnap = snap;
      if (!snap?.running) {
        if (voiced.size) stopAll();
        voiced.clear();
        prev.clear();
        return;
      }
      const live = new Set<string>();
      for (const p of s.project.parts) {
        const lv = snap.live[p.id];
        if (!lv) continue;
        const id = p.id;
        switch (p.type) {
          case "led":
          case "rgb-led": {
            const b = lv.brightness ?? 0;
            const was = prev.get(`${id}:lit`);
            const lit = was ? b > 0.08 : b > 0.25; // hysteresis so PWM fades don't chatter
            const e = edge(`${id}:lit`, lit);
            if (e) shot(id, e > 0 ? fx.ledOn : fx.ledOff);
            if (edge(`${id}:burnt`, !!lv.burnt) > 0) shot(`${id}:b`, fx.burnt, 0);
            break;
          }
          case "pilot-lamp": {
            const e = edge(`${id}:lit`, !!lv.on);
            if (e) shot(id, e > 0 ? fx.lampOn : fx.lampOff);
            break;
          }
          case "buzzer":
            if (lv.on && lv.freq) {
              setTone(id, lv.freq);
              live.add(id);
            }
            break;
          case "relay":
          case "timer-relay": {
            const e = edge(`${id}:on`, !!(lv.on ?? lv.indicator));
            if (e) shot(id, () => fx.relay(e > 0));
            break;
          }
          case "contactor": {
            const e = edge(`${id}:on`, !!lv.on);
            if (e) shot(id, () => fx.contactor(e > 0));
            break;
          }
          case "overload":
          case "mcb3":
            if (edge(`${id}:on`, !!lv.on)) shot(id, fx.breaker);
            break;
          case "pb-no":
          case "pb-nc":
          case "button":
          case "joystick": {
            const e = edge(`${id}:on`, !!lv.on);
            if (e) shot(id, () => fx.button(e > 0), 30);
            break;
          }
          case "limit-switch": {
            const e = edge(`${id}:on`, !!lv.on);
            if (e) shot(id, () => fx.button(e > 0), 30);
            break;
          }
          case "estop":
            if (edge(`${id}:on`, !!lv.on)) shot(id, fx.estop);
            break;
          case "selector2":
          case "selector3":
            if (change(`${id}:pos`, Number(lv.reading ?? 0))) shot(id, fx.detent);
            break;
          case "air-supply":
            if (edge(`${id}:on`, !!lv.on)) shot(id, fx.airOpen);
            break;
          case "valve52":
          case "valve52d":
            if (edge(`${id}:on`, !!lv.on)) shot(id, fx.valve);
            break;
          case "cylinder": {
            if (edge(`${id}:a0`, !!lv.leds?.[0]) > 0) shot(`${id}:a0`, fx.cylinderEnd, 0);
            if (edge(`${id}:a1`, !!lv.leds?.[1]) > 0) shot(`${id}:a1`, fx.cylinderEnd, 0);
            if (lv.speed) {
              setHiss(id, Math.abs(lv.speed) / 400);
              live.add(id);
            }
            break;
          }
          case "dc-motor":
          case "motor3": {
            const max = p.type === "motor3" ? 1500 : 1.2;
            if (lv.speed) {
              setHum(id, lv.speed, max);
              live.add(id);
            }
            break;
          }
          case "servo-sg90":
          case "servo-mg996r": {
            const a = Math.round((lv.angle ?? 0) * 2) / 2;
            if (change(`${id}:ang`, a)) {
              setWhine(id, true);
              clearTimeout(servoIdle.get(id));
              servoIdle.set(
                id,
                setTimeout(() => stopTone(id), 140),
              );
            }
            break;
          }
          case "multimeter":
            if (lv.indicator) {
              setTone(id, 2700, 0.02);
              live.add(id);
            }
            break;
          default:
            if (SENSOR_FX.has(p.type)) {
              if (edge(`${id}:det`, !!(lv.indicator ?? lv.on)) > 0) shot(id, () => fx.sensor(p.type), 120);
            }
        }
      }
      // stop the continuous voices whose part went quiet
      for (const id of voiced) if (!live.has(id) && !servoIdle.has(id)) stopTone(id);
      voiced.clear();
      for (const id of live) voiced.add(id);
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
    <div className={`app layout-${layout} ${running ? "is-running" : ""} ${leftTab ? "has-drawer" : ""} ${layout !== "phone" ? "has-status" : ""}`}>
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
      {layout !== "phone" && <StatusBar />}
      <Toasts />
      <SoundEngine />
    </div>
  );
}
