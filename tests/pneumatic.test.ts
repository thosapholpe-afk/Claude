import { describe, expect, it } from "vitest";
import { defaultScenarioState } from "../src/core/env";
import { SimEngine } from "../src/core/sim";
import { instantiateTemplate, TEMPLATES } from "../src/core/templates";

async function runFor(e: SimEngine, ms: number, each?: () => void) {
  for (let t = 0; t < ms; t += 20) {
    await new Promise((r) => setTimeout(r, 0));
    await e.frame(20);
    each?.();
  }
}

async function boot() {
  const t = TEMPLATES.find((x) => x.id === "plc-pneumatic")!;
  const inst = instantiateTemplate(t, "plc-fx16", "ladder");
  expect(inst.log).toEqual([]);
  const e = new SimEngine();
  e.autoFrames = false;
  e.setCircuit("plc-fx16", inst.parts, inst.wires);
  e.setEnvironment(defaultScenarioState("lab"), {});
  await e.start("ladder", inst.code.ladder!);
  return e;
}

describe("pneumatics", () => {
  it("cycles the cylinder on START and sends it home on STOP", async () => {
    const e = await boot();
    await runFor(e, 400);
    let s = e.snapshot()!;
    expect(s.live.CYL1.pos).toBe(0);
    expect(s.live.AIR.reading).toBeCloseTo(6, 0);
    expect(s.plc?.bits.X2).toBe(true); // a0: home
    expect(s.plc?.bits.X1).toBe(true); // STOP is NC: healthy = ON
    expect(s.live.YV1.on).toBe(false);

    e.setInput("S1", { pressed: true });
    await runFor(e, 100);
    e.setInput("S1", { pressed: false });

    // watch several strokes: the rod must reach both ends repeatedly
    let ends = 0;
    let homes = 0;
    let wasEnd = false;
    let wasHome = true;
    let maxPos = 0;
    await runFor(e, 6000, () => {
      const p = e.snapshot()!.live.CYL1.pos ?? 0;
      maxPos = Math.max(maxPos, p);
      if (p >= 0.999 && !wasEnd) ends++;
      if (p <= 0.001 && !wasHome) homes++;
      wasEnd = p >= 0.999;
      wasHome = p <= 0.001;
    });
    expect(maxPos).toBe(1);
    expect(ends).toBeGreaterThanOrEqual(3);
    expect(homes).toBeGreaterThanOrEqual(3);
    s = e.snapshot()!;
    expect(s.plc?.bits.M0).toBe(true);
    expect(s.live.H1.on).toBe(true);
    expect(s.plc?.acc.C0).toBe(ends);
    expect(s.diags.filter((d) => d.level === "error")).toEqual([]);

    // STOP: valve drops out, the spring returns the cylinder home and it stays there
    e.setInput("S2", { pressed: true });
    await runFor(e, 100);
    e.setInput("S2", { pressed: false });
    await runFor(e, 2000);
    s = e.snapshot()!;
    expect(s.plc?.bits.M0).toBe(false);
    expect(s.live.YV1.on).toBe(false);
    expect(s.live.CYL1.pos).toBe(0);
    expect(s.live.H1.on).toBe(false);
    await runFor(e, 1500);
    expect(e.snapshot()!.live.CYL1.pos).toBe(0);
    await e.stop();
  }, 60000);

  it("manual override, closed ball valve and double-solenoid memory", async () => {
    const e = await boot();
    await runFor(e, 200);
    // manual override on the valve extends the cylinder without the PLC
    e.setInput("YV1", { pressed: true });
    await runFor(e, 900);
    expect(e.snapshot()!.live.CYL1.pos).toBe(1);
    e.setInput("YV1", { pressed: false });
    await runFor(e, 900);
    expect(e.snapshot()!.live.CYL1.pos).toBe(0);
    // no air: nothing moves even with the valve shifted
    e.setInput("AIR", { off: true });
    e.setInput("YV1", { pressed: true });
    await runFor(e, 900);
    expect(e.snapshot()!.live.CYL1.pos).toBe(0);
    expect(e.snapshot()!.live.AIR.reading).toBeLessThan(0.1);
    // a slower flow-control setting takes longer
    e.setInput("AIR", { off: false });
    e.setInput("CYL1", { speed: 50 });
    await runFor(e, 1000);
    const p = e.snapshot()!.live.CYL1.pos!;
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
    await e.stop();
  }, 30000);
});
