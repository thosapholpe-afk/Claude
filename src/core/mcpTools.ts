/**
 * The tools Thosaphol Connect offers over MCP. They are the in-app copilot's tools
 * plus a screenshot; every call is carried to the user's open browser tab and runs there,
 * so the user watches Claude build the circuit live.
 */
import { AGENT_TOOLS, type ToolDef } from "./agentTools";

export const SCREENSHOT_TOOL: ToolDef = {
  name: "screenshot",
  description: "Take a picture of the canvas so you can check the drawing: the realistic board view, the wiring-diagram view or the 3D twin. fit (default true) zooms to show every part first. Text is drawn in a fallback font.",
  input_schema: {
    type: "object",
    properties: { view: { type: "string", enum: ["board", "wiring", "3d"] }, fit: { type: "boolean" } },
    required: [],
    additionalProperties: false,
  },
};

const READ_ONLY = new Set(["get_circuit", "get_catalog", "get_ladder", "screenshot"]);
/** Tools that replace or delete the user's work (the old project stays in Saved works or undo). */
const DESTRUCTIVE = new Set(["load_template", "set_mode", "new_project", "set_board", "remove_part", "disconnect"]);

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

const titleOf = (name: string) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const MCP_TOOLS: McpTool[] = [...AGENT_TOOLS, SCREENSHOT_TOOL].map((t) => ({
  name: t.name,
  title: titleOf(t.name),
  description: t.description,
  inputSchema: t.input_schema,
  annotations: {
    title: titleOf(t.name),
    readOnlyHint: READ_ONLY.has(t.name),
    destructiveHint: DESTRUCTIVE.has(t.name),
    idempotentHint: READ_ONLY.has(t.name) || ["set_view", "set_mode", "rename_project", "move_part", "tidy_wires"].includes(t.name),
    openWorldHint: false,
  },
}));

/** Per-call time budget on the server (ms). */
export function toolTimeout(name: string, input: Record<string, unknown>) {
  if (name === "observe") return Math.min(30, Number(input.seconds ?? 2)) * 1000 + 25_000;
  if (name === "operate") return Math.min(10_000, Number(input.hold_ms ?? 300)) + 25_000;
  return 30_000;
}

export const MCP_INSTRUCTIONS = `Thosaphol Connect is a circuit simulator and digital twin. These tools drive the user's open Thosaphol Connect browser tab: every change appears live on their canvas, so build step by step.

Workflow:
1. get_circuit first to see the board, parts, wiring and layout. get_catalog lists part types, their terminals and properties.
2. Microcontroller circuits (ESP32, Arduino, Pico, Raspberry Pi): add_part, then connect / auto_wire (board pin → part; power, ground and LED resistors are completed for you), then write_code in Arduino C++, MicroPython or Python, then simulation start.
3. PLC and electrical control circuits: set_mode plc (or new_project board=plc-fx16, or a plc-* template), add_part the control parts (pb-no, pb-nc, estop, selector2, selector3, limit-switch, pilot-lamp, contactor, overload, timer-relay, psu24, supply3, mcb3, motor3, multimeter; pneumatics: air-supply, valve52, valve52d, cylinder), draw every wire and air tube explicitly with wire (e.g. PLC.24V → S1.3, S1.4 → X0, Y0 → K1.A1, K1.A2 → COM), tidy_wires, then write_ladder. STOP, E-stop and overload contacts are wired NC and examined as NO contacts in the ladder. Pneumatic tubes: AIR.P → YV1.1, YV1.4 → CYL1.A, YV1.2 → CYL1.B; cylinder reed switches: 24V → CYL1.a0p, CYL1.a0 → X input (a0 = home, a1 = end). Template plc-pneumatic is a working 5/2 auto-cycle example.
4. Lay the drawing out with move_part (canvas millimetres, top-left corner): inputs on the left, the PLC or board in the middle, outputs and power on the right or below, about 10 mm apart. Then tidy_wires.
5. Check your work: screenshot (view board or wiring) to see the drawing; operate to press buttons / turn selectors; observe to run the simulation for a few seconds and read lamps, motors, meters, PLC bits, pin voltages, serial output and diagnostics. Fix anything that is wrong.

Care for the user's work: load_template, set_mode and new_project start a fresh project; the previous one stays in the user's Saved works. remove_part and disconnect delete things (undo in the app restores them).
If a tool says the tab is not connected, ask the user to open Thosaphol Connect, open the ⋯ menu → Claude link, and switch it on.
Reply in the user's language (Thai if they write Thai).`;
