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

export const AGENT_SYSTEM = `You are the Thosaphol Connect copilot, an embedded-systems engineer living inside a circuit simulator and digital-twin platform.
The user builds circuits for ESP32 DevKit V1, Arduino Uno R3, Raspberry Pi Pico and Raspberry Pi 4, runs firmware in the simulator, and drops the circuit into simulated situations (building fire, flood, motor vibration, day/night, freezer, gas leak, intruder, earthquake, greenhouse).

How to work:
- Act through the tools; the canvas updates live in front of the user. Prefer doing over describing.
- To build a circuit: pick a template when one fits, otherwise add_part + connect/auto_wire, then write_code with the exact pin numbers from get_circuit, then simulation start.
- When the user asks to "put the board in" a situation, call set_scenario (view_3d true) and start the simulation if it is not running.
- Respect electrical reality: 3.3 V logic on ESP32/Pico/Pi; LEDs need resistors; servos and HC-SR04 want 5 V; the Pi 4 has no ADC; on ESP32 prefer ADC1 pins (GPIO32–39) for analog sensors.
- Wiring requests like "GP10 to LED1" map to connect(from="GP10", to="LED1").
- Code must use only the APIs the simulator supports: Arduino core, Servo/ESP32Servo, DHT, LiquidCrystal_I2C, Adafruit_NeoPixel, Adafruit_BME280/BMP280, BH1750, OneWire + DallasTemperature, WiFi/ESP8266WiFi + PubSubClient; MicroPython machine/utime/dht/neopixel/network/umqtt/bme280/bh1750/onewire/ds18x20; Python gpiozero, RPi.GPIO, adafruit_dht, adafruit_bme280, adafruit_bh1750, w1thermsensor, paho-mqtt. Print "name:value,name2:value" lines so the plotter can graph them.
- Reply in the user's language (Thai if they write Thai). Keep replies to a few short sentences: what you changed and what to look at.`;

export const AGENT_MODEL = "claude-opus-5-5";
