/**
 * Projects home — the first screen after entering the studio.
 * Projects are playing cards in two decks, microcontroller (green) and PLC (gold);
 * the chosen deck fans out across the whole screen. "New project" asks for a name first.
 */
import { ChevronLeft, ChevronRight, Copy, Cpu, Factory, LogOut, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { BOARDS, getBoard } from "../core/boards";
import { endpointPos, footprintOf, instBounds, isBoard } from "../core/circuit";
import { getPart } from "../core/parts";
import { boardPrice, bomOf, usd } from "../core/prices";
import { TEMPLATES, templateSupports } from "../core/templates";
import type { Project } from "../core/types";
import { newId } from "../core/wiring";
import { deleteProject, listProjects, openProject, saveProject } from "../lib/persist";
import { useStudio } from "../store";
import { wirePath } from "./Canvas";
import { Brand } from "./Logo";
import { MascotCta } from "./Mascot";
import { Modal } from "./Modals";
import { Board2D, SvgDefs } from "./render/Board2D";
import { Part2D } from "./render/Parts2D";

type DeckId = "mcu" | "plc";
const deckOf = (p: Project): DeckId => (getBoard(p.boardId).family === "plc" ? "plc" : "mcu");

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};

/** A drawing of the whole circuit: boards, parts and wires, fitted to its bounds. */
export const ProjectThumb = memo(
  function ProjectThumb({ project }: { project: Project }) {
    const board = getBoard(project.boardId);
    const vb = useMemo(() => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of project.parts) {
        const b = instBounds(p);
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w);
        y1 = Math.max(y1, b.y + b.h);
      }
      if (!Number.isFinite(x0)) return "0 0 100 60";
      const pad = Math.max(6, (x1 - x0) * 0.06);
      return `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
    }, [project.parts]);
    return (
      <svg viewBox={vb} className="proj-thumb" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <SvgDefs />
        {project.parts.map((inst) => {
          const fp = footprintOf(inst);
          if (!fp) return null;
          const def = isBoard(inst) ? null : getPart(inst.type);
          if (!isBoard(inst) && !def) return null;
          return (
            <g key={inst.id} transform={`translate(${inst.x} ${inst.y}) rotate(${inst.rot} ${fp.w / 2} ${fp.h / 2})`}>
              {isBoard(inst) ? <Board2D board={board} powered={false} ledOn={false} showLabels={false} /> : <Part2D inst={inst} def={def!} t={0} />}
            </g>
          );
        })}
        <g fill="none" strokeLinecap="round">
          {project.wires.map((w) => {
            const a = endpointPos(project.parts, w.from.part, w.from.pin);
            const b = endpointPos(project.parts, w.to.part, w.to.pin);
            if (!a || !b) return null;
            return <path key={w.id} d={wirePath(a, b, w.points)} stroke={w.color} strokeWidth={0.9} />;
          })}
        </g>
      </svg>
    );
  },
  (a, b) => a.project.id === b.project.id && a.project.updatedAt === b.project.updatedAt,
);

/** The fan spacing follows the viewport so the spread fills the screen. */
function useSpread() {
  const calc = () => (typeof window === "undefined" ? 70 : Math.max(38, Math.min(118, window.innerWidth * 0.065)));
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

/** One deck fanned like a hand of playing cards; the last card starts a new project. */
function Deck({ deck, projects, onOpen, onNew, refresh }: { deck: DeckId; projects: Project[]; onOpen: (id: string) => void; onNew: () => void; refresh: () => void }) {
  const [active, setActive] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const spread = useSpread();
  const n = projects.length + 1; // + the "new project" card
  const go = (d: number) => {
    setConfirm(false);
    setRenaming(false);
    setActive((a) => Math.max(0, Math.min(n - 1, a + d)));
  };
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const wheel = useRef(0);
  const current = useStudio((s) => s.project.id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || document.querySelector(".modal-back")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => setActive((a) => Math.min(a, n - 1)), [n]);
  const cur = projects[active];
  const Suit = deck === "plc" ? Factory : Cpu;
  return (
    <div className={`deck-stage deck-${deck}`}>
      <div
        className="deck"
        onPointerDown={(e) => (drag.current = { x: e.clientX, moved: false })}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 54) {
            go(dx < 0 ? 1 : -1);
            d.x = e.clientX;
            d.moved = true;
          }
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onPointerLeave={() => (drag.current = null)}
        onWheel={(e) => {
          wheel.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (Math.abs(wheel.current) > 70) {
            go(wheel.current > 0 ? 1 : -1);
            wheel.current = 0;
          }
        }}
      >
        {[...projects, null].map((p, i) => {
          const d = i - active;
          const ad = Math.abs(d);
          if (ad > 5) return null;
          const key = p ? p.id : "new";
          const anim = { x: d * spread, y: ad * 10, rotate: d * 6, scale: 1 - Math.min(ad, 4) * 0.055, opacity: ad > 4 ? 0 : 1 };
          if (!p)
            return (
              <motion.button
                key={key}
                className={`deck-card new-card ${d === 0 ? "front" : ""}`}
                style={{ zIndex: 60 - ad, transformOrigin: "50% 118%" }}
                initial={{ y: 140, opacity: 0, rotate: 0 }}
                animate={anim}
                transition={{ type: "spring", stiffness: 240, damping: 26, delay: Math.min(i, 6) * 0.03 }}
                onClick={() => (drag.current?.moved ? null : d === 0 ? onNew() : setActive(i))}
                aria-label={deck === "plc" ? "New PLC project" : "New microcontroller project"}
                tabIndex={d === 0 ? 0 : -1}
              >
                <Plus size={42} strokeWidth={2.2} />
                <b>New {deck === "plc" ? "PLC" : "MCU"} project</b>
                <small>Name it, pick a {deck === "plc" ? "PLC" : "board"}, start building</small>
              </motion.button>
            );
          const board = getBoard(p.boardId);
          const parts = p.parts.filter((x) => !isBoard(x)).length;
          const no = String(i + 1).padStart(2, "0");
          return (
            <motion.button
              key={key}
              className={`deck-card ${d === 0 ? "front" : ""}`}
              style={{ zIndex: 60 - ad, transformOrigin: "50% 118%" }}
              initial={{ y: 140, opacity: 0, rotate: 0 }}
              animate={anim}
              transition={{ type: "spring", stiffness: 240, damping: 26, delay: Math.min(i, 6) * 0.03 }}
              onClick={() => {
                if (drag.current?.moved) return;
                if (d === 0) onOpen(p.id);
                else go(d);
              }}
              aria-label={d === 0 ? `Open ${p.name}` : `Show ${p.name}`}
              tabIndex={d === 0 ? 0 : -1}
            >
              <span className="pc-corner tl">
                <b>{no}</b>
                <Suit size={13} />
              </span>
              <span className="pc-corner br">
                <b>{no}</b>
                <Suit size={13} />
              </span>
              <div className="pc-face">
                <div className="pc-art">
                  <ProjectThumb project={p} />
                </div>
                <strong>{p.name}</strong>
                <em>
                  {board.short} · {parts} part{parts === 1 ? "" : "s"} · {ago(p.updatedAt)}
                </em>
              </div>
            </motion.button>
          );
        })}
      </div>
      <div className="deck-nav">
        <button onClick={() => go(-1)} disabled={active === 0} aria-label="Previous card">
          <ChevronLeft size={18} />
        </button>
        <div className="dn-mid">
          {cur && renaming ? (
            <input
              className="dn-rename"
              defaultValue={cur.name}
              autoFocus
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== cur.name) {
                  saveProject({ ...cur, name: v, updatedAt: Date.now() });
                  if (cur.id === current) useStudio.getState().commit((q) => ({ ...q, name: v }), false);
                  refresh();
                }
                setRenaming(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            />
          ) : (
            <b>{cur ? cur.name : `New ${deck === "plc" ? "PLC" : "MCU"} project`}</b>
          )}
          <small>
            {String(active + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
            {cur ? ` · ≈ ${usd(bomOf(cur).total)} to build` : ""}
          </small>
          {cur && (
            <span className="dn-actions">
              <button className="dn-open" onClick={() => onOpen(cur.id)}>
                Open
              </button>
              <button onClick={() => setRenaming(true)} aria-label="Rename" title="Rename">
                <Pencil size={14} />
              </button>
              <button
                onClick={() => {
                  saveProject({ ...cur, id: newId("p"), name: `${cur.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() });
                  refresh();
                }}
                aria-label="Duplicate"
                title="Duplicate"
              >
                <Copy size={14} />
              </button>
              {cur.id !== current &&
                (confirm ? (
                  <button
                    className="dn-del"
                    onClick={() => {
                      deleteProject(cur.id);
                      setConfirm(false);
                      refresh();
                    }}
                  >
                    Delete?
                  </button>
                ) : (
                  <button onClick={() => setConfirm(true)} aria-label="Delete" title="Delete">
                    <Trash2 size={14} />
                  </button>
                ))}
            </span>
          )}
        </div>
        <button onClick={() => go(1)} disabled={active === n - 1} aria-label="Next card">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** Name first, then pick the kind of project, the board and an optional starter. */
function NewProjectDialog({ onClose, initialMode }: { onClose: () => void; initialMode: DeckId }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DeckId>(initialMode);
  const [boardId, setBoardId] = useState(initialMode === "plc" ? "plc-fx16" : "esp32-devkit-v1");
  const [template, setTemplate] = useState("");
  const [touched, setTouched] = useState(false);
  const boards = BOARDS.filter((b) => (b.family === "plc") === (mode === "plc"));
  const templates = TEMPLATES.filter((t) => templateSupports(t, boardId));
  useEffect(() => {
    if (!boards.some((b) => b.id === boardId)) setBoardId(boards[0].id);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (template && !templates.some((t) => t.id === template)) setTemplate("");
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = name.trim().length > 0;
  const create = () => {
    setTouched(true);
    if (!ok) return;
    useStudio.getState().createProject({ name, boardId, template: template || undefined });
  };
  return (
    <Modal title="New project" onClose={onClose} wide>
      <form
        className="np-form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span>Project name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Conveyor sorter, Greenhouse monitor" maxLength={80} aria-invalid={touched && !ok} />
          {touched && !ok && <small className="np-err">Give your project a name first</small>}
        </label>
        <div className="np-mode" role="tablist" aria-label="Kind of project">
          {(
            [
              ["mcu", "Microcontroller", "ESP32 · Arduino · Pico · Raspberry Pi", Cpu],
              ["plc", "PLC & control", "Ladder logic · relays · pneumatics", Factory],
            ] as const
          ).map(([id, label, sub, Icon]) => (
            <button type="button" key={id} role="tab" aria-selected={mode === id} className={`${mode === id ? "on" : ""} m-${id}`} onClick={() => setMode(id)}>
              <Icon size={18} />
              <span>
                <b>{label}</b>
                <small>{sub}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="kicker">Board</p>
        <div className="np-boards">
          {boards.map((b) => (
            <button type="button" key={b.id} className={`card-pick ${b.id === boardId ? "on" : ""}`} onClick={() => setBoardId(b.id)}>
              <svg viewBox={`-2 -2 ${b.width + 4} ${b.height + 4}`} className="thumb">
                <SvgDefs />
                <Board2D board={b} powered={false} ledOn={false} showLabels={false} />
              </svg>
              <span>{b.short}</span>
              {boardPrice(b.id) !== undefined && (
                <small className="card-meta">
                  <b>{usd(boardPrice(b.id)!)}</b>
                </small>
              )}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Start from</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">Blank — just the board</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="np-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <Plus size={15} /> Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectsHome() {
  const user = useStudio((s) => s.user);
  const theme = useStudio((s) => s.theme);
  const [rev, setRev] = useState(0);
  const [creating, setCreating] = useState(false);
  const projects = useMemo(() => {
    void rev;
    // make sure the project that was open last is on the list with its latest edits
    saveProject(useStudio.getState().project);
    return listProjects()
      .map((m) => openProject(m.id))
      .filter((p): p is Project => !!p)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [rev]);
  const decks = useMemo(() => ({ mcu: projects.filter((p) => deckOf(p) === "mcu"), plc: projects.filter((p) => deckOf(p) === "plc") }), [projects]);
  const [deck, setDeck] = useState<DeckId>(() => (projects[0] ? deckOf(projects[0]) : "mcu"));
  const refresh = () => setRev((r) => r + 1);
  const open = (id: string) => useStudio.getState().openEditor(id);
  const first = (user?.name ?? "").split(" ")[0];
  return (
    <div className="home">
      <header className="home-top">
        <Brand size={28} />
        <span className="spacer" />
        <button
          className="btn icon ghost"
          aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={() => {
            const t = theme === "dark" ? "light" : "dark";
            useStudio.getState().set("theme", t);
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
          <span className="home-user">
            <span className="avatar">{user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : user.name.slice(0, 1).toUpperCase()}</span>
            <span className="hu-name">{user.name}</span>
            <button
              className="btn icon ghost sm"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
                try {
                  localStorage.removeItem("tconnect.localUser");
                } catch {
                  /* ignore */
                }
                useStudio.getState().set("user", null);
              }}
            >
              <LogOut size={14} />
            </button>
          </span>
        )}
      </header>
      <div className="home-head">
        <div className="hh-copy">
          <p className="kicker">{projects.length ? "Your decks" : "Welcome"}</p>
          <h1>{first ? `Hi ${first}, pick a deck.` : "Pick a deck."}</h1>
          <div className="deck-switch" role="tablist" aria-label="Decks">
            {(
              [
                ["mcu", "MCU", Cpu],
                ["plc", "PLC", Factory],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={deck === id} className={`ds-${id} ${deck === id ? "on" : ""}`} onClick={() => setDeck(id)}>
                <span className="ds-pile" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <Icon size={15} />
                <b>{label}</b>
                <small>{decks[id].length}</small>
              </button>
            ))}
          </div>
        </div>
        <MascotCta>
          <button className="btn primary np-btn" onClick={() => setCreating(true)}>
            <Plus size={17} /> New project
          </button>
        </MascotCta>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={deck} className="deck-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: 30, transition: { duration: 0.18 } }}>
          <Deck deck={deck} projects={decks[deck]} onOpen={open} onNew={() => setCreating(true)} refresh={refresh} />
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>{creating && <NewProjectDialog initialMode={deck} onClose={() => setCreating(false)} />}</AnimatePresence>
    </div>
  );
}
