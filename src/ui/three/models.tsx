/**
 * Detailed 3D models, built in millimetres (scale the parent group to taste).
 * Boards use their own 2D silkscreen render as the top-surface texture, so
 * labels, traces and pads match the 2D editor exactly.
 */
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { footprintOf, isBoard, isHost } from "../../core/circuit";
import type { BoardDef, Connector, PartInstance } from "../../core/types";
import { Board2D, headerStrips, SvgDefs } from "../render/Board2D";
import { Part2D } from "../render/Parts2D";
import { getPart } from "../../core/parts";

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
const texCache = new Map<string, THREE.Texture>();

/** Rasterise an SVG element tree (in mm units) into a texture. */
export function useSvgTexture(key: string, w: number, h: number, render: () => ReactElement): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(() => texCache.get(key) ?? null);
  useEffect(() => {
    const hit = texCache.get(key);
    if (hit) {
      setTex(hit);
      return;
    }
    let cancelled = false;
    const ppm = Math.min(14, 3600 / Math.max(w, h));
    const markup = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" width={w * ppm} height={h * ppm} viewBox={`0 0 ${w} ${h}`}>
        <SvgDefs />
        {render()}
      </svg>,
    );
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas");
      c.width = Math.round(w * ppm);
      c.height = Math.round(h * ppm);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      texCache.set(key, t);
      setTex(t);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return tex;
}

function useLabelTexture(text: string, fg: string, bg: string, w: number, h: number) {
  return useMemo(() => {
    const k = 40;
    const c = document.createElement("canvas");
    c.width = Math.max(32, Math.round(w * k));
    c.height = Math.max(16, Math.round(h * k));
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg;
    const fs = Math.min(c.height * 0.26, (c.width * 1.5) / Math.max(4, text.length));
    g.font = `600 ${fs}px IBM Plex Mono, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2);
    // pin-1 dot
    g.beginPath();
    g.arc(fs * 0.7, c.height - fs * 0.7, fs * 0.22, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, fg, bg, w, h]);
}

// ---------------------------------------------------------------------------
// board geometry helpers
// ---------------------------------------------------------------------------
export type HeaderStyle = "male-down" | "female-up" | "male-up";
export const headerStyle = (b: BoardDef): HeaderStyle => (b.family === "avr" ? "female-up" : b.family === "bcm2711" ? "male-up" : "male-down");
export const SPACER = 2.5; // header plastic height
export const PIN_BELOW = 6; // male pin length below the plastic

function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const METAL = { color: "#c6ccd2", metalness: 0.9, roughness: 0.28 };
const GOLD = { color: "#e6bd5c", metalness: 0.75, roughness: 0.32 };
const PLASTIC = { color: "#17181b", metalness: 0.05, roughness: 0.7 };

/** Instanced boxes for many identical small parts (pins, SMD bodies). */
function Boxes({ items, size, material }: { items: { x: number; y: number; z: number; rot?: number; color?: string }[]; size: [number, number, number]; material: THREE.MeshStandardMaterialParameters }) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(...size);
    const mat = new THREE.MeshStandardMaterial(material);
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, it.rot ?? 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.color) m.setColorAt(i, col.set(it.color));
    });
    m.count = items.length;
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return m;
  }, [items, size, material]);
  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return <primitive object={mesh} />;
}

function Headers({ board }: { board: BoardDef }) {
  const t = board.thickness;
  const style = headerStyle(board);
  const strips = useMemo(() => headerStrips(board.pins), [board]);
  const pins = useMemo(() => {
    const below = style === "male-down" ? SPACER + PIN_BELOW : 3;
    const above = style === "male-down" ? t + 1.3 : t + (style === "female-up" ? 1 : SPACER + 6);
    const len = below + above;
    return { len, cy: above - len / 2, items: board.pins.map((p) => ({ x: p.x, y: 0, z: p.y })) };
  }, [board, style, t]);
  const pinSize = useMemo(() => [0.64, pins.len, 0.64] as [number, number, number], [pins.len]);
  const pinItems = useMemo(() => pins.items.map((p) => ({ ...p, y: pins.cy })), [pins]);
  const holes = useMemo(() => board.pins.map((p) => ({ x: p.x, y: t + 8.5 + 0.02, z: p.y })), [board, t]);
  return (
    <group>
      {strips.map((s, i) => {
        const h = style === "female-up" ? 8.5 : SPACER;
        const y = style === "male-down" ? -h / 2 : t + h / 2;
        return (
          <mesh key={i} position={[s.x + s.w / 2, y, s.y + s.h / 2]} castShadow receiveShadow>
            <boxGeometry args={[s.w - 0.1, h, s.h - 0.15]} />
            <meshStandardMaterial {...PLASTIC} />
          </mesh>
        );
      })}
      {style !== "female-up" && <Boxes items={pinItems} size={pinSize} material={GOLD} />}
      {style === "female-up" && <Boxes items={holes} size={[1.05, 0.04, 1.05]} material={{ color: "#050505", roughness: 1 }} />}
    </group>
  );
}

function Chip({ c, isModule, board }: { c: BoardDef["chips"][number]; isModule: boolean; board: BoardDef }) {
  const t = board.thickness;
  const label = useLabelTexture(isModule ? "ESP-WROOM-32" : c.label, c.metal ? "#5a6168" : "#a9adb2", c.metal ? "#c3c8cd" : "#1b1c1f", c.w, c.h);
  const legs = useMemo(() => {
    if (c.metal || isModule) return [];
    const out: { x: number; y: number; z: number; rot?: number }[] = [];
    const pitch = c.w > 20 ? 2.54 : 0.65;
    if (c.w > 20) {
      // DIP: legs along the long sides
      const n = Math.floor(c.w / pitch);
      for (let i = 0; i < n; i++) {
        const x = c.x + (c.w - (n - 1) * pitch) / 2 + i * pitch;
        out.push({ x, y: t + 0.6, z: c.y - 0.35 }, { x, y: t + 0.6, z: c.y + c.h + 0.35 });
      }
    } else if (c.w <= 8 && c.h <= 8 && c.w > 3) {
      const n = Math.max(2, Math.floor((Math.min(c.w, c.h) - 1) / pitch));
      for (let i = 0; i < n; i++) {
        const d = -((n - 1) * pitch) / 2 + i * pitch;
        out.push({ x: c.x + c.w / 2 + d, y: t + 0.12, z: c.y - 0.3 }, { x: c.x + c.w / 2 + d, y: t + 0.12, z: c.y + c.h + 0.3 });
        out.push({ x: c.x - 0.3, y: t + 0.12, z: c.y + c.h / 2 + d, rot: Math.PI / 2 }, { x: c.x + c.w + 0.3, y: t + 0.12, z: c.y + c.h / 2 + d, rot: Math.PI / 2 });
      }
    }
    return out;
  }, [c, isModule, t]);
  const legSize = useMemo(() => (c.w > 20 ? ([0.5, 1.2, 0.9] as [number, number, number]) : ([0.25, 0.2, 0.7] as [number, number, number])), [c.w]);
  const z = Math.max(0.4, c.z);
  if (isModule) {
    return (
      <group>
        <mesh position={[c.x + c.w / 2 + 1.5, t + 0.4, c.y + c.h / 2]} castShadow receiveShadow>
          <boxGeometry args={[c.w + 3, 0.8, c.h]} />
          <meshStandardMaterial color="#1a1f1c" roughness={0.6} />
        </mesh>
        <mesh position={[c.x + (c.w - 5) / 2, t + 0.8 + 1.2, c.y + c.h / 2]} castShadow>
          <boxGeometry args={[c.w - 5, 2.4, c.h - 1.2]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[c.x + (c.w - 5) / 2, t + 0.8 + 2.41, c.y + c.h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[c.w - 6, c.h - 2]} />
          <meshStandardMaterial map={label} metalness={0.6} roughness={0.35} />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      {c.metal ? (
        <RoundedBox args={[c.w, z, c.h]} radius={Math.min(0.5, z / 2.2)} position={[c.x + c.w / 2, t + z / 2, c.y + c.h / 2]} castShadow receiveShadow>
          <meshStandardMaterial {...METAL} />
        </RoundedBox>
      ) : (
        <mesh position={[c.x + c.w / 2, t + z / 2 + (c.w > 20 ? 0.8 : 0), c.y + c.h / 2]} castShadow receiveShadow>
          <boxGeometry args={[c.w, z, c.h]} />
          <meshStandardMaterial color={c.color} roughness={0.75} />
        </mesh>
      )}
      <mesh position={[c.x + c.w / 2, t + z + (c.w > 20 ? 0.8 : 0) + 0.01, c.y + c.h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[c.w * 0.96, c.h * 0.9]} />
        <meshStandardMaterial map={label} roughness={c.metal ? 0.35 : 0.8} metalness={c.metal ? 0.6 : 0} />
      </mesh>
      {legs.length > 0 && <Boxes items={legs} size={legSize} material={METAL} />}
    </group>
  );
}

/** Opening on the outward face of an edge connector. */
function faceOf(c: Connector, t: number) {
  const cx = c.x + c.w / 2;
  const cz = c.y + c.h / 2;
  const cy = t + c.z / 2;
  switch (c.edge) {
    case "left":
      return { pos: [c.x - 0.02, cy, cz] as const, rot: [0, -Math.PI / 2, 0] as const, w: c.h, h: c.z };
    case "right":
      return { pos: [c.x + c.w + 0.02, cy, cz] as const, rot: [0, Math.PI / 2, 0] as const, w: c.h, h: c.z };
    case "top":
      return { pos: [cx, cy, c.y - 0.02] as const, rot: [0, Math.PI, 0] as const, w: c.w, h: c.z };
    default:
      return { pos: [cx, cy, c.y + c.h + 0.02] as const, rot: [0, 0, 0] as const, w: c.w, h: c.z };
  }
}

function ConnectorModel({ c, board }: { c: Connector; board: BoardDef }) {
  const t = board.thickness;
  if (c.kind === "antenna") return null;
  if (c.kind === "sd") {
    return (
      <mesh position={[c.x + c.w / 2, -0.75, c.y + c.h / 2]} castShadow>
        <boxGeometry args={[c.w, 1.5, c.h]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
    );
  }
  if (c.kind === "button") {
    return (
      <group position={[c.x + c.w / 2, t, c.y + c.h / 2]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[c.w, 1, c.h]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[0, 1.25, 0]} castShadow>
          <cylinderGeometry args={[Math.min(c.w, c.h) * 0.3, Math.min(c.w, c.h) * 0.3, 0.9, 20]} />
          <meshStandardMaterial color="#202124" roughness={0.6} />
        </mesh>
      </group>
    );
  }
  if (c.kind === "header") {
    const items: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) items.push({ x: c.x + 1.27 + i * 2.54, y: t + 4.2, z: c.y + 1.27 + j * 2.54 });
    return (
      <group>
        <mesh position={[c.x + c.w / 2, t + 1.25, c.y + c.h / 2]} castShadow>
          <boxGeometry args={[c.w, 2.5, c.h]} />
          <meshStandardMaterial {...PLASTIC} />
        </mesh>
        <Boxes items={items} size={[0.64, 8, 0.64]} material={GOLD} />
      </group>
    );
  }
  const f = faceOf(c, t);
  const body =
    c.kind === "barrel" || c.kind === "audio" ? (
      <meshStandardMaterial color="#141518" roughness={0.65} />
    ) : (
      <meshStandardMaterial {...METAL} />
    );
  return (
    <group>
      {c.kind === "usb-c" ? (
        <RoundedBox args={[c.w, c.z, c.h]} radius={Math.min(c.z, c.w) * 0.45} position={[c.x + c.w / 2, t + c.z / 2, c.y + c.h / 2]} castShadow>
          {body}
        </RoundedBox>
      ) : (
        <mesh position={[c.x + c.w / 2, t + c.z / 2, c.y + c.h / 2]} castShadow receiveShadow>
          <boxGeometry args={[c.w, c.z, c.h]} />
          {body}
        </mesh>
      )}
      <group position={f.pos as unknown as [number, number, number]} rotation={f.rot as unknown as [number, number, number]}>
        {c.kind === "barrel" || c.kind === "audio" ? (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[Math.min(f.w, f.h) * 0.3, Math.min(f.w, f.h) * 0.3, 0.1, 24]} />
            <meshStandardMaterial color="#050505" />
          </mesh>
        ) : c.kind === "usb-a" ? (
          <>
            {[0.27, 0.73].map((k) => (
              <group key={k}>
                <mesh position={[(k - 0.5) * f.w, 0, 0]}>
                  <planeGeometry args={[f.w * 0.36, f.h * 0.4]} />
                  <meshStandardMaterial color="#060606" />
                </mesh>
                <mesh position={[(k - 0.5) * f.w, -f.h * 0.06, 0.02]}>
                  <planeGeometry args={[f.w * 0.3, f.h * 0.12]} />
                  <meshStandardMaterial color={c.label.includes("3.0") ? "#1f6fe0" : "#202326"} />
                </mesh>
              </group>
            ))}
          </>
        ) : (
          <mesh>
            <planeGeometry args={[f.w * (c.kind === "rj45" ? 0.7 : 0.62), f.h * (c.kind === "usb-b" ? 0.55 : c.kind === "rj45" ? 0.6 : 0.4)]} />
            <meshStandardMaterial color="#060606" />
          </mesh>
        )}
      </group>
      {c.kind === "rj45" && (
        <>
          <mesh position={[c.x + c.w + 0.05, t + c.z * 0.8, c.y + 2.5]}>
            <boxGeometry args={[0.1, 1.2, 1.6]} />
            <meshStandardMaterial color="#c9ff5a" emissive="#c9ff5a" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[c.x + c.w + 0.05, t + c.z * 0.8, c.y + c.h - 2.5]}>
            <boxGeometry args={[0.1, 1.2, 1.6]} />
            <meshStandardMaterial color="#ffb347" emissive="#ffb347" emissiveIntensity={0.6} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Smd({ board }: { board: BoardDef }) {
  const t = board.thickness;
  const { bodies, ends } = useMemo(() => {
    const rnd = seeded(board.id);
    const keepOut: { x0: number; z0: number; x1: number; z1: number }[] = [
      ...board.chips.map((c) => ({ x0: c.x - 1.2, z0: c.y - 1.2, x1: c.x + c.w + 1.2, z1: c.y + c.h + 1.2 })),
      ...board.connectors.map((c) => ({ x0: c.x - 1, z0: c.y - 1, x1: c.x + c.w + 1, z1: c.y + c.h + 1 })),
      ...board.holes.map((h) => ({ x0: h.x - h.d, z0: h.y - h.d, x1: h.x + h.d, z1: h.y + h.d })),
    ];
    const target = Math.round((board.width * board.height) / 110);
    const bodies: { x: number; y: number; z: number; rot: number; color: string }[] = [];
    const ends: { x: number; y: number; z: number; rot: number }[] = [];
    for (let tries = 0; bodies.length < target && tries < target * 40; tries++) {
      const x = 2.5 + rnd() * (board.width - 5);
      const z = 2.5 + rnd() * (board.height - 5);
      if (board.pins.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.y - z) < 2)) continue;
      if (keepOut.some((k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1)) continue;
      if (bodies.some((b) => Math.abs(b.x - x) < 2.2 && Math.abs(b.z - z) < 1.6)) continue;
      const rot = rnd() < 0.5 ? 0 : Math.PI / 2;
      const cap = rnd() < 0.55;
      bodies.push({ x, y: t + 0.25, z, rot, color: cap ? "#b8915e" : "#1e1f22" });
      const dx = Math.cos(rot) * 0.65;
      const dz = -Math.sin(rot) * 0.65;
      ends.push({ x: x + dx, y: t + 0.26, z: z + dz, rot }, { x: x - dx, y: t + 0.26, z: z - dz, rot });
    }
    return { bodies, ends };
  }, [board, t]);
  return (
    <group>
      <Boxes items={bodies} size={[1.6, 0.5, 0.8]} material={{ color: "#ffffff", roughness: 0.6 }} />
      <Boxes items={ends} size={[0.32, 0.52, 0.82]} material={METAL} />
    </group>
  );
}

function StatusLeds({ board, powered, ledOn }: { board: BoardDef; powered: boolean; ledOn: boolean }) {
  const t = board.thickness;
  const f = board.family;
  const leds = [
    { x: f === "avr" ? 52 : f === "rp2040" ? 6.2 : f === "bcm2711" ? 2.6 : 10.8, z: f === "avr" ? 20 : f === "rp2040" ? 4.3 : f === "bcm2711" ? 47 : 5.2, color: "#ff3b30", on: powered },
    { x: f === "avr" ? 52 : f === "rp2040" ? 6.2 : f === "bcm2711" ? 2.6 : 10.8, z: f === "avr" ? 23.6 : f === "rp2040" ? 16.6 : f === "bcm2711" ? 51 : 22.6, color: f === "esp32" ? "#2f8bff" : "#7cff5b", on: ledOn },
  ];
  return (
    <group>
      {leds.map((l, i) => (
        <group key={i} position={[l.x, t + 0.3, l.z]}>
          <mesh castShadow>
            <boxGeometry args={[1.6, 0.6, 0.8]} />
            <meshStandardMaterial color={l.color} emissive={l.color} emissiveIntensity={l.on ? 3.5 : 0} transparent opacity={0.9} />
          </mesh>
          {l.on && <pointLight color={l.color} intensity={0.5} distance={14} decay={2} position={[0, 1, 0]} />}
        </group>
      ))}
    </group>
  );
}

/** Full board model in mm. Origin = PCB top-left corner, y = 0 at the PCB's underside. */
export function BoardModel({ board, powered = false, ledOn = false }: { board: BoardDef; powered?: boolean; ledOn?: boolean }) {
  const t = board.thickness;
  const W = board.width;
  const H = board.height;
  const pcbGeo = useMemo(() => {
    const r = board.family === "bcm2711" ? 3 : 1.6;
    const s = new THREE.Shape();
    s.moveTo(r, 0);
    s.lineTo(W - r, 0);
    s.quadraticCurveTo(W, 0, W, r);
    s.lineTo(W, H - r);
    s.quadraticCurveTo(W, H, W - r, H);
    s.lineTo(r, H);
    s.quadraticCurveTo(0, H, 0, H - r);
    s.lineTo(0, r);
    s.quadraticCurveTo(0, 0, r, 0);
    for (const h of board.holes) {
      const p = new THREE.Path();
      p.absarc(h.x, h.y, h.d / 2, 0, Math.PI * 2, true);
      s.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 18 });
    g.rotateX(Math.PI / 2);
    g.translate(0, t, 0);
    return g;
  }, [board, W, H, t]);
  const silk = useSvgTexture(`silk:${board.id}`, W, H, () => <Board2D board={board} powered={false} ledOn={false} silk />);
  return (
    <group>
      <mesh geometry={pcbGeo} castShadow receiveShadow>
        <meshStandardMaterial color={board.pcbColor} roughness={0.55} metalness={0.05} />
      </mesh>
      {silk && (
        <mesh position={[W / 2, t + 0.012, H / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[W, H]} />
          <meshStandardMaterial map={silk} transparent alphaTest={0.5} roughness={0.5} metalness={0.08} />
        </mesh>
      )}
      <Headers board={board} />
      {board.chips.map((c, i) => (
        <Chip key={i} c={c} board={board} isModule={board.id === "esp32-devkit-v1" && i === 0} />
      ))}
      {board.connectors.map((c) => (
        <ConnectorModel key={c.id} c={c} board={board} />
      ))}
      <Smd board={board} />
      <StatusLeds board={board} powered={powered} ledOn={ledOn} />
    </group>
  );
}

export const HOST_TOP: Record<string, number> = { breadboard: 8.5, perfboard: 1.6 };

/** Breadboard / perfboard body with its 2D artwork on top. Origin = top-left corner at the floor. */
export function HostModel({ inst }: { inst: PartInstance }) {
  const fp = footprintOf(inst)!;
  const def = getPart(inst.type)!;
  const top = HOST_TOP[inst.type] ?? 1.6;
  const key = `host:${inst.type}:${JSON.stringify(inst.props)}`;
  const tex = useSvgTexture(key, fp.w, fp.h, () => <Part2D inst={{ ...inst, x: 0, y: 0, rot: 0 }} def={def} t={0} />);
  const finish = inst.type === "perfboard" ? ({ fr4: "#1f6e43", phenolic: "#b98a4b", "fr4-white": "#eceae4" } as Record<string, string>)[String(inst.props.finish ?? "fr4")] : "#efece2";
  return (
    <group>
      <RoundedBox args={[fp.w, top, fp.h]} radius={inst.type === "breadboard" ? 0.8 : 0.3} position={[fp.w / 2, top / 2, fp.h / 2]} castShadow receiveShadow>
        <meshStandardMaterial color={finish} roughness={inst.type === "breadboard" ? 0.85 : 0.6} />
      </RoundedBox>
      {tex && (
        <mesh position={[fp.w / 2, top + 0.015, fp.h / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[fp.w, fp.h]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.5} roughness={inst.type === "breadboard" ? 0.85 : 0.5} metalness={inst.type === "perfboard" ? 0.15 : 0} />
        </mesh>
      )}
      {tex && inst.type === "perfboard" && (
        // solder side: same pad grid seen from below
        <mesh position={[fp.w / 2, -0.015, fp.h / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[1, -1, 1]}>
          <planeGeometry args={[fp.w, fp.h]} />
          <meshStandardMaterial map={tex} transparent alphaTest={0.5} roughness={0.45} metalness={0.2} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Vertical stacking: parts plugged into a breadboard/perfboard sit on its top
 * surface, ESP32/Pico sit on their header spacers, a Pi 4 carries a perfboard HAT.
 */
export function computeStack(parts: PartInstance[], inserted: { part: string; bb: string }[], board: BoardDef) {
  const hostOf = new Map<string, string>();
  for (const i of inserted) if (!hostOf.has(i.part)) hostOf.set(i.part, i.bb);
  const style = headerStyle(board);
  const boardInst = parts.find(isBoard);
  const boardHost = boardInst ? hostOf.get(boardInst.id) : undefined;
  const lift = new Map<string, number>();
  for (const p of parts) {
    if (isHost(p)) lift.set(p.id, p.id === boardHost && style === "male-up" ? board.thickness + SPACER + 0.4 : 0);
  }
  if (boardInst) {
    const host = boardHost ? parts.find((p) => p.id === boardHost) : undefined;
    if (host && style === "male-down") lift.set(boardInst.id, (lift.get(host.id) ?? 0) + (HOST_TOP[host.type] ?? 1.6) + SPACER);
    else if (style === "male-down") lift.set(boardInst.id, SPACER + PIN_BELOW);
    else lift.set(boardInst.id, style === "female-up" ? 3 : 0);
  }
  for (const p of parts) {
    if (lift.has(p.id)) continue;
    const h = hostOf.get(p.id);
    const host = h ? parts.find((x) => x.id === h) : undefined;
    lift.set(p.id, host ? (lift.get(host.id) ?? 0) + (HOST_TOP[host.type] ?? 1.6) : 0);
  }
  /** Height (mm) at which a wire attaches to a pin of a part. */
  const pinTop = (partId: string) => {
    const inst = parts.find((p) => p.id === partId);
    if (!inst) return 5;
    const base = lift.get(partId) ?? 0;
    if (isHost(inst)) return base + (HOST_TOP[inst.type] ?? 1.6) + 0.3;
    if (isBoard(inst)) return base + board.thickness + (style === "male-down" ? 1.3 : style === "female-up" ? 8.5 : SPACER + 6);
    return base + 5.5;
  };
  return { lift, pinTop, hostOf };
}
