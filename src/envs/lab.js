import * as THREE from "three";
import { Env } from "./base.js";
import { canvasTex, genTextures, makeNoise } from "./common.js";

// A clinical gait laboratory: pale vinyl floor, instrumented treadmills, motion-capture cameras on
// poles, ceiling softboxes and a back wall. Neutral, soft light so skin and fabric read naturally.
const FLOOR = -0.14;

function floorTextures() {
  const N = makeNoise(11);
  return genTextures(512, (u, v, x, y) => {
    const n = N.fbm(u * 6, v * 6, 6, 4), fine = N.noise(u * 64, v * 64, 64);
    const seam = Math.min(u * 4 % 1, v * 4 % 1) < 0.004 ? -12 : 0;
    const g = 188 + n * 18 + fine * 5 + seam;
    return [g, g + 1, g + 3, 0.5 + 0.15 * n + 0.04 * fine + (seam ? -0.08 : 0)];
  }, { normalStrength: 1.2, repeat: 8 });
}
function beltTexture() {
  const t = canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = "#26292e"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { const g = 30 + Math.random() * 30; x.fillStyle = `rgba(${g},${g + 2},${g + 6},0.5)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
    x.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 24; i++) x.fillRect((i / 24) * w, 0, 2, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 1);
  return t;
}
function labelTexture(text) {
  return canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = "rgba(40,46,56,0.85)"; x.font = "600 64px Kanit, 'Segoe UI', sans-serif"; x.textBaseline = "middle";
    x.fillText(text, 16, h / 2);
  });
}
function wallTexture() {
  return canvasTex(1024, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#c9ced6"); g.addColorStop(0.62, "#d8dce2"); g.addColorStop(0.64, "#9aa3b0"); g.addColorStop(1, "#a7afba");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(90,100,115,0.18)"; x.lineWidth = 2;
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((i / 8) * w, 0); x.lineTo((i / 8) * w, h * 0.63); x.stroke(); }
  });
}

class Treadmill {
  constructor(label) {
    this.group = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x5d636c, metalness: 0.6, roughness: 0.38 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 0.86), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7, metalness: 0.2 }));
    base.position.y = -0.068; base.receiveShadow = true; base.castShadow = true; this.group.add(base);
    this.tex = beltTexture();
    const beltMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.92, metalness: 0 });
    for (const z of [-0.18, 0.18]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.34), beltMat);
      b.rotation.x = -Math.PI / 2; b.position.set(0, 0.0015, z); b.receiveShadow = true; this.group.add(b);
    }
    for (const z of [-0.41, 0.41]) { const r = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.025, 0.05), frame); r.position.set(0, 0.0, z); r.castShadow = true; r.receiveShadow = true; this.group.add(r); }
    // thin colour line on the side rail identifies the walker (matches their shirt and chart colour)
    this.accent = new THREE.MeshStandardMaterial({ color: 0x38c6ff, roughness: 0.5, emissive: 0x38c6ff, emissiveIntensity: 0.35 });
    for (const z of [-0.437, 0.437]) { const s = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.012, 0.004), this.accent); s.position.set(0, -0.004, z); this.group.add(s); }
    for (const x of [-1.15, 1.15]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.8, 32), frame);
      r.rotation.x = Math.PI / 2; r.position.set(x, -0.05, 0); this.group.add(r);
    }
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: labelTexture(label), transparent: true, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(-0.75, FLOOR + 0.002, 0.62); this.group.add(lab);
    this.belt = 0;
  }
  move(dx) { this.belt += dx; this.tex.offset.x = -this.belt; }
}

function mocapCamera() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2329, roughness: 0.55, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0x8a919b, metalness: 0.7, roughness: 0.3 }));
  pole.position.y = 1.3 + FLOOR; pole.castShadow = true; g.add(pole);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 24), dark); foot.position.y = FLOOR + 0.015; g.add(foot);
  const head = new THREE.Group(); head.position.y = 2.55 + FLOOR; g.add(head);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), dark); head.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.25, 0.2), toneMapped: false }));
  ring.position.z = 0.072; head.add(ring);
  g.userData.head = head;
  return g;
}

export class LabEnv extends Env {
  build() {
    this.treadmill = true;
    this.light = {
      exposure: 1.0, bloom: [0.18, 0.4, 1.3], fog: [0xb9c0ca, 0.012], background: new THREE.Color(0xb9c0ca), env: "room", envIntensity: 0.75,
      hemi: [0xf4f7fb, 0x7d838c, 0.55], sun: { color: 0xfff4e6, intensity: 2.2, pos: [2.5, 7, 4] },
      rimA: { color: 0xcfe0ff, intensity: 0.9, pos: [-5, 3.5, -4] }, rimB: { color: 0xffffff, intensity: 0.45, pos: [-3, 2, 5] },
    };
    const ft = floorTextures();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: ft.map, normalMap: ft.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.62, metalness: 0.0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; floor.receiveShadow = true; this.add(floor);
    // room: back + side walls with skirting, ceiling with softbox panels
    const wt = wallTexture(); wt.wrapS = THREE.RepeatWrapping; wt.repeat.set(3, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9 });
    const W = 16, H = 5.2, D = 12;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); back.position.set(0, FLOOR + H / 2, -D / 2); back.receiveShadow = true; this.add(back);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat); side.rotation.y = -s * Math.PI / 2; side.position.set(s * W / 2, FLOOR + H / 2, 0); this.add(side); }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xe4e7ec, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = FLOOR + H; this.add(ceil);
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.22, 1.15) });
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
      const pnl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), panelMat);
      pnl.rotation.x = Math.PI / 2; pnl.position.set(i * 2.8, FLOOR + H - 0.01, j * 3.2); this.add(pnl);
    }
    // a wall display and a handrail strip for scale
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35), new THREE.MeshBasicMaterial({ map: canvasTex(512, 288, (x, w, h) => {
      x.fillStyle = "#0b1626"; x.fillRect(0, 0, w, h);
      x.strokeStyle = "#3aa9ff"; x.lineWidth = 3; x.beginPath();
      for (let i = 0; i < w; i++) { const y = h * 0.5 + Math.sin(i * 0.045) * 40 + Math.sin(i * 0.13) * 8; i ? x.lineTo(i, y) : x.moveTo(i, y); }
      x.stroke(); x.strokeStyle = "#e76624"; x.beginPath();
      for (let i = 0; i < w; i++) { const y = h * 0.62 + Math.sin(i * 0.045 + 1.2) * 30; i ? x.lineTo(i, y) : x.moveTo(i, y); }
      x.stroke(); x.fillStyle = "#9fb6d2"; x.font = "600 22px sans-serif"; x.fillText("GAIT ANALYSIS", 18, 34);
    }) }));
    screen.position.set(-3.2, FLOOR + 2.0, -D / 2 + 0.03); this.add(screen);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.7, roughness: 0.3 }));
    rail.position.set(0, FLOOR + 0.95, -D / 2 + 0.12); this.add(rail);
    // motion-capture cameras around the capture volume
    this.cams = [];
    for (const [x, z] of [[-4.5, -4], [0, -5], [4.5, -4], [-5.5, 0.5], [5.5, 0.5], [-4.5, 4.2], [4.5, 4.2]]) {
      const c = mocapCamera(); c.position.set(x, 0, z);
      c.userData.head.lookAt(0, 0.9, 0);
      this.add(c); this.cams.push(c);
    }
    this.mills = [1, 2, 3, 4, 5, 6].map((k) => new Treadmill(`LANE ${k}`));
    for (const m of this.mills) this.add(m.group);
    const tmpC = new THREE.Color();
    this.tick.push((dt, t, ctx) => {
      this.mills.forEach((mill, i) => {
        const ln = ctx.lanes[i], on = !!ln && (i === 0 || ctx.merged < 0.98);
        mill.group.visible = on;
        if (!ln) return;
        mill.group.position.set(ln.position.x, 0, ln.position.z);
        if (ctx.colors && ctx.colors[i]) { tmpC.set(ctx.colors[i]); mill.accent.color.copy(tmpC); mill.accent.emissive.copy(tmpC); }
      });
    });
  }
}
