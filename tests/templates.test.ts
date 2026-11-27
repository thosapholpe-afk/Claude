import { describe, expect, it } from "vitest";
import { BOARDS } from "../src/core/boards";
import { SimEngine } from "../src/core/sim";
import { instantiateTemplate, TEMPLATES, templateSupports } from "../src/core/templates";
import { defaultScenarioState } from "../src/core/env";

async function runFor(e: SimEngine, ms: number) {
  for (let t = 0; t < ms; t += 20) {
    await new Promise((r) => setTimeout(r, 0));
    await e.frame(20);
  }
}

const cases: [string, string, string][] = [];
for (const t of TEMPLATES)
  for (const b of BOARDS) {
    if (!templateSupports(t, b.id)) continue;
    for (const lang of b.languages) if (t.code[lang]) cases.push([t.id, b.id, lang]);
  }

describe("templates compile and run on every supported board", () => {
  it.each(cases)("%s on %s (%s)", async (tid, bid, lang) => {
    const t = TEMPLATES.find((x) => x.id === tid)!;
    const inst = instantiateTemplate(t, bid, lang as never);
    expect(inst.log).toEqual([]);
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit(bid, inst.parts, inst.wires);
    e.setEnvironment(t.scenario ? inst.scenario : defaultScenarioState("lab"), {});
    const lines: { text: string; kind: string }[] = [];
    e.onSerial((ls) => lines.push(...ls));
    await e.start(lang as never, inst.code[lang as never]!);
    await runFor(e, 2500);
    const errs = lines.filter((l) => l.kind === "err" || (l.kind === "sys" && l.text.startsWith("⚠")));
    expect(errs.map((l) => l.text)).toEqual([]);
    const diag = e.snapshot()!.diags.filter((d) => d.level === "error");
    expect(diag.map((d) => d.msg)).toEqual([]);
    await e.stop();
  }, 20000);
});
