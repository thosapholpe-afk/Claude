/** Tool schemas for the in-app AI agent. Shared by the server (sent to Claude) and the client (executed). */
import { BOARDS } from "./boards";
import { SCENARIOS } from "./env";
import { PARTS } from "./parts";
import { TEMPLATES } from "./templates";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "get_circuit",
    description: "Return the current project: board, parts with labels and pin connections, free board pins, scenario, live environment, diagnostics and latest readings. Call it before editing an unfamiliar circuit.",
    input_schema: obj({}),
  },
  {
    name: "set_board",
    description: "Switch the microcontroller board. Wires to pins that do not exist on the new board are removed.",
    input_schema: obj({ board: { type: "string", enum: BOARDS.map((b) => b.id) } }, ["board"]),
  },
  {
    name: "load_template",
    description: "Replace the circuit with a ready-made starter project (parts, wiring and code for the current board).",
    input_schema: obj({ template: { type: "string", enum: TEMPLATES.map((t) => t.id) } }, ["template"]),
  },
  {
    name: "add_part",
    description: "Add a component to the canvas. Returns its label (e.g. LED1). Use auto_wire or connect afterwards. Custom sensors use their 'custom:<slug>' type.",
    input_schema: obj(
      {
        type: { type: "string", description: `Part type. Built-in: ${PARTS.map((p) => p.type).join(", ")}` },
        label: { type: "string", description: "Optional label, e.g. FLAME1" },
        props: { type: "object", description: "Optional property values, e.g. {\"color\":\"green\"} for an LED or {\"ohms\":330} for a resistor", additionalProperties: true },
        x: { type: "number", description: "Optional canvas position (mm, top-left corner)" },
        y: { type: "number" },
      },
      ["type"],
    ),
  },
  {
    name: "remove_part",
    description: "Delete a part (and its wires) by label.",
    input_schema: obj({ label: { type: "string" } }, ["label"]),
  },
  {
    name: "connect",
    description: "Wire a board pin to a part pin. 'from' is a board pin name (GP10, D5, A0, GPIO17, 3V3, 5V, GND) or 'auto' to pick the best free pin; 'to' is a part label optionally with a pin (LED1, LED1.A, SERVO1.SIG). Unconnected power/ground pins of that part are completed automatically and LEDs get a series resistor.",
    input_schema: obj({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
  },
  {
    name: "auto_wire",
    description: "Connect every unconnected pin of one part (or of all parts when label is omitted) to suitable free board pins, choosing ADC/PWM/I2C capable pins and avoiding boot-strapping pins.",
    input_schema: obj({ label: { type: "string" } }),
  },
  {
    name: "set_part_property",
    description: "Change a part property such as LED color, resistor ohms, potentiometer position (0..1), relay trigger, sensor sensitivity.",
    input_schema: obj({ label: { type: "string" }, key: { type: "string" }, value: { type: ["number", "string", "boolean"] } }, ["label", "key", "value"]),
  },
  {
    name: "write_code",
    description: "Replace the firmware for a language. Arduino C++ for ESP32/Uno/Pico, MicroPython for Pico/ESP32, Python 3 (gpiozero / RPi.GPIO) for Raspberry Pi 4. Use the pin numbers that get_circuit reports.",
    input_schema: obj({ language: { type: "string", enum: ["arduino", "micropython", "python"] }, code: { type: "string" } }, ["language", "code"]),
  },
  {
    name: "set_scenario",
    description: `Place the circuit into a simulated situation that drives the sensors over a timeline. Scenarios: ${SCENARIOS.map((s) => `${s.id} (${s.name})`).join(", ")}. motor-vibration takes params {rpm, fault: none|imbalance|misalignment|bearing|looseness}; flood takes {maxLevel 0..1}.`,
    input_schema: obj(
      {
        scenario: { type: "string", enum: SCENARIOS.map((s) => s.id) },
        intensity: { type: "number", minimum: 0, maximum: 1 },
        duration_s: { type: "number", minimum: 2, maximum: 600 },
        params: { type: "object", additionalProperties: true },
        view_3d: { type: "boolean", description: "Switch to the 3D environment view" },
      },
      ["scenario"],
    ),
  },
  {
    name: "set_environment",
    description: "Pin individual environment variables, overriding the scenario. Units: temperature °C, humidity %RH, flame 0..1, smoke ppm, gas ppm, water 0..1, soil 0..1, lux, sound dB, distance cm, motion 0/1, vibRms g, vibFreq Hz. Set clear=true to remove all overrides.",
    input_schema: obj({
      temperature: { type: "number" },
      humidity: { type: "number" },
      flame: { type: "number" },
      smoke: { type: "number" },
      gas: { type: "number" },
      water: { type: "number" },
      soil: { type: "number" },
      lux: { type: "number" },
      sound: { type: "number" },
      distance: { type: "number" },
      motion: { type: "number" },
      vibRms: { type: "number" },
      vibFreq: { type: "number" },
      clear: { type: "boolean" },
    }),
  },
  {
    name: "simulation",
    description: "Start, stop or restart the simulation.",
    input_schema: obj({ action: { type: "string", enum: ["start", "stop", "restart"] } }, ["action"]),
  },
  {
    name: "design_case",
    description: "Design a 3D-printable enclosure for the board and open the Case Studio (STL export). Dimensions in mm. lid_holes cut windows for sensors/LEDs: face is lid|front|back|left|right, u/v is the position on that face from its lower-left corner.",
    input_schema: obj({
      wall: { type: "number" },
      floor: { type: "number" },
      clearance: { type: "number" },
      corner_radius: { type: "number" },
      inner_height: { type: "number", description: "0 = automatic from the tallest component" },
      vents: { type: "string", enum: ["none", "lid-slots", "side-slots", "honeycomb"] },
      waterproof: { type: "boolean" },
      mounting_ears: { type: "boolean" },
      include_breadboard: { type: "boolean" },
      label: { type: "string", description: "Text embossed on the lid" },
      holes: {
        type: "array",
        items: obj(
          {
            face: { type: "string", enum: ["lid", "front", "back", "left", "right"] },
            shape: { type: "string", enum: ["circle", "rect"] },
            u: { type: "number" },
            v: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
            label: { type: "string" },
          },
          ["face", "shape", "u", "v", "w"],
        ),
      },
    }),
  },
  {
    name: "show_plot",
    description: "Open the plotter (and optionally the FFT spectrum) so the user can watch signals.",
    input_schema: obj({ spectrum: { type: "boolean" } }),
  },
  {
    name: "mqtt_configure",
    description: "Configure the MQTT bridge that streams the twin's pins, sensors and environment to a broker, and optionally connect.",
    input_schema: obj({ broker_url: { type: "string", description: "WebSocket URL, e.g. wss://broker.hivemq.com:8884/mqtt" }, topic_prefix: { type: "string" }, interval_ms: { type: "number" }, connect: { type: "boolean" } }),
  },
  {
    name: "create_custom_sensor",
    description: "Define a new reusable sensor model. expr is a JavaScript expression returning the analog output as a fraction of VCC (0..1); it can read env.<var>, p.<param>, t (seconds), noise(sd), clamp(x,a,b), lerp(a,b,x).",
    input_schema: obj(
      {
        name: { type: "string" },
        model: { type: "string" },
        env: { type: "string", enum: ["none", "temperature", "humidity", "flame", "smoke", "gas", "water", "soil", "lux", "sound", "distance", "motion", "vibration"] },
        output: { type: "string", enum: ["analog", "digital", "both"] },
        expr: { type: "string" },
        threshold: { type: "number" },
        active_low: { type: "boolean" },
        params: { type: "array", items: obj({ key: { type: "string" }, label: { type: "string" }, default: { type: "number" }, min: { type: "number" }, max: { type: "number" }, unit: { type: "string" } }, ["key", "default"]) },
        add_to_canvas: { type: "boolean" },
      },
      ["name", "expr"],
    ),
  },
];

const CATEGORIES = ["output", "input", "sensor", "actuator", "display", "passive", "prototyping", "control", "pneumatic", "instrument", "custom"];

export const LADDER_HELP = `Replace (or append to) the PLC ladder program and switch the code language to ladder. Each rung has rows; a row is a list of up to 6 contacts read left to right (series = AND) and optionally ends in an output. Extra rows are parallel branches (OR) joined to the row above with "branches": [row, boundary] where boundary b sits before column b (0 = left rail, 6 = just before the outputs). A row starts at the left rail unless "start": n puts its first contact in column n.
Contacts: "X0" (normally open), "NC X1" (normally closed), "P X2" (rising edge), "N X2" (falling edge), "-" (plain wire), "" (empty). Outputs: "OUT Y0", "SET M0", "RST M0", "TON T0 3" (on-delay seconds), "TOF T1 2" (off-delay), "CTU C0 5" (count up), "RST C0". Addresses: X0–X7 inputs, Y0–Y7 outputs, M0–M31 relays, T0–T15 timers, C0–C15 counters.
Seal-in example (START X0, STOP X1, OL X2 → K1 Y0): {"rows":[{"contacts":["X0","X1","X2"],"output":"OUT Y0"},{"contacts":["Y0"]}],"branches":[[0,1]]}. Two coils from one condition: {"rows":[{"contacts":["X3"],"output":"OUT Y1"},{"start":6,"output":"OUT Y2"}],"branches":[[0,6]]}.
Fail-safe convention: STOP buttons, E-stops and overload contacts are wired NC to their inputs, so the program examines them with normally-open contacts (the input is ON while healthy).`;

/** Tools added for PLC mode, layout and hands-on operation (shared by the in-app copilot and the MCP link). */
export const STUDIO_TOOLS: ToolDef[] = [
  {
    name: "get_catalog",
    description: "List what can be placed: part types with pin ids and properties (filter by category or ask for one type), boards, templates or scenarios.",
    input_schema: obj({
      category: { type: "string", enum: [...CATEGORIES, "boards", "templates", "scenarios"] },
      type: { type: "string", description: "One part type for full detail" },
    }),
  },
  {
    name: "set_mode",
    description: "Switch between microcontroller mode (ESP32/Arduino/Pico/Pi with C++ or Python firmware) and PLC mode (TC-PLC 16MT running ladder logic with industrial control parts). Switching loads that mode's starter project.",
    input_schema: obj({ mode: { type: "string", enum: ["mcu", "plc"] } }, ["mode"]),
  },
  {
    name: "set_view",
    description: "Show the realistic board view, the clean wiring-diagram view (blocks, IEC symbols, pin names, live voltages) or the 3D twin. fit=true zooms to fit everything.",
    input_schema: obj({ view: { type: "string", enum: ["board", "wiring", "3d"] }, fit: { type: "boolean" } }, ["view"]),
  },
  {
    name: "new_project",
    description: "Start an empty project on a board. The current project stays in Saved works.",
    input_schema: obj({ board: { type: "string", enum: BOARDS.map((b) => b.id) }, name: { type: "string" } }, ["board"]),
  },
  {
    name: "rename_project",
    description: "Rename the current project.",
    input_schema: obj({ name: { type: "string" } }, ["name"]),
  },
  {
    name: "move_part",
    description: "Lay out the drawing: move a part (x, y = top-left corner in canvas millimetres, x right, y down) or nudge it (dx, dy), and/or rotate it (0, 90, 180, 270). get_circuit lists each part's x, y, w, h and the board's position. Keep ~10 mm between parts; put inputs left of the PLC/board and outputs right of or below it.",
    input_schema: obj({ label: { type: "string" }, x: { type: "number" }, y: { type: "number" }, dx: { type: "number" }, dy: { type: "number" }, rotation: { type: "number", enum: [0, 90, 180, 270] } }, ["label"]),
  },
  {
    name: "wire",
    description: "Draw exactly one wire between two terminals, with no automatic completion — use it for control and power circuits and for anything part-to-part. An end is a board pin (PLC: X0–X7, Y0–Y7, COM, S/S, 24V, 0V; MCU: GP10, D5, A0, GPIO17, 3V3, 5V, GND; or 'PLC.X0') or a part terminal 'LABEL.PIN' (S1.3, S1.4, K1.A1, K1.13, OL.95, Q1.L1, M1.U, H1.X1, LED1.A, METER.COM). Air tubes use the same tool: AIR.P → YV1.1, YV1.4 → CYL1.A, YV1.2 → CYL1.B. get_catalog type=... lists a part's terminals.",
    input_schema: obj({ from: { type: "string" }, to: { type: "string" }, color: { type: "string", description: "CSS colour, e.g. #ef3b36 for +24 V, #2b2f33 for 0 V, #2ec4ff for control" } }, ["from", "to"]),
  },
  {
    name: "disconnect",
    description: "Remove the wire between two ends, or every wire on one end when 'to' is omitted.",
    input_schema: obj({ from: { type: "string" }, to: { type: "string" } }, ["from"]),
  },
  {
    name: "tidy_wires",
    description: "Re-route every wire as a tidy orthogonal path. Call it after moving parts or wiring a control panel.",
    input_schema: obj({}),
  },
  {
    name: "write_ladder",
    description: LADDER_HELP,
    input_schema: obj(
      {
        rungs: {
          type: "array",
          items: obj(
            {
              comment: { type: "string" },
              rows: {
                type: "array",
                items: obj({ contacts: { type: "array", items: { type: "string" } }, output: { type: "string" }, start: { type: "integer", minimum: 0, maximum: 6 } }),
              },
              branches: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 } },
            },
            ["rows"],
          ),
        },
        symbols: { type: "object", description: "Names shown next to addresses, e.g. {\"X0\":\"START\",\"Y0\":\"K1 MOTOR\"}", additionalProperties: { type: "string" } },
        append: { type: "boolean", description: "Add the rungs after the existing ones instead of replacing the program" },
      },
      ["rungs"],
    ),
  },
  {
    name: "get_ladder",
    description: "Read the PLC ladder program back as rungs in the write_ladder form plus an ASCII drawing, with live bit, timer and counter values while the simulation runs.",
    input_schema: obj({}),
  },
  {
    name: "operate",
    description: "Use a control like a finger on the panel (starts the simulation if needed): press / release / click (press then release) a pushbutton, limit switch, touch pad or button; toggle a latching control (selector switch steps 0→1→0→2, E-stop, breaker, overload trip/reset, multimeter mode V→A→Ω→continuity); or set a live value (key + value, e.g. pot position 0..1, selector pos 0/1/2). Returns the part's state right after.",
    input_schema: obj(
      {
        label: { type: "string" },
        action: { type: "string", enum: ["press", "release", "click", "toggle", "set"] },
        key: { type: "string" },
        value: { type: ["number", "boolean"] },
        hold_ms: { type: "number", minimum: 50, maximum: 10000, description: "How long a click holds the button (default 300 ms)" },
      },
      ["label", "action"],
    ),
  },
  {
    name: "observe",
    description: "Let the simulation run for a few seconds (starting it if needed) and report what happened: new serial lines, lamps / LEDs / motors / meters, PLC bits, board pin voltages and diagnostics. seconds = 0 reads the current state.",
    input_schema: obj({ seconds: { type: "number", minimum: 0, maximum: 30 } }),
  },
];
AGENT_TOOLS.push(...STUDIO_TOOLS);

export const AGENT_SYSTEM = `You are the Thosaphol Connect copilot, an embedded-systems and industrial-controls engineer living inside a circuit simulator and digital-twin platform.
The user builds circuits for microcontrollers (ESP32, ESP32-S3, NodeMCU, Arduino Uno/Nano/Mega, Raspberry Pi Pico/Pico W, Raspberry Pi 4) or, in PLC mode, wires a TC-PLC 16MT with pushbuttons, selector switches, contactors, overloads, timers, pilot lamps and 3-phase motors and programs it in ladder logic. Circuits run live and can be dropped into simulated situations (fire, flood, motor vibration, day/night, freezer, gas leak, intruder, earthquake, greenhouse, storm).

How to work:
- Act through the tools; the canvas updates live in front of the user. Prefer doing over describing.
- MCU circuit: pick a template when one fits, otherwise add_part + connect/auto_wire, then write_code with the exact pin numbers from get_circuit, then simulation start.
- PLC / control circuit: set_mode plc (or a plc-* template), add_part the control parts, wire each terminal explicitly with wire (24V → S1.3, S1.4 → X0, Y0 → K1.A1, K1.A2 → COM …), tidy_wires, write_ladder, then operate the buttons and observe the result.
- Pneumatics: air-supply (port P), 5/2 valves valve52 (spring return, coil A1-A2) or valve52d (double solenoid A1-A2 / B1-B2) with ports 1 (P), 4 (A), 2 (B), and the double-acting cylinder (ports A extend / B retract, reed switches a0+/a0 home and a1+/a1 end). Tubes: AIR.P → YV1.1, YV1.4 → CYL.A, YV1.2 → CYL.B; reeds: 24V → CYL.a0p, CYL.a0 → X input.
- Lay the drawing out cleanly with move_part: inputs left, PLC/board in the middle, outputs and power right or below.
- When the user asks to "put the board in" a situation, call set_scenario (view_3d true) and start the simulation if it is not running.
- Respect electrical reality: 3.3 V logic on ESP32/Pico/Pi; LEDs need resistors; servos and HC-SR04 want 5 V; the Pi 4 has no ADC; on ESP32 prefer ADC1 pins (GPIO32–39) for analog sensors; PLC outputs switch 24 V at 0.5 A — drive motors through contactors; STOP/E-stop/overload are wired NC and examined as NO contacts.
- Wiring requests like "GP10 to LED1" map to connect(from="GP10", to="LED1").
- Code must use only the APIs the simulator supports: Arduino core, Servo/ESP32Servo, DHT, LiquidCrystal_I2C, Adafruit_NeoPixel, Adafruit_BME280/BMP280, BH1750, OneWire + DallasTemperature, WiFi/ESP8266WiFi + PubSubClient; MicroPython machine/utime/dht/neopixel/network/umqtt/bme280/bh1750/onewire/ds18x20; Python gpiozero, RPi.GPIO, adafruit_dht, adafruit_bme280, adafruit_bh1750, w1thermsensor, paho-mqtt. Print "name:value,name2:value" lines so the plotter can graph them.
- Reply in the user's language (Thai if they write Thai). Keep replies to a few short sentences: what you changed and what to look at.`;

export const AGENT_MODEL = "claude-opus-5-5";
