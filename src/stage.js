import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LabEnv } from "./envs/lab.js";
import { GardenEnv } from "./envs/garden.js";
import { BeachEnv } from "./envs/beach.js";
import { FactoryEnv } from "./envs/factory.js";
import { SnowEnv } from "./envs/snow.js";

export const ENVS = { lab: LabEnv, garden: GardenEnv, beach: BeachEnv, factory: FactoryEnv, snow: SnowEnv };
export const GROUND = 0;

function makeArrow(color) {
  const root = new THREE.Group(), g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 12), mat); shaft.position.y = 0.5; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 16), mat); g.add(head);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.075, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  root.add(g); root.add(ring);
  root.userData = { g, shaft, head, ring };
  return root;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = (this.scene = new THREE.Scene());
    this.U = { uTime: { value: 0 }, uWind: { value: 1 }, uG: { value: 0 } };
    this.pmrem = new THREE.PMREMGenerator(r);
    this.roomEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.08, 600);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 1.2, maxDistance: 16, maxPolarAngle: Math.PI * 0.495, autoRotateSpeed: 0.6 });
    this.controls.target.set(0, 0.85, 0);
    this.camera.position.set(4.4, 1.5, 5.4);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 40 });
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 4;
    sc.add(this.sun); sc.add(this.sun.target);
    this.rimA = new THREE.DirectionalLight(0x3388ff, 2); sc.add(this.rimA);
    this.rimB = new THREE.DirectionalLight(0x66ddff, 1); sc.add(this.rimB);

    this.lanes = [new THREE.Group(), new THREE.Group()];
    for (const l of this.lanes) sc.add(l);
    this.laneTarget = [new THREE.Vector3(-1.3, 0, -0.6), new THREE.Vector3(1.3, 0, 0.6)];
    this.merged = 0; this.mergeTarget = 0;
    this.arrows = [[makeArrow(new THREE.Color(2.2, 2.6, 3.0)), makeArrow(new THREE.Color(2.2, 2.6, 3.0))], [makeArrow(new THREE.Color(0.3, 1.5, 3.2)), makeArrow(new THREE.Color(0.3, 1.5, 3.2))]];
    for (const pair of this.arrows) for (const a of pair) sc.add(a);

    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(sc, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.6, 0.5, 1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.pointScale = 400;
    this.pickables = [];
    this.onPick = null; this.onHover = null;
    this.ray = new THREE.Raycaster();
    canvas.addEventListener("pointerdown", (e) => { this._pd = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", (e) => {
      if (!this._pd) return;
      const d = Math.hypot(e.clientX - this._pd[0], e.clientY - this._pd[1]); this._pd = null;
      if (d > 6) return;
      const hit = this.pick(e);
      if (this.onPick) this.onPick(hit ? hit.object.userData : null, e);
    });
    let lastHover = 0;
    canvas.addEventListener("pointermove", (e) => {
      const now = performance.now();
      if (now - lastHover < 90 || e.buttons) return;
      lastHover = now;
      const hit = this.pick(e);
      canvas.style.cursor = hit ? "pointer" : "grab";
      if (this.onHover) this.onHover(hit ? hit.object.userData : null, e);
    });
    canvas.addEventListener("pointerleave", () => { if (this.onHover) this.onHover(null); });

    this.camTween = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects(this.pickables, false);
    return hits[0] || null;
  }

  resize() {
    const p = this.canvas.parentElement, w = this.canvas.clientWidth || p.clientWidth, h = this.canvas.clientHeight || p.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 46 : 32;
    this.camera.updateProjectionMatrix();
    this.pointScale = this.renderer.domElement.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  setEnv(id) {
    if (this.env) this.env.dispose();
    this.U.uG.value = 0;
    this.env = new ENVS[id](this);
    this.env.build();
    this.envId = id;
    const L = this.env.light, sc = this.scene;
    this.renderer.toneMappingExposure = L.exposure;
    [this.bloom.strength, this.bloom.radius, this.bloom.threshold] = L.bloom;
    sc.fog = new THREE.FogExp2(L.fog[0], L.fog[1]);
    sc.background = L.background;
    sc.environment = L.env === "room" ? this.roomEnv : L.env;
    this.envIntensity = L.envIntensity;
    this.hemi.color.set(L.hemi[0]); this.hemi.groundColor.set(L.hemi[1]); this.hemi.intensity = L.hemi[2];
    for (const [light, cfg] of [[this.sun, L.sun], [this.rimA, L.rimA], [this.rimB, L.rimB]]) { light.color.set(cfg.color); light.intensity = cfg.intensity; light.position.set(...cfg.pos); }
    this.applyEnvIntensity();
  }

  applyEnvIntensity() {
    const k = this.envIntensity ?? 1;
    this.scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (m.isMeshStandardMaterial) m.envMapIntensity = k;
    });
  }

  view(name) {
    const P = {
      cine: [[4.4, 1.5, 5.4], [0, 0.85, 0]],
      side: [[0, 1.0, 7.2], [0, 0.85, 0]],
      front: [[7.0, 1.2, 0.0], [0, 0.85, 0]],
      back: [[-6.5, 1.6, 2.2], [0, 0.85, 0]],
      low: [[2.2, 0.25, 3.2], [0, 0.55, 0]],
      close: [[1.4, 1.15, 2.3], [0, 0.8, 0]],
    }[name];
    if (!P) return;
    this.camTween = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1: new THREE.Vector3(...P[0]), q1: new THREE.Vector3(...P[1]) };
  }

  setLayout(lanes, merged) {
    this.laneTarget = lanes.map((v) => new THREE.Vector3(...v));
    this.mergeTarget = merged ? 1 : 0;
  }

  update(dt, t, ctx) {
    this.U.uTime.value = t;
    this.merged += (this.mergeTarget - this.merged) * Math.min(1, dt * 5);
    for (let i = 0; i < 2; i++) this.lanes[i].position.lerp(this.laneTarget[i], Math.min(1, dt * 5));
    if (this.camTween) {
      const c = this.camTween; c.t = Math.min(1, c.t + dt / 1.1);
      const e = c.t < 0.5 ? 4 * c.t ** 3 : 1 - (-2 * c.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(c.p0, c.p1, e); this.controls.target.lerpVectors(c.q0, c.q1, e);
      if (c.t >= 1) this.camTween = null;
    }
    this.controls.update();
    if (this.env) this.env.update(ctx.envDt ?? dt, t, { ...ctx, lanes: this.lanes, merged: this.merged });
  }

  setArrow(i, side, visible, pos, F, BW, s) {
    const a = this.arrows[i][side === "R" ? 0 : 1], u = a.userData;
    a.visible = visible;
    if (!visible) return;
    const len = Math.max(0.01, (F / BW) * 0.55);
    a.position.copy(pos);
    u.g.rotation.z = 0.18 * Math.sin(2 * Math.PI * s);
    u.shaft.scale.y = len; u.shaft.position.y = len / 2; u.head.position.y = len + 0.03;
    u.ring.material.opacity = 0.25 + 0.5 * (F / BW);
    u.ring.scale.setScalar(0.8 + 0.4 * (F / BW));
  }

  render() { this.composer.render(); }
}
