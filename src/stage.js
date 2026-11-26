import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const GROUND = 0;          // treadmill belt surface
const FLOOR = -0.14;       // lab floor

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function floorTexture() {
  const t = canvasTex(1024, 1024, (x, w) => {
    x.fillStyle = "#0a0a0c"; x.fillRect(0, 0, w, w);
    x.strokeStyle = "rgba(255,255,255,0.045)"; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { const p = (i / 8) * w; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, w); x.moveTo(0, p); x.lineTo(w, p); x.stroke(); }
    x.strokeStyle = "rgba(255,40,40,0.22)"; x.lineWidth = 3;
    x.strokeRect(1.5, 1.5, w - 3, w - 3);
    x.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i <= 8; i += 2) for (let j = 0; j <= 8; j += 2) x.fillRect((i / 8) * w - 6, (j / 8) * w - 1, 12, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 20);
  return t;
}

function beltTexture(accent) {
  const t = canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = "#151518"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.fillStyle = "rgba(255,255,255,0.07)";
    for (let i = 0; i < 16; i++) x.fillRect((i / 16) * w, 0, 3, h);
    x.fillStyle = accent; x.fillRect(0, 0, 10, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2 / 1.0, 1);
  return t;
}

function labelTexture(text, sub, color) {
  return canvasTex(1024, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = color; x.font = "700 120px Kanit, 'Segoe UI', sans-serif"; x.textBaseline = "middle";
    x.fillText(text, 20, h * 0.42);
    x.fillStyle = "rgba(255,255,255,0.55)"; x.font = "500 44px 'JetBrains Mono', monospace";
    x.fillText(sub, 24, h * 0.85);
  });
}

class Treadmill {
  constructor(accentHex, label) {
    this.group = new THREE.Group();
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x0d0d10, metalness: 0.75, roughness: 0.32, clearcoat: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.13, 0.86), dark);
    base.position.y = -0.068; base.receiveShadow = true; base.castShadow = true; this.group.add(base);
    this.tex = beltTexture(accentHex === 0xff2a2a ? "rgba(255,42,42,0.5)" : "rgba(255,255,255,0.35)");
    const beltMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85, metalness: 0.05 });
    for (const z of [-0.18, 0.18]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.34), beltMat);
      b.rotation.x = -Math.PI / 2; b.position.set(0, 0.0015, z); b.receiveShadow = true; this.group.add(b);
    }
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentHex).multiplyScalar(2.4), toneMapped: false });
    for (const z of [-0.425, 0.425]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.012, 0.008), glow); s.position.set(0, -0.02, z); this.group.add(s);
    }
    const gap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.004, 0.012), glow); gap.position.set(0, 0.001, 0); this.group.add(gap);
    for (const x of [-1.15, 1.15]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.84, 32), dark);
      r.rotation.x = Math.PI / 2; r.position.set(x, -0.045, 0); this.group.add(r);
    }
    const lt = labelTexture(label[0], label[1], accentHex === 0xff2a2a ? "#ff2a2a" : "#f4f4f5");
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false, opacity: 0.9 }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(-0.6, FLOOR + 0.002, 0.66); this.group.add(lab);
    this.belt = 0;
  }
  move(dx) { this.belt += dx; this.tex.offset.x = -this.belt / 1.0; }
}

function makeArrow(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 12), mat); shaft.position.y = 0.5; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 16), mat); g.add(head);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.075, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; g.userData = { shaft, head, ring, mat };
  const root = new THREE.Group(); root.add(g); root.add(ring);
  root.userData = { g, shaft, head, ring };
  return root;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = (this.scene = new THREE.Scene());
    sc.background = new THREE.Color(0x050506);
    sc.fog = new THREE.FogExp2(0x050506, 0.075);
    const pm = new THREE.PMREMGenerator(r);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6; this.controls.maxDistance = 14; this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0.85, 0);
    this.camera.position.set(4.4, 1.5, 5.4);

    // lights
    sc.add(new THREE.HemisphereLight(0xffffff, 0x220606, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 7, 4); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    sc.add(key);
    const rim = new THREE.DirectionalLight(0xff1a1a, 2.2); rim.position.set(-5, 3.5, -4); sc.add(rim);
    const rim2 = new THREE.DirectionalLight(0xff3030, 0.9); rim2.position.set(-3, 2, 5); sc.add(rim2);
    const back = new THREE.DirectionalLight(0xdfe6ff, 1.2); back.position.set(-2, 5, 0); sc.add(back);

    // floor + backdrop
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshPhysicalMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.25, clearcoat: 0.25, clearcoatRoughness: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; floor.receiveShadow = true; sc.add(floor);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 12, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9, side: THREE.BackSide }));
    wall.position.y = 5; sc.add(wall);
    for (const [y, k] of [[1.5, 2.2], [1.53, 0.5], [3.2, 0.35]]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(14.9, 14.9, 0.025, 128, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.05).multiplyScalar(k), toneMapped: false, side: THREE.BackSide }));
      band.position.y = y; sc.add(band);
    }

    // light cones (fake volumetrics)
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1, 0.92, 0.9) } },
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(abs(dot(vN,vV)),2.0); float a=0.05*f*smoothstep(0.,0.9,vUv.y)*smoothstep(1.,0.6,vUv.y); gl_FragColor=vec4(uColor*a,a); }",
    });
    this.cones = [];
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.4, 5, 48, 1, true), coneMat);
      c.position.y = 2.4; sc.add(c); this.cones.push(c);
    }

    // dust
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 12; pos[i * 3 + 1] = Math.random() * 4.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 10; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    sc.add(this.dust);

    // treadmills & lanes
    this.mills = [new Treadmill(0xffffff, ["TYPE 1", "LANE A · DUAL-BELT"]), new Treadmill(0xff2a2a, ["TYPE 2", "LANE B · DUAL-BELT"])];
    for (const t of this.mills) { t.group.position.y = 0; sc.add(t.group); }
    this.lanes = [new THREE.Group(), new THREE.Group()];
    for (const l of this.lanes) sc.add(l);
    this.arrows = [[makeArrow(new THREE.Color(2.4, 2.4, 2.4)), makeArrow(new THREE.Color(2.4, 2.4, 2.4))], [makeArrow(new THREE.Color(3, 0.1, 0.1)), makeArrow(new THREE.Color(3, 0.1, 0.1))]];
    for (const pair of this.arrows) for (const a of pair) sc.add(a);
    this.mode = "lanes"; this.laneT = 0;

    // post
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(sc, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.6, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.camTween = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  resize() {
    const p = this.canvas.parentElement, w = p.clientWidth, h = p.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 46 : 32;
    this.camera.updateProjectionMatrix();
  }

  lanePos(i, ghost) {
    if (ghost) return new THREE.Vector3(0, 0, 0);
    return i === 0 ? new THREE.Vector3(-1.3, 0, -0.6) : new THREE.Vector3(1.3, 0, 0.6);
  }

  setMode(mode) { this.mode = mode; }

  view(name) {
    const P = {
      cine: [[4.4, 1.5, 5.4], [0, 0.85, 0]],
      side: [[0, 1.0, 7.2], [0, 0.85, 0]],
      front: [[7.0, 1.2, 0.0], [0, 0.85, 0]],
      back: [[-6.5, 1.6, 2.2], [0, 0.85, 0]],
      low: [[2.2, 0.25, 3.2], [0, 0.55, 0]],
    }[name];
    if (!P) return;
    this.camTween = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1: new THREE.Vector3(...P[0]), q1: new THREE.Vector3(...P[1]) };
  }

  update(dt, figs, time) {
    const ghost = this.mode === "ghost";
    this.laneT += ((ghost ? 1 : 0) - this.laneT) * Math.min(1, dt * 5);
    for (let i = 0; i < 2; i++) {
      const p = this.lanePos(i, false).lerp(this.lanePos(i, true), this.laneT);
      this.lanes[i].position.copy(p);
      this.mills[i].group.position.set(p.x, 0, p.z);
      this.cones[i].position.set(p.x, 2.4, p.z);
    }
    this.mills[1].group.visible = this.laneT < 0.98;
    this.mills[1].group.scale.setScalar(1 - 0.0 * this.laneT);
    this.cones[1].visible = this.laneT < 0.5;
    const pa = this.dust.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { let y = pa.getY(i) + dt * 0.03; if (y > 4.5) y = 0; pa.setY(i, y); pa.setX(i, pa.getX(i) + Math.sin(time * 0.3 + i) * dt * 0.01); }
    pa.needsUpdate = true;
    if (this.camTween) {
      const c = this.camTween; c.t = Math.min(1, c.t + dt / 1.1);
      const e = c.t < 0.5 ? 4 * c.t ** 3 : 1 - (-2 * c.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(c.p0, c.p1, e); this.controls.target.lerpVectors(c.q0, c.q1, e);
      if (c.t >= 1) this.camTween = null;
    }
    this.controls.update();
  }

  setArrow(i, side, visible, pos, F, BW, s) {
    const a = this.arrows[i][side === "R" ? 0 : 1], u = a.userData;
    a.visible = visible;
    if (!visible) return;
    const len = Math.max(0.01, (F / BW) * 0.55);
    a.position.copy(pos); a.position.y = GROUND + 0.004;
    const tilt = -0.18 * Math.sin(2 * Math.PI * s);
    u.g.rotation.z = -tilt;
    u.shaft.scale.y = len; u.shaft.position.y = len / 2; u.head.position.y = len + 0.03;
    u.ring.material.opacity = 0.25 + 0.5 * (F / BW);
    u.ring.scale.setScalar(0.8 + 0.4 * (F / BW));
  }

  render() { this.composer.render(); }
}
export { GROUND };
