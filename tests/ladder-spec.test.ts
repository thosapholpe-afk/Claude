import { describe, expect, it } from "vitest";
import { evalRung, LadderMachine, ladderAscii, ladderFromSpec, ladderToSpec, startStopProgram } from "../src/core/plc";

describe("ladder text form", () => {
  it("builds the seal-in rung exactly like the starter program", () => {
    const p = ladderFromSpec([{ rows: [{ contacts: ["X0", "X1", "X2"], output: "Y0" }, { contacts: ["Y0"] }], branches: [[0, 1]] }]);
    const ref = startStopProgram().rungs[0];
    expect(p.rungs[0].cells).toEqual(ref.cells);
    expect(p.rungs[0].links).toEqual(ref.links);
    expect(p.rungs[0].outs).toEqual(ref.outs);
  });

  it("parses every contact and output form", () => {
    const p = ladderFromSpec([
      { rows: [{ contacts: ["NC X1", "/X2", "P X3", "N X4", "-", "M5"], output: "SET M0" }] },
      { rows: [{ contacts: ["X0"], output: "TON T0 2.5s" }] },
      { rows: [{ contacts: ["X1"], output: "CTU C0 3" }] },
      { rows: [{ contacts: ["X2"], output: "RST C0" }] },
      { rows: [{ contacts: ["X2"], output: "RST Y1" }] },
    ]);
    expect(p.rungs[0].cells[0].map((c) => c && c.t)).toEqual(["nc", "nc", "rise", "fall", "wire", "no"]);
    expect(p.rungs[1].outs[0]).toEqual({ t: "ton", a: "T0", pre: 2.5 });
    expect(p.rungs[2].outs[0]).toEqual({ t: "ctu", a: "C0", pre: 3 });
    expect(p.rungs[3].outs[0]).toEqual({ t: "rst", a: "C0" });
    expect(p.rungs[4].outs[0]).toEqual({ t: "reset", a: "Y1" });
  });

  it("rejects bad addresses, missing presets and rungs without outputs", () => {
    expect(() => ladderFromSpec([{ rows: [{ contacts: ["X9"], output: "Y0" }] }])).toThrow(/not a contact/);
    expect(() => ladderFromSpec([{ rows: [{ contacts: ["X0"], output: "TON T0" }] }])).toThrow(/preset/);
    expect(() => ladderFromSpec([{ rows: [{ contacts: ["X0"], output: "OUT T0" }] }])).toThrow(/TON/);
    expect(() => ladderFromSpec([{ rows: [{ contacts: ["X0"] }] }])).toThrow(/no output/);
    expect(() => ladderFromSpec([{ rows: [{ contacts: ["X0", "X1", "X2", "X3", "X4", "X5", "X6"], output: "Y0" }] }])).toThrow(/at most 6/);
  });

  it("parallel outputs and mid-rung branches conduct correctly", () => {
    // X0 drives Y0 and Y1; (X1 AND (X2 OR X3)) drives Y2
    const p = ladderFromSpec([
      { rows: [{ contacts: ["X0"], output: "Y0" }, { start: 6, output: "Y1" }], branches: [[0, 6]] },
      { rows: [{ contacts: ["X1", "X2"], output: "Y2" }, { start: 1, contacts: ["X3"] }], branches: [[0, 1], [0, 2]] },
    ]);
    const m = new LadderMachine(p);
    m.scan({ X0: true }, 10);
    expect([m.bit("Y0"), m.bit("Y1")]).toEqual([true, true]);
    m.scan({ X0: false, X1: true, X3: true }, 10);
    expect([m.bit("Y0"), m.bit("Y1"), m.bit("Y2")]).toEqual([false, false, true]);
    m.scan({ X1: false, X3: true }, 10);
    expect(m.bit("Y2")).toBe(false);
    // X3 alone (without X1) must not reach Y2 through the empty first cell
    const r = evalRung(p.rungs[1], (c) => c.a === "X3");
    expect(r.outs[0]).toBe(false);
  });

  it("round-trips through the text form and draws ASCII", () => {
    const prog = startStopProgram();
    const spec = ladderToSpec(prog);
    expect(spec.rungs[0].rows[0]).toEqual({ contacts: ["X0", "X1", "X2"], output: "OUT Y0" });
    expect(spec.rungs[0].branches).toEqual([[0, 1]]);
    const back = ladderFromSpec(spec.rungs, spec.symbols);
    expect(back.rungs.map((r) => [r.cells, r.links, r.outs])).toEqual(prog.rungs.map((r) => [r.cells, r.links, r.outs]));
    const art = ladderAscii(prog);
    expect(art).toContain("-[X0  ]-");
    expect(art).toContain("( OUT Y0 )");
    expect(art.split("\n")[2].startsWith("|--[Y0  ]-+")).toBe(true);
  });
});
