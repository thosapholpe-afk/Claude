/**
 * Animated 3D part models, in millimetres. Origin = footprint top-left at the
 * surface the part stands on (floor or breadboard top); x → X, 2D y → Z.
 * Modules use their own 2D artwork as the PCB's top texture and add real 3D
 * components on top; everything that moves reads the live simulation state.
 */
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ReactNode, useMemo, useRef } from "react";
import * as THREE from "three";
import { LED_HEX, type PartDef, type PartLive } from "../../core/parts";
import type { PartInstance } from "../../core/types";
import { useStudio } from "../../store";
import { Part2D } from "../render/Parts2D";
import { Boxes, GOLD, METAL, PLASTIC, useLabelTexture, useSvgTexture } from "./models";

const HEADER = 2.5; // plastic height under a module PCB
const PIN_DOWN = 6; // male pin length below the plastic
const STATIC_LIVE: PartLive = {};
const DYNAMIC_PROPS = new Set(["x", "y", "position", "sensitivity", "threshold", "range", "hold"]);

const useLive = (id: string) => useStudio((s) => s.snap?.live[id]) as PartLive | undefined;


// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------
function useArt(inst: PartInstance, def: PartDef, r: { x: number; y: number; w: number; h: number }) {
  const props = Object.fromEntries(Object.entries(inst.props).filter(([k]) => !DYNAMIC_PROPS.has(k)));
  const key = `art:${def.type}:${JSON.stringify(props)}:${r.x},${r.y},${r.w},${r.h}`;
  return useSvgTexture(key, r.w, r.h, () => (
    <g transform={`translate(${-r.x} ${-r.y})`}>
      <Part2D inst={{ ...inst, x: 0, y: 0, rot: 0 }} def={def} live={STATIC_LIVE} t={0} />
    </g>
  ));
}

/** PCB slab with the part's own artwork on top. */
function Slab({ inst, def, x = 0, z = 0, w = def.w, d = def.h, t = 1.6, y = HEADER, color, round = false }: { inst: PartInstance; def: PartDef; x?: number; z?: number; w?: number; d?: number; t?: number; y?: number; color: string; round?: boolean }) {
  const tex = useArt(inst, def, { x, y: z, w, h: d });
  return (
    <group>
      {round ? (
        <mesh position={[x + w / 2, y + t / 2, z + d / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[w / 2, w / 2, t, 48]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      ) : (
        <RoundedBox args={[w, t, d]} radius={Math.min(0.7, t * 0.45)} smoothness={2} position={[x + w / 2, y + t / 2, z + d / 2]} castShadow receiveShadow>
          <meshStandardMaterial color={color} roughness={0.55} />
        </RoundedBox>
      )}
      {tex && (
        <mesh position={[x + w / 2, y + t + 0.02, z + d / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.4} roughness={0.5} metalness={0.06} />
        </mesh>
      )}
    </group>
  );
}

/** Straight male header: plastic under the PCB, gold pins through it. */
function HeaderDown({ pins, top = HEADER + 1.6 + 0.9 }: { pins: { x: number; y: number }[]; top?: number }) {
  const plastic = useMemo(() => pins.map((p) => ({ x: p.x, y: HEADER / 2, z: p.y })), [pins]);
  const len = top + PIN_DOWN;
  const gold = useMemo(() => pins.map((p) => ({ x: p.x, y: top - len / 2, z: p.y })), [pins, top, len]);
  const goldSize = useMemo(() => [0.64, len, 0.64] as [number, number, number], [len]);
  return (
    <group>
      <Boxes items={plastic} size={PLASTIC_CELL} material={PLASTIC} />
      <Boxes items={gold} size={goldSize} material={GOLD} />
    </group>
  );
}
const PLASTIC_CELL: [number, number, number] = [2.5, HEADER, 2.5];

/** Tinned leads going straight down into the holes. */
function Legs({ pins, top, r = 0.25 }: { pins: { x: number; y: number }[]; top: number; r?: number }) {
  return (
    <group>
      {pins.map((p, i) => (
        <mesh key={i} position={[p.x, (top - 5) / 2, p.y]} castShadow>
          <cylinderGeometry args={[r, r, top + 5, 8]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
      ))}
    </group>
  );
}

/** Small SMD indicator LED that glows (blooms) when on. */
function SmdLed({ x, z, y = HEADER + 1.6, color, on, light = false }: { x: number; z: number; y?: number; color: string; on: boolean; light?: boolean }) {
  return (
    <group position={[x, y + 0.3, z]}>
      <mesh>
        <boxGeometry args={[1.6, 0.6, 0.9]} />
        <meshStandardMaterial color={on ? color : "#4b3a33"} emissive={color} emissiveIntensity={on ? 6 : 0} toneMapped={!on} />
      </mesh>
      {on && light && <pointLight color={color} intensity={0.06} distance={30} decay={2} position={[0, 2, 0]} />}
    </group>
  );
}

function Chip({ x, z, w, d, h = 1.2, color = "#1b1d20", y = HEADER + 1.6 }: { x: number; z: number; w: number; d: number; h?: number; color?: string; y?: number }) {
  return (
    <mesh position={[x + w / 2, y + h / 2, z + d / 2]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

function TrimPot({ x, z, y = HEADER + 1.6 }: { x: number; z: number; y?: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 2, 0]} castShadow>
        <boxGeometry args={[4.8, 4, 4.8]} />
        <meshStandardMaterial color="#1f5fd1" roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.15, 0]}>
        <cylinderGeometry args={[1.6, 1.6, 0.3, 24]} />
        <meshStandardMaterial color="#eef0f2" />
      </mesh>
      <mesh position={[0, 4.32, 0]}>
        <boxGeometry args={[2.2, 0.08, 0.35]} />
        <meshStandardMaterial color="#555" />
      </mesh>
    </group>
  );
}

/** Wire from a to b through a lifted midpoint. */
function Cable({ pts, color, r = 0.45 }: { pts: [number, number, number][]; color: string; r?: number }) {
  const geo = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, r, 8, false), [pts, r]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={color} roughness={0.45} />
    </mesh>
  );
}

/** Female dupont housing over a pin. */
function Dupont({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 2.6, z]} castShadow>
      <boxGeometry args={[2.4, 5.2, 2.4]} />
      <meshStandardMaterial color="#111214" roughness={0.6} />
    </mesh>
  );
}

/** Rings that expand and fade (sound, touch ripples). */
function Ripples({ y, r0, r1, color, active, speed = 1.4, axis = "y" }: { y: number; r0: number; r1: number; color: string; active: boolean; speed?: number; axis?: "y" | "-x" }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const k = (clock.elapsedTime * speed + i / 3) % 1;
      m.visible = active;
      const r = r0 + (r1 - r0) * k;
      m.scale.setScalar(r);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    });
  });
  return (
    <group position={[0, y, 0]} rotation={axis === "-x" ? [0, 0, Math.PI / 2] : [0, 0, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.035, 6, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// through-hole parts
// ---------------------------------------------------------------------------
function LedModel({ inst, rgb }: { inst: PartInstance; rgb?: boolean }) {
  const L = useLive(inst.id);
  const cx = rgb ? 5.08 : 2.54;
  const cz = rgb ? 12.7 : 11.43;
  const pins = rgb ? [1.27, 3.81, 6.35, 8.89].map((x) => ({ x, y: 12.7 })) : [{ x: 1.27, y: 11.43 }, { x: 3.81, y: 11.43 }];
  const burnt = !!L?.burnt;
  let col = new THREE.Color(LED_HEX[String(inst.props.color)] ?? "#ff2a2a");
  let b = Math.min(1.4, L?.brightness ?? 0);
  if (rgb) {
    const [r, g, bl] = L?.rgb ?? [0, 0, 0];
    b = Math.max(r, g, bl);
    col = b > 0.01 ? new THREE.Color(r / b, g / b, bl / b) : new THREE.Color("#f4f6ff");
  }
  const body = burnt ? new THREE.Color("#3b2a22") : rgb && b < 0.01 ? new THREE.Color("#eef1f6") : col;
  const on = b > 0.02 && !burnt;
  return (
    <group>
      <Legs pins={pins} top={1.2} />
      <group position={[cx, 0, cz]}>
        <mesh position={[0, 1.7, 0]} castShadow>
          <cylinderGeometry args={[2.9, 2.9, 1, 32]} />
          <meshPhysicalMaterial color={body} roughness={0.25} transmission={0.35} thickness={1} transparent opacity={0.92} emissive={col} emissiveIntensity={on ? b * 2 : 0} toneMapped={!on} />
        </mesh>
        <mesh position={[0, 4.6, 0]} castShadow>
          <cylinderGeometry args={[2.5, 2.5, 4.8, 32]} />
          <meshPhysicalMaterial color={body} roughness={0.18} transmission={0.4} thickness={2} transparent opacity={0.9} emissive={col} emissiveIntensity={on ? b * 4 : 0} toneMapped={!on} />
        </mesh>
        <mesh position={[0, 7, 0]} castShadow>
          <sphereGeometry args={[2.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial color={body} roughness={0.18} transmission={0.4} thickness={2} transparent opacity={0.9} emissive={col} emissiveIntensity={on ? b * 5 : 0} toneMapped={!on} />
        </mesh>
        {on && <pointLight color={col} intensity={b * 0.9} distance={70} decay={2} position={[0, 6, 0]} />}
        {burnt && <Smoke y={8} />}
      </group>
    </group>
  );
}

function Smoke({ y }: { y: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const k = (clock.elapsedTime * 0.35 + i / 4) % 1;
      m.position.set(Math.sin(k * 6 + i) * 1.5, y + k * 14, Math.cos(k * 5 + i) * 1.2);
      m.scale.setScalar(1 + k * 3);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.35 * (1 - k);
    });
  });
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#6f6a66" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const BAND = ["#111", "#7b4a24", "#d6281f", "#f07b12", "#f4d21b", "#2f9e44", "#1f5fd1", "#7f3fbf", "#8a8a8a", "#f2f2f2"];
function bandsFor(ohms: number) {
  if (!Number.isFinite(ohms) || ohms <= 0) return [BAND[0], BAND[0], BAND[0]];
  const exp = Math.floor(Math.log10(ohms)) - 1;
  const digits = Math.round(ohms / 10 ** exp);
  return [BAND[Math.floor(digits / 10) % 10], BAND[digits % 10], BAND[Math.max(0, Math.min(9, exp))]];
}

function ResistorModel({ inst }: { inst: PartInstance }) {
  const ohms = Number(inst.props.ohms ?? 220);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d9c08e";
    g.fillRect(0, 0, 256, 32);
    const bands = [...bandsFor(ohms), "#c9a23a"];
    [58, 92, 126, 196].forEach((x, i) => {
      g.fillStyle = bands[i];
      g.fillRect(x, 0, 18, 32);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [ohms]);
  const y = 1.9;
  return (
    <group>
      <Legs pins={[{ x: 1.27, y: 1.27 }, { x: 8.89, y: 1.27 }]} top={y} r={0.22} />
      <mesh position={[5.08, y, 1.27]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.22, 0.22, 7.6, 8]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh position={[5.08, y, 1.27]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[1.15, 3.6, 6, 16]} />
        <meshStandardMaterial map={tex} roughness={0.55} />
      </mesh>
    </group>
  );
}

function ButtonModel({ inst }: { inst: PartInstance }) {
  const L = useLive(inst.id);
  const cap = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (cap.current) cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, L?.on ? 4.1 : 4.8, 30, dt);
  });
  const color = { red: "#e5322d", blue: "#2f6fe0", green: "#2fae4f", yellow: "#f0c419", black: "#222" }[String(inst.props.cap)] ?? "#e5322d";
  return (
    <group>
      <Legs pins={inst.type === "button" ? [{ x: 1.27, y: 1.27 }, { x: 6.35, y: 1.27 }, { x: 1.27, y: 6.35 }, { x: 6.35, y: 6.35 }] : []} top={0.8} />
      <mesh position={[3.81, 1.75, 3.81]} castShadow>
        <boxGeometry args={[6, 3.5, 6]} />
        <meshStandardMaterial color="#1d1f22" roughness={0.6} />
      </mesh>
      <mesh position={[3.81, 3.55, 3.81]}>
        <boxGeometry args={[6.1, 0.15, 6.1]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh ref={cap} position={[3.81, 4.8, 3.81]} castShadow>
        <cylinderGeometry args={[1.9, 1.9, 2.4, 24]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
}

function PotModel({ inst }: { inst: PartInstance }) {
  const knob = useRef<THREE.Group>(null);
  const target = -(Number(inst.props.position ?? 0.5) - 0.5) * THREE.MathUtils.degToRad(270);
  useFrame((_, dt) => {
    if (knob.current) knob.current.rotation.y = THREE.MathUtils.damp(knob.current.rotation.y, target, 10, dt);
  });
  return (
    <group>
      <Legs pins={[2.54, 5.08, 7.62].map((x) => ({ x, y: 10.16 }))} top={1} />
      <mesh position={[5.08, 3, 5.6]} castShadow>
        <boxGeometry args={[9.6, 6, 9.6]} />
        <meshStandardMaterial color="#1f5fd1" roughness={0.45} />
      </mesh>
      <mesh position={[5.08, 6.6, 5.6]}>
        <cylinderGeometry args={[3.4, 3.4, 1.2, 28]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <group ref={knob} position={[5.08, 7.2, 5.6]}>
        <mesh position={[0, 3.2, 0]} castShadow>
          <cylinderGeometry args={[3.6, 3.9, 6.4, 18]} />
          <meshStandardMaterial color="#1a1b1e" roughness={0.5} />
        </mesh>
        <mesh position={[0, 6.45, -2.2]}>
          <boxGeometry args={[0.7, 0.12, 2.6]} />
          <meshStandardMaterial color="#f2f2f0" emissive="#f2f2f0" emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

function LdrModel() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#c9864a";
    g.beginPath();
    g.arc(64, 64, 64, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#7a3d18";
    g.lineWidth = 7;
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const y = 22 + i * 14;
      g.moveTo(i % 2 ? 30 : 98, y);
      g.lineTo(i % 2 ? 98 : 30, y);
    }
    g.stroke();
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <group>
      <Legs pins={[{ x: 1.27, y: 8.89 }, { x: 3.81, y: 8.89 }]} top={5} r={0.2} />
      <mesh position={[2.54, 5.2, 8.89]} castShadow>
        <cylinderGeometry args={[2.5, 2.5, 1.6, 28]} />
        <meshStandardMaterial color="#c9864a" />
      </mesh>
      <mesh position={[2.54, 6.02, 8.89]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.4, 28]} />
        <meshPhysicalMaterial map={tex} roughness={0.1} clearcoat={1} />
      </mesh>
    </group>
  );
}

function To92({ x, z, label = "LM35", face = 0 }: { x: number; z: number; label?: string; face?: number }) {
  const tex = useLabelTexture(label, "#c9ccd1", "#121315", 4.4, 2);
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.absarc(0, 0, 2.3, Math.PI * 0.1, Math.PI * 0.9, true);
    s.closePath();
    return s;
  }, []);
  return (
    <group position={[x, 0, z]} rotation={[0, face, 0]}>
      <mesh position={[0, 7.4, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <extrudeGeometry args={[shape, { depth: 4.6, bevelEnabled: false, curveSegments: 16 }]} />
        <meshStandardMaterial color="#141517" roughness={0.6} />
      </mesh>
      <mesh position={[0, 5.1, 0.72]}>
        <planeGeometry args={[3.8, 1.6]} />
        <meshStandardMaterial map={tex} />
      </mesh>
    </group>
  );
}

function Lm35Model() {
  return (
    <group>
      <Legs pins={[1.27, 3.81, 6.35].map((x) => ({ x, y: 8.89 }))} top={2.8} r={0.22} />
      <To92 x={3.81} z={8.89} />
    </group>
  );
}

function BuzzerModel({ inst }: { inst: PartInstance }) {
  const L = useLive(inst.id);
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = L?.on ? Math.sin(clock.elapsedTime * 90) * 0.12 : 0;
  });
  return (
    <group>
      <Legs pins={[{ x: 3.81, y: 13.97 }, { x: 8.89, y: 13.97 }]} top={0.6} />
      {[3.81, 8.89].map((x) => (
        <mesh key={x} position={[x, 0.6, 12.7]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 2.6, 6]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
      ))}
      <group ref={body} position={[6.35, 0, 6.35]}>
        <mesh position={[0, 4.75, 0]} castShadow>
          <cylinderGeometry args={[6, 6, 9.5, 40]} />
          <meshStandardMaterial color="#141518" roughness={0.5} />
        </mesh>
        <mesh position={[0, 9.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 4.4, 40]} />
          <meshStandardMaterial color="#1f2124" roughness={0.8} />
        </mesh>
        <mesh position={[0, 9.4, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 0.3, 16]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <Ripples y={9.8} r0={6} r1={16} color="#e8d4a2" active={!!L?.on} speed={1.8} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------
function ServoModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const big = def.type === "servo-mg996r";
  const bx = big ? 12 : 13;
  const bw = big ? 40.7 : 23;
  const bd = big ? 19.7 : 12.2;
  const bz = (def.h - bd) / 2;
  const hubX = bx + (big ? 10 : 6);
  const hubZ = def.h / 2;
  const H = big ? 37 : 22.7;
  const horn = useRef<THREE.Group>(null);
  const target = -THREE.MathUtils.degToRad((L?.angle ?? 90) - 90);
  useFrame((_, dt) => {
    if (horn.current) horn.current.rotation.y = THREE.MathUtils.damp(horn.current.rotation.y, target, big ? 7 : 10, dt);
  });
  const label = useLabelTexture(big ? "MG996R" : "SG90", "#e7eef7", big ? "#1b1c1f" : "#2a6fd6", 9, 3);
  const hornShape = useMemo(() => {
    const L2 = big ? 15 : 11;
    const s = new THREE.Shape();
    s.moveTo(-1.6, 0);
    s.lineTo(-0.8, L2);
    s.quadraticCurveTo(0, L2 + 1.3, 0.8, L2);
    s.lineTo(1.6, 0);
    s.absarc(0, 0, 2.2, 0, Math.PI, true);
    return s;
  }, [big]);
  const wires: [string, number][] = [
    ["#6b3f1e", def.pins[0].y],
    ["#d8302a", def.pins[1].y],
    ["#f39a1d", def.pins[2].y],
  ];
  const bodyMat = big ? <meshStandardMaterial color="#1b1c1f" roughness={0.55} /> : <meshPhysicalMaterial color="#2a6fd6" roughness={0.35} transmission={0.25} thickness={4} transparent opacity={0.94} />;
  return (
    <group>
      {def.pins.map((p) => (
        <Dupont key={p.id} x={p.x} z={p.y} />
      ))}
      <HeaderDownPins pins={def.pins} />
      {wires.map(([c, z], i) => (
        <Cable key={i} color={c} pts={[[1.27, 5, z], [bx * 0.45, 6, z], [bx * 0.8, H * 0.25, hubZ - 1 + i], [bx + 0.5, H * 0.25, hubZ - 1 + i]]} />
      ))}
      <RoundedBox args={[bw, H, bd]} radius={1} smoothness={3} position={[bx + bw / 2, H / 2, bz + bd / 2]} castShadow receiveShadow>
        {bodyMat}
      </RoundedBox>
      <RoundedBox args={[bw + (big ? 14 : 9.6), 2.5, bd]} radius={0.6} position={[bx + bw / 2, H * 0.72, bz + bd / 2]} castShadow>
        {bodyMat}
      </RoundedBox>
      <mesh position={[bx + bw / 2 + (big ? 6 : 3), H + 0.02, bz + bd / 2 + bd * 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[big ? 14 : 8, big ? 4.6 : 3]} />
        <meshStandardMaterial map={label} transparent />
      </mesh>
      <mesh position={[hubX, H + 2, hubZ]} castShadow>
        <cylinderGeometry args={[big ? 5.5 : 3.4, big ? 5.5 : 3.4, 4, 32]} />
        {bodyMat}
      </mesh>
      <mesh position={[hubX, H + 4.6, hubZ]}>
        <cylinderGeometry args={[big ? 2.6 : 1.9, big ? 2.6 : 1.9, 1.2, 20]} />
        <meshStandardMaterial color="#e8e8e4" />
      </mesh>
      <group ref={horn} position={[hubX, H + 5.2, hubZ]}>
        <mesh rotation={[Math.PI / 2, 0, Math.PI]} castShadow>
          <extrudeGeometry args={[hornShape, { depth: 1.4, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2, bevelSegments: 2 }]} />
          <meshStandardMaterial color="#f4f4f0" roughness={0.45} />
        </mesh>
        {[0.35, 0.55, 0.75].map((k) => (
          <mesh key={k} position={[0, 0.02, -(big ? 15 : 11) * k]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.4, 12]} />
            <meshBasicMaterial color="#9b9b96" />
          </mesh>
        ))}
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.3, 12]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
      </group>
    </group>
  );
}

/** Pins sticking down out of a dupont plug or cable end. */
function HeaderDownPins({ pins }: { pins: { x: number; y: number }[] }) {
  const gold = useMemo(() => pins.map((p) => ({ x: p.x, y: -PIN_DOWN / 2 + 0.2, z: p.y })), [pins]);
  return <Boxes items={gold} size={DOWN_PIN} material={GOLD} />;
}
const DOWN_PIN: [number, number, number] = [0.64, PIN_DOWN, 0.64];

function MotorModel({ inst }: { inst: PartInstance }) {
  const L = useLive(inst.id);
  const fan = useRef<THREE.Group>(null);
  const blur = useRef<THREE.Mesh>(null);
  const speed = useRef(0);
  useFrame((_, dt) => {
    speed.current = THREE.MathUtils.damp(speed.current, L?.speed ?? 0, 2.5, dt);
    if (fan.current) fan.current.rotation.y += speed.current * dt * 60;
    if (blur.current) {
      blur.current.visible = speed.current > 0.25;
      (blur.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, speed.current * 0.35);
    }
  });
  return (
    <group>
      <Dupont x={1.27} z={7.46} />
      <Dupont x={1.27} z={12.54} />
      <HeaderDownPins pins={[{ x: 1.27, y: 7.46 }, { x: 1.27, y: 12.54 }]} />
      <Cable color="#d8302a" pts={[[1.27, 5, 7.46], [6, 4, 8], [11, 3, 8.6]]} />
      <Cable color="#202124" pts={[[1.27, 5, 12.54], [6, 4, 12], [11, 3, 11.4]]} />
      <group position={[19.5, 0, 10]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[9, 9, 3, 32]} />
          <meshStandardMaterial color="#2a2c30" roughness={0.6} />
        </mesh>
        <mesh position={[0, 11, 0]} castShadow>
          <cylinderGeometry args={[9.5, 9.5, 16, 40]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[0, 19.6, 0]}>
          <cylinderGeometry args={[3, 3, 1.2, 24]} />
          <meshStandardMaterial {...METAL} roughness={0.2} />
        </mesh>
        <mesh position={[0, 22, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 4, 12]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <group ref={fan} position={[0, 24, 0]}>
          <mesh>
            <cylinderGeometry args={[2.2, 2.2, 2.4, 20]} />
            <meshStandardMaterial color="#e8d4a2" roughness={0.4} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} rotation={[0.35, (k * Math.PI * 2) / 3, 0]} position={[Math.cos((k * Math.PI * 2) / 3) * 8, 0, -Math.sin((k * Math.PI * 2) / 3) * 8]} castShadow>
              <boxGeometry args={[13, 0.5, 4.6]} />
              <meshStandardMaterial color="#f5b0a3" roughness={0.35} transparent opacity={0.92} />
            </mesh>
          ))}
        </group>
        <mesh ref={blur} position={[0, 24, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[15, 48]} />
          <meshBasicMaterial color="#f5b0a3" transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function RelayModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const box = useRef<THREE.Group>(null);
  const last = useRef(false);
  const kick = useRef(0);
  const tex = useArt(inst, def, { x: 14, y: 3.2, w: 19, h: 15.6 });
  useFrame((_, dt) => {
    const on = !!L?.on;
    if (on !== last.current) {
      last.current = on;
      kick.current = 1;
    }
    kick.current = Math.max(0, kick.current - dt * 8);
    if (box.current) box.current.scale.set(1 + 0.015 * kick.current, 1 - 0.03 * kick.current, 1 + 0.015 * kick.current);
  });
  const y0 = HEADER + 1.6;
  return (
    <group>
      <Slab inst={inst} def={def} color="#1d5fa8" />
      <HeaderDown pins={def.pins.filter((p) => p.x < 10)} />
      <group ref={box} position={[23.5, y0, 11]}>
        <RoundedBox args={[19, 15.5, 15.6]} radius={0.5} position={[0, 7.75, 0]} castShadow>
          <meshStandardMaterial color="#2b67d0" roughness={0.45} />
        </RoundedBox>
        {tex && (
          <mesh position={[0, 15.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[19, 15.6]} />
            <meshStandardMaterial map={tex} />
          </mesh>
        )}
      </group>
      <group position={[45, y0, 13]}>
        <RoundedBox args={[8, 10, 17]} radius={0.4} position={[0, 5, 0]} castShadow>
          <meshStandardMaterial color="#1e5bd6" roughness={0.5} />
        </RoundedBox>
        {[-5.08, 0, 5.08].map((dz) => (
          <group key={dz} position={[0, 10, dz]}>
            <mesh>
              <cylinderGeometry args={[1.6, 1.6, 0.6, 20]} />
              <meshStandardMaterial {...METAL} />
            </mesh>
            <mesh position={[0, 0.32, 0]}>
              <boxGeometry args={[2.6, 0.12, 0.45]} />
              <meshStandardMaterial color="#555" />
            </mesh>
          </group>
        ))}
      </group>
      <SmdLed x={8} z={6} color="#ff3b30" on={!!L?.powered} />
      <SmdLed x={8} z={20} color="#33ff88" on={!!L?.on} light />
    </group>
  );
}

// ---------------------------------------------------------------------------
// displays & lights
// ---------------------------------------------------------------------------
function LcdModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const lit = !!L?.backlight && !!L?.powered;
  const lines = L?.text ?? ["", ""];
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 284;
    return { c, t: new THREE.CanvasTexture(c) };
  }, []);
  const key = `${lit}|${lines.join("|")}`;
  useMemo(() => {
    const g = tex.c.getContext("2d")!;
    g.fillStyle = lit ? "#8fd14f" : "#2f3b24";
    g.fillRect(0, 0, 1024, 284);
    for (let r = 0; r < 2; r++)
      for (let col = 0; col < 16; col++) {
        g.fillStyle = lit ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.12)";
        g.fillRect(16 + col * 62.5, 22 + r * 130, 56, 112);
      }
    g.fillStyle = lit ? "#10240a" : "#1c2a14";
    g.font = "bold 92px IBM Plex Mono, monospace";
    g.textBaseline = "middle";
    lines.slice(0, 2).forEach((l, r) => {
      const s = (l ?? "").replace(String.fromCharCode(223), "°").padEnd(16).slice(0, 16);
      [...s].forEach((ch, col) => g.fillText(ch, 18 + col * 62.5, 80 + r * 130));
    });
    tex.t.colorSpace = THREE.SRGBColorSpace;
    tex.t.needsUpdate = true;
  }, [key, tex, lit, lines]);
  const y0 = HEADER + 1.6;
  return (
    <group>
      <Slab inst={inst} def={def} color="#1f6b3a" />
      <HeaderDown pins={def.pins} />
      <mesh position={[40, y0 + 3.5, 18]} castShadow>
        <boxGeometry args={[71, 7, 25]} />
        <meshStandardMaterial color="#0d0f10" roughness={0.4} />
      </mesh>
      <mesh position={[40, y0 + 7.02, 18]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[65, 18]} />
        <meshStandardMaterial map={tex.t} emissive={lit ? "#c8ff7a" : "#000"} emissiveMap={tex.t} emissiveIntensity={lit ? 0.9 : 0} toneMapped={!lit} roughness={0.25} />
      </mesh>
      {lit && <pointLight color="#b8ff6a" intensity={0.25} distance={60} decay={2} position={[40, y0 + 14, 18]} />}
    </group>
  );
}

function NeoPixelModel({ inst }: { inst: PartInstance }) {
  const L = useLive(inst.id);
  const n = Number(inst.props.count ?? 12);
  const px = L?.pixels ?? [];
  const cols = Array.from({ length: n }, (_, i) => {
    const c = px[i] ?? 0;
    return new THREE.Color(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
  });
  const avg = cols.reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / Math.max(1, n));
  const lum = avg.r + avg.g + avg.b;
  return (
    <group>
      <mesh position={[18.5, HEADER + 0.8, 38.5]} castShadow>
        <boxGeometry args={[12, 1.6, 7]} />
        <meshStandardMaterial color="#141518" />
      </mesh>
      <HeaderDown pins={[14.69, 17.23, 19.77, 22.31].map((x) => ({ x, y: 40.6 }))} />
      <group position={[18.5, HEADER, 18.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]} castShadow receiveShadow>
          <ringGeometry args={[11.5, 18.3, 64]} />
          <meshStandardMaterial color="#141518" side={THREE.DoubleSide} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.8, 0]}>
          <cylinderGeometry args={[18.3, 18.3, 1.6, 64, 1, true]} />
          <meshStandardMaterial color="#141518" side={THREE.DoubleSide} />
        </mesh>
        {cols.map((col, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const on = col.r + col.g + col.b > 0.01;
          return (
            <group key={i} position={[Math.cos(a) * 14.9, 1.6, Math.sin(a) * 14.9]} rotation={[0, -a, 0]}>
              <mesh position={[0, 0.8, 0]}>
                <boxGeometry args={[5, 1.6, 5]} />
                <meshStandardMaterial color="#f1f1ec" roughness={0.4} />
              </mesh>
              <mesh position={[0, 1.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[1.9, 20]} />
                <meshStandardMaterial color={on ? col : "#f8f8f4"} emissive={col} emissiveIntensity={on ? 7 : 0} toneMapped={!on} />
              </mesh>
            </group>
          );
        })}
        {lum > 0.02 && <pointLight color={avg.clone().multiplyScalar(1 / Math.max(avg.r, avg.g, avg.b, 0.001))} intensity={Math.min(2.5, lum * 4)} distance={90} decay={2} position={[0, 10, 0]} />}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// sensor modules
// ---------------------------------------------------------------------------
type LedSpec = { x: number; z: number; color?: string; when: "powered" | "indicator" | "on" };
function ModuleLeds({ leds, L, y }: { leds: LedSpec[]; L?: PartLive; y?: number }) {
  return (
    <>
      {leds.map((l, i) => (
        <SmdLed key={i} x={l.x} z={l.z} y={y} color={l.color ?? (l.when === "powered" ? "#ff3b30" : "#33ff88")} on={!!(l.when === "powered" ? L?.powered : l.when === "on" ? L?.on : L?.indicator)} light={l.when !== "powered"} />
      ))}
    </>
  );
}

const MODULE_COLOR: Record<string, string> = {
  flame: "#16181b",
  "ir-obstacle": "#1d5fa8",
  sw420: "#1d5fa8",
  sound: "#1d5fa8",
  adxl335: "#5b2f8f",
  bme280: "#6b2fa3",
  bh1750: "#1d5fa8",
  hall: "#16181b",
  touch: "#c8202a",
  mq2: "#1d5fa8",
  mq135: "#1d5fa8",
  pir: "#2f7d3b",
  "hc-sr04": "#1d5fa8",
  water: "#c62828",
};

function MqCan({ x, z, L }: { x: number; z: number; L?: PartLive }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = L?.powered ? 1.6 + 0.6 * Math.sin(clock.elapsedTime * 3) : 0;
  });
  const y0 = HEADER + 1.6;
  return (
    <group position={[x, y0, z]}>
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[9.2, 9.2, 2.4, 40]} />
        <meshStandardMaterial color="#2b2622" roughness={0.7} />
      </mesh>
      <mesh position={[0, 8, 0]} castShadow>
        <cylinderGeometry args={[8.6, 8.6, 11.5, 40, 1, true]} />
        <meshStandardMaterial {...METAL} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 13.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6.9, 8.6, 40]} />
        <meshStandardMaterial {...METAL} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 13.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.9, 40]} />
        <meshStandardMaterial ref={glow} color="#4a3a2a" emissive="#ff6a00" emissiveIntensity={0} toneMapped={false} wireframe={false} roughness={0.9} />
      </mesh>
      <MeshGrille y={13.75} r={6.9} />
    </group>
  );
}

/** Steel mesh over a sensor opening. */
function MeshGrille({ y, r }: { y: number; r: number }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = "#cfd5db";
    g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 8) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 128);
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }, []);
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[r, 40]} />
      <meshStandardMaterial map={tex} transparent alphaTest={0.3} metalness={0.8} roughness={0.35} />
    </mesh>
  );
}

function SonarModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const dist = useStudio((s) => s.snap?.env.distance ?? 120);
  const pings = useRef<(THREE.Mesh | null)[]>([]);
  const reach = Math.min(260, dist * 10);
  useFrame(({ clock }) => {
    pings.current.forEach((m, i) => {
      if (!m) return;
      const k = (clock.elapsedTime * 0.9 + i / 3) % 1;
      m.visible = !!L?.powered;
      m.position.z = -12 - k * reach;
      m.scale.setScalar(4 + k * 26);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    });
  });
  // stands upright on its pins, transducers facing forward (−Z)
  const tz = 19.2;
  return (
    <group>
      <HeaderDownPins pins={def.pins} />
      <mesh position={[22.5, HEADER / 2, tz]}>
        <boxGeometry args={[10.2, HEADER, 2.5]} />
        <meshStandardMaterial {...PLASTIC} />
      </mesh>
      {/* turned to face −Z (away from its pins), like a sensor looking ahead */}
      <group position={[45, 0, 2 * (tz - 1.2)]} rotation={[0, Math.PI, 0]}>
      <group position={[0, HEADER + 20.5, tz - 1.2]} rotation={[Math.PI / 2, 0, 0]}>
        <Slab inst={inst} def={def} y={0} color="#1d5fa8" />
        {[11.2, 33.8].map((x) => (
          <group key={x} position={[x, 1.6, 9]}>
            <mesh position={[0, 6, 0]} castShadow>
              <cylinderGeometry args={[8, 8, 12, 40, 1, true]} />
              <meshStandardMaterial {...METAL} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 11.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[7.9, 40]} />
              <meshStandardMaterial color="#1b1c1e" roughness={0.9} />
            </mesh>
            <MeshGrille y={11.9} r={6.4} />
          </group>
        ))}
        <mesh position={[22.5, 2.6, 3]}>
          <boxGeometry args={[4, 2, 2]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        {/* solder side: driver chips and the model name */}
        <Chip x={8} z={6} w={6} d={5} h={1.1} y={-1.1} />
        <Chip x={19.5} z={8} w={6} d={5} h={1.1} y={-1.1} />
        <Chip x={31} z={6} w={6} d={5} h={1.1} y={-1.1} />
        <BackLabel text="HC-SR04" x={22.5} z={15} />
      </group>
      </group>
      <group position={[22.5, HEADER + 11.5, tz - 1.2]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} ref={(m) => void (pings.current[i] = m)}>
            <torusGeometry args={[1, 0.05, 6, 48, Math.PI]} />
            <meshBasicMaterial color="#9fd0ff" transparent opacity={0.4} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function BackLabel({ text, x, z }: { text: string; x: number; z: number }) {
  const tex = useLabelTexture(text, "#eef3ff", "#1d5fa8", 14, 3);
  return (
    <mesh position={[x, -0.03, z]} rotation={[Math.PI / 2, 0, 0]} scale={[-1, 1, 1]}>
      <planeGeometry args={[14, 3]} />
      <meshStandardMaterial map={tex} />
    </mesh>
  );
}

function PirModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame((_, dt) => {
    if (mat.current) mat.current.emissiveIntensity = THREE.MathUtils.damp(mat.current.emissiveIntensity, L?.on ? 0.9 : 0, 8, dt);
  });
  return (
    <group>
      <Slab inst={inst} def={def} color="#2f7d3b" />
      <HeaderDown pins={def.pins} />
      <mesh position={[16.15, HEADER + 1.6, 10.4]} castShadow>
        <sphereGeometry args={[11.4, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial ref={mat} color="#f4f4f1" roughness={0.55} transmission={0.25} thickness={2} transparent opacity={0.96} emissive="#ff4d4d" emissiveIntensity={0} />
      </mesh>
      <TrimPot x={6} z={20.5} />
      <TrimPot x={26.3} z={20.5} />
    </group>
  );
}

function SideDome({ x, z, color, clear = false, glow = 0 }: { x: number; z: number; color: string; clear?: boolean; glow?: number }) {
  // 5 mm LED lying on its side, pointing −X
  const y = HEADER + 1.6 + 2.6;
  return (
    <group position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[2.4, 2.4, 4.6, 24]} />
        <meshPhysicalMaterial color={color} roughness={0.2} transmission={clear ? 0.5 : 0} transparent={clear} opacity={clear ? 0.9 : 1} emissive={color} emissiveIntensity={glow} toneMapped={glow < 1} />
      </mesh>
      <mesh position={[0, 2.3, 0]} castShadow>
        <sphereGeometry args={[2.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={color} roughness={0.2} transmission={clear ? 0.5 : 0} transparent={clear} opacity={clear ? 0.9 : 1} emissive={color} emissiveIntensity={glow} toneMapped={glow < 1} />
      </mesh>
    </group>
  );
}

function IrBeam({ x, z, active, reach }: { x: number; z: number; active: boolean; reach: number }) {
  const m = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (m.current) m.current.opacity = active ? 0.1 + 0.05 * Math.sin(clock.elapsedTime * 8) : 0;
  });
  return (
    <mesh position={[x - reach / 2, HEADER + 4.2, z]} rotation={[0, 0, Math.PI / 2]}>
      <coneGeometry args={[reach * 0.18, reach, 24, 1, true]} />
      <meshBasicMaterial ref={m} color="#c25cff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function ModuleModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const color = MODULE_COLOR[def.type] ?? def.custom?.color ?? "#1d5fa8";
  const dist = useStudio((s) => s.snap?.env.distance ?? 120);
  const y0 = HEADER + 1.6;
  let extra: ReactNode = null;
  let leds: LedSpec[] = [];
  switch (def.type) {
    case "flame":
      extra = (
        <>
          <SideDome x={-1.4} z={7} color="#0d0d10" />
          <TrimPot x={11} z={7} />
          <Chip x={17} z={4.4} w={5} d={5.2} h={1.6} />
        </>
      );
      leds = [{ x: 25.3, z: 3.6, when: "powered" }, { x: 25.3, z: 10.4, when: "indicator" }];
      break;
    case "ir-obstacle":
      extra = (
        <>
          <SideDome x={-0.6} z={3.8} color="#bcd4ff" clear glow={L?.powered ? 0.6 : 0} />
          <SideDome x={-0.6} z={10.2} color="#141518" />
          <IrBeam x={-3} z={3.8} active={!!L?.powered} reach={Math.min(160, Math.max(20, dist * 10))} />
          <TrimPot x={9.5} z={7} />
          <Chip x={14.5} z={4.4} w={5} d={5.2} h={1.6} />
        </>
      );
      leds = [{ x: 23.5, z: 3.6, when: "powered" }, { x: 23.5, z: 10.4, when: "indicator" }];
      break;
    case "sw420":
      extra = (
        <>
          <Shaker active={!!L?.indicator}>
            <mesh position={[7.5, y0 + 3.5, 7]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[3.4, 3.4, 11, 24]} />
              <meshStandardMaterial {...METAL} />
            </mesh>
          </Shaker>
          <TrimPot x={17.5} z={7} />
        </>
      );
      leds = [{ x: 24, z: 3.6, when: "powered" }, { x: 24, z: 10.4, when: "indicator" }];
      break;
    case "sound":
      extra = (
        <>
          <group position={[-0.5, y0, 7.5]}>
            <mesh position={[0, 3.2, 0]} castShadow>
              <cylinderGeometry args={[4.8, 4.8, 6.4, 32]} />
              <meshStandardMaterial {...METAL} />
            </mesh>
            <mesh position={[0, 6.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[4.2, 32]} />
              <meshStandardMaterial color="#141516" roughness={0.95} />
            </mesh>
            <Ripples y={6.6} r0={5} r1={5 + Math.max(0, ((L?.reading ?? 40) - 40) / 3)} color="#9fd0ff" active={!!L?.powered && (L?.reading ?? 0) > 50} speed={2.2} />
          </group>
          <TrimPot x={11} z={7.5} />
          <Chip x={17} z={4.8} w={5} d={5.4} h={1.6} />
        </>
      );
      leds = [{ x: 26, z: 3.6, when: "powered" }, { x: 26, z: 11.4, when: "indicator" }];
      break;
    case "adxl335":
      extra = <Chip x={7.5} z={3} w={6} d={6} h={1.2} />;
      break;
    case "bme280":
      extra = (
        <>
          <Chip x={4.85} z={3.6} w={3} d={3} h={1} color="#c9ced3" />
          <Chip x={4.4} z={7.2} w={3.9} d={1.3} h={0.9} />
        </>
      );
      break;
    case "bh1750":
      extra = (
        <>
          <Chip x={5.6} z={6.0} w={4} d={3.2} h={1.1} />
          <mesh position={[7.62, y0 + 1.12, 7.6]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.2, 1.6]} />
            <meshPhysicalMaterial color="#b7c3cf" roughness={0.05} clearcoat={1} />
          </mesh>
        </>
      );
      break;
    case "hall":
      extra = (
        <group position={[-0.2, 0, 6]} rotation={[0, 0, Math.PI / 2]}>
          <To92 x={0} z={0} label="3144" face={Math.PI / 2} />
        </group>
      );
      leds = [{ x: 12.2, z: 6, color: "#ff3b30", when: "indicator" }];
      break;
    case "touch":
      extra = (
        <group position={[7.62, y0 + 0.05, 4.5]}>
          <Ripples y={0.2} r0={3} r1={8} color="#ffffff" active={!!L?.on} speed={1.6} />
          <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[2.9, 32]} />
            <meshStandardMaterial color="#ffe1d6" emissive="#ff8a7a" emissiveIntensity={L?.on ? 2.5 : 0} toneMapped={!L?.on} transparent opacity={L?.on ? 0.9 : 0} />
          </mesh>
        </group>
      );
      leds = [{ x: 2.2, z: 2.2, color: "#ff3b30", when: "on" }];
      break;
    case "mq2":
    case "mq135":
      extra = (
        <>
          <MqCan x={16} z={9.5} L={L} />
          <TrimPot x={28.5} z={5} />
        </>
      );
      leds = [{ x: 3, z: 4, when: "powered" }, { x: 3, z: 8, when: "indicator" }];
      break;
    case "water":
      return <WaterModel inst={inst} def={def} />;
    default:
      if (def.custom) leds = [{ x: def.w - 4, z: 2.5, when: "powered" }];
  }
  return (
    <group>
      <Slab inst={inst} def={def} color={color} />
      <HeaderDown pins={def.pins} />
      {extra}
      <ModuleLeds leds={leds} L={L} />
    </group>
  );
}

function Shaker({ active, children }: { active: boolean; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.set(active ? Math.sin(clock.elapsedTime * 70) * 0.25 : 0, active ? Math.cos(clock.elapsedTime * 53) * 0.15 : 0, 0);
  });
  return <group ref={g}>{children}</group>;
}

function WaterModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const level = Math.max(0, Math.min(1, (L?.reading ?? 0) / 40));
  return (
    <group>
      <Slab inst={inst} def={def} color="#c62828" t={1.2} />
      <HeaderDown pins={def.pins} top={HEADER + 2.1} />
      {level > 0.01 && (
        <mesh position={[10, HEADER + 1.3, 44 - 21 * level]}>
          <boxGeometry args={[20.4, 0.25, 42 * level]} />
          <meshPhysicalMaterial color="#2c8bff" transparent opacity={0.45} roughness={0.05} transmission={0.3} />
        </mesh>
      )}
      <SmdLed x={16} z={50} y={HEADER + 1.2} color="#ff3b30" on={!!L?.powered} />
    </group>
  );
}

function SoilModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const tex = useArt(inst, def, { x: 0, y: 0, w: def.w, h: def.h });
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(23, 0);
    s.lineTo(23, 62);
    s.lineTo(16, 80);
    s.lineTo(7, 80);
    s.lineTo(0, 62);
    s.closePath();
    return s;
  }, []);
  return (
    <group>
      <mesh position={[0, HEADER + 1.6, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <extrudeGeometry args={[shape, { depth: 1.6, bevelEnabled: false }]} />
        <meshStandardMaterial color="#141518" roughness={0.55} />
      </mesh>
      {tex && (
        <mesh position={[def.w / 2, HEADER + 1.62, def.h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[def.w, def.h]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.4} />
        </mesh>
      )}
      <HeaderDown pins={def.pins} />
      <Chip x={3} z={6} w={17} d={10} h={1.2} color="#1d1f22" />
    </group>
  );
}

function Dht22Model({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const tex = useArt(inst, def, { x: 0, y: 0, w: 15.24, h: 20 });
  return (
    <group>
      <Legs pins={def.pins} top={1.4} />
      {def.pins.map((p) => (
        <mesh key={p.id} position={[p.x, 1.4, (p.y + 20) / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, p.y - 20, 6]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
      ))}
      <RoundedBox args={[15.1, 7.7, 20]} radius={1} position={[7.62, 3.85, 10]} castShadow receiveShadow>
        <meshStandardMaterial color="#f3f3ef" roughness={0.7} />
      </RoundedBox>
      {tex && (
        <mesh position={[7.62, 7.72, 10]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[15.24, 20]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.4} />
        </mesh>
      )}
    </group>
  );
}

function Ds18b20Model({ def }: { def: PartDef }) {
  const y = 4;
  return (
    <group>
      {def.pins.map((p) => (
        <Dupont key={p.id} x={p.x} z={p.y} />
      ))}
      <HeaderDownPins pins={def.pins} />
      <mesh position={[5, y, 11]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[2.6, 2.6, 18, 28]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh position={[5, y, 2]} castShadow>
        <sphereGeometry args={[2.6, 24, 12]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh position={[5, y, 21.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[3, 3, 4.4, 24]} />
        <meshStandardMaterial color="#121315" roughness={0.5} />
      </mesh>
      <Cable color="#121315" r={1.6} pts={[[5, y, 24], [5, y - 0.5, 27], [5, y, 30]]} />
      <Cable color="#2a2a2a" pts={[[4.2, y, 30], [3.2, 4.5, 34], [2.54, 5.2, 39.37]]} />
      <Cable color="#f2c230" pts={[[5, y, 30], [5, 4.5, 34], [5.08, 5.2, 39.37]]} />
      <Cable color="#d6302a" pts={[[5.8, y, 30], [6.8, 4.5, 34], [7.62, 5.2, 39.37]]} />
    </group>
  );
}

function JoystickModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const stick = useRef<THREE.Group>(null);
  const cap = useRef<THREE.Group>(null);
  const tx = (Number(inst.props.x ?? 0.5) - 0.5) * 0.9;
  const tz = (Number(inst.props.y ?? 0.5) - 0.5) * 0.9;
  useFrame((_, dt) => {
    if (stick.current) {
      stick.current.rotation.z = THREE.MathUtils.damp(stick.current.rotation.z, -tx, 12, dt);
      stick.current.rotation.x = THREE.MathUtils.damp(stick.current.rotation.x, tz, 12, dt);
    }
    if (cap.current) cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, L?.on ? 13 : 14, 25, dt);
  });
  const y0 = HEADER + 1.6;
  return (
    <group>
      <Slab inst={inst} def={def} color="#16181b" />
      <HeaderDown pins={def.pins} />
      <mesh position={[15.5, y0 + 4, 13]} castShadow>
        <boxGeometry args={[23, 8, 23]} />
        <meshStandardMaterial color="#202226" roughness={0.6} />
      </mesh>
      <group position={[15.5, y0 + 8, 13]}>
        <mesh castShadow>
          <sphereGeometry args={[9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2a2c31" roughness={0.5} />
        </mesh>
        <group ref={stick}>
          <mesh position={[0, 6, 0]} castShadow>
            <cylinderGeometry args={[1.8, 2.2, 12, 16]} />
            <meshStandardMaterial color="#3a3d44" />
          </mesh>
          <group ref={cap} position={[0, 14, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[7.2, 7.6, 5, 32]} />
              <meshStandardMaterial color="#26282c" roughness={0.6} />
            </mesh>
            {[5.6, 4.0, 2.4].map((r) => (
              <mesh key={r} position={[0, 2.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[r - 0.3, r, 32]} />
                <meshStandardMaterial color="#3c3f46" />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

function PulseModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const led = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const k = L?.indicator ? 1 : 0;
    if (led.current) led.current.emissiveIntensity = THREE.MathUtils.damp(led.current.emissiveIntensity, k * 8, 14, dt);
    if (light.current) light.current.intensity = THREE.MathUtils.damp(light.current.intensity, k * 0.5, 14, dt);
  });
  const y = 5;
  return (
    <group>
      {def.pins.map((p) => (
        <Dupont key={p.id} x={p.x} z={p.y} />
      ))}
      <HeaderDownPins pins={def.pins} />
      <Cable color="#7b3fd0" pts={[[6.6, y, 14.4], [6, y, 18], [5.46, 5.2, 22.86]]} />
      <Cable color="#d6302a" pts={[[8, y, 15], [8, y, 18], [8, 5.2, 22.86]]} />
      <Cable color="#2a2a2a" pts={[[9.4, y, 14.4], [10, y, 18], [10.54, 5.2, 22.86]]} />
      <Slab inst={inst} def={def} w={16} d={16} t={1.2} y={y - 0.6} color="#1f8a4c" round />
      <mesh position={[8, y + 1.0, 7.7]}>
        <boxGeometry args={[1.8, 0.6, 1.8]} />
        <meshStandardMaterial ref={led} color="#5cff8f" emissive="#5cff8f" emissiveIntensity={0} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color="#5cff8f" intensity={0} distance={40} decay={2} position={[8, y + 4, 7.7]} />
    </group>
  );
}

function RainModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const wet = Math.max(0, Math.min(1, (L?.reading ?? 0) / 100));
  const drops = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ x: 3 + ((i * 37.7) % 20), z: 3 + ((i * 53.3) % 16), s: 0.6 + ((i * 13.1) % 7) / 10 })), []);
  const n = Math.round(wet * drops.length);
  return (
    <group>
      <Slab inst={inst} def={def} x={0} z={1} w={26} d={20} t={1} y={0.6} color="#1d2a3a" />
      {drops.slice(0, n).map((d, i) => (
        <mesh key={i} position={[d.x, 1.75, d.z]} scale={[d.s, d.s * 0.45, d.s]}>
          <sphereGeometry args={[1, 14, 8]} />
          <meshPhysicalMaterial color="#9fd0ff" roughness={0.02} transmission={0.85} thickness={1} transparent opacity={0.85} />
        </mesh>
      ))}
      <Cable color="#e8e8e8" pts={[[26, 1.8, 9], [27.5, 3.5, 9.5], [29, HEADER + 2.2, 10]]} r={0.4} />
      <Cable color="#2a2a2a" pts={[[26, 1.8, 13], [27.5, 3.5, 12.5], [29, HEADER + 2.2, 12]]} r={0.4} />
      <Slab inst={inst} def={def} x={28} z={4} w={32} d={14} color="#1d5fa8" />
      <HeaderDown pins={def.pins} />
      <TrimPot x={35} z={11} />
      <Chip x={40.5} z={8.4} w={5} d={5.2} h={1.6} />
      <ModuleLeds leds={[{ x: 50, z: 7.6, when: "powered" }, { x: 50, z: 14.4, when: "indicator" }]} L={L} />
    </group>
  );
}


// ---------------------------------------------------------------------------
// panel devices (industrial control) and the multimeter
// ---------------------------------------------------------------------------
const DEVICE: Record<string, { h: number; color: string }> = {
  "pb-no": { h: 12, color: "#24262a" },
  "pb-nc": { h: 12, color: "#24262a" },
  "pilot-lamp": { h: 12, color: "#24262a" },
  estop: { h: 14, color: "#f2c419" },
  selector2: { h: 12, color: "#24262a" },
  selector3: { h: 12, color: "#24262a" },
  "limit-switch": { h: 22, color: "#c6ccd2" },
  contactor: { h: 70, color: "#e6e5e1" },
  overload: { h: 40, color: "#e6e5e1" },
  "timer-relay": { h: 62, color: "#e6e5e1" },
  psu24: { h: 50, color: "#c9ced3" },
  supply3: { h: 24, color: "#2a2c30" },
  mcb3: { h: 44, color: "#f2f1ec" },
  multimeter: { h: 26, color: "#f2c419" },
};
const CAP_COLOR: Record<string, string> = { green: "#22b35a", red: "#e0352d", black: "#222", yellow: "#f2c419", blue: "#2c6fe0", white: "#f1f1ee", amber: "#ff9d1c" };

function ScrewTerminals({ pins, y }: { pins: { x: number; y: number }[]; y: number }) {
  const heads = useMemo(() => pins.map((p) => ({ x: p.x, y: y + 0.4, z: p.y })), [pins, y]);
  return <Boxes items={heads} size={SCREW} material={METAL} />;
}
const SCREW: [number, number, number] = [2.6, 0.8, 2.6];

function DeviceModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const spec = DEVICE[def.type] ?? { h: 20, color: "#e6e5e1" };
  const H = spec.h;
  const tex = useArt(inst, def, { x: 0, y: 0, w: def.w, h: def.h });
  const cap = useRef<THREE.Group>(null);
  const knob = useRef<THREE.Group>(null);
  const pressed = !!L?.on;
  useFrame((_, dt) => {
    if (cap.current) cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, H + (pressed ? 1.2 : 4), 25, dt);
    if (knob.current) {
      const pos = Number(L?.reading ?? 0);
      const ang = def.type === "selector3" ? (pos === 1 ? 45 : pos === 2 ? -45 : 0) : pos ? -45 : 45;
      knob.current.rotation.y = THREE.MathUtils.damp(knob.current.rotation.y, THREE.MathUtils.degToRad(ang), 12, dt);
    }
  });
  const bodyH = def.type === "supply3" ? 16 : H;
  const bodyD = def.type === "pb-no" || def.type === "pb-nc" || def.type === "pilot-lamp" ? 21 : def.type.startsWith("selector") ? 25 : def.type === "estop" ? 26 : def.type === "supply3" ? 15 : def.h;
  const lampColor = CAP_COLOR[String(inst.props.color ?? "green")] ?? "#22b35a";
  const b = Math.min(1.2, L?.brightness ?? 0);
  const lcd = useMemo(() => {
    if (def.type !== "multimeter") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 280;
    return { c, t: new THREE.CanvasTexture(c) };
  }, [def.type]);
  const text = L?.text ?? ["0.000", "V DC"];
  useMemo(() => {
    if (!lcd) return;
    const g = lcd.c.getContext("2d")!;
    g.fillStyle = "#b8c9a5";
    g.fillRect(0, 0, 512, 280);
    g.fillStyle = "#1d2a14";
    g.font = "600 44px IBM Plex Mono, monospace";
    g.fillText(text[1] ?? "", 24, 60);
    g.font = "600 150px IBM Plex Mono, monospace";
    g.textAlign = "right";
    g.fillText(text[0] ?? "", 490, 230);
    g.textAlign = "left";
    lcd.t.colorSpace = THREE.SRGBColorSpace;
    lcd.t.needsUpdate = true;
  }, [lcd, text[0], text[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <RoundedBox args={[def.w, bodyH, bodyD]} radius={Math.min(1.6, bodyH / 3)} smoothness={3} position={[def.w / 2, bodyH / 2, bodyD / 2]} castShadow receiveShadow>
        <meshStandardMaterial color={spec.color} roughness={def.type === "psu24" ? 0.35 : 0.6} metalness={def.type === "psu24" || def.type === "limit-switch" ? 0.6 : 0.05} />
      </RoundedBox>
      {tex && (
        <mesh position={[def.w / 2, bodyH + 0.03, def.h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[def.w, def.h]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.4} roughness={0.55} />
        </mesh>
      )}
      <ScrewTerminals pins={def.pins} y={bodyH} />
      {(def.type === "pb-no" || def.type === "pb-nc") && (
        <group ref={cap} position={[11.43, H + 4, 10.5]}>
          <mesh castShadow>
            <cylinderGeometry args={[7.4, 7.8, 5, 40]} />
            <meshStandardMaterial color={CAP_COLOR[String(inst.props.color ?? (def.type === "pb-nc" ? "red" : "green"))] ?? "#22b35a"} roughness={0.35} />
          </mesh>
          <mesh position={[0, -2.6, 0]}>
            <cylinderGeometry args={[9.4, 9.4, 1.6, 40]} />
            <meshStandardMaterial {...METAL} />
          </mesh>
        </group>
      )}
      {def.type === "pilot-lamp" && (
        <group position={[11.43, H, 10.5]}>
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[9.4, 9.4, 1.6, 40]} />
            <meshStandardMaterial {...METAL} />
          </mesh>
          <mesh position={[0, 3, 0]} castShadow>
            <sphereGeometry args={[7.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
            <meshPhysicalMaterial color={lampColor} roughness={0.25} transmission={0.3} thickness={2} transparent opacity={0.95} emissive={lampColor} emissiveIntensity={b * 4} toneMapped={b < 0.05} />
          </mesh>
          {b > 0.05 && <pointLight color={lampColor} intensity={b * 1.2} distance={90} decay={2} position={[0, 10, 0]} />}
        </group>
      )}
      {def.type === "estop" && (
        <group position={[13.97, H, 13.6]}>
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[5, 6, 6, 32]} />
            <meshStandardMaterial color="#2a2c30" />
          </mesh>
          <mesh position={[0, pressed ? 6.5 : 9, 0]} castShadow>
            <sphereGeometry args={[11, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2.8]} />
            <meshStandardMaterial color={pressed ? "#a9201a" : "#e0352d"} roughness={0.35} />
          </mesh>
        </group>
      )}
      {def.type.startsWith("selector") && (
        <group ref={knob} position={[11.43, H, 13]}>
          <mesh position={[0, 1, 0]}>
            <cylinderGeometry args={[6.8, 6.8, 2, 32]} />
            <meshStandardMaterial {...METAL} />
          </mesh>
          <mesh position={[0, 4.5, 0]} castShadow>
            <boxGeometry args={[3, 6, 11]} />
            <meshStandardMaterial color="#2e3035" roughness={0.5} />
          </mesh>
          <mesh position={[0, 7.55, -4.2]}>
            <boxGeometry args={[1, 0.1, 2]} />
            <meshStandardMaterial color="#f2f2f0" />
          </mesh>
        </group>
      )}
      {def.type === "limit-switch" && (
        <group position={[15, H, 12]} rotation={[0, 0, pressed ? 0.5 : 0]}>
          <mesh position={[0, 5, 0]} castShadow>
            <boxGeometry args={[2, 10, 2]} />
            <meshStandardMaterial color="#2b2d31" />
          </mesh>
          <mesh position={[0, 10, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[2.6, 2.6, 3, 24]} />
            <meshStandardMaterial color="#1b1c1f" />
          </mesh>
        </group>
      )}
      {lcd && (
        <mesh position={[20.32, H + 0.08, 14]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[28.6, 16]} />
          <meshStandardMaterial map={lcd.t} emissive="#c9ffb0" emissiveMap={lcd.t} emissiveIntensity={0.25} />
        </mesh>
      )}
      {def.type === "contactor" && <SmdLed x={def.w / 2} z={33} y={H} color="#33ff88" on={pressed} light />}
      {def.type === "timer-relay" && (
        <>
          <SmdLed x={def.w / 2 - 4} z={12} y={H} color="#33ff88" on={!!L?.indicator} />
          <SmdLed x={def.w / 2 + 4} z={12} y={H} color="#ffb020" on={pressed} light />
        </>
      )}
      {def.type === "psu24" && <SmdLed x={def.w - 6} z={6} y={H} color="#33ff88" on light />}
      {def.type === "overload" && <SmdLed x={24.5} z={17} y={H} color="#ff3b30" on={pressed} light />}
    </group>
  );
}

function Motor3Model({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const L = useLive(inst.id);
  const fan = useRef<THREE.Group>(null);
  const sp = useRef(0);
  useFrame((_, dt) => {
    sp.current = THREE.MathUtils.damp(sp.current, L?.speed ?? 0, 2, dt);
    if (fan.current) fan.current.rotation.y += sp.current * dt * 40;
  });
  const fins = useMemo(() => Array.from({ length: 24 }, (_, i) => (i / 24) * Math.PI * 2), []);
  return (
    <group>
      <ScrewTerminals pins={def.pins} y={6} />
      <mesh position={[25.4, 3, 47]} castShadow>
        <boxGeometry args={[28.8, 6, 7]} />
        <meshStandardMaterial color="#2a2c30" />
      </mesh>
      <group position={[25.4, 0, 22]}>
        <mesh position={[0, 20, 0]} castShadow>
          <cylinderGeometry args={[17, 17, 40, 48]} />
          <meshStandardMaterial color="#4f6b8a" roughness={0.45} metalness={0.3} />
        </mesh>
        {fins.map((a) => (
          <mesh key={a} position={[Math.cos(a) * 18, 20, Math.sin(a) * 18]} rotation={[0, -a, 0]} castShadow>
            <boxGeometry args={[3, 38, 1.2]} />
            <meshStandardMaterial color="#45607d" roughness={0.5} metalness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 41, 0]}>
          <cylinderGeometry args={[19.5, 19.5, 2, 48, 1, true]} />
          <meshStandardMaterial color="#34495f" side={THREE.DoubleSide} />
        </mesh>
        <group ref={fan} position={[0, 41.5, 0]}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} rotation={[0.4, (k * Math.PI) / 3, 0]} position={[Math.cos((k * Math.PI) / 3) * 8, 0, -Math.sin((k * Math.PI) / 3) * 8]}>
              <boxGeometry args={[14, 0.6, 5]} />
              <meshStandardMaterial color="#c9d4e0" roughness={0.4} />
            </mesh>
          ))}
          <mesh>
            <cylinderGeometry args={[3, 3, 2, 20]} />
            <meshStandardMaterial color="#2a2c30" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
export function PartModel({ inst, def }: { inst: PartInstance; def: PartDef }) {
  switch (def.type) {
    case "led":
      return <LedModel inst={inst} />;
    case "rgb-led":
      return <LedModel inst={inst} rgb />;
    case "resistor":
      return <ResistorModel inst={inst} />;
    case "button":
      return <ButtonModel inst={inst} />;
    case "pot":
      return <PotModel inst={inst} />;
    case "ldr":
      return <LdrModel />;
    case "lm35":
      return <Lm35Model />;
    case "buzzer":
      return <BuzzerModel inst={inst} />;
    case "servo-sg90":
    case "servo-mg996r":
      return <ServoModel inst={inst} def={def} />;
    case "dc-motor":
      return <MotorModel inst={inst} />;
    case "relay":
      return <RelayModel inst={inst} def={def} />;
    case "lcd1602":
      return <LcdModel inst={inst} def={def} />;
    case "neopixel-ring":
      return <NeoPixelModel inst={inst} />;
    case "hc-sr04":
      return <SonarModel inst={inst} def={def} />;
    case "pir":
      return <PirModel inst={inst} def={def} />;
    case "soil":
      return <SoilModel inst={inst} def={def} />;
    case "dht22":
      return <Dht22Model inst={inst} def={def} />;
    case "ds18b20":
      return <Ds18b20Model def={def} />;
    case "joystick":
      return <JoystickModel inst={inst} def={def} />;
    case "pulse":
      return <PulseModel inst={inst} def={def} />;
    case "rain":
      return <RainModel inst={inst} def={def} />;
    case "motor3":
      return <Motor3Model inst={inst} def={def} />;
    default:
      if (DEVICE[def.type]) return <DeviceModel inst={inst} def={def} />;
      return <ModuleModel inst={inst} def={def} />;
  }
}
