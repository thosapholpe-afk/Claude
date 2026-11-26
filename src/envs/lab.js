import * as THREE from "three";
import { Env } from "./base.js";
import { canvasTex, Ambient } from "./common.js";

const FLOOR = -0.14;

function floorTexture() {
  const t = canvasTex(1024, 1024, (x, w) => {
    const g = x.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, "#050c18"); g.addColorStop(1, "#071226");
    x.fillStyle = g; x.fillRect(0, 0, w, w);
    x.strokeStyle = "rgba(120,190,255,0.06)"; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { const p = (i / 8) * w; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, w); x.moveTo(0, p); x.lineTo(w, p); x.stroke(); }
    x.strokeStyle = "rgba(47,184,255,0.35)"; x.lineWidth = 3; x.strokeRect(1.5, 1.5, w - 3, w - 3);
    x.fillStyle = "rgba(160,220,255,0.18)";
    for (let i = 0; i <= 8; i += 2) for (let j = 0; j <= 8; j += 2) { x.fillRect((i / 8) * w - 7, (j / 8) * w - 1, 14, 2); x.fillRect((i / 8) * w - 1, (j / 8) * w - 7, 2, 14); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 20);
  return t;
}
function beltTexture(accent) {
  const t = canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = "#0c121c"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(180,220,255,${Math.random() * 0.04})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.fillStyle = "rgba(160,210,255,0.08)";
    for (let i = 0; i < 16; i++) x.fillRect((i / 16) * w, 0, 3, h);
    x.fillStyle = accent; x.fillRect(0, 0, 10, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 1);
  return t;
}
function labelTexture(text, sub, color) {
  return canvasTex(1024, 256, (x, w, h) => {
    x.fillStyle = color; x.font = "700 120px Kanit, 'Segoe UI', sans-serif"; x.textBaseline = "middle";
    x.fillText(text, 20, h * 0.42);
    x.fillStyle = "rgba(200,230,255,0.55)"; x.font = "500 44px 'JetBrains Mono', monospace";
    x.fillText(sub, 24, h * 0.85);
  });
}
function holoTexture(title, seed) {
  return canvasTex(512, 320, (x, w, h) => {
    x.fillStyle = "rgba(8,40,90,0.35)"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(90,200,255,0.9)"; x.lineWidth = 2; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = "#8fe6ff"; x.font = "600 26px 'JetBrains Mono', monospace"; x.fillText(title, 20, 40);
    x.strokeStyle = "rgba(90,200,255,0.18)"; x.lineWidth = 1;
    for (let i = 0; i < 10; i++) { x.beginPath(); x.moveTo(20, 70 + i * 22); x.lineTo(w - 20, 70 + i * 22); x.stroke(); }
    const rows = [[90, 0.9], [160, 0.6], [230, 0.75]];
    rows.forEach(([y0, a], r) => {
      x.strokeStyle = r === 1 ? "rgba(255,255,255,0.8)" : "rgba(80,220,255,0.95)"; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 480; i++) { const v = Math.sin(i * 0.05 * (r + 1) + seed) * 18 * a + Math.sin(i * 0.31 + r) * 5 * Math.random(); i ? x.lineTo(20 + i, y0 + v) : x.moveTo(20, y0 + v); }
      x.stroke();
    });
    x.fillStyle = "rgba(143,230,255,0.8)"; x.font = "500 16px 'JetBrains Mono', monospace";
    x.fillText("IMU 200 Hz · TCN · EMG 1 kHz", 20, h - 22);
  });
}

class Treadmill {
  constructor(accent, label) {
    this.glowMat = null;
    this.group = new THREE.Group();
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x0a0f18, metalness: 0.8, roughness: 0.3, clearcoat: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 0.86), dark);
    base.position.y = -0.068; base.receiveShadow = true; base.castShadow = true; this.group.add(base);
    this.tex = beltTexture(accent === 0 ? "rgba(220,240,255,0.45)" : "rgba(47,184,255,0.55)");
    const beltMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85, metalness: 0.05 });
    for (const z of [-0.18, 0.18]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.34), beltMat);
      b.rotation.x = -Math.PI / 2; b.position.set(0, 0.0015, z); b.receiveShadow = true; this.group.add(b);
    }
    const glow = (this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.5, 3.2), toneMapped: false }));
    for (const z of [-0.425, 0.425]) { const s = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.012, 0.008), glow); s.position.set(0, -0.02, z); this.group.add(s); }
    const gap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.004, 0.012), glow); gap.position.set(0, 0.001, 0); this.group.add(gap);
    for (const x of [-1.15, 1.15]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.84, 32), dark);
      r.rotation.x = Math.PI / 2; r.position.set(x, -0.045, 0); this.group.add(r);
    }
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(label[0], label[1], "#eaf6ff"), transparent: true, depthWrite: false, opacity: 0.9 }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(-0.6, FLOOR + 0.002, 0.66); this.group.add(lab);
    this.belt = 0;
  }
  move(dx) { this.belt += dx; this.tex.offset.x = -this.belt; }
}

export class LabEnv extends Env {
  build() {
    this.treadmill = true;
    this.light = {
      exposure: 1.05, bloom: [0.75, 0.55, 1.05], fog: [0x030914, 0.07], background: new THREE.Color(0x02060d), env: "room", envIntensity: 0.42,
      hemi: [0x9fc8ff, 0x040a18, 0.4], sun: { color: 0xffffff, intensity: 2.3, pos: [3, 7, 4] },
      rimA: { color: 0x1f6bff, intensity: 3.4, pos: [-5, 3.5, -4] }, rimB: { color: 0x34d8ff, intensity: 1.5, pos: [-3, 2, 5] },
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshPhysicalMaterial({ map: floorTexture(), roughness: 0.42, metalness: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; floor.receiveShadow = true; this.add(floor);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 12, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x050a14, roughness: 0.9, side: THREE.BackSide }));
    wall.position.y = 5; this.add(wall);
    for (const [y, k] of [[1.5, 2.2], [1.53, 0.5], [3.2, 0.35], [0.4, 0.6]]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(14.9, 14.9, 0.025, 128, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.55, 1.2).multiplyScalar(k), toneMapped: false, side: THREE.BackSide }));
      band.position.y = y; this.add(band);
    }
    // light cones
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0.75, 0.9, 1.0) } },
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(abs(dot(vN,vV)),2.0); float a=0.055*f*smoothstep(0.,0.9,vUv.y)*smoothstep(1.,0.6,vUv.y); gl_FragColor=vec4(uColor*a,a); }",
    });
    this.cones = [0, 1, 2, 3, 4, 5].map(() => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.4, 5, 48, 1, true), coneMat); c.position.y = 2.4; this.add(c); return c; });
    // body-scan rings + holographic field
    const scanMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 3.0), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const fieldMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.U.uTime },
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f=1.0-abs(dot(vN,vV)); float l=smoothstep(0.92,1.0,fract(vUv.y*24.0-uTime*0.4)); float a=(0.03+0.07*pow(f,3.0)+0.05*l)*smoothstep(1.0,0.75,vUv.y)*smoothstep(0.0,0.08,vUv.y); gl_FragColor=vec4(vec3(0.2,0.75,1.0)*a,a); }",
    });
    this.scans = [0, 1, 2, 3, 4, 5].map(() => {
      const g = new THREE.Group();
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.006, 8, 96), scanMat); r.rotation.x = Math.PI / 2; g.add(r);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.2, 64, 1, true), fieldMat); f.position.y = 1.1; g.add(f);
      this.add(g); g.userData.ring = r; return g;
    });
    // holo panels
    this.panels = [];
    [["GAIT · KINEMATICS", 1], ["EMG · ENVELOPE", 4], ["IMU + TCN · EVENTS", 7]].forEach(([t, s], i) => {
      const tex = holoTexture(t, s);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      p.position.set(-3.2 + i * 3.2, 2.6 + (i % 2) * 0.25, -3.6); p.rotation.y = (1 - i) * 0.25;
      this.add(p); this.panels.push(p);
    });
    this.dust = new Ambient(this.U, 600, { box: [12, 4.5, 10], center: [0, 2.25, 0], fall: -0.03, wind: 0.02, swirl: 0.15, size: 0.012, color: [0.7, 0.9, 1.0], additive: true, scroll: 0, opacity: 0.6 });
    this.add(this.dust.points); this.fx.push(this.dust);
    this.mills = [1, 2, 3, 4, 5, 6].map((k) => new Treadmill(1, [`LANE ${k}`, "DUAL-BELT · 1000 Hz"]));
    for (const m of this.mills) this.add(m.group);
    const tmpC = new THREE.Color();
    this.tick.push((dt, t, ctx) => {
      this.mills.forEach((mill, i) => {
        const ln = ctx.lanes[i], on = !!ln && (i === 0 || ctx.merged < 0.98);
        mill.group.visible = on; this.cones[i].visible = on && (i === 0 || ctx.merged < 0.5);
        const sc = this.scans[i];
        sc.visible = !!ln && ctx.figVisible[i] && !(i > 0 && ctx.merged > 0.5);
        if (!ln) return;
        mill.group.position.set(ln.position.x, 0, ln.position.z);
        this.cones[i].position.set(ln.position.x, 2.4, ln.position.z);
        sc.position.set(ln.position.x, 0, ln.position.z);
        sc.userData.ring.position.y = 0.05 + (0.5 + 0.5 * Math.sin(t * 0.9 + i * 1.7)) * 1.9;
        if (ctx.colors && ctx.colors[i]) mill.glowMat.color.copy(tmpC.set(ctx.colors[i])).multiplyScalar(2.2);
      });
      this.panels.forEach((p, i) => { p.position.y = 2.6 + (i % 2) * 0.25 + Math.sin(t * 0.6 + i) * 0.04; p.material.map.offset.x = Math.sin(t * 0.2 + i) * 0.01; });
    });
  }
}
