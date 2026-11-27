import { describe, expect, it } from "vitest";
import { defaultScenarioState } from "../src/core/env";
import { evalRung, LadderMachine, NC, NO, rung, startStopProgram } from "../src/core/plc";
import { SimEngine } from "../src/core/sim";
import { instantiateTemplate, TEMPLATES } from "../src/core/templates";

async function runFor(e: SimEngine, ms: number) {
  for (let t = 0; t < ms; t += 20) {
    await new Promise((r) => setTimeout(r, 0));
    await e.frame(20);
  }
}

describe("ladder logic", () => {
  it("evaluates a seal-in rung with a parallel branch", () => {
    const r = rung([{ cells: [NO("X0"), NO("X1")], out: { t: "coil", a: "Y0" } }, { cells: [NO("Y0")] }], [[0, 1]]);
    const bits: Record<string, boolean> = { X0: false, X1: true, Y0: true };
    const res = evalRung(r, (c) => (c.t === "no" ? !!bits[c.a] : !bits[c.a]));
    expect(res.outs[0]).toBe(true);
    bits.X1 = false;
    expect(evalRung(r, (c) => (c.t === "no" ? !!bits[c.a] : !bits[c.a])).outs[0]).toBe(false);
  });

  it("runs timers, counters and set/reset", () => {
    const m = new LadderMachine({
      kind: "ladder",
      symbols: {},
      rungs: [
        rung([{ cells: [NO("X0")], out: { t: "ton", a: "T0", pre: 1 } }]),
        rung([{ cells: [{ t: "rise", a: "X1" }], out: { t: "ctu", a: "C0", pre: 3 } }]),
        rung([{ cells: [NO("C0")], out: { t: "set", a: "M0" } }]),
        rung([{ cells: [NC("X2")], out: { t: "coil", a: "Y1" } }]),
      ],
    });
    for (let i = 0; i < 50; i++) m.scan({ X0: true, X1: false, X2: false }, 10);
    expect(m.bit("T0")).toBe(false);
    for (let i = 0; i < 60; i++) m.scan({ X0: true, X1: false, X2: false }, 10);
    expect(m.bit("T0")).toBe(true);
    for (let k = 0; k < 3; k++) {
      m.scan({ X0: true, X1: true }, 10);
      m.scan({ X0: true, X1: false }, 10);
    }
    expect(m.acc.C0).toBe(3);
    expect(m.bit("M0")).toBe(true);
    expect(m.bit("Y1")).toBe(true);
  });

  it("starts and stops a 3-phase motor through the PLC, contactor and overload", async () => {
    const t = TEMPLATES.find((x) => x.id === "plc-start-stop")!;
    const inst = instantiateTemplate(t, "plc-fx16", "ladder");
    expect(inst.log).toEqual([]);
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("plc-fx16", inst.parts, inst.wires);
    e.setEnvironment(defaultScenarioState("lab"), {});
    await e.start("ladder", inst.code.ladder!);
    await runFor(e, 300);
    let snap = e.snapshot()!;
    expect(snap.live.K1.on).toBe(false);
    expect(snap.live.H2.on).toBe(true);
    e.setInput("S1", { pressed: true });
    await runFor(e, 200);
    e.setInput("S1", { pressed: false });
    await runFor(e, 2500);
    snap = e.snapshot()!;
    expect(snap.plc?.bits.Y0).toBe(true);
    expect(snap.live.K1.on).toBe(true);
    expect(snap.live.H1.on).toBe(true);
    expect(snap.live.M1.on).toBe(true);
    expect(Number(snap.live.M1.reading)).toBeGreaterThan(1000);
    expect(snap.diags.filter((d) => d.level === "error")).toEqual([]);
    e.setInput("S2", { pressed: true });
    await runFor(e, 200);
    snap = e.snapshot()!;
    expect(snap.live.K1.on).toBe(false);
    expect(snap.live.M1.on).toBe(false);
    await e.stop();
  }, 30000);

  it("reverses the motor with the second contactor and runs hard-wired relay logic", async () => {
    const fr = instantiateTemplate(TEMPLATES.find((x) => x.id === "plc-fwd-rev")!, "plc-fx16", "ladder");
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("plc-fx16", fr.parts, fr.wires);
    e.setEnvironment(defaultScenarioState("lab"), {});
    await e.start("ladder", fr.code.ladder!);
    e.setInput("S2", { pressed: true });
    await runFor(e, 200);
    e.setInput("S2", { pressed: false });
    await runFor(e, 3000);
    expect(e.snapshot()!.live.K2.on).toBe(true);
    expect(e.snapshot()!.live.K1.on).toBe(false);
    expect(Number(e.snapshot()!.live.M1.speed)).toBeLessThan(-0.5);
    await e.stop();

    const hw = instantiateTemplate(TEMPLATES.find((x) => x.id === "relay-start-stop")!, "plc-fx16", "ladder");
    const e2 = new SimEngine();
    e2.autoFrames = false;
    e2.setCircuit("plc-fx16", hw.parts, hw.wires);
    e2.setEnvironment(defaultScenarioState("lab"), {});
    await e2.start("ladder", hw.code.ladder!);
    e2.setInput("S1", { pressed: true });
    await runFor(e2, 200);
    e2.setInput("S1", { pressed: false });
    await runFor(e2, 300);
    expect(e2.snapshot()!.live.K1.on).toBe(true);
    expect(e2.snapshot()!.live.H1.on).toBe(true);
    e2.setInput("OL", { tripped: true });
    await runFor(e2, 200);
    expect(e2.snapshot()!.live.K1.on).toBe(false);
    expect(e2.snapshot()!.live.H2.on).toBe(true);
    await e2.stop();
  }, 30000);

  it("keeps the default program valid", () => {
    expect(startStopProgram().rungs.length).toBe(3);
  });
});
