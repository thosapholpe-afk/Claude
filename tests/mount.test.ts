import { describe, expect, it } from "vitest";
import { buildTopology, epKey } from "../src/core/circuit";
import { getBoard } from "../src/core/boards";
import { planMount } from "../src/core/mount";
import type { PartInstance } from "../src/core/types";

const boardInst = (id: string): PartInstance => ({ id: "board", type: `board:${id}`, label: id, x: 20.32, y: 30.48, rot: 0, props: {} });

function mounted(boardId: string, kind: "breadboard" | "perfboard") {
  const b = boardInst(boardId);
  const plan = planMount(b, kind);
  expect(plan.ok).toBe(true);
  const host: PartInstance = { id: "H", type: plan.host!.type, label: "H", x: plan.host!.x, y: plan.host!.y, rot: 0, props: plan.host!.props };
  const parts = [host, { ...b, x: plan.board!.x, y: plan.board!.y }];
  return { plan, parts, topo: buildTopology(getBoard(boardId), parts, [], new Map()) };
}

describe("mounting boards", () => {
  it("plugs every ESP32 header pin into a breadboard", () => {
    const { topo, plan } = mounted("esp32-devkit-v1", "breadboard");
    const boardPins = topo.inserted.filter((i) => i.part === "board");
    expect(boardPins.length).toBe(30);
    expect(plan.summary).toMatch(/rows a and i/);
    // the hole two rows away in the same column strip is on the same net as the pin
    const ins = boardPins.find((i) => i.pin === "t2")!;
    const col = ins.hole.slice(1);
    expect(topo.nodeOf.get(epKey("board", "t2"))).toBe(topo.nodeOf.get(epKey("H", `c${col}`)));
  });

  it("straddles the Pico across the channel on rows c and h", () => {
    const { topo, plan } = mounted("rpi-pico", "breadboard");
    expect(topo.inserted.filter((i) => i.part === "board").length).toBe(40);
    expect(plan.summary).toMatch(/rows c and h/);
  });

  it("refuses the Uno and puts a Pi 4 header on a perfboard", () => {
    expect(planMount(boardInst("arduino-uno"), "breadboard").ok).toBe(false);
    expect(planMount(boardInst("rpi-4b"), "breadboard").ok).toBe(false);
    const { topo } = mounted("rpi-4b", "perfboard");
    expect(topo.inserted.filter((i) => i.part === "board").length).toBe(40);
  });

  it("isolates perfboard pads but joins stripboard rows", () => {
    const mk = (kind: string): PartInstance => ({ id: "P", type: "perfboard", label: "P", x: 0, y: 0, rot: 0, props: { cols: 10, rows: 5, kind } });
    const b = getBoard("esp32-devkit-v1");
    const perf = buildTopology(b, [mk("perfboard")], [], new Map());
    expect(perf.nodeOf.get(epKey("P", "X1Y2"))).not.toBe(perf.nodeOf.get(epKey("P", "X9Y2")));
    const strip = buildTopology(b, [mk("stripboard")], [], new Map());
    expect(strip.nodeOf.get(epKey("P", "X1Y2"))).toBe(strip.nodeOf.get(epKey("P", "X9Y2")));
    expect(strip.nodeOf.get(epKey("P", "X1Y2"))).not.toBe(strip.nodeOf.get(epKey("P", "X1Y3")));
  });
});
