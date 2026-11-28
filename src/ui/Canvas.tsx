import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBoard, builtinLedId, builtinLedLit } from "../core/boards";
import { BOARD_ID, endpointPos, footprintOf, instBounds, isAirWire, isBoard, isHost, pinWorld } from "../core/circuit";
import { getPart } from "../core/parts";
import { engine } from "../core/sim";
import type { BoardDef, PartInstance, Wire } from "../core/types";
import { snap } from "../core/wiring";
import { useStudio } from "../store";
import { Board2D, SvgDefs } from "./render/Board2D";
import { DiagramBoard, DiagramPart } from "./render/Diagram2D";
import { Part2D } from "./render/Parts2D";

/** Which PLC terminals are energised (above half the 24 V logic level). */
function plcIo(board: BoardDef, pinV: Record<string, number> | undefined) {
  const out: Record<string, boolean> = {};
  for (const p of board.pins) if (/^[XY]\d$/.test(p.label)) out[p.label] = (pinV?.[p.id] ?? 0) > board.logicV / 2;
  return out;
}

const ANIMATED = new Set(["buzzer", "led", "water", "mq2", "mq135", "dc-motor", "rain", "pulse", "touch", "motor3"]);

interface View {
  tx: number;
  ty: number;
  k: number;
}

type Drag =
  | { kind: "part"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; pushed: boolean }
  | { kind: "pan"; sx: number; sy: number; tx: number; ty: number }
  | null;

interface PendingWire {
  part: string;
  pin: string;
  x: number;
  y: number;
}

export function wirePath(a: { x: number; y: number }, b: { x: number; y: number }, pts: { x: number; y: number }[]) {
  if (pts.length) {
    const all = [a, ...pts, b];
    let d = `M ${a.x} ${a.y}`;
    for (let i = 1; i < all.length - 1; i++) {
      const p = all[i - 1];
      const c = all[i];
      const n = all[i + 1];
      const r = Math.min(1.6, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
      const ux = Math.sign(c.x - p.x);
      const uy = Math.sign(c.y - p.y);
      const vx = Math.sign(n.x - c.x);
      const vy = Math.sign(n.y - c.y);
      d += ` L ${c.x - ux * r} ${c.y - uy * r} Q ${c.x} ${c.y} ${c.x + vx * r} ${c.y + vy * r}`;
    }
    return d + ` L ${b.x} ${b.y}`;
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(16, 3 + dist * 0.22);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`;
}

export function Canvas() {
  const diagram = useStudio((s) => s.view === "diagram");
  const project = useStudio((s) => s.project);
  const snapState = useStudio((s) => s.snap);
  const selection = useStudio((s) => s.selection);
  const selectedWire = useStudio((s) => s.selectedWire);
  const running = useStudio((s) => s.sim.running);
  const burst = useStudio((s) => s.burst);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ tx: 60, ty: 40, k: 5.2 });
  const [drag, setDrag] = useState<Drag>(null);
  const [pending, setPending] = useState<PendingWire | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverPin, setHoverPin] = useState<{ part: string; pin: string; sx: number; sy: number } | null>(null);
  const board = getBoard(project.boardId);
  const t = (snapState?.t ?? 0) / 1000;

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (cx - r.left - view.tx) / view.k, y: (cy - r.top - view.ty) / view.k };
    },
    [view],
  );

  // fit the circuit on first mount
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const parts = useStudio.getState().project.parts;
    if (!parts.length) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of parts) {
      const b = instBounds(p);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    const pad = 22;
    const k = Math.max(2, Math.min(9, Math.min((el.clientWidth - pad * 2) / (x1 - x0 + 20), (el.clientHeight - pad * 2) / (y1 - y0 + 24))));
    setView({ k, tx: (el.clientWidth - (x1 - x0) * k) / 2 - x0 * k, ty: (el.clientHeight - (y1 - y0) * k) / 2 - y0 * k + 6 });
  }, []);
  useEffect(() => {
    if (!fitted.current) {
      fitted.current = true;
      requestAnimationFrame(fit);
    }
    const onFit = () => fit();
    window.addEventListener("tconnect:fit", onFit);
    return () => window.removeEventListener("tconnect:fit", onFit);
  }, [fit]);
  // refit when a template/project replaces everything
  const partsKey = project.parts.length + project.boardId + project.name;
  useEffect(() => {
    requestAnimationFrame(fit);
  }, [partsKey, fit]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.closest?.(".cm-editor")) return;
      const st = useStudio.getState();
      if (st.modal) return; // a dialog owns the keyboard
      if (e.key === "Escape") {
        setPending(null);
        st.select([]);
      } else if (e.key === "Delete" || e.key === "Backspace") st.deleteSelection();
      else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) st.rotateSelection();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.duplicateSelection();
      } else if (e.key === "f" && !e.ctrlKey && !e.metaKey) fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

  // wheel zoom (non-passive)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(1.2, Math.min(28, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    const zoom = (e: Event) => {
      const f = (e as CustomEvent<number>).detail;
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mx = r.width / 2;
      const my = r.height / 2;
      setView((v) => {
        const k = Math.max(1.2, Math.min(28, v.k * f));
        return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
      });
    };
    window.addEventListener("tconnect:zoom", zoom);
    return () => window.removeEventListener("tconnect:zoom", zoom);
  }, []);

  const parts = useMemo(() => {
    const arr = [...project.parts];
    return arr.sort((a, b) => (isHost(a) ? -1 : isHost(b) ? 1 : isBoard(a) ? -1 : isBoard(b) ? 1 : 0));
  }, [project.parts]);
  const coverRects = useMemo(
    () =>
      project.parts
        .filter((p) => !isHost(p))
        .map((p) => {
          const b = instBounds(p);
          return { x: b.x + 0.8, y: b.y + 0.8, w: b.w - 1.6, h: b.h - 1.6 };
        }),
    [project.parts],
  );

  const inserted = useMemo(() => new Set((snapState?.inserted ?? []).map((i) => `${i.part}:${i.pin}`)), [snapState?.inserted]);
  const diagParts = useMemo(() => new Set((snapState?.diags ?? []).filter((d) => d.part).map((d) => d.part!)), [snapState?.diags]);

  const onPointerDownPart = (e: React.PointerEvent, inst: PartInstance) => {
    e.stopPropagation();
    const st = useStudio.getState();
    const pdef = getPart(inst.type);
    if (running && pdef?.toggle) {
      engine.setInput(inst.id, pdef.toggle(engine.getInput(inst.id)));
      st.select([inst.id]);
      return;
    }
    if (running && pdef?.pressable) {
      engine.setInput(inst.id, { pressed: true });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const up = () => {
        engine.setInput(inst.id, { pressed: false });
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointerup", up);
      return;
    }
    if (pending) return;
    st.select([inst.id]);
    const w = toWorld(e.clientX, e.clientY);
    setDrag({ kind: "part", id: inst.id, sx: w.x, sy: w.y, ox: inst.x, oy: inst.y, moved: false, pushed: false });
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerDownPin = (e: React.PointerEvent, part: string, pin: string) => {
    e.stopPropagation();
    const pos = endpointPos(project.parts, part, pin);
    if (!pos) return;
    if (pending) {
      if (pending.part !== part || pending.pin !== pin) useStudio.getState().addWire({ from: { part: pending.part, pin: pending.pin }, to: { part, pin } });
      setPending(null);
      return;
    }
    setPending({ part, pin, x: pos.x, y: pos.y });
    setCursor(pos);
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const pinAt = (wx: number, wy: number): { part: string; pin: string } | null => {
    let best: { part: string; pin: string; d: number } | null = null;
    for (const inst of project.parts) {
      const fp = footprintOf(inst);
      if (!fp) continue;
      const b = instBounds(inst);
      if (wx < b.x - 3 || wx > b.x + b.w + 3 || wy < b.y - 3 || wy > b.y + b.h + 3) continue;
      for (const p of fp.pins) {
        const w = pinWorld(inst, fp, p);
        const d = Math.hypot(w.x - wx, w.y - wy);
        if (d < 1.4 && (!best || d < best.d)) best = { part: inst.id, pin: p.id, d };
      }
    }
    return best;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (pending) setCursor(w);
    if (!drag) return;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, tx: drag.tx + (e.clientX - drag.sx), ty: drag.ty + (e.clientY - drag.sy) }));
      return;
    }
    const dx = w.x - drag.sx;
    const dy = w.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 0.6) return;
    const st = useStudio.getState();
    const inst = st.project.parts.find((p) => p.id === drag.id);
    if (!inst) return;
    if (!drag.pushed) st.commit((p) => p, true);
    const fp = footprintOf(inst);
    const p0 = fp?.pins[0];
    let nx = drag.ox + dx;
    let ny = drag.oy + dy;
    if (p0 && fp) {
      const rel = pinWorld({ ...inst, x: 0, y: 0 }, fp, p0);
      nx = snap(nx + rel.x) - rel.x;
      ny = snap(ny + rel.y) - rel.y;
    }
    st.movePart(drag.id, nx, ny, false);
    if (!drag.moved || !drag.pushed) setDrag({ ...drag, moved: true, pushed: true });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pending) {
      const w = toWorld(e.clientX, e.clientY);
      const hit = pinAt(w.x, w.y);
      if (hit && (hit.part !== pending.part || hit.pin !== pending.pin)) {
        useStudio.getState().addWire({ from: { part: pending.part, pin: pending.pin }, to: hit });
        setPending(null);
      }
      // otherwise stay in click-to-connect mode
    }
    if (drag?.kind === "part" && drag.moved) {
      const st = useStudio.getState();
      const ids = st.project.wires.filter((w) => (w.from.part === drag.id || w.to.part === drag.id) && w.points.length).map((w) => w.id);
      if (ids.length) st.tidyWires(ids);
    }
    setDrag(null);
  };

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (pending && e.button === 0) {
      setPending(null);
      return;
    }
    useStudio.getState().select([]);
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty });
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-tconnect-part");
    if (!type) return;
    const w = toWorld(e.clientX, e.clientY);
    useStudio.getState().addPart(type, w);
  };

  const wireEls = project.wires.map((w: Wire) => {
    const a = endpointPos(project.parts, w.from.part, w.from.pin);
    const b = endpointPos(project.parts, w.to.part, w.to.pin);
    if (!a || !b) return null;
    const d = wirePath(a, b, w.points);
    const v = snapState?.wireV[w.id] ?? 0;
    const live = running && Math.abs(v) > 0.3;
    const sel = selectedWire === w.id;
    const air = isAirWire(project.parts, w);
    return (
      <g
        key={w.id}
        className="wire"
        onPointerDown={(e) => {
          e.stopPropagation();
          useStudio.getState().select([], w.id);
        }}
      >
        <path d={d} stroke="transparent" strokeWidth={3} fill="none" />
        {sel && <path d={d} stroke="var(--accent)" strokeWidth={2.4} fill="none" opacity={0.45} />}
        {diagram ? (
          <path d={d} stroke={live ? (air ? "#5cc4ff" : "var(--dg-live)") : w.color} strokeWidth={air ? 0.6 : 0.45} fill="none" strokeLinejoin="round" />
        ) : air ? (
          <>
            {/* PU air tube: translucent blue with a highlight */}
            <path d={d} stroke="rgba(0,0,0,.4)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} stroke={w.color} strokeWidth={1.55} fill="none" opacity={0.62} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} stroke="#e8f7ff" strokeWidth={0.32} fill="none" opacity={0.55} strokeLinecap="round" transform="translate(-0.28 -0.28)" />
          </>
        ) : (
          <>
            <path d={d} stroke="rgba(0,0,0,.55)" strokeWidth={1.25} fill="none" strokeLinecap="round" />
            <path d={d} stroke={w.color} strokeWidth={0.85} fill="none" strokeLinecap="round" />
            <path d={d} stroke="#fff" strokeWidth={0.22} fill="none" opacity={0.28} strokeLinecap="round" transform="translate(-0.18 -0.18)" />
          </>
        )}
        {diagram && running && (() => {
          const mid = w.points.length ? w.points[Math.floor(w.points.length / 2)] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g transform={`translate(${mid.x} ${mid.y})`}>
              <rect x={-4.2} y={-1.35} width={8.4} height={2.7} rx={1.35} fill="var(--dg-tag)" />
              <text y={0.65} fontSize={1.75} textAnchor="middle" fill={live ? "var(--dg-live)" : "var(--dg-sub)"} fontFamily="IBM Plex Mono, monospace">
                {Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)} {air ? "bar" : "V"}
              </text>
            </g>
          );
        })()}
        {live && <path d={d} className="flow" stroke={air ? "#d4f1ff" : v > 4 ? "#fbbf24" : "#93c5fd"} strokeWidth={air ? 0.7 : 0.5} fill="none" strokeLinecap="round" style={{ animationDuration: `${air ? 0.7 : Math.max(0.35, 1.6 - v * 0.2)}s` }} />}
        <circle cx={a.x} cy={a.y} r={0.7} fill={w.color} stroke="rgba(0,0,0,.5)" strokeWidth={0.2} />
        <circle cx={b.x} cy={b.y} r={0.7} fill={w.color} stroke="rgba(0,0,0,.5)" strokeWidth={0.2} />
      </g>
    );
  });

  const hp = hoverPin;
  const hpInfo = useMemo(() => {
    if (!hp) return null;
    const inst = project.parts.find((p) => p.id === hp.part);
    if (!inst) return null;
    if (isBoard(inst)) {
      const p = board.pins.find((x) => x.id === hp.pin);
      if (!p) return null;
      const v = snapState?.pinV[p.id];
      const drv = snapState?.drives[p.id];
      return {
        title: `${board.short} · ${p.label}`,
        lines: [
          p.gpio !== undefined ? `GPIO ${p.gpio}${p.phys ? ` · pin ${p.phys}` : ""}` : p.kind === "gnd" ? "Ground" : p.volts ? `${p.volts} V supply` : p.kind,
          p.caps.length ? p.caps.map((c) => c.toUpperCase()).join(" · ") : "",
          p.inputOnly ? "Input only" : "",
          p.avoid ? `⚠ ${p.avoid}` : "",
          v !== undefined && running ? `${v.toFixed(2)} V${drv ? ` · ${drv.mode}${drv.pwm !== undefined ? ` PWM ${(drv.pwm * 100).toFixed(0)}%` : ""}` : ""}` : "",
        ].filter(Boolean),
      };
    }
    const def = getPart(inst.type);
    const p = def?.pins.find((x) => x.id === hp.pin);
    return { title: `${inst.label} · ${p?.label ?? hp.pin}`, lines: [p?.need ? `needs ${p.need.toUpperCase()}` : p?.role ?? "", inserted.has(`${inst.id}:${hp.pin}`) ? "Inserted in breadboard" : ""].filter(Boolean) };
  }, [hp, project.parts, board, snapState, running, inserted]);

  return (
    <div className={`canvas-wrap ${diagram ? "diagram" : ""}`} ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`canvas ${pending ? "is-wiring" : ""} ${drag?.kind === "pan" ? "is-panning" : ""}`}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <SvgDefs />
        <defs>
          <pattern id="grid-sm" width={2.54 * view.k} height={2.54 * view.k} patternUnits="userSpaceOnUse" x={view.tx} y={view.ty}>
            <circle cx={0.5} cy={0.5} r={view.k > 4 ? 0.7 : 0.5} fill="var(--grid-dot)" />
          </pattern>
          <pattern id="grid-lg" width={25.4 * view.k} height={25.4 * view.k} patternUnits="userSpaceOnUse" x={view.tx} y={view.ty}>
            <path d={`M ${25.4 * view.k} 0 L 0 0 0 ${25.4 * view.k}`} fill="none" stroke="var(--grid-line)" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-sm)" />
        <rect width="100%" height="100%" fill="url(#grid-lg)" />
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {parts.map((inst) => {
            const fp = footprintOf(inst);
            if (!fp) return null;
            const sel = selection.includes(inst.id);
            const cx = fp.w / 2;
            const cy = fp.h / 2;
            const live = snapState?.live[inst.id];
            const def = isBoard(inst) ? null : getPart(inst.type);
            const bnd = instBounds(inst);
            const builtin = builtinLedId(board);
            const ledOn = !!builtin && builtinLedLit(board, snapState?.drives[builtin]);
            return (
              <g key={inst.id} data-id={inst.id} className={`part ${sel ? "is-selected" : ""}`} onPointerDown={(e) => onPointerDownPart(e, inst)}>
                <g transform={`translate(${inst.x} ${inst.y}) rotate(${inst.rot} ${cx} ${cy})`}>
                  {diagram ? (
                    isBoard(inst) ? <DiagramBoard board={board} pinV={snapState?.pinV} running={running} /> : def ? <DiagramPart inst={inst} def={def} fp={fp} live={live} /> : null
                  ) : isBoard(inst) ? (
                    <Board2D board={board} powered={running} ledOn={ledOn} io={board.family === "plc" ? plcIo(board, snapState?.pinV) : undefined} />
                  ) : def ? (
                    <Part2D inst={inst} def={def} live={live} t={ANIMATED.has(def.type) || live?.burnt ? t : 0} />
                  ) : null}
                </g>
                {sel && <rect className="sel-ring" x={bnd.x - 1.2} y={bnd.y - 1.2} width={bnd.w + 2.4} height={bnd.h + 2.4} rx={1.5} />}
                {!isHost(inst) && !isBoard(inst) && (
                  <text className="part-label" x={bnd.x + bnd.w / 2} y={bnd.y + bnd.h + 3.2} textAnchor="middle">
                    {inst.label}
                    {live?.reading !== undefined && running && def?.category !== "output" && def?.type !== "resistor" ? `  ${fmt(live.reading)}${live.readingUnit ?? ""}` : ""}
                  </text>
                )}
                {diagParts.has(inst.id) && (
                  <g transform={`translate(${bnd.x + bnd.w - 1} ${bnd.y - 1})`}>
                    <path d="M0 -2.2 L2.2 1.6 H-2.2 Z" fill="var(--warn)" stroke="#000" strokeWidth={0.2} />
                    <text x={0} y={1.1} fontSize={2} textAnchor="middle" fill="#000" fontWeight={700}>
                      !
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          <g className="wires">{wireEls}</g>
          {/* pin hit targets */}
          <g className="pins">
            {parts.map((inst) => {
              const fp = footprintOf(inst);
              if (!fp) return null;
              const bb = isHost(inst);
              return fp.pins.map((p) => {
                const w = pinWorld(inst, fp, p);
                const ins = inserted.has(`${inst.id}:${p.id}`);
                // holes hidden under a mounted board/part can't be clicked — the part on top gets the click
                if (bb && coverRects.some((r) => w.x > r.x && w.x < r.x + r.w && w.y > r.y && w.y < r.y + r.h)) return ins ? <circle key={`${inst.id}:${p.id}`} cx={w.x} cy={w.y} r={0.55} fill="var(--accent)" opacity={0.85} /> : null;
                return (
                  <g key={`${inst.id}:${p.id}`}>
                    {ins && <circle cx={w.x} cy={w.y} r={0.55} fill="var(--accent)" opacity={0.85} />}
                    <circle
                      className={`pin-hit ${bb ? "bb" : ""}`}
                      cx={w.x}
                      cy={w.y}
                      r={bb ? 0.9 : 1.15}
                      onPointerDown={(e) => onPointerDownPin(e, inst.id, p.id)}
                      onPointerEnter={(e) => setHoverPin({ part: inst.id, pin: p.id, sx: e.clientX, sy: e.clientY })}
                      onPointerLeave={() => setHoverPin(null)}
                    />
                  </g>
                );
              });
            })}
          </g>
          {pending && cursor && (
            <path d={wirePath(pending, cursor, [])} stroke={useStudio.getState().wireColor ?? "var(--accent)"} strokeWidth={0.8} fill="none" strokeDasharray="1.6 1" className="pending-wire" />
          )}
          {burst && Date.now() - burst.t < 900 && <circle key={burst.t} className="burst" cx={burst.x} cy={burst.y} r={4} />}
        </g>
      </svg>
      {hpInfo && hp && (
        <div className="pin-tip" style={{ left: hp.sx - (wrapRef.current?.getBoundingClientRect().left ?? 0) + 14, top: hp.sy - (wrapRef.current?.getBoundingClientRect().top ?? 0) + 14 }}>
          <strong>{hpInfo.title}</strong>
          {hpInfo.lines.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
      {pending && <div className="wiring-hint">Click a pin to finish the wire · Esc to cancel</div>}
    </div>
  );
}

function fmt(v: number) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export { BOARD_ID };
