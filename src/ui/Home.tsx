/**
 * Projects home — the first screen after entering the studio.
 * Recent projects fan out as a deck of cards; every project sits on a shelf of
 * colored spines that open up into a detail card. "New project" asks for a name first.
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
import { Modal } from "./Modals";
import { Board2D, SvgDefs } from "./render/Board2D";
import { Part2D } from "./render/Parts2D";

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

const SPINE = ["#2f3566", "#c5dc6b", "#e8b99a", "#3f6b57", "#e6e1d3", "#a3343a", "#3b6ea8", "#d9a441"];
const inkOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#1b1d22" : "#f4f1ea";
};

/** Recent projects as a fanned hand of cards: the front one upright, the rest tucked behind. */
function Deck({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const [active, setActive] = useState(0);
  const n = projects.length;
  const go = (d: number) => setActive((a) => Math.max(0, Math.min(n - 1, a + d)));
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const wheel = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, n - 1))), [n]);
  const cur = projects[active];
  return (
    <section className="deck-stage" aria-label="Recent projects">
      <div
        className="deck"
        onPointerDown={(e) => (drag.current = { x: e.clientX, moved: false })}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 56) {
            go(dx < 0 ? 1 : -1);
            d.x = e.clientX;
            d.moved = true;
          }
        }}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onPointerLeave={() => (drag.current = null)}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
          wheel.current += e.deltaX;
          if (Math.abs(wheel.current) > 60) {
            go(wheel.current > 0 ? 1 : -1);
            wheel.current = 0;
          }
        }}
      >
        {projects.map((p, i) => {
          const d = i - active;
          const ad = Math.abs(d);
          if (ad > 4) return null;
          const board = getBoard(p.boardId);
          const parts = p.parts.filter((x) => !isBoard(x)).length;
          return (
            <motion.button
              key={p.id}
              className={`deck-card ${d === 0 ? "front" : ""}`}
              style={{ zIndex: 50 - ad, transformOrigin: "50% 115%" }}
              initial={false}
              animate={{ x: d * 62, y: ad * 8, rotate: d * 6.5, scale: 1 - ad * 0.06, opacity: ad > 3 ? 0 : 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              onClick={() => {
                if (drag.current?.moved) return;
                if (d === 0) onOpen(p.id);
                else setActive(i);
              }}
              aria-label={d === 0 ? `Open ${p.name}` : `Show ${p.name}`}
              tabIndex={d === 0 ? 0 : -1}
            >
              <span className="dc-no">no. {String(i + 1).padStart(2, "0")}</span>
              <div className="dc-art">
                <ProjectThumb project={p} />
              </div>
              <strong>{p.name}</strong>
              <em>
                {board.short} · {parts} part{parts === 1 ? "" : "s"}
              </em>
            </motion.button>
          );
        })}
      </div>
      {cur && (
        <div className="deck-nav">
          <button onClick={() => go(-1)} disabled={active === 0} aria-label="Previous project">
            <ChevronLeft size={16} />
          </button>
          <div>
            <b>{cur.name}</b>
            <small>
              {String(active + 1).padStart(2, "0")} / {String(n).padStart(2, "0")} · edited {ago(cur.updatedAt)}
            </small>
          </div>
          <button onClick={() => go(1)} disabled={active === n - 1} aria-label="Next project">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}

/** Every project as a colored spine; the chosen one opens into a card with its drawing and actions. */
function Shelf({ projects, onOpen, refresh }: { projects: Project[]; onOpen: (id: string) => void; refresh: () => void }) {
  const [open, setOpen] = useState<string | null>(projects[0]?.id ?? null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const current = useStudio((s) => s.project.id);
  const hoverable = typeof matchMedia !== "undefined" && matchMedia("(hover: hover)").matches;
  useEffect(() => {
    if (!projects.some((p) => p.id === open)) setOpen(projects[0]?.id ?? null);
  }, [projects, open]);
  return (
    <section className="shelf-wrap" aria-label="All projects">
      <div className="shelf-head">
        <p className="kicker">All projects · {projects.length}</p>
        <small className="muted">{hoverable ? "Hover a spine to open it" : "Tap a spine to open it"}</small>
      </div>
      <div className="shelf">
        {projects.map((p, i) => {
          const on = p.id === open;
          const bg = SPINE[i % SPINE.length];
          const ink = inkOn(bg);
          const board = getBoard(p.boardId);
          const parts = p.parts.filter((x) => !isBoard(x)).length;
          return (
            <motion.div
              layout
              key={p.id}
              className={`spine ${on ? "open" : ""}`}
              style={{ background: bg, color: ink }}
              onMouseEnter={() => hoverable && setOpen(p.id)}
              onClick={() => !on && setOpen(p.id)}
              transition={{ layout: { type: "spring", stiffness: 320, damping: 34 } }}
            >
              {on ? (
                <motion.div className="spine-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12, duration: 0.25 }}>
                  <div className="sb-top">
                    <span className="dc-no">
                      {String(i + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}
                    </span>
                    {p.id === current && <span className="sb-tag">open in editor</span>}
                  </div>
                  <div className="sb-art">
                    <ProjectThumb project={p} />
                  </div>
                  {renaming === p.id ? (
                    <input
                      className="sb-rename"
                      defaultValue={p.name}
                      autoFocus
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v && v !== p.name) {
                          saveProject({ ...p, name: v, updatedAt: Date.now() });
                          if (p.id === current) useStudio.getState().commit((q) => ({ ...q, name: v }), false);
                          refresh();
                        }
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                    />
                  ) : (
                    <h3>{p.name}</h3>
                  )}
                  <p>
                    {board.name}
                    <br />
                    {parts} parts · {p.wires.length} wires · ≈ {usd(bomOf(p).total)} · edited {ago(p.updatedAt)}
                  </p>
                  <div className="sb-actions">
                    <button className="sb-open" onClick={() => onOpen(p.id)}>
                      Open
                    </button>
                    <button onClick={() => setRenaming(p.id)} aria-label="Rename" title="Rename">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        saveProject({ ...p, id: newId("p"), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() });
                        refresh();
                      }}
                      aria-label="Duplicate"
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </button>
                    {p.id !== current &&
                      (confirm === p.id ? (
                        <button
                          className="sb-del"
                          onClick={() => {
                            deleteProject(p.id);
                            setConfirm(null);
                            refresh();
                          }}
                        >
                          Delete?
                        </button>
                      ) : (
                        <button onClick={() => setConfirm(p.id)} aria-label="Delete" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      ))}
                  </div>
                </motion.div>
              ) : (
                <span className="spine-label">{p.name}</span>
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/** Name first, then pick the kind of project, the board and an optional starter. */
function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"mcu" | "plc">("mcu");
  const [boardId, setBoardId] = useState("esp32-devkit-v1");
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
            <button type="button" key={id} role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => setMode(id)}>
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
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New project
        </button>
      </header>
      <section className="home-hero">
        <p className="kicker">{projects.length ? "Your projects" : "Welcome"}</p>
        <h1>{projects.length ? (first ? `Welcome back, ${first}.` : "Pick up where you left off.") : "Start your first project."}</h1>
        <p className="lede">{projects.length ? "Swipe through your work, open a project to keep building, or start something new." : "Name it, pick a board or a PLC, and start from a blank bench or a ready-made template."}</p>
      </section>
      {projects.length ? (
        <>
          <Deck projects={projects.slice(0, 12)} onOpen={open} />
          <Shelf projects={projects} onOpen={open} refresh={refresh} />
        </>
      ) : (
        <button className="home-empty" onClick={() => setCreating(true)}>
          <Plus size={28} />
          <b>Create new project</b>
          <small>Give it a name — you can change everything else later</small>
        </button>
      )}
      <AnimatePresence>{creating && <NewProjectDialog onClose={() => setCreating(false)} />}</AnimatePresence>
    </div>
  );
}
