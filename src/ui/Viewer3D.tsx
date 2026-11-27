import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box, Layers, Minus, Plus, RotateCw, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getBoard } from "../core/boards";
import { instBounds, isBoard, isHost } from "../core/circuit";
import { getPart } from "../core/parts";
import type { BoardDef, PartInstance } from "../core/types";
import { useStudio } from "../store";
import { Instance3D, useStack, Wires3D } from "./Twin3D";

const S = 0.1;
const VIEWS: Record<string, [number, number, number]> = {
  iso: [0.85, 0.75, 1.15],
  top: [0.0001, 1, 0.0002],
  front: [0, 0.22, 1],
  side: [1, 0.22, 0],
  under: [0.7, -0.85, 0.9],
};

type Shown = { ids: Set<string>; title: string; sub: string };

function pick(parts: PartInstance[], focus: string | null, scope: "focus" | "all", hostOf: Map<string, string>, board: BoardDef): Shown {
  const all = { ids: new Set(parts.map((p) => p.id)), title: "Whole circuit", sub: `${parts.length} items` };
  const inst = focus ? parts.find((p) => p.id === focus) : undefined;
  if (scope === "all" || !inst) return all;
  if (isHost(inst)) {
    const kids = parts.filter((p) => hostOf.get(p.id) === inst.id);
    const def = getPart(inst.type)!;
    const size = inst.type === "perfboard" ? `${inst.props.cols ?? 24} × ${inst.props.rows ?? 18} holes` : `${inst.props.cols ?? 30} columns`;
    return { ids: new Set([inst.id, ...kids.map((k) => k.id)]), title: `${inst.label} · ${def.name}`, sub: `${size}${kids.length ? ` · ${kids.length} mounted` : ""}` };
  }
  if (isBoard(inst)) {
    const h = hostOf.get(inst.id);
    const host = h ? parts.find((p) => p.id === h) : undefined;
    return { ids: new Set([inst.id, ...(host ? [host.id] : [])]), title: board.name, sub: host ? `mounted on ${host.label} (${getPart(host.type)?.name})` : `${board.width} × ${board.height} mm PCB` };
  }
  return { ids: new Set([inst.id]), title: `${inst.label} · ${getPart(inst.type)?.name ?? inst.type}`, sub: "component" };
}

/** Animated vertical separation of stack levels. */
function Exploder({ level, explode, children }: { level: number; explode: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    const target = explode ? level * 2.2 : 0;
    g.current.position.y = THREE.MathUtils.damp(g.current.position.y, target, 6, dt);
  });
  return <group ref={g}>{children}</group>;
}

function Scene({ shown, view, spin, explode, onDims, onUserMove }: { shown: Shown; view: string; spin: boolean; explode: boolean; onDims: (d: [number, number, number]) => void; onUserMove: () => void }) {
  const parts = useStudio((s) => s.project.parts);
  const board = getBoard(useStudio((s) => s.project.boardId));
  const stack = useStack(parts, board);
  const list = parts.filter((p) => shown.ids.has(p.id));
  const levels = useMemo(() => {
    const ls = [...new Set(list.map((p) => Math.round((stack.lift.get(p.id) ?? 0) * 10) / 10))].sort((a, b) => a - b);
    return new Map(list.map((p) => [p.id, ls.indexOf(Math.round((stack.lift.get(p.id) ?? 0) * 10) / 10)]));
  }, [list, stack]);
  const center = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of list) {
      const b = instBounds(p);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, y1 - y0) * S };
  }, [list]);
  const content = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } | null;
  const anim = useRef(0);
  const lastDims = useRef("");
  useEffect(() => {
    anim.current = 1;
  }, [view, shown.title, explode]);
  useEffect(() => {
    if (!controls) return;
    const f = () => onUserMove();
    controls.addEventListener("start", f);
    return () => controls.removeEventListener("start", f);
  }, [controls, onUserMove]);
  const frame = useRef(0);
  useFrame((_, dt) => {
    frame.current++;
    if (content.current && frame.current % 20 === 0) {
      const b = new THREE.Box3().setFromObject(content.current);
      if (!b.isEmpty()) {
        const sz = b.getSize(new THREE.Vector3()).divideScalar(S);
        const key = `${sz.x.toFixed(1)}|${sz.z.toFixed(1)}|${sz.y.toFixed(1)}`;
        if (key !== lastDims.current) {
          lastDims.current = key;
          onDims([sz.x, sz.z, sz.y]);
        }
      }
    }
    if (anim.current > 0 && controls) {
      const d = Math.max(3.6, center.span * (explode ? 2.05 : 1.8));
      const dir = new THREE.Vector3(...(VIEWS[view] ?? VIEWS.iso)).normalize();
      const goal = dir.multiplyScalar(d).add(new THREE.Vector3(0, 0.4, 0));
      const k = 1 - Math.exp(-dt * 5);
      camera.position.lerp(goal, k);
      controls.target.lerp(new THREE.Vector3(0, 0.4, 0), k);
      controls.update();
      anim.current = camera.position.distanceTo(goal) < 0.02 ? 0 : anim.current;
    }
  });
  return (
    <>
      <group ref={content} position={[-center.cx * S, 0, -center.cy * S]}>
        {list.map((p) => (
          <Exploder key={p.id} level={levels.get(p.id) ?? 0} explode={explode}>
            <Instance3D inst={p} board={board} lift={stack.lift.get(p.id) ?? 0} />
          </Exploder>
        ))}
        {!explode && <Wires3D pinTop={stack.pinTop} only={shown.ids} />}
      </group>
      <ContactShadows position={[0, -0.002, 0]} opacity={0.55} scale={Math.max(8, center.span * 2.6)} blur={2.6} far={3} resolution={1024} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate={spin} autoRotateSpeed={1.1} minDistance={1} maxDistance={80} />
    </>
  );
}

function HoleSize({ inst }: { inst: PartInstance }) {
  const setProp = useStudio((s) => s.setProp);
  const keys = inst.type === "perfboard" ? (["cols", "rows"] as const) : (["cols"] as const);
  const spec = (k: string) => getPart(inst.type)!.props.find((p) => p.key === k)!;
  return (
    <div className="v3d-holes">
      <span className="muted small">Holes</span>
      {keys.map((k, i) => {
        const v = Number(inst.props[k] ?? spec(k).default);
        const sp = spec(k);
        const clamp = (n: number) => Math.max(Number(sp.min ?? 1), Math.min(Number(sp.max ?? 99), n));
        return (
          <span key={k} className="v3d-step">
            {i > 0 && <b className="x">×</b>}
            <button aria-label={`Fewer ${k}`} onClick={() => setProp(inst.id, k, clamp(v - 1))}>
              <Minus size={13} />
            </button>
            <input aria-label={k} value={v} inputMode="numeric" onChange={(e) => Number.isFinite(+e.target.value) && e.target.value !== "" && setProp(inst.id, k, clamp(Math.round(+e.target.value)))} />
            <button aria-label={`More ${k}`} onClick={() => setProp(inst.id, k, clamp(v + 1))}>
              <Plus size={13} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function Viewer3DModal() {
  const parts = useStudio((s) => s.project.parts);
  const boardId = useStudio((s) => s.project.boardId);
  const focus = useStudio((s) => s.viewerFocus);
  const set = useStudio((s) => s.set);
  const board = getBoard(boardId);
  const stack = useStack(parts, board);
  const [scope, setScope] = useState<"focus" | "all">(focus ? "focus" : "all");
  const [view, setView] = useState("iso");
  const [spin, setSpin] = useState(true);
  const [explode, setExplode] = useState(false);
  const [dims, setDims] = useState<[number, number, number] | null>(null);
  const shown = useMemo(() => pick(parts, focus, scope, stack.hostOf, board), [parts, focus, scope, stack, board]);
  const focusInst = focus ? parts.find((p) => p.id === focus) : undefined;
  const hostInView = scope === "focus" && focusInst ? (isHost(focusInst) ? focusInst : isBoard(focusInst) ? parts.find((p) => p.id === stack.hostOf.get(focusInst.id)) : undefined) : undefined;
  const close = () => set("modal", null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const stackLevels = new Set(parts.filter((p) => shown.ids.has(p.id)).map((p) => Math.round(stack.lift.get(p.id) ?? 0))).size;
  return (
    <motion.div className="modal-back v3d-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div className="v3d" role="dialog" aria-modal="true" aria-label="3D viewer" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
        <Canvas shadows dpr={[1, 2]} camera={{ fov: 35, near: 0.05, far: 300, position: [6, 5, 8] }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[6, 10, 5]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
          <directionalLight position={[-6, 3, -4]} intensity={0.7} color="#f5d0c4" />
          <directionalLight position={[0, -6, 2]} intensity={0.35} color="#e8eadf" />
          <Environment resolution={256} frames={1}>
            <Lightformer intensity={2.2} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} color="#ffffff" />
            <Lightformer intensity={1.4} position={[-6, 2, 3]} rotation={[0, Math.PI / 2, 0]} scale={[8, 3, 1]} color="#e8d4a2" />
            <Lightformer intensity={1.2} position={[6, 2, -3]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 3, 1]} color="#bcd9a2" />
            <Lightformer intensity={0.5} position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[10, 10, 1]} color="#e9e4dc" />
          </Environment>
          <Scene shown={shown} view={view} spin={spin} explode={explode} onDims={setDims} onUserMove={() => setSpin(false)} />
        </Canvas>

        <header className="v3d-head">
          <div>
            <span className="eyebrow">3D model</span>
            <h2>{shown.title}</h2>
            <p className="muted small">{shown.sub}</p>
          </div>
          <button className="btn icon" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {dims && (
          <div className="v3d-dims" title="Overall bounding box">
            <span>W</span>
            <b>{dims[0].toFixed(1)}</b>
            <span>D</span>
            <b>{dims[1].toFixed(1)}</b>
            <span>H</span>
            <b>{dims[2].toFixed(1)}</b>
            <em>mm</em>
          </div>
        )}

        <div className="v3d-bar">
          <div className="seg">
            {[
              ["iso", "Iso"],
              ["top", "Top"],
              ["front", "Front"],
              ["side", "Side"],
              ["under", "Under"],
            ].map(([id, l]) => (
              <button
                key={id}
                className={view === id ? "on" : ""}
                onClick={() => {
                  setView(id);
                  setSpin(false);
                }}
              >
                {view === id && <motion.span layoutId="v3d-view" className="seg-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span>{l}</span>
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={spin ? "on" : ""} onClick={() => setSpin((v) => !v)} title="Auto-rotate">
              {spin && <motion.span layoutId="v3d-spin" className="seg-pill" />}
              <RotateCw size={14} className={spin ? "spin-slow" : ""} />
              <span>Spin</span>
            </button>
            <button className={explode ? "on" : ""} onClick={() => setExplode((v) => !v)} disabled={stackLevels < 2} title={stackLevels < 2 ? "Nothing is stacked" : "Lift the stack apart"}>
              {explode && <motion.span layoutId="v3d-exp" className="seg-pill" />}
              <Layers size={14} />
              <span>Explode</span>
            </button>
            {focusInst && (
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope((s) => (s === "all" ? "focus" : "all"))}>
                {scope === "all" && <motion.span layoutId="v3d-scope" className="seg-pill" />}
                <Box size={14} />
                <span>Whole circuit</span>
              </button>
            )}
          </div>
          {hostInView && (hostInView.type === "perfboard" || hostInView.type === "breadboard") && <HoleSize inst={hostInView} />}
        </div>
        <p className="v3d-hint muted small">Drag to orbit · scroll to zoom · right-drag to pan</p>
      </motion.div>
    </motion.div>
  );
}
