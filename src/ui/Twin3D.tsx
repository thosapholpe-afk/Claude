import { ContactShadows, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getBoard } from "../core/boards";
import { buildTopology, endpointPos, footprintOf, instBounds, isBoard, isHost } from "../core/circuit";
import { getScenario, vibAccel } from "../core/env";
import { getPart, LED_HEX, type PartLive } from "../core/parts";
import { engine } from "../core/sim";
import type { BoardDef, PartInstance } from "../core/types";
import { useStudio } from "../store";
import { SCENARIO_ICON } from "./EnvPanel";
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
    const id = board.builtinLed ?? (board.family === "rp2040" ? "LED" : "");
    return !!s.snap?.drives[id]?.level;
  });
  return (
    <Placed inst={inst} w={board.width} h={board.height} lift={lift}>
      <BoardModel board={board} powered={running} ledOn={ledOn} />
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

// ---------------------------------------------------------------- parts
function LcdScreen({ lines, lit }: { lines: string[]; lit: boolean }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 144;
    return { c, t: new THREE.CanvasTexture(c) };
  }, []);
  useEffect(() => {
    const g = tex.c.getContext("2d")!;
    g.fillStyle = lit ? "#8fd14f" : "#344326";
    g.fillRect(0, 0, 512, 144);
    g.fillStyle = "#10240a";
    g.font = "bold 52px IBM Plex Mono, monospace";
    (lines ?? []).slice(0, 2).forEach((l, i) => g.fillText(l.replace(String.fromCharCode(223), "°").padEnd(16).slice(0, 16), 14, 58 + i * 66));
    tex.t.needsUpdate = true;
  }, [lines, lit, tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[6.5, 1.8]} />
      <meshStandardMaterial map={tex.t} emissive={lit ? "#a6ff5c" : "#000"} emissiveIntensity={lit ? 0.35 : 0} emissiveMap={tex.t} />
    </mesh>
  );
}

export function Part3D({ inst, lift = 0 }: { inst: PartInstance; lift?: number }) {
  const def = getPart(inst.type);
  const lv = useStudio((s) => s.snap?.live[inst.id]) as PartLive | undefined;
  const horn = useRef<THREE.Group>(null);
  const fan = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (horn.current && lv?.angle !== undefined) horn.current.rotation.y = THREE.MathUtils.degToRad(90 - lv.angle);
    if (fan.current) fan.current.rotation.y += (lv?.speed ?? 0) * dt * 40;
  });
  if (!def) return null;
  const cx = def.w / 2;
  const cy = def.h / 2;
  const rot = -THREE.MathUtils.degToRad(inst.rot);
  const w = def.w * S;
  const h = def.h * S;
  const pcb = (color: string, ww = w, hh = h) => (
    <RoundedBox args={[ww, 0.16, hh]} radius={0.03} position={[0, 0.08, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.55} />
    </RoundedBox>
  );
  let body: ReactElement;
  switch (def.type) {
    case "led": {
      const col = LED_HEX[String(inst.props.color)] ?? "#ff2a2a";
      const b = Math.min(1.3, lv?.brightness ?? 0);
      body = (
        <group position={[0, 0, -0.2]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.25, 0.25, 0.55, 24]} />
            <meshStandardMaterial color={lv?.burnt ? "#3a2a20" : col} transparent opacity={0.85} emissive={col} emissiveIntensity={b * 4} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.72, 0]} castShadow>
            <sphereGeometry args={[0.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={lv?.burnt ? "#3a2a20" : col} transparent opacity={0.85} emissive={col} emissiveIntensity={b * 4} roughness={0.2} />
          </mesh>
          {b > 0.05 && <pointLight position={[0, 0.9, 0]} color={col} intensity={b * 2.5} distance={4} decay={2} />}
        </group>
      );
      break;
    }
    case "servo-sg90":
    case "servo-mg996r": {
      const big = def.type === "servo-mg996r";
      const bw = (big ? 40.7 : 23) * S;
      const bh = (big ? 19.7 : 12.2) * S;
      const bz = (big ? 36 : 22) * S;
      const bx = ((big ? 12 : 13) - cx) * S + bw / 2;
      const hubX = ((big ? 22 : 19) - cx) * S;
      body = (
        <group>
          <mesh position={[bx, bz / 2, 0]} castShadow>
            <boxGeometry args={[bw, bz, bh]} />
            <meshStandardMaterial color={big ? "#1b1c1f" : "#2a6fd6"} roughness={0.4} transparent={!big} opacity={big ? 1 : 0.92} />
          </mesh>
          <mesh position={[hubX, bz + 0.08, 0]}>
            <cylinderGeometry args={[0.28, 0.28, 0.16, 20]} />
            <meshStandardMaterial color="#e8e8e4" />
          </mesh>
          <group ref={horn} position={[hubX, bz + 0.2, 0]}>
            <mesh position={[(big ? 0.7 : 0.5), 0, 0]} castShadow>
              <boxGeometry args={[big ? 1.6 : 1.1, 0.07, 0.24]} />
              <meshStandardMaterial color="#f4f4f0" />
            </mesh>
          </group>
        </group>
      );
      break;
    }
    case "hc-sr04":
      body = (
        <group>
          {pcb("#1d5fa8")}
          {[-1.13, 1.13].map((x) => (
            <mesh key={x} position={[x, 0.16 + 0.6, -0.15]} rotation={[0, 0, 0]} castShadow>
              <cylinderGeometry args={[0.8, 0.8, 1.2, 28]} />
              <meshStandardMaterial color="#c9ced3" metalness={0.85} roughness={0.35} />
            </mesh>
          ))}
        </group>
      );
      break;
    case "dht22":
      body = (
        <mesh position={[0, 0.39, -0.1]} castShadow>
          <boxGeometry args={[1.51, 0.77, 2]} />
          <meshStandardMaterial color="#f1f1ec" roughness={0.7} />
        </mesh>
      );
      break;
    case "lcd1602":
      body = (
        <group>
          {pcb("#1f6b3a")}
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[7.1, 0.7, 2.5]} />
            <meshStandardMaterial color="#0d0f10" />
          </mesh>
          <group position={[0, 0.86, 0]}>
            <LcdScreen lines={lv?.text ?? ["", ""]} lit={!!lv?.backlight && !!lv?.powered} />
          </group>
        </group>
      );
      break;
    case "neopixel-ring": {
      const n = Number(inst.props.count ?? 12);
      body = (
        <group position={[0, 0, (18.5 - cy) * S]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} receiveShadow>
            <ringGeometry args={[1.15, 1.83, 48]} />
            <meshStandardMaterial color="#141518" side={THREE.DoubleSide} />
          </mesh>
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const c = lv?.pixels?.[i] ?? 0;
            const col = new THREE.Color(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
            const on = c > 0;
            return (
              <mesh key={i} position={[Math.cos(a) * 1.5, 0.18, Math.sin(a) * 1.5]}>
                <boxGeometry args={[0.5, 0.16, 0.5]} />
                <meshStandardMaterial color={on ? col : "#eeeeea"} emissive={col} emissiveIntensity={on ? 3 : 0} />
              </mesh>
            );
          })}
        </group>
      );
      break;
    }
    case "buzzer":
      body = (
        <mesh position={[0, 0.48, -0.1]} castShadow>
          <cylinderGeometry args={[0.6, 0.6, 0.95, 32]} />
          <meshStandardMaterial color="#141518" emissive={lv?.on ? "#e8d4a2" : "#000"} emissiveIntensity={lv?.on ? 0.15 : 0} />
        </mesh>
      );
      break;
    case "dc-motor":
      body = (
        <group position={[(19.5 - cx) * S, 0, (10 - cy) * S]}>
          <mesh position={[0, 1, 0]} castShadow>
            <cylinderGeometry args={[0.95, 0.95, 2, 28]} />
            <meshStandardMaterial color="#c9ced3" metalness={0.8} roughness={0.3} />
          </mesh>
          <group ref={fan} position={[0, 2.15, 0]}>
            {[0, 1, 2].map((k) => (
              <mesh key={k} rotation={[0.3, (k * Math.PI * 2) / 3, 0]} position={[Math.cos((k * Math.PI * 2) / 3) * 0.7, 0, -Math.sin((k * Math.PI * 2) / 3) * 0.7]}>
                <boxGeometry args={[1.2, 0.04, 0.45]} />
                <meshStandardMaterial color="#e8d4a2" transparent opacity={0.8} />
              </mesh>
            ))}
          </group>
        </group>
      );
      break;
    case "pir":
      body = (
        <group>
          {pcb("#2f7d3b")}
          <mesh position={[0, 0.2, (10.4 - cy) * S]} castShadow>
            <sphereGeometry args={[0.96, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f4f4f1" roughness={0.3} transparent opacity={0.95} emissive={lv?.on ? "#ff4d4d" : "#000"} emissiveIntensity={lv?.on ? 0.3 : 0} />
          </mesh>
        </group>
      );
      break;
    case "mq2":
      body = (
        <group>
          {pcb("#1d5fa8")}
          <mesh position={[0, 0.16 + 0.75, (9.5 - cy) * S]} castShadow>
            <cylinderGeometry args={[0.86, 0.86, 1.5, 28]} />
            <meshStandardMaterial color="#b9c0c6" metalness={0.7} roughness={0.5} />
          </mesh>
        </group>
      );
      break;
    case "water":
      body = (
        <group>
          {pcb("#c62828")}
          <mesh position={[0, 0.165, -0.8]}>
            <boxGeometry args={[1.6, 0.01, 4]} />
            <meshStandardMaterial color="#d9b25a" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      );
      break;
    case "resistor":
      body = (
        <mesh position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.11, 0.3, 4, 12]} />
          <meshStandardMaterial color="#d8c08f" />
        </mesh>
      );
      break;
    case "button":
      body = (
        <group>
          <mesh position={[0, 0.17, 0]} castShadow>
            <boxGeometry args={[0.7, 0.34, 0.7]} />
            <meshStandardMaterial color="#1d1f22" />
          </mesh>
          <mesh position={[0, lv?.on ? 0.36 : 0.44, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.2, 20]} />
            <meshStandardMaterial color={{ red: "#e5322d", blue: "#2f6fe0", green: "#2fae4f", yellow: "#f0c419", black: "#222" }[String(inst.props.cap)] ?? "#e5322d"} />
          </mesh>
        </group>
      );
      break;
    case "pot":
      body = (
        <group>
          <mesh position={[0, 0.4, -0.15]} castShadow>
            <boxGeometry args={[0.96, 0.8, 0.74]} />
            <meshStandardMaterial color="#1f5fd1" />
          </mesh>
          <mesh position={[0, 1.05, -0.15]} rotation={[0, -(Number(inst.props.position ?? 0.5) - 0.5) * 4.7, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.6, 18]} />
            <meshStandardMaterial color="#e2e5e8" metalness={0.4} />
          </mesh>
        </group>
      );
      break;
    case "relay":
      body = (
        <group>
          {pcb("#1d5fa8")}
          <mesh position={[(23.5 - cx) * S, 0.16 + 0.8, (11 - cy) * S]} castShadow>
            <boxGeometry args={[1.9, 1.6, 1.56]} />
            <meshStandardMaterial color="#2b67d0" />
          </mesh>
          <mesh position={[(45 - cx) * S, 0.16 + 0.5, 0]} castShadow>
            <boxGeometry args={[0.8, 1, 1.7]} />
            <meshStandardMaterial color="#1e5bd6" />
          </mesh>
        </group>
      );
      break;
    default: {
      const color = def.custom?.color ?? (["flame", "sound"].includes(def.type) ? "#16181b" : def.type === "adxl335" ? "#5b2f8f" : def.type === "soil" ? "#141518" : "#1d5fa8");
      body = (
        <group>
          {pcb(color)}
          {lv?.indicator && <pointLight position={[0, 0.4, 0]} color="#33ff88" intensity={0.6} distance={1.5} />}
        </group>
      );
    }
  }
  return (
    <group position={[(inst.x + cx) * S, lift * S, (inst.y + cy) * S]} rotation={[0, rot, 0]}>
      {body}
    </group>
  );
}

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
        return { id: w.id, color: w.color, geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.045, 8, false) };
      })
      .filter(Boolean) as { id: string; color: string; geo: THREE.TubeGeometry }[];
  }, [project.wires, project.parts, pinTop, only]);
  return (
    <group>
      {tubes.map((t) => (
        <mesh key={t.id} geometry={t.geo} castShadow>
          <meshStandardMaterial color={t.color} roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

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
  return <Part3D inst={inst} lift={lift} />;
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
    if (scenario === "building-fire") {
      bg = "#1a0d08";
      fogC = "#2a1610";
      density = 0.015 + Math.min(1, (env?.smoke ?? 0) / 3000) * 0.05;
    } else if (scenario === "cold-storage") {
      bg = "#bcd6e6";
      fogC = "#cfe3ef";
      density = 0.03;
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

function CameraRig({ preset, span }: { preset: string; span: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const d = Math.max(7, span * 1.05);
    const pos: Record<string, [number, number, number]> = {
      angled: [d * 0.55, d * 0.62, d * 0.85],
      top: [0.001, d * 1.25, 0.001],
      front: [0, d * 0.25, d * 1.15],
    };
    camera.position.set(...(pos[preset] ?? pos.angled));
    camera.lookAt(0, 0, 0);
  }, [preset, span, camera]);
  return null;
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
  const Icon = SCENARIO_ICON[scenario.id];
  return (
    <div className="twin3d">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 400 }} gl={{ antialias: true }}>
        <CameraRig preset={preset} span={span} />
        <Atmosphere />
        <Lights />
        <Rig span={span} />
        {scenario.id === "motor-vibration" ? (
          <Motor span={span} />
        ) : (
          <Room span={span} wall={scenario.id === "building-fire" ? "#2a1a14" : scenario.id === "cold-storage" ? "#d6e6ef" : scenario.id === "day-night" || scenario.id === "greenhouse" ? "#000000" : "#2c2c31"} floor={scenario.id === "building-fire" ? "#241a16" : scenario.id === "cold-storage" ? "#e8f1f6" : scenario.id === "greenhouse" ? "#5a3b22" : "#232326"} />
        )}
        {scenario.id === "building-fire" && <Fire span={span} />}
        {scenario.id === "flood" && <Water span={span} />}
        {scenario.id === "intruder" && <Person span={span} />}
        {scenario.id === "greenhouse" && <Plants span={span} />}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={span * 3} blur={2.4} far={4} />
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={120} />
      </Canvas>
      <div className="twin-hud">
        <div className="seg">
          {[
            ["top", "Top"],
            ["front", "Front"],
            ["angled", "Angled"],
          ].map(([id, l]) => (
            <button key={id} className={preset === id ? "on" : ""} onClick={() => setPreset(id)}>
              {l}
            </button>
          ))}
          <button className="primary" onClick={() => set("view", "2d")}>
            Back to 2D
          </button>
        </div>
      </div>
      <div className="twin-card">
        <div className="twin-title">
          {Icon && <Icon size={16} />}
          <strong>{def.name}</strong>
          <span className="muted">{def.thai}</span>
        </div>
        {!running && <p className="small muted">Start the simulation to run the timeline.</p>}
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

