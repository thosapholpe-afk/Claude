import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { AlertTriangle, ChevronDown, ChevronUp, CircleAlert, Code2, Eraser, Info, LineChart, Radio, Send, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBoard } from "../core/boards";
import { engine, type MqttMessage } from "../core/sim";
import { templateFor } from "../core/templates";
import type { Lang } from "../core/types";
import { useStudio, type DockTab } from "../store";
import { Plotter } from "./Plotter";

const hl = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: "var(--code-kw)" },
  { tag: [t.typeName, t.className], color: "var(--code-type)" },
  { tag: [t.string, t.special(t.string)], color: "var(--code-str)" },
  { tag: [t.number, t.bool, t.null], color: "var(--code-num)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-com)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--code-fn)" },
  { tag: [t.processingInstruction, t.meta], color: "var(--code-meta)" },
  { tag: [t.operator], color: "var(--text-2)" },
]);
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text)", height: "100%", fontSize: "13px" },
  ".cm-content": { fontFamily: "IBM Plex Mono, ui-monospace, monospace", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--accent)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--select) !important" },
});

const LANG_LABEL: Record<Lang, string> = { arduino: "Arduino C++", micropython: "MicroPython", python: "Python 3" };

const STARTER: Record<Lang, string> = {
  arduino: `void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.println("Hello from Thosaphol Connect");
  delay(1000);
}
`,
  micropython: `from machine import Pin
import utime

while True:
    print("Hello from Thosaphol Connect")
    utime.sleep(1)
`,
  python: `from time import sleep

while True:
    print("Hello from Thosaphol Connect")
    sleep(1)
`,
};

function CodePane() {
  const project = useStudio((s) => s.project);
  const setCode = useStudio((s) => s.setCode);
  const setLang = useStudio((s) => s.setLang);
  const board = getBoard(project.boardId);
  const code = project.code[project.lang] ?? STARTER[project.lang];
  const ext = useMemo(() => [project.lang === "arduino" ? cpp() : python(), syntaxHighlighting(hl), theme, EditorView.lineWrapping], [project.lang]);
  return (
    <div className="code-pane">
      <div className="pane-bar">
        <div className="seg" role="tablist" aria-label="Language">
          {board.languages.map((l) => (
            <button key={l} role="tab" aria-selected={project.lang === l} className={project.lang === l ? "on" : ""} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
        <span className="muted small">{project.lang === "arduino" ? "sketch.ino" : "main.py"} · edits apply on the next run</span>
      </div>
      <div className="code-host">
        <CodeMirror value={code} height="100%" extensions={ext} basicSetup={{ foldGutter: false, highlightActiveLine: true }} onChange={(v) => setCode(project.lang, v)} theme="none" />
      </div>
    </div>
  );
}

function SerialPane() {
  const serial = useStudio((s) => s.serial);
  const running = useStudio((s) => s.sim.running);
  const [input, setInput] = useState("");
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [serial, follow]);
  const shown = serial.slice(-600);
  return (
    <div className="serial-pane">
      <div className="serial-out" ref={ref} onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
      }}>
        {!shown.length && <p className="muted empty">Serial output appears here when the simulation runs.</p>}
        {shown.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>
            <span className="ts">{(l.t / 1000).toFixed(3)}</span>
            <span>{l.kind === "in" ? `› ${l.text}` : l.text}</span>
          </div>
        ))}
      </div>
      <form
        className="serial-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input) return;
          engine.sendSerial(input + "\n");
          setInput("");
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={running ? "Send to the board's serial input…" : "Start the simulation to send serial input"} disabled={!running} aria-label="Serial input" />
        <button className="btn icon" disabled={!running} aria-label="Send">
          <Send size={15} />
        </button>
        <button type="button" className="btn icon" onClick={() => useStudio.setState({ serial: [] })} aria-label="Clear serial">
          <Eraser size={15} />
        </button>
      </form>
    </div>
  );
}

function DiagPane() {
  const snap = useStudio((s) => s.snap);
  const project = useStudio((s) => s.project);
  const diags = snap?.diags ?? [];
  const tpl = templateFor(project.name.toLowerCase().replace(/\s+/g, "-"));
  void tpl;
  const unconnected = useMemo(() => {
    const out: string[] = [];
    for (const p of project.parts) {
      if (p.type.startsWith("board:") || p.type === "breadboard") continue;
      const any = project.wires.some((w) => w.from.part === p.id || w.to.part === p.id) || snap?.inserted.some((i) => i.part === p.id);
      if (!any) out.push(`${p.label} is not connected to anything`);
    }
    return out;
  }, [project, snap?.inserted]);
  return (
    <div className="diag-pane">
      {!diags.length && !unconnected.length && (
        <p className="ok-line">
          <Info size={15} /> No electrical problems found. Voltages, currents and logic levels look safe.
        </p>
      )}
      {diags.map((d, i) => (
        <p key={i} className={`diag ${d.level}`}>
          {d.level === "error" ? <CircleAlert size={15} /> : <AlertTriangle size={15} />} {d.msg}
        </p>
      ))}
      {unconnected.map((m) => (
        <p key={m} className="diag info">
          <Info size={15} /> {m}
        </p>
      ))}
    </div>
  );
}

// buffered at module level so messages arrive even while the tab is closed
const mqttLog: MqttMessage[] = [];
const mqttLogListeners = new Set<() => void>();
engine.onMqtt((m) => {
  mqttLog.push(m);
  if (mqttLog.length > 400) mqttLog.splice(0, mqttLog.length - 400);
  mqttLogListeners.forEach((l) => l());
});

function MqttLogPane() {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    mqttLogListeners.add(l);
    return () => void mqttLogListeners.delete(l);
  }, []);
  const msgs = mqttLog;
  const status = useStudio((s) => s.mqttStatus);
  return (
    <div className="serial-out mqtt-log">
      <p className="muted small">Broker: {status === "online" ? engine.mqtt.broker() : "not connected — messages loop back locally"} </p>
      {!msgs.length && <p className="muted empty">Messages published or received by the firmware (PubSubClient, umqtt, paho) show up here.</p>}
      {msgs.map((m, i) => (
        <div key={i} className={`line ${m.dir === "in" ? "in" : "out"}`}>
          <span className="ts">{(m.t / 1000).toFixed(2)}</span>
          <span className="mono">
            {m.dir === "in" ? "⇣" : "⇡"} {m.topic}
          </span>
          <span>{m.payload}</span>
        </div>
      ))}
    </div>
  );
}

const TABS: { id: DockTab; label: string; icon: typeof Code2 }[] = [
  { id: "code", label: "Code", icon: Code2 },
  { id: "serial", label: "Serial monitor", icon: TerminalSquare },
  { id: "plot", label: "Plotter & historian", icon: LineChart },
  { id: "diag", label: "Diagnostics", icon: AlertTriangle },
  { id: "mqtt", label: "MQTT log", icon: Radio },
];

export function Dock() {
  const tab = useStudio((s) => s.dockTab);
  const open = useStudio((s) => s.dockOpen);
  const set = useStudio((s) => s.set);
  const diagCount = useStudio((s) => s.snap?.diags.length ?? 0);
  const serialCount = useStudio((s) => s.serial.length);
  const [h, setH] = useState(320);
  const drag = useRef<{ y: number; h: number } | null>(null);
  return (
    <section className={`dock ${open ? "" : "closed"}`} style={{ height: open ? h : 40 }}>
      <div
        className="dock-grip"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h };
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setH(Math.max(160, Math.min(window.innerHeight * 0.75, drag.current.h - (e.clientY - drag.current.y))));
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <div className="dock-tabs" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id && open}
            className={tab === tb.id && open ? "on" : ""}
            onClick={() => {
              set("dockTab", tb.id);
              set("dockOpen", true);
            }}
          >
            <tb.icon size={15} />
            <span>{tb.label}</span>
            {tb.id === "diag" && diagCount > 0 && <b className="badge warn">{diagCount}</b>}
            {tb.id === "serial" && serialCount > 0 && tab !== "serial" && <b className="badge">{Math.min(99, serialCount)}</b>}
          </button>
        ))}
        <button className="btn icon dock-toggle" onClick={() => set("dockOpen", !open)} aria-label={open ? "Collapse panel" : "Expand panel"}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div className="dock-body">
          {tab === "code" && <CodePane />}
          {tab === "serial" && <SerialPane />}
          {tab === "plot" && <Plotter />}
          {tab === "diag" && <DiagPane />}
          {tab === "mqtt" && <MqttLogPane />}
        </div>
      )}
    </section>
  );
}
