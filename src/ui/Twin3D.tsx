import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Box, Columns2, Maximize, RectangleHorizontal, Square } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { builtinLedId, builtinLedLit, getBoard } from "../core/boards";
import { buildTopology, endpointPos, footprintOf, instBounds, isAirWire, isBoard, isHost } from "../core/circuit";
import { getScenario, vibAccel } from "../core/env";
import { getPart, type PartDef } from "../core/parts";
import { engine } from "../core/sim";
import type { BoardDef, PartInstance } from "../core/types";
import { useStudio } from "../store";
import { SCENARIO_ICON } from "./EnvPanel";
import { PartModel } from "./three/parts3d";
import { BoardModel, computeStack, HostModel } from "./three/models";

const S = 0.1; // 1 unit = 10 mm

function useCenter() {
  const parts = useStudio((s) => s.project.parts);
  return useMemo(() => {
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
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, y1 - y0) * S };
  }, [parts]);
}

const live = () => useStudio.getState().snap;

// ---------------------------------------------------------------- board
function BoardLive({ board, inst, lift }: { board: BoardDef; inst: PartInstance; lift: number }) {
  const running = useStudio((s) => s.sim.running);
  const ledOn = useStudio((s) => {
    const id = builtinLedId(board);
    return !!id && builtinLedLit(board, s.snap?.drives[id]);
  });
  const ioKey = useStudio((s) => (board.family === "plc" ? board.pins.filter((p) => /^[XY]\d$/.test(p.label)).map((p) => ((s.snap?.pinV[p.id] ?? 0) > 12 ? "1" : "0")).join("") : ""));
  const io = useMemo(() => {
    const o: Record<string, boolean> = {};
    board.pins.filter((p) => /^[XY]\d$/.test(p.label)).forEach((p, i) => (o[p.label] = ioKey[i] === "1"));
    return o;
  }, [ioKey, board]);
  return (
    <Placed inst={inst} w={board.width} h={board.height} lift={lift}>
      <BoardModel board={board} powered={running} ledOn={ledOn} io={io} />
    </Placed>
  );
}

/** Positions a mm-unit model (origin top-left) at an instance, rotating about its centre. */
function Placed({ inst, w, h, lift, children }: { inst: PartInstance; w: number; h: number; lift: number; children: ReactNode }) {
  return (
    <group position={[(inst.x + w / 2) * S, lift * S, (inst.y + h / 2) * S]} rotation={[0, -THREE.MathUtils.degToRad(inst.rot ?? 0), 0]} scale={S}>
      <group position={[-w / 2, 0, -h / 2]}>{children}</group>
    </group>
  );
}

// ---------------------------------------------------------------- wires
export function Wires3D({ pinTop, only }: { pinTop: (part: string) => number; only?: Set<string> }) {
  const project = useStudio((s) => s.project);
  const tubes = useMemo(() => {
    return project.wires
      .filter((w) => !only || (only.has(w.from.part) && only.has(w.to.part)))
      .map((w) => {
        const a = endpointPos(project.parts, w.from.part, w.from.pin);
        const b = endpointPos(project.parts, w.to.part, w.to.pin);
        if (!a || !b) return null;
        const ha = pinTop(w.from.part) * S;
        const hb = pinTop(w.to.part) * S;
        const d = Math.hypot(b.x - a.x, b.y - a.y) * S;
        const lift = 0.6 + d * 0.18;
        const pts = [
          new THREE.Vector3(a.x * S, ha, a.y * S),
          new THREE.Vector3(a.x * S, ha + lift * 0.7, a.y * S),
          new THREE.Vector3(((a.x + b.x) / 2) * S, Math.max(ha, hb) + lift, ((a.y + b.y) / 2) * S),
          new THREE.Vector3(b.x * S, hb + lift * 0.7, b.y * S),
          new THREE.Vector3(b.x * S, hb, b.y * S),
        ];
        const curve = new THREE.CatmullRomCurve3(pts);
        const air = isAirWire(project.parts, w);
        return { id: w.id, color: w.color, curve, air, geo: new THREE.TubeGeometry(curve, 40, air ? 0.2 : 0.045, air ? 12 : 8, false) };
      })
      .filter(Boolean) as { id: string; color: string; air: boolean; curve: THREE.CatmullRomCurve3; geo: THREE.TubeGeometry }[];
  }, [project.wires, project.parts, pinTop, only]);
  return (
    <group>
      {tubes.map((t) => (
        <mesh key={t.id} geometry={t.geo} castShadow>
          {t.air ? <meshStandardMaterial color={t.color} roughness={0.25} transparent opacity={0.78} /> : <meshStandardMaterial color={t.color} roughness={0.45} />}
        </mesh>
      ))}
      <CurrentFlow tubes={tubes} />
    </group>
  );
}

/** Bright beads running along wires that carry a live signal — direction follows the voltage. */
function CurrentFlow({ tubes }: { tubes: { id: string; color: string; curve: THREE.CatmullRomCurve3 }[] }) {
  const PER = 4;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const lengths = useMemo(() => tubes.map((t) => t.curve.getLength()), [tubes]);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const snap = live();
    const t = clock.elapsedTime;
    let k = 0;
    tubes.forEach((tb, i) => {
      const v = snap?.running ? snap.wireV[tb.id] ?? 0 : 0;
      const on = v > 0.4;
      for (let j = 0; j < PER; j++) {
        if (on) {
          const u = (t * (0.9 / Math.max(0.5, lengths[i])) * (1 + v * 0.2) + j / PER) % 1;
          dummy.position.copy(tb.curve.getPointAt(u));
          dummy.scale.setScalar(0.06 + 0.012 * Math.min(5, v));
        } else dummy.scale.setScalar(0.00001);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
        m.setColorAt(k, col.set(tb.color).lerp(WHITE, 0.55).multiplyScalar(2.2));
        k++;
      }
    });
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, tubes.length * PER)]} key={tubes.length}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
const WHITE = new THREE.Color("#ffffff");

// ---------------------------------------------------------------- environments
function Fire({ span }: { span: number }) {
  const count = 260;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const smoke = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const seeds = useMemo(() => Array.from({ length: count }, () => ({ x: (Math.random() - 0.5) * span * 0.9, z: -span * 0.7 - Math.random() * 2.5, s: Math.random(), v: 0.6 + Math.random() * 1.4 })), [span]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const env = live()?.env;
    const k = env?.flame ?? 0;
    const sm = Math.min(1, (env?.smoke ?? 0) / 2500);
    const t = clock.elapsedTime;
    if (mesh.current) {
      seeds.forEach((p, i) => {
        const life = (t * p.v + p.s) % 1;
        dummy.position.set(p.x + Math.sin(t * 3 + i) * 0.08, life * 3.2 * k, p.z);
        const sc = (1 - life) * 0.55 * k;
        dummy.scale.setScalar(Math.max(0.0001, sc));
        dummy.updateMatrix();
        mesh.current!.setMatrixAt(i, dummy.matrix);
      });
      mesh.current.instanceMatrix.needsUpdate = true;
    }
    if (smoke.current) {
      seeds.slice(0, 90).forEach((p, i) => {
        const life = (t * p.v * 0.18 + p.s) % 1;
        dummy.position.set(p.x * 1.2 + Math.sin(t * 0.6 + i) * 0.6 * life, 1 + life * 6, p.z + 1.5 * life);
        dummy.scale.setScalar(Math.max(0.0001, (0.4 + life * 1.6) * sm));
        dummy.updateMatrix();
        smoke.current!.setMatrixAt(i, dummy.matrix);
      });
      smoke.current.instanceMatrix.needsUpdate = true;
    }
    if (light.current) light.current.intensity = k * (14 + Math.sin(t * 17) * 3 + Math.sin(t * 7.3) * 2);
  });
  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ff7a1a" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={smoke} args={[undefined, undefined, 90]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#3d3d3d" transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <pointLight ref={light} position={[0, 1.2, -span * 0.8]} color="#ff6a1a" distance={span * 3} decay={1.6} castShadow />
    </group>
  );
}

function Water({ span }: { span: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(span * 3, span * 3, 48, 48), [span]);
  useFrame(({ clock }) => {
    const env = live()?.env;
    const lvl = env?.water ?? 0;
    if (!ref.current) return;
    ref.current.position.y = -0.2 + lvl * 3.4;
    ref.current.visible = lvl > 0.005;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 1.3 + clock.elapsedTime * 1.6) * 0.04 + Math.cos(pos.getY(i) * 1.7 + clock.elapsedTime) * 0.04);
    pos.needsUpdate = true;
  });
  return (
    <mesh ref={ref} geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
      <meshPhysicalMaterial color="#2a7fd4" transparent opacity={0.55} roughness={0.05} metalness={0.1} transmission={0.2} />
    </mesh>
  );
}

/** Falling rain streaks; density follows env.rain. */
function Rain({ span }: { span: number }) {
  const N = 1400;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * span * 2.6, z: (Math.random() - 0.5) * span * 2.6, s: Math.random(), v: 0.8 + Math.random() * 0.5 })), [span]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const rain = live()?.env.rain ?? 0;
    const shown = Math.floor(N * Math.min(1, rain * 1.1));
    const t = clock.elapsedTime;
    const top = span * 1.4;
    seeds.forEach((p, i) => {
      if (i >= shown) dummy.scale.setScalar(0.00001);
      else {
        const life = (t * p.v * 1.3 + p.s) % 1;
        dummy.position.set(p.x + life * 0.6, top * (1 - life), p.z);
        dummy.scale.set(1, 1, 1);
      }
      dummy.rotation.set(0, 0, 0.12);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <boxGeometry args={[0.012, 0.45, 0.012]} />
      <meshBasicMaterial color="#a9c6ea" transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}

/** Lightning bolt that flashes with the storm's light spikes. */
function Lightning({ span }: { span: number }) {
  const bolt = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    let x = 0;
    for (let i = 0; i <= 14; i++) {
      pts.push(new THREE.Vector3(x, span * 2.2 - (i / 14) * span * 2.2, 0));
      x += (Math.random() - 0.5) * span * 0.25;
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.05, 5, false);
  }, [span]);
  useFrame(() => {
    const lux = live()?.env.lux ?? 0;
    if (bolt.current) bolt.current.visible = lux > 25000;
  });
  return (
    <mesh ref={bolt} geometry={geo} position={[span * 0.9, 0, -span * 1.6]} visible={false}>
      <meshBasicMaterial color="#dfe8ff" toneMapped={false} />
    </mesh>
  );
}

function Motor({ span }: { span: number }) {
  const shaft = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const f = live()?.env.vibFreq ?? 0;
    if (shaft.current) shaft.current.rotation.x += f * dt * Math.PI * 2 * 0.25;
  });
  const L = Math.max(6, span * 1.1);
  return (
    <group position={[0, -2.8, 0]}>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[2.6, 2.6, L, 40]} />
        <meshStandardMaterial color="#2c5d8f" metalness={0.5} roughness={0.45} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-L / 2 + 0.6 + (i * (L - 1.2)) / 13, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[2.62, 0.08, 6, 40]} />
          <meshStandardMaterial color="#244d78" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh ref={shaft} position={[L / 2 + 1, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.35, 0.35, 2.2, 18]} />
        <meshStandardMaterial color="#c9ced3" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, -2.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[L * 0.8, 0.7, 4.6]} />
        <meshStandardMaterial color="#2a2d31" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, 2.62, 0]}>
        <boxGeometry args={[span * 1.05, 0.1, span * 0.6]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Person({ span }: { span: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const env = live()?.env;
    if (!ref.current || !env) return;
    ref.current.position.z = -Math.min(40, env.distance / 10) - span * 0.3;
    ref.current.visible = env.distance < 399;
    ref.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 6)) * 0.12;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 4.2, 0]} castShadow>
        <capsuleGeometry args={[1.1, 3.6, 6, 16]} />
        <meshStandardMaterial color="#5b6774" roughness={0.8} />
      </mesh>
      <mesh position={[0, 8, 0]} castShadow>
        <sphereGeometry args={[0.85, 20, 16]} />
        <meshStandardMaterial color="#c9a184" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Room({ span, wall, floor }: { span: number; wall: string; floor: string }) {
  const R = Math.max(14, span * 2.2);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[R * 2, R * 2]} />
        <meshStandardMaterial color={floor} roughness={0.9} />
      </mesh>
      <mesh position={[0, R * 0.45, -R]} receiveShadow>
        <planeGeometry args={[R * 2, R * 0.9]} />
        <meshStandardMaterial color={wall} roughness={0.95} />
      </mesh>
      <mesh position={[-R, R * 0.45, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[R * 2, R * 0.9]} />
        <meshStandardMaterial color={wall} roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Lab bench: a light mat printed with a 1 cm grid and 5 cm major lines. */
function Bench({ span }: { span: number }) {
  const R = Math.max(30, span * 4);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d3d9df";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#b6c0ca";
    g.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const x = (i * 512) / 5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 512);
      g.moveTo(0, x);
      g.lineTo(512, x);
      g.stroke();
    }
    g.strokeStyle = "#8d9aa7";
    g.lineWidth = 4;
    g.strokeRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set((R * 2) / 5, (R * 2) / 5);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [R]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[R * 2, R * 2]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  );
}

function Plants({ span }: { span: number }) {
  return (
    <group position={[0, 0, -span * 0.9]}>
      {Array.from({ length: 7 }, (_, i) => (
        <group key={i} position={[(i - 3) * 2.2, 0, Math.sin(i) * 0.8]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.5, 1.2, 16]} />
            <meshStandardMaterial color="#8a4b2a" />
          </mesh>
          <mesh position={[0, 2.2, 0]} castShadow>
            <coneGeometry args={[0.9, 2.4, 10]} />
            <meshStandardMaterial color="#2f8f46" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rig({ span }: { span: number }) {
  const group = useRef<THREE.Group>(null);
  const scenario = useStudio((s) => s.project.scenario.id);
  useFrame(() => {
    const snap = live();
    if (!group.current || !snap) return;
    const env = snap.env;
    const t = engine.t / 1000;
    if (scenario === "motor-vibration" || scenario === "earthquake") {
      const amp = scenario === "earthquake" ? env.shake * 0.5 : Math.min(0.08, env.vibRms * 0.05);
      group.current.position.x = vibAccel(t, env, 0) * amp;
      group.current.position.y = (scenario === "motor-vibration" ? 0 : 0) + vibAccel(t, env, 2) * amp * 0.4;
      group.current.position.z = vibAccel(t, env, 1) * amp;
    } else group.current.position.set(0, 0, 0);
  });
  void span;
  return (
    <group ref={group}>
      <Circuit3D />
    </group>
  );
}

export function useStack(parts: PartInstance[], board: BoardDef) {
  return useMemo(() => {
    const topo = buildTopology(board, parts, [], new Map());
    return computeStack(parts, topo.inserted, board);
  }, [parts, board]);
}

/** One placed instance in 3D: board, breadboard/perfboard host, or component. */
export function Instance3D({ inst, board, lift }: { inst: PartInstance; board: BoardDef; lift: number }) {
  if (isBoard(inst)) return <BoardLive board={board} inst={inst} lift={lift} />;
  if (isHost(inst)) {
    const fp = footprintOf(inst)!;
    return (
      <Placed inst={inst} w={fp.w} h={fp.h} lift={lift}>
        <HostModel inst={inst} />
      </Placed>
    );
  }
  const def = getPart(inst.type);
  if (!def) return null;
  return (
    <Placed inst={inst} w={def.w} h={def.h} lift={lift}>
      {def.pressable || def.toggle ? (
        <Operable inst={inst} def={def}>
          <PartModel inst={inst} def={def} />
        </Operable>
      ) : (
        <PartModel inst={inst} def={def} />
      )}
    </Placed>
  );
}

/** Hands-on controls in 3D: hold push buttons / valve overrides, click to flip selectors, E-stops, breakers, ball valves. */
function Operable({ inst, def, children }: { inst: PartInstance; def: PartDef; children: ReactNode }) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const running = useStudio((s) => s.sim.running);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    document.body.style.cursor = hover && running ? "pointer" : "";
  }, [hover, running]);
  useEffect(() => () => void (document.body.style.cursor = ""), []);
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (!useStudio.getState().sim.running) return;
    e.stopPropagation();
    // keep the camera still while a finger is on the control
    if (controls) controls.enabled = false;
    const done = () => {
      if (def.pressable && !def.toggle) engine.setInput(inst.id, { pressed: false });
      if (controls) controls.enabled = true;
    };
    if (def.toggle) engine.setInput(inst.id, def.toggle(engine.getInput(inst.id)));
    else engine.setInput(inst.id, { pressed: true });
    window.addEventListener("pointerup", done, { once: true });
    window.addEventListener("pointercancel", done, { once: true });
  };
  return (
    <group
      onPointerDown={down}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      {children}
    </group>
  );
}

function Circuit3D() {
  const project = useStudio((s) => s.project);
  const board = getBoard(project.boardId);
  const c = useCenter();
  const stack = useStack(project.parts, board);
  return (
    <group position={[-c.cx * S, 0, -c.cy * S]}>
      {project.parts.map((p) => (
        <Instance3D key={p.id} inst={p} board={board} lift={stack.lift.get(p.id) ?? 0} />
      ))}
      <Wires3D pinTop={stack.pinTop} />
    </group>
  );
}

function Atmosphere() {
  const scenario = useStudio((s) => s.project.scenario.id);
  const { scene } = useThree();
  useFrame(() => {
    const env = live()?.env;
    const theme = document.documentElement.dataset.theme === "light";
    let bg = theme ? "#e6e5e1" : "#232326";
    let fogC = bg;
    let density = 0.012;
    if (scenario === "lab") {
      // the bench: light grey mat with a fine grid, same in both themes
      bg = theme ? "#d9dfe5" : "#c3cbd3";
      fogC = bg;
      density = 0.006;
    } else if (scenario === "building-fire") {
      bg = "#1a0d08";
      fogC = "#2a1610";
      density = 0.015 + Math.min(1, (env?.smoke ?? 0) / 3000) * 0.05;
    } else if (scenario === "cold-storage") {
      bg = "#a9c6d8";
      fogC = "#bcd6e6";
      density = 0.016;
    } else if (scenario === "gas-leak") {
      bg = "#0e1a0b";
      fogC = "#40602a";
      density = 0.01 + Math.min(1, (env?.gas ?? 0) / 9000) * 0.05;
    } else if (scenario === "day-night" || scenario === "greenhouse") {
      const k = Math.min(1, Math.log10(Math.max(1, env?.lux ?? 1)) / 4.6);
      const c = new THREE.Color("#050914").lerp(new THREE.Color(scenario === "greenhouse" ? "#cfe8d0" : "#8ec5ff"), k);
      bg = `#${c.getHexString()}`;
      fogC = bg;
    } else if (scenario === "flood") {
      bg = "#0b1620";
      fogC = "#123040";
      density = 0.02;
    } else if (scenario === "storm") {
      const flash = Math.min(1, Math.max(0, ((env?.lux ?? 0) - 20000) / 50000));
      const c = new THREE.Color("#1a2230").lerp(new THREE.Color("#0b0f16"), Math.min(1, (env?.rain ?? 0) * 1.2)).lerp(new THREE.Color("#c9d6ff"), flash * 0.7);
      bg = `#${c.getHexString()}`;
      fogC = bg;
      density = 0.012 + (env?.rain ?? 0) * 0.03;
    }
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.FogExp2(fogC, density);
  });
  return null;
}

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const scenario = useStudio((s) => s.project.scenario.id);
  useFrame(() => {
    const env = live()?.env;
    if (!sun.current || !amb.current) return;
    if (scenario === "day-night" || scenario === "greenhouse") {
      const k = Math.min(1, Math.log10(Math.max(1, env?.lux ?? 1)) / 4.6);
      sun.current.intensity = 0.1 + k * 3;
      amb.current.intensity = 0.08 + k * 0.6;
    } else if (scenario === "building-fire") {
      sun.current.intensity = 1.1;
      amb.current.intensity = 0.45;
    } else if (scenario === "storm") {
      const flash = Math.min(1, Math.max(0, ((env?.lux ?? 0) - 20000) / 50000));
      sun.current.intensity = 0.5 + flash * 9;
      amb.current.intensity = 0.25 + flash * 1.5;
    } else if (scenario === "lab") {
      // light bench mat: softer light so white parts don't wash out
      sun.current.intensity = 1.5;
      amb.current.intensity = 0.25;
    } else {
      sun.current.intensity = 2.4;
      amb.current.intensity = 0.7;
    }
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.45} />
      <hemisphereLight args={["#f6efe6", "#2e2e33", 0.8]} />
      <directionalLight ref={sun} position={[8, 14, 6]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
    </>
  );
}

/** Soft studio lights for metal and plastic reflections (rendered once, no network fetch). */
export function StudioReflections() {
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer intensity={1.6} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} color="#ffffff" />
      <Lightformer intensity={1.1} position={[-6, 2, 3]} rotation={[0, Math.PI / 2, 0]} scale={[8, 3, 1]} color="#bbf7d0" />
      <Lightformer intensity={0.9} position={[6, 2, -3]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 3, 1]} color="#d9f99d" />
      <Lightformer intensity={0.35} position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[10, 10, 1]} color="#e9e4dc" />
    </Environment>
  );
}

/** Bloom on anything brighter than white (LEDs, displays, current beads), filmic tone mapping. */
export function Glow({ vignette = true }: { vignette?: boolean }) {
  return (
    vignette ? (
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.85} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette eskil={false} offset={0.25} darkness={0.45} />
      </EffectComposer>
    ) : (
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.85} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    )
  );
}

function CameraRig({ preset, span, fit }: { preset: string; span: number; fit: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const d = Math.max(7, span * 1.05);
    const pos: Record<string, [number, number, number]> = {
      angled: [d * 0.55, d * 0.62, d * 0.85],
      top: [0.001, d * 1.25, 0.001],
      front: [0, d * 0.25, d * 1.15],
      right: [d * 1.15, d * 0.25, 0.001],
    };
    camera.position.set(...(pos[preset] ?? pos.angled));
    camera.lookAt(0, 0, 0);
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) {
      c.target.set(0, 0, 0);
      c.update?.();
    }
  }, [preset, span, camera, controls, fit]);
  return null;
}

/** What every part is doing right now, like a bench multimeter for the whole circuit. */
function LiveReadings() {
  const parts = useStudio((s) => s.project.parts);
  const live = useStudio((s) => s.snap?.live);
  const running = useStudio((s) => s.sim.running);
  if (!running || !live) return null;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const rows = parts
    .filter((p) => !isBoard(p) && !isHost(p) && live[p.id])
    .map((p) => {
      const l = live[p.id];
      let v = "";
      if (p.type === "cylinder") v = `${fmt(Number(l.reading ?? 0))} mm${l.speed ? (l.speed > 0 ? " →" : " ←") : ""}`;
      else if (l.speed) v = `${Math.round(l.speed)} rpm`;
      else if (l.reading !== undefined && Number.isFinite(l.reading) && l.readingUnit && l.readingUnit !== "pos") v = `${fmt(l.reading)} ${l.readingUnit}`;
      else if (l.text?.length) v = l.text.join(" ");
      else if (l.on !== undefined) v = l.on ? "ON" : "off";
      return { label: p.label, v, on: !!l.on };
    })
    .filter((r) => r.v)
    .slice(0, 12);
  if (!rows.length) return null;
  return (
    <dl className="live-rows">
      {rows.map((r) => (
        <div key={r.label} className={r.on ? "on" : ""}>
          <dt>{r.label}</dt>
          <dd>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Twin3D() {
  const scenario = useStudio((s) => s.project.scenario);
  const env = useStudio((s) => s.snap?.env);
  const running = useStudio((s) => s.sim.running);
  const set = useStudio((s) => s.set);
  const def = getScenario(scenario.id);
  const c = useCenter();
  const span = Math.max(6, c.span);
  const [preset, setPreset] = useState("angled");
  const [fit, setFit] = useState(0);
  const Icon = SCENARIO_ICON[scenario.id];
  return (
    <div className="twin3d">
      <Canvas shadows flat dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 400 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <CameraRig preset={preset} span={span} fit={fit} />
        <Atmosphere />
        <Lights />
        <Rig span={span} />
        {scenario.id === "motor-vibration" ? (
          <Motor span={span} />
        ) : scenario.id === "lab" ? (
          <Bench span={span} />
        ) : (
          <Room span={span} wall={scenario.id === "building-fire" ? "#2a1a14" : scenario.id === "cold-storage" ? "#d6e6ef" : scenario.id === "day-night" || scenario.id === "greenhouse" ? "#000000" : "#2c2c31"} floor={scenario.id === "building-fire" ? "#241a16" : scenario.id === "cold-storage" ? "#e8f1f6" : scenario.id === "greenhouse" ? "#5a3b22" : "#232326"} />
        )}
        {scenario.id === "building-fire" && <Fire span={span} />}
        {scenario.id === "flood" && <Water span={span} />}
        {(scenario.id === "storm" || scenario.id === "flood") && <Rain span={span} />}
        {scenario.id === "storm" && <Lightning span={span} />}
        {scenario.id === "intruder" && <Person span={span} />}
        {scenario.id === "greenhouse" && <Plants span={span} />}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={span * 3} blur={2.4} far={4} />
        <StudioReflections />
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={120} />
        <Glow />
      </Canvas>
      <div className="twin-hud">
        {(
          [
            ["angled", "Iso", Box],
            ["top", "Top", Square],
            ["front", "Front", RectangleHorizontal],
            ["right", "Right", Columns2],
          ] as const
        ).map(([id, l, I]) => (
          <button key={id} className={preset === id ? "on" : ""} onClick={() => setPreset(id)}>
            <I size={13} />
            {l}
          </button>
        ))}
        <i className="hud-sep" />
        <button onClick={() => setFit((n) => n + 1)} title="Frame the whole circuit">
          <Maximize size={13} />
          Fit
        </button>
      </div>
      <div className="twin-card">
        <h4 className="twin-kicker">Live readings</h4>
        <div className="twin-title">
          {Icon && <Icon size={15} />}
          <strong>{def.name}</strong>
          <span className="muted">{def.thai}</span>
        </div>
        {!running && <p className="small muted">Press Simulate to see live values.</p>}
        <LiveReadings />
        {env && (
          <dl>
            <dt>Temp</dt>
            <dd>{env.temperature.toFixed(1)} °C</dd>
            <dt>Humidity</dt>
            <dd>{env.humidity.toFixed(0)} %</dd>
            {(scenario.id === "building-fire" || env.flame > 0.01) && (
              <>
                <dt>Flame IR</dt>
                <dd>{(env.flame * 100).toFixed(0)} %</dd>
                <dt>Smoke</dt>
                <dd>{env.smoke.toFixed(0)} ppm</dd>
              </>
            )}
            {(scenario.id === "flood" || env.water > 0.01) && (
              <>
                <dt>Water</dt>
                <dd>{(env.water * 100).toFixed(0)} %</dd>
              </>
            )}
            {(scenario.id === "motor-vibration" || scenario.id === "earthquake") && (
              <>
                <dt>Vibration</dt>
                <dd>{env.vibRms.toFixed(2)} g rms</dd>
                <dt>Speed</dt>
                <dd>{(env.vibFreq * 60).toFixed(0)} rpm</dd>
              </>
            )}
            {scenario.id === "intruder" && (
              <>
                <dt>Distance</dt>
                <dd>{env.distance.toFixed(0)} cm</dd>
              </>
            )}
            {(scenario.id === "day-night" || scenario.id === "greenhouse") && (
              <>
                <dt>Light</dt>
                <dd>{env.lux.toFixed(0)} lx</dd>
              </>
            )}
            {scenario.id === "storm" && (
              <>
                <dt>Pressure</dt>
                <dd>{env.pressure.toFixed(1)} hPa</dd>
                <dt>Rain</dt>
                <dd>{(env.rain * 100).toFixed(0)} %</dd>
                <dt>Light</dt>
                <dd>{env.lux.toFixed(0)} lx</dd>
              </>
            )}
            {scenario.id === "gas-leak" && (
              <>
                <dt>LPG</dt>
                <dd>{env.gas.toFixed(0)} ppm</dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

