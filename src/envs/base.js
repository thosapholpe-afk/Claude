import * as THREE from "three";

export class Env {
  constructor(stage) {
    this.stage = stage;
    this.U = stage.U;
    this.root = new THREE.Group();
    stage.scene.add(this.root);
    this.g = 0;
    this.treadmill = false;
    this.windy = false;
    this.deform = null;
    this.fx = [];
    this.tick = [];
    this.rts = [];
    this.light = {};
    this.footDust = null;
  }
  add(o) { this.root.add(o); return o; }
  scroll(dx) { this.g += dx; this.U.uG.value = this.g; }
  sink() { return 0; }
  stamp() {}
  onStep() {}
  update(dt, t, ctx) {
    for (const f of this.tick) f(dt, t, ctx);
    for (const p of this.fx) p.update(dt, this.stage.pointScale, this.floorY ?? -Infinity);
    if (this.deform) this.deform.update(this.g);
  }
  dispose() {
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        if (seen.has(m)) continue; seen.add(m);
        for (const k of ["map", "normalMap", "roughnessMap", "emissiveMap", "alphaMap", "bumpMap"]) if (m[k]) m[k].dispose();
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose();
        m.dispose();
      }
    });
    this.root.removeFromParent();
    if (this.deform) this.deform.dispose();
    for (const rt of this.rts) rt.dispose();
  }
}
