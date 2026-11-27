import type { BoardDef, Cap, CustomSensorDef, EnvKey, PartCategory, PartPin, PinRole, PropSpec } from "./types";
import { type EnvState, vibAccel, vnoise } from "./env";

/** Live visual / measured state a part exposes after each solve. */
export interface PartLive {
  brightness?: number;
  rgb?: [number, number, number];
  angle?: number;
  on?: boolean;
  freq?: number;
  burnt?: boolean;
  text?: string[];
  backlight?: boolean;
  pixels?: number[];
  speed?: number;
  powered?: boolean;
  /** Physical reading for plotting (°C, cm, g, …). */
  reading?: number;
  readingUnit?: string;
  /** Primary output voltage. */
  outV?: number;
  indicator?: boolean;
  warn?: string;
}

/** Context handed to a part while the solver builds the conductance matrix. */
export interface StampCtx {
  n(pin: string): number;
  R(a: number, b: number, ohms: number): void;
  /** Norton source: `volts` between node a and ref through output resistance r. */
  V(a: number, ref: number, volts: number, r: number): void;
  /** Piecewise-linear diode (LED / opto). */
  D(a: number, c: number, vf: number, rs: number, key: string): void;
  /** Voltage of a node from the previous iteration. */
  v(node: number): number;
  supply(vcc: string, gnd: string): number;
  env: EnvState;
  t: number;
  dt: number;
  props: Record<string, number | string | boolean>;
  input: Record<string, number | boolean>;
  mem: Record<string, number>;
  board: BoardDef;
}

export interface PostCtx extends StampCtx {
  /** Current (A) through a diode registered with D(). */
  diodeI(key: string): number;
  /** PWM duty cycle driving a pin's net (1 when driven steadily). */
  duty(pin: string): number;
  /** Signal metadata (servo pulse, tone) of the GPIO driving this pin's net. */
  signal(pin: string): { servoUs?: number; toneHz?: number; level?: number; gpio?: number } | undefined;
  /** Library-level device state written by firmware shims. */
  lib: Record<string, unknown>;
}

export interface PartDef {
  type: string;
  name: string;
  category: PartCategory;
  description: string;
  w: number;
  h: number;
  /** Height above the work surface for the 3D view (mm). */
  h3: number;
  pins: PartPin[];
  props: PropSpec[];
  env?: EnvKey[];
  supplyMin?: number;
  supplyMax?: number;
  prefer5v?: boolean;
  /** Pins that are always shorted internally. */
  ties?: [string, string][];
  /** Pins shorted depending on inputs / state (buttons, relays). */
  switches?: (props: Record<string, unknown>, input: Record<string, unknown>, mem: Record<string, number>) => [string, string][];
  stamp?: (c: StampCtx) => void;
  post?: (c: PostCtx) => PartLive;
  /** Arduino library this part is usually driven with. */
  lib?: string;
  keywords: string[];
  pcb?: string;
  custom?: CustomSensorDef;
  /** Breadboards and perfboards: other parts' pins plug into these holes. */
  host?: boolean;
  /** Size-dependent footprint (breadboard columns, perfboard X × Y). */
  layout?: (props: Record<string, unknown>) => PartLayout;
}

export interface PartLayout {
  w: number;
  h: number;
  pins: PartPin[];
  ties: [string, string][];
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pin = (id: string, label: string, x: number, y: number, role: PinRole, need?: Cap): PartPin => ({ id, label, x, y, role, need });

const LED_VF: Record<string, number> = { red: 1.9, orange: 2.0, yellow: 2.05, green: 2.2, blue: 2.95, white: 3.0 };
export const LED_HEX: Record<string, string> = {
  red: "#ff2a2a",
  orange: "#ff8a1f",
  yellow: "#ffe02a",
  green: "#2aff6a",
  blue: "#2a8bff",
  white: "#f2f6ff",
};

export const BB_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const layoutCache = new Map<string, PartLayout>();
const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Math.round(Number(v ?? d));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

const powered = (c: StampCtx, vcc: string, gnd: string, min: number) => c.supply(vcc, gnd) >= min;

/** Digital output of a sensor module comparator (open-collector with pull-up on the module). */
function digitalOut(c: StampCtx, out: string, gnd: string, high: boolean, vcc: number) {
  c.V(c.n(out), c.n(gnd), high ? vcc : 0, high ? 10_000 : 120);
}

function ledPost(c: PostCtx, key: string, anode: string): { b: number; burnt: boolean; warn?: string } {
  const I = c.diodeI(key);
  const memKey = `${key}_over`;
  if (I > 0.045) c.mem[memKey] = (c.mem[memKey] ?? 0) + c.dt;
  else c.mem[memKey] = Math.max(0, (c.mem[memKey] ?? 0) - c.dt * 0.25);
  if ((c.mem[memKey] ?? 0) > 0.6) c.mem[`${key}_burnt`] = 1;
  const burnt = c.mem[`${key}_burnt`] === 1;
  const b = burnt ? 0 : clamp(I / 0.008, 0, 1.4) * c.duty(anode);
  const warn = I > 0.03 ? `${(I * 1000).toFixed(0)} mA through LED — add a 220 Ω resistor` : undefined;
  return { b, burnt, warn };
}

export const PARTS: PartDef[] = [
  // ------------------------------------------------------------------ outputs
  {
    type: "led",
    name: "LED 5 mm",
    category: "output",
    description: "Through-hole LED. Needs a series resistor (220–330 Ω).",
    w: 5.08,
    h: 12.7,
    h3: 8.6,
    pins: [pin("C", "Cathode (−)", 1.27, 11.43, "cathode"), pin("A", "Anode (+)", 3.81, 11.43, "anode", "digital")],
    props: [
      {
        key: "color",
        label: "Color",
        type: "select",
        default: "red",
        options: Object.keys(LED_VF).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })),
      },
    ],
    keywords: ["led", "light", "blink", "ไฟ", "หลอด"],
    stamp: (c) => c.D(c.n("A"), c.n("C"), LED_VF[String(c.props.color)] ?? 2, 14, "d"),
    post: (c) => {
      const r = ledPost(c, "d", "A");
      return { brightness: r.b, burnt: r.burnt, warn: r.warn, on: r.b > 0.05, reading: Math.round(c.diodeI("d") * 1e4) / 10, readingUnit: "mA" };
    },
  },
  {
    type: "rgb-led",
    name: "RGB LED (common cathode)",
    category: "output",
    description: "Three LEDs in one package sharing the cathode.",
    w: 10.16,
    h: 14,
    h3: 8.6,
    pins: [
      pin("R", "Red", 1.27, 12.7, "anode", "pwm"),
      pin("K", "Common −", 3.81, 12.7, "cathode"),
      pin("G", "Green", 6.35, 12.7, "anode", "pwm"),
      pin("B", "Blue", 8.89, 12.7, "anode", "pwm"),
    ],
    props: [],
    keywords: ["rgb", "color", "สี"],
    stamp: (c) => {
      c.D(c.n("R"), c.n("K"), 1.9, 16, "r");
      c.D(c.n("G"), c.n("K"), 2.9, 16, "g");
      c.D(c.n("B"), c.n("K"), 2.95, 16, "b");
    },
    post: (c) => {
      const r = ledPost(c, "r", "R");
      const g = ledPost(c, "g", "G");
      const b = ledPost(c, "b", "B");
      return { rgb: [r.b, g.b, b.b], brightness: Math.max(r.b, g.b, b.b), burnt: r.burnt && g.burnt && b.burnt, warn: r.warn ?? g.warn ?? b.warn };
    },
  },
  {
    type: "buzzer",
    name: "Buzzer",
    category: "output",
    description: "Active buzzer beeps on DC; passive buzzer plays tone() frequencies.",
    w: 12.7,
    h: 15.2,
    h3: 9.5,
    pins: [pin("P", "+", 3.81, 13.97, "signal", "digital"), pin("N", "−", 8.89, 13.97, "gnd")],
    props: [
      {
        key: "kind",
        label: "Type",
        type: "select",
        default: "active",
        options: [
          { value: "active", label: "Active (DC beep)" },
          { value: "passive", label: "Passive (tone)" },
        ],
      },
    ],
    keywords: ["buzzer", "beep", "alarm", "sound", "เสียง", "บัซเซอร์", "ออด"],
    stamp: (c) => c.R(c.n("P"), c.n("N"), 160),
    post: (c) => {
      const v = c.v(c.n("P")) - c.v(c.n("N"));
      const sig = c.signal("P");
      if (c.props.kind === "passive") {
        const f = sig?.toneHz ?? 0;
        return { on: f > 0 && v > 1, freq: f };
      }
      return { on: v > 2.4, freq: v > 2.4 ? 2300 : 0 };
    },
  },
  {
    type: "servo-sg90",
    name: "Servo SG90",
    category: "actuator",
    description: "9 g micro servo, 0–180°, 1.8 kg·cm. Signal: 50 Hz PWM.",
    w: 38,
    h: 13,
    h3: 22.7,
    pins: [pin("GND", "GND (brown)", 1.27, 3.96, "gnd"), pin("V", "V+ (red)", 1.27, 6.5, "vcc"), pin("SIG", "Signal (orange)", 1.27, 9.04, "pwm-in", "pwm")],
    props: [],
    supplyMin: 4.0,
    supplyMax: 6.0,
    prefer5v: true,
    lib: "Servo.h / ESP32Servo.h",
    keywords: ["servo", "sg90", "เซอร์โว", "motor"],
    stamp: (c) => c.R(c.n("V"), c.n("GND"), 330),
    post: (c) => servoPost(c, 0.1),
  },
  {
    type: "servo-mg996r",
    name: "Servo MG996R",
    category: "actuator",
    description: "Metal-gear standard servo, 11 kg·cm. Needs a solid 5–6 V supply.",
    w: 54,
    h: 21,
    h3: 42.9,
    pins: [pin("GND", "GND (brown)", 1.27, 7.96, "gnd"), pin("V", "V+ (red)", 1.27, 10.5, "vcc"), pin("SIG", "Signal (orange)", 1.27, 13.04, "pwm-in", "pwm")],
    props: [],
    supplyMin: 4.8,
    supplyMax: 7.2,
    prefer5v: true,
    lib: "Servo.h / ESP32Servo.h",
    keywords: ["servo", "mg996r", "mg996", "mgrr", "เซอร์โว", "high torque"],
    stamp: (c) => c.R(c.n("V"), c.n("GND"), 250),
    post: (c) => servoPost(c, 0.17),
  },
  {
    type: "relay",
    name: "Relay module 1-ch",
    category: "actuator",
    description: "5 V relay with opto-isolated input. COM switches between NC and NO.",
    w: 50,
    h: 26,
    h3: 19,
    pins: [
      pin("VCC", "VCC", 1.27, 10.46, "vcc"),
      pin("GND", "GND", 1.27, 13.0, "gnd"),
      pin("IN", "IN", 1.27, 15.54, "digital-in", "digital"),
      pin("NO", "NO", 46.99, 7.92, "passive"),
      pin("COM", "COM", 46.99, 13.0, "passive"),
      pin("NC", "NC", 46.99, 18.08, "passive"),
    ],
    props: [
      {
        key: "trigger",
        label: "Trigger",
        type: "select",
        default: "high",
        options: [
          { value: "high", label: "Active HIGH" },
          { value: "low", label: "Active LOW" },
        ],
      },
    ],
    supplyMin: 4.5,
    prefer5v: true,
    keywords: ["relay", "รีเลย์", "switch", "pump", "ปั๊ม"],
    switches: (_p, _i, mem) => (mem.energized ? [["COM", "NO"]] : [["COM", "NC"]]),
    stamp: (c) => {
      if (c.props.trigger === "low") c.D(c.n("VCC"), c.n("IN"), 1.2, 1000, "opto");
      else c.D(c.n("IN"), c.n("GND"), 1.2, 1000, "opto");
      c.R(c.n("VCC"), c.n("GND"), 70);
    },
    post: (c) => {
      const ok = c.supply("VCC", "GND") > 3.8;
      const on = ok && c.diodeI("opto") > 0.0008;
      if (Boolean(c.mem.energized) !== on) c.mem.clicks = (c.mem.clicks ?? 0) + 1;
      c.mem.energized = on ? 1 : 0;
      return { on, powered: ok, indicator: on };
    },
  },
  {
    type: "dc-motor",
    name: "DC motor / fan",
    category: "actuator",
    description: "Small 3–6 V hobby motor. Drive it through a transistor or relay, not a GPIO.",
    w: 30,
    h: 20,
    h3: 20,
    pins: [pin("P", "+", 1.27, 7.46, "signal", "digital"), pin("N", "−", 1.27, 12.54, "gnd")],
    props: [],
    keywords: ["motor", "fan", "dc", "พัดลม", "มอเตอร์"],
    stamp: (c) => c.R(c.n("P"), c.n("N"), 12),
    post: (c) => {
      const v = c.v(c.n("P")) - c.v(c.n("N"));
      const i = v / 12;
      return { speed: clamp((Math.abs(v) - 0.6) / 4.4, 0, 1.3) * Math.sign(v) * c.duty("P"), warn: i > 0.05 && c.signal("P") ? `Motor pulls ${(i * 1000).toFixed(0)} mA from a GPIO — use a driver` : undefined };
    },
  },
  // ------------------------------------------------------------------ displays
  {
    type: "lcd1602",
    name: "LCD 16×2 (I²C)",
    category: "display",
    description: "HD44780 character LCD with PCF8574 backpack at 0x27.",
    w: 80,
    h: 36,
    h3: 12,
    pins: [pin("GND", "GND", 1.27, 14.19, "gnd"), pin("VCC", "VCC", 1.27, 16.73, "vcc"), pin("SDA", "SDA", 1.27, 19.27, "sda", "sda"), pin("SCL", "SCL", 1.27, 21.81, "scl", "scl")],
    props: [{ key: "address", label: "I²C address", type: "select", default: "0x27", options: [{ value: "0x27", label: "0x27" }, { value: "0x3F", label: "0x3F" }] }],
    supplyMin: 3.0,
    lib: "LiquidCrystal_I2C.h",
    keywords: ["lcd", "display", "จอ", "screen", "1602"],
    stamp: (c) => {
      c.R(c.n("SDA"), c.n("VCC"), 4700);
      c.R(c.n("SCL"), c.n("VCC"), 4700);
      c.R(c.n("VCC"), c.n("GND"), 200);
    },
    post: (c) => {
      const ok = c.supply("VCC", "GND") > 2.9;
      const st = (c.lib.lcd as { lines?: string[]; backlight?: boolean } | undefined) ?? {};
      return { powered: ok, text: ok ? st.lines ?? ["", ""] : ["", ""], backlight: ok && st.backlight !== false };
    },
  },
  {
    type: "neopixel-ring",
    name: "NeoPixel ring (12× WS2812B)",
    category: "display",
    description: "Addressable RGB LEDs on one data line.",
    w: 37,
    h: 42,
    h3: 4,
    pins: [pin("VCC", "5V", 14.69, 40.6, "vcc"), pin("GND", "GND", 17.23, 40.6, "gnd"), pin("DIN", "DIN", 19.77, 40.6, "digital-in", "digital"), pin("DOUT", "DOUT", 22.31, 40.6, "nc")],
    props: [{ key: "count", label: "Pixels", type: "number", default: 12, min: 1, max: 24, step: 1 }],
    supplyMin: 3.5,
    prefer5v: true,
    lib: "Adafruit_NeoPixel.h",
    keywords: ["neopixel", "ws2812", "rgb ring", "ไฟวง"],
    stamp: (c) => c.R(c.n("VCC"), c.n("GND"), 300),
    post: (c) => {
      const ok = c.supply("VCC", "GND") > 3.4;
      const px = (c.lib.pixels as number[] | undefined) ?? [];
      return { powered: ok, pixels: ok ? px : [] };
    },
  },
  // ------------------------------------------------------------------ inputs
  {
    type: "button",
    name: "Push button",
    category: "input",
    description: "6 mm tactile switch. Pins 1a/1b are joined, 2a/2b are joined; pressing connects 1 ↔ 2.",
    w: 7.62,
    h: 7.62,
    h3: 5,
    pins: [pin("1a", "1a", 1.27, 1.27, "signal", "digital"), pin("1b", "1b", 6.35, 1.27, "passive"), pin("2a", "2a", 1.27, 6.35, "gnd"), pin("2b", "2b", 6.35, 6.35, "passive")],
    props: [{ key: "cap", label: "Cap color", type: "select", default: "red", options: ["red", "blue", "green", "yellow", "black"].map((v) => ({ value: v, label: v })) }],
    ties: [
      ["1a", "1b"],
      ["2a", "2b"],
    ],
    switches: (_p, input) => (input.pressed ? [["1a", "2a"]] : []),
    keywords: ["button", "switch", "push", "ปุ่ม", "สวิตช์"],
    post: (c) => ({ on: Boolean(c.input.pressed) }),
  },
  {
    type: "pot",
    name: "Potentiometer 10 kΩ",
    category: "input",
    description: "Rotary knob. Outer pins to 3V3/GND, wiper to an analog pin.",
    w: 10.16,
    h: 11.4,
    h3: 15,
    pins: [pin("1", "VCC", 2.54, 10.16, "vcc"), pin("W", "Wiper", 5.08, 10.16, "analog", "adc"), pin("2", "GND", 7.62, 10.16, "gnd")],
    props: [
      { key: "position", label: "Position", type: "range", default: 0.5, min: 0, max: 1, step: 0.01, live: true },
      { key: "ohms", label: "Resistance", type: "number", default: 10000, min: 1000, max: 100000, step: 1000, unit: "Ω" },
    ],
    keywords: ["pot", "potentiometer", "knob", "ตัวต้านทานปรับค่า", "โพเทนชิโอ"],
    stamp: (c) => {
      const R = Number(c.props.ohms) || 10000;
      const p = clamp(Number(c.input.position ?? c.props.position), 0, 1);
      c.R(c.n("1"), c.n("W"), Math.max(1, R * (1 - p)));
      c.R(c.n("W"), c.n("2"), Math.max(1, R * p));
    },
    post: (c) => ({ reading: Math.round(clamp(Number(c.input.position ?? c.props.position), 0, 1) * 100), readingUnit: "%", outV: c.v(c.n("W")) - c.v(c.n("2")) }),
  },
  // ------------------------------------------------------------------ passives
  {
    type: "resistor",
    name: "Resistor",
    category: "passive",
    description: "Carbon-film resistor.",
    w: 10.16,
    h: 2.54,
    h3: 2.5,
    pins: [pin("1", "1", 1.27, 1.27, "passive"), pin("2", "2", 8.89, 1.27, "passive")],
    props: [{ key: "ohms", label: "Resistance", type: "number", default: 220, min: 1, max: 10_000_000, step: 1, unit: "Ω" }],
    keywords: ["resistor", "ตัวต้านทาน", "r"],
    stamp: (c) => c.R(c.n("1"), c.n("2"), Math.max(0.1, Number(c.props.ohms) || 220)),
    post: (c) => ({ reading: Math.abs(c.v(c.n("1")) - c.v(c.n("2"))) / (Number(c.props.ohms) || 220) * 1000, readingUnit: "mA" }),
  },
  {
    type: "ldr",
    name: "Photoresistor (LDR)",
    category: "sensor",
    description: "GL5528 light-dependent resistor. Use with a 10 kΩ resistor as a divider.",
    w: 5.08,
    h: 10,
    h3: 6,
    pins: [pin("1", "1", 1.27, 8.89, "passive"), pin("2", "2", 3.81, 8.89, "analog", "adc")],
    props: [],
    env: ["lux"],
    keywords: ["ldr", "light", "photo", "แสง", "ความสว่าง"],
    stamp: (c) => {
      const lux = Math.max(0.1, c.env.lux);
      c.R(c.n("1"), c.n("2"), clamp(10_000 * Math.pow(lux / 10, -0.7), 80, 2_000_000));
    },
    post: (c) => ({ reading: Math.round(c.env.lux), readingUnit: "lx" }),
  },
  // ------------------------------------------------------------------ sensors
  {
    type: "lm35",
    name: "LM35 temperature",
    category: "sensor",
    description: "Analog temperature sensor, 10 mV/°C. Supply 4–30 V.",
    w: 7.62,
    h: 10,
    h3: 5,
    pins: [pin("VS", "+Vs", 1.27, 8.89, "vcc"), pin("OUT", "Vout", 3.81, 8.89, "analog", "adc"), pin("GND", "GND", 6.35, 8.89, "gnd")],
    props: [],
    env: ["temperature"],
    supplyMin: 4,
    prefer5v: true,
    keywords: ["lm35", "temperature", "temp", "อุณหภูมิ"],
    stamp: (c) => {
      if (powered(c, "VS", "GND", 3.9)) c.V(c.n("OUT"), c.n("GND"), clamp(c.env.temperature * 0.01, 0, 1.5), 80);
    },
    post: (c) => ({ powered: c.supply("VS", "GND") > 3.9, reading: c.env.temperature, readingUnit: "°C" }),
  },
  {
    type: "dht22",
    name: "DHT22 temp & humidity",
    category: "sensor",
    description: "Digital single-wire sensor (AM2302). Use the DHT library.",
    w: 15.24,
    h: 27,
    h3: 7.7,
    pins: [pin("VCC", "VCC", 3.81, 25.4, "vcc"), pin("DATA", "DATA", 6.35, 25.4, "digital-out", "digital"), pin("NC", "NC", 8.89, 25.4, "nc"), pin("GND", "GND", 11.43, 25.4, "gnd")],
    props: [{ key: "model", label: "Model", type: "select", default: "DHT22", options: [{ value: "DHT22", label: "DHT22 / AM2302" }, { value: "DHT11", label: "DHT11" }] }],
    env: ["temperature", "humidity"],
    supplyMin: 3.0,
    lib: "DHT.h",
    keywords: ["dht", "dht22", "dht11", "humidity", "temperature", "ความชื้น", "อุณหภูมิ"],
    stamp: (c) => c.R(c.n("DATA"), c.n("VCC"), 10_000),
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.9, reading: c.env.temperature, readingUnit: "°C" }),
  },
  {
    type: "hc-sr04",
    name: "Ultrasonic HC-SR04",
    category: "sensor",
    description: "2–400 cm ranging. Pulse TRIG for 10 µs, measure ECHO with pulseIn().",
    w: 45,
    h: 20.5,
    h3: 15,
    pins: [pin("VCC", "VCC", 18.69, 19.2, "vcc"), pin("TRIG", "Trig", 21.23, 19.2, "digital-in", "digital"), pin("ECHO", "Echo", 23.77, 19.2, "digital-out", "digital"), pin("GND", "GND", 26.31, 19.2, "gnd")],
    props: [],
    env: ["distance"],
    supplyMin: 4.5,
    prefer5v: true,
    keywords: ["ultrasonic", "distance", "hc-sr04", "sonar", "ระยะ", "อัลตราโซนิก"],
    stamp: (c) => {
      if (powered(c, "VCC", "GND", 4.3)) c.V(c.n("ECHO"), c.n("GND"), 0, 200);
    },
    post: (c) => {
      const ok = c.supply("VCC", "GND") > 4.3;
      return { powered: ok, reading: c.env.distance, readingUnit: "cm", warn: !ok && c.supply("VCC", "GND") > 2.5 ? "HC-SR04 needs 5 V" : undefined };
    },
  },
  {
    type: "flame",
    name: "Flame sensor (IR)",
    category: "sensor",
    description: "760–1100 nm IR receiver with comparator. DO goes LOW when a flame is seen.",
    w: 32,
    h: 14,
    h3: 8,
    pins: [pin("AO", "A0", 30.73, 3.19, "analog", "adc"), pin("GND", "G", 30.73, 5.73, "gnd"), pin("VCC", "+", 30.73, 8.27, "vcc"), pin("DO", "D0", 30.73, 10.81, "digital-out", "digital")],
    props: [{ key: "sensitivity", label: "Sensitivity (trim pot)", type: "range", default: 0.6, min: 0, max: 1, step: 0.01 }],
    env: ["flame"],
    supplyMin: 3.0,
    keywords: ["flame", "fire", "ไฟ", "เปลวไฟ", "ไฟไหม้"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      const f = clamp(c.env.flame + 0.01 * vnoise(c.t * 30, 7), 0, 1);
      c.V(c.n("AO"), c.n("GND"), s * (0.97 - 0.9 * Math.pow(f, 0.7)), 1000);
      const thr = 1 - Number(c.props.sensitivity ?? 0.6) * 0.95;
      c.mem.det = f > thr ? 1 : 0;
      digitalOut(c, "DO", "GND", !c.mem.det, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, indicator: Boolean(c.mem.det), reading: c.env.flame * 100, readingUnit: "%IR", outV: c.v(c.n("AO")) - c.v(c.n("GND")) }),
  },
  {
    type: "water",
    name: "Water level sensor",
    category: "sensor",
    description: "Exposed parallel traces. Output rises with immersion depth.",
    w: 20,
    h: 62,
    h3: 3,
    pins: [pin("S", "S", 7.46, 60.96, "analog", "adc"), pin("VCC", "+", 10, 60.96, "vcc"), pin("GND", "−", 12.54, 60.96, "gnd")],
    props: [],
    env: ["water"],
    keywords: ["water", "level", "rain", "flood", "น้ำ", "ระดับน้ำ"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.5) return;
      c.V(c.n("S"), c.n("GND"), s * clamp(0.015 + 0.72 * Math.pow(c.env.water, 0.75) + 0.004 * vnoise(c.t * 9, 4), 0, 1), 2000);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.5, reading: c.env.water * 40, readingUnit: "mm", outV: c.v(c.n("S")) - c.v(c.n("GND")) }),
  },
  {
    type: "soil",
    name: "Soil moisture (capacitive v1.2)",
    category: "sensor",
    description: "Corrosion-free capacitive probe. Output falls as soil gets wetter.",
    w: 23,
    h: 80,
    h3: 3,
    pins: [pin("GND", "GND", 8.96, 1.27, "gnd"), pin("VCC", "VCC", 11.5, 1.27, "vcc"), pin("AO", "AOUT", 14.04, 1.27, "analog", "adc")],
    props: [],
    env: ["soil"],
    keywords: ["soil", "moisture", "ดิน", "ความชื้นดิน", "ต้นไม้"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 3) return;
      c.V(c.n("AO"), c.n("GND"), Math.min(s, 3.0) * clamp(0.92 - 0.55 * c.env.soil, 0, 1), 1000);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 3, reading: c.env.soil * 100, readingUnit: "%", outV: c.v(c.n("AO")) - c.v(c.n("GND")) }),
  },
  {
    type: "mq2",
    name: "Gas / smoke MQ-2",
    category: "sensor",
    description: "Heated SnO₂ sensor for LPG, smoke and H₂. Needs ~20 s warm-up.",
    w: 32,
    h: 22,
    h3: 18,
    pins: [pin("VCC", "VCC", 12.19, 20.73, "vcc"), pin("GND", "GND", 14.73, 20.73, "gnd"), pin("DO", "DO", 17.27, 20.73, "digital-out", "digital"), pin("AO", "AO", 19.81, 20.73, "analog", "adc")],
    props: [{ key: "threshold", label: "Alarm threshold", type: "range", default: 0.45, min: 0.05, max: 0.95, step: 0.01 }],
    env: ["gas", "smoke"],
    supplyMin: 4.5,
    prefer5v: true,
    keywords: ["mq2", "mq-2", "gas", "smoke", "lpg", "แก๊ส", "ควัน"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 3) {
        c.mem.on = -1;
        return;
      }
      if (c.mem.on === undefined || c.mem.on < 0) c.mem.on = c.t;
      const ppm = Math.max(1, c.env.gas + 2.2 * c.env.smoke);
      let frac = 0.07 + 0.82 * clamp(Math.log10(ppm / 200) / Math.log10(10000 / 200), 0, 1);
      const warm = clamp((c.t - c.mem.on) / 20, 0, 1);
      frac = frac + (1 - warm) * 0.35 * (1 - frac);
      frac = clamp(frac * (s / 5) + 0.003 * vnoise(c.t * 4, 8), 0, 1);
      c.mem.frac = frac;
      c.V(c.n("AO"), c.n("GND"), s * frac, 1000);
      const alarm = frac > Number(c.props.threshold ?? 0.45);
      c.mem.det = alarm ? 1 : 0;
      digitalOut(c, "DO", "GND", !alarm, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 3, indicator: Boolean(c.mem.det), reading: c.env.gas + c.env.smoke, readingUnit: "ppm", outV: c.v(c.n("AO")) - c.v(c.n("GND")) }),
  },
  {
    type: "pir",
    name: "PIR motion HC-SR501",
    category: "sensor",
    description: "Pyroelectric motion detector. OUT goes HIGH (3.3 V) while motion is seen.",
    w: 32.3,
    h: 24.3,
    h3: 25,
    pins: [pin("VCC", "VCC", 13.61, 23.0, "vcc"), pin("OUT", "OUT", 16.15, 23.0, "digital-out", "digital"), pin("GND", "GND", 18.69, 23.0, "gnd")],
    props: [{ key: "hold", label: "Hold time", type: "number", default: 2.5, min: 0.5, max: 300, step: 0.5, unit: "s" }],
    env: ["motion"],
    supplyMin: 4.5,
    prefer5v: true,
    keywords: ["pir", "motion", "เคลื่อนไหว", "ตรวจจับคน", "intruder"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 4.3) return;
      if (c.env.motion > 0.5) c.mem.last = c.t;
      const on = c.mem.last !== undefined && c.t - c.mem.last < Number(c.props.hold ?? 2.5);
      c.mem.out = on ? 1 : 0;
      c.V(c.n("OUT"), c.n("GND"), on ? 3.3 : 0, 400);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 4.3, on: Boolean(c.mem.out), reading: c.mem.out ?? 0, readingUnit: "" }),
  },
  {
    type: "sw420",
    name: "Vibration switch SW-420",
    category: "sensor",
    description: "Spring switch + comparator. DO goes HIGH while vibration exceeds the trim threshold.",
    w: 32,
    h: 14,
    h3: 8,
    pins: [pin("VCC", "VCC", 30.73, 4.46, "vcc"), pin("GND", "GND", 30.73, 7.0, "gnd"), pin("DO", "DO", 30.73, 9.54, "digital-out", "digital")],
    props: [{ key: "sensitivity", label: "Sensitivity", type: "range", default: 0.5, min: 0, max: 1, step: 0.01 }],
    env: ["vibration"],
    keywords: ["sw420", "vibration", "shake", "สั่น", "แรงสั่นสะเทือน"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 3) return;
      const a = Math.abs(vibAccel(c.t, c.env, 0));
      const thr = 0.05 + 0.8 * (1 - Number(c.props.sensitivity ?? 0.5));
      if (a > thr) c.mem.last = c.t;
      const on = c.mem.last !== undefined && c.t - c.mem.last < 0.08;
      c.mem.out = on ? 1 : 0;
      digitalOut(c, "DO", "GND", on, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 3, indicator: Boolean(c.mem.out), reading: c.env.vibRms, readingUnit: "g" }),
  },
  {
    type: "adxl335",
    name: "Accelerometer ADXL335 (GY-61)",
    category: "sensor",
    description: "3-axis ±3 g analog accelerometer, 330 mV/g around 1.65 V. Great for motor vibration analysis.",
    w: 21,
    h: 16,
    h3: 3,
    pins: [
      pin("VCC", "VCC", 5.42, 14.73, "vcc"),
      pin("X", "X", 7.96, 14.73, "analog", "adc"),
      pin("Y", "Y", 10.5, 14.73, "analog", "adc"),
      pin("Z", "Z", 13.04, 14.73, "analog", "adc"),
      pin("GND", "GND", 15.58, 14.73, "gnd"),
    ],
    props: [],
    env: ["vibration"],
    keywords: ["adxl335", "accelerometer", "vibration", "gy-61", "ความเร่ง", "สั่น", "motor"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      const g = (v: number) => clamp(1.65 + 0.33 * v, 0.05, 3.25);
      c.V(c.n("X"), c.n("GND"), g(vibAccel(c.t, c.env, 0)), 32_000 / 100);
      c.V(c.n("Y"), c.n("GND"), g(vibAccel(c.t, c.env, 1) * 0.6), 320);
      c.V(c.n("Z"), c.n("GND"), g(1 + vibAccel(c.t, c.env, 2) * 0.35), 320);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, reading: vibAccel(c.t, c.env, 0), readingUnit: "g", outV: c.v(c.n("X")) - c.v(c.n("GND")) }),
  },
  {
    type: "sound",
    name: "Sound sensor KY-037",
    category: "sensor",
    description: "Electret mic + amplifier. AO follows the waveform, DO trips above the threshold.",
    w: 34,
    h: 15,
    h3: 9,
    pins: [pin("AO", "AO", 32.73, 3.69, "analog", "adc"), pin("GND", "G", 32.73, 6.23, "gnd"), pin("VCC", "+", 32.73, 8.77, "vcc"), pin("DO", "DO", 32.73, 11.31, "digital-out", "digital")],
    props: [{ key: "threshold", label: "Threshold", type: "number", default: 65, min: 30, max: 110, step: 1, unit: "dB" }],
    env: ["sound"],
    keywords: ["sound", "mic", "microphone", "clap", "เสียง", "ไมค์"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 3) return;
      const amp = clamp((c.env.sound - 30) / 90, 0, 1) * 0.42 * s;
      const wave = Math.sin(2 * Math.PI * 220 * c.t) * 0.6 + vnoise(c.t * 800, 12) * 0.4;
      c.V(c.n("AO"), c.n("GND"), s / 2 + amp * wave, 1000);
      const loud = c.env.sound > Number(c.props.threshold ?? 65);
      c.mem.det = loud ? 1 : 0;
      digitalOut(c, "DO", "GND", loud, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 3, indicator: Boolean(c.mem.det), reading: c.env.sound, readingUnit: "dB" }),
  },
  // ------------------------------------------------------------------ prototyping
  {
    type: "breadboard",
    name: "Breadboard",
    category: "prototyping",
    description: "Solderless breadboard: columns of 5 connected holes on each side of the channel, plus power rails. Set the number of columns.",
    w: layoutBreadboard({}).w,
    h: layoutBreadboard({}).h,
    h3: 8.5,
    pins: layoutBreadboard({}).pins,
    props: [
      { key: "cols", label: "Columns", type: "number", default: 30, min: 5, max: 80, step: 1 },
      { key: "rails", label: "Power rails", type: "boolean", default: true },
    ],
    ties: layoutBreadboard({}).ties,
    layout: layoutBreadboard,
    host: true,
    keywords: ["breadboard", "เบรดบอร์ด", "protoboard"],
  },
  {
    type: "perfboard",
    name: "Perfboard (บอร์ดไข่ปลา)",
    category: "prototyping",
    description: "Prototype board with a 2.54 mm hole grid. Perfboard pads are isolated — join them with wires; stripboard joins each row. Set X × Y holes.",
    w: layoutPerfboard({}).w,
    h: layoutPerfboard({}).h,
    h3: 1.6,
    pins: layoutPerfboard({}).pins,
    props: [
      { key: "cols", label: "Holes X", type: "number", default: 24, min: 4, max: 90, step: 1 },
      { key: "rows", label: "Holes Y", type: "number", default: 18, min: 4, max: 70, step: 1 },
      {
        key: "kind",
        label: "Type",
        type: "select",
        default: "perfboard",
        options: [
          { value: "perfboard", label: "Perfboard (isolated pads)" },
          { value: "stripboard", label: "Stripboard (rows joined)" },
        ],
      },
      {
        key: "finish",
        label: "Board",
        type: "select",
        default: "fr4",
        options: [
          { value: "fr4", label: "FR4 green" },
          { value: "phenolic", label: "Phenolic brown" },
          { value: "fr4-white", label: "FR4 white" },
        ],
      },
    ],
    ties: layoutPerfboard({}).ties,
    layout: layoutPerfboard,
    host: true,
    keywords: ["perfboard", "protoboard", "stripboard", "veroboard", "ไข่ปลา", "บอร์ดไข่ปลา", "pcb"],
  },
];

function servoPost(c: PostCtx, secPer60: number): PartLive {
  const s = c.supply("V", "GND");
  const sig = c.signal("SIG");
  let target = c.mem.target ?? 90;
  if (sig?.servoUs && s > 3.0) target = clamp(((sig.servoUs - 544) / (2400 - 544)) * 180, 0, 180);
  c.mem.target = target;
  const cur = c.mem.angle ?? 90;
  const speed = (60 / secPer60) * clamp(s / 5, 0.3, 1.2);
  const step = speed * c.dt;
  const next = Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
  c.mem.angle = next;
  const warn = s > 0.5 && s < 4.2 ? `Servo supply ${s.toFixed(1)} V — weak, connect V+ to 5 V` : undefined;
  return { angle: next, powered: s > 3, reading: next, readingUnit: "°", warn };
}


/** Breadboard geometry: rows a–e and f–j either side of a 3-pitch channel, optional ± rails. */
export function layoutBreadboard(props: Record<string, unknown>): PartLayout {
  const cols = num(props.cols, 30, 5, 80);
  const rails = props.rails !== false;
  const key = `bb:${cols}:${rails}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const P = 2.54;
  const top = rails ? 4 : 1;
  const pins: PartPin[] = [];
  const ties: [string, string][] = [];
  for (let col = 1; col <= cols; col++) {
    BB_ROWS.forEach((r, ri) => {
      const yi = ri < 5 ? top + ri : top + 7 + (ri - 5);
      pins.push({ id: `${r}${col}`, label: `${r}${col}`, x: P * (col + 1), y: P * yi, role: "passive" });
    });
    for (const group of [BB_ROWS.slice(0, 5), BB_ROWS.slice(5)]) for (let i = 1; i < group.length; i++) ties.push([`${group[0]}${col}`, `${group[i]}${col}`]);
  }
  if (rails) {
    const railRows = [
      { id: "tn", y: 1, label: "−" },
      { id: "tp", y: 2, label: "+" },
      { id: "bp", y: top + 13, label: "+" },
      { id: "bn", y: top + 14, label: "−" },
    ];
    let n = 0;
    while (n + 2 + Math.floor(n / 5) <= cols + 1) n++;
    for (const rail of railRows) {
      for (let k = 0; k < n; k++) {
        pins.push({ id: `${rail.id}${k + 1}`, label: `${rail.label} rail`, x: P * (k + 2 + Math.floor(k / 5)), y: P * rail.y, role: rail.id.endsWith("n") ? "gnd" : "vcc" });
        if (k > 0) ties.push([`${rail.id}1`, `${rail.id}${k + 1}`]);
      }
    }
  }
  const out = { w: P * (cols + 3), h: P * (rails ? top + 15 : top + 13), pins, ties };
  layoutCache.set(key, out);
  return out;
}

/** Perfboard / stripboard: a plain X × Y grid on 2.54 mm pitch. */
export function layoutPerfboard(props: Record<string, unknown>): PartLayout {
  const cols = num(props.cols, 24, 4, 90);
  const rows = num(props.rows, 18, 4, 70);
  const strip = props.kind === "stripboard";
  const key = `pb:${cols}:${rows}:${strip}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const P = 2.54;
  const pins: PartPin[] = [];
  const ties: [string, string][] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      pins.push({ id: `X${c}Y${r}`, label: `X${c} Y${r}`, x: P * c, y: P * r, role: "passive" });
      if (strip && c > 1) ties.push([`X1Y${r}`, `X${c}Y${r}`]);
    }
  }
  const out = { w: P * (cols + 1), h: P * (rows + 1), pins, ties };
  layoutCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Custom sensors
// ---------------------------------------------------------------------------
const exprCache = new Map<string, (env: EnvState, p: Record<string, number>, t: number) => number>();

export function compileSensorExpr(expr: string) {
  let fn = exprCache.get(expr);
  if (fn) return fn;
  const body = `"use strict"; const noise = (sd) => sd * (Math.random() * 2 - 1); const clamp = (x, a, b) => Math.max(a, Math.min(b, x)); const lerp = (a, b, x) => a + (b - a) * x; return (${expr});`;
  // eslint-disable-next-line no-new-func
  const raw = new Function("env", "p", "t", "Math", body) as (env: EnvState, p: Record<string, number>, t: number, m: Math) => number;
  fn = (env, p, t) => {
    const v = Number(raw(env, p, t, Math));
    return Number.isFinite(v) ? v : 0;
  };
  exprCache.set(expr, fn);
  return fn;
}

export function customSensorToPart(def: CustomSensorDef): PartDef {
  const n = def.pins.length;
  const w = Math.max(def.w, n * 2.54 + 6);
  const startX = w / 2 - ((n - 1) * 2.54) / 2;
  const pins: PartPin[] = def.pins.map((p, i) => ({
    id: p.id,
    label: p.label,
    x: startX + i * 2.54,
    y: def.h - 1.27,
    role: p.role,
    need: p.role === "analog" ? "adc" : p.role === "digital-out" || p.role === "digital-in" ? "digital" : p.role === "pwm-in" ? "pwm" : undefined,
  }));
  const vcc = def.pins.find((p) => p.role === "vcc")?.id;
  const gnd = def.pins.find((p) => p.role === "gnd")?.id;
  const ao = def.pins.find((p) => p.role === "analog")?.id;
  const dout = def.pins.find((p) => p.role === "digital-out")?.id;
  return {
    type: def.type,
    name: def.name,
    category: "custom",
    description: def.description || `${def.model} custom sensor`,
    w,
    h: def.h,
    h3: 6,
    pins,
    props: def.params.map((p) => ({ key: p.key, label: `${p.label}${p.unit ? ` (${p.unit})` : ""}`, type: "number" as const, default: p.default, min: p.min, max: p.max, step: (p.max - p.min) / 100 || 0.01 })),
    env: def.env === "none" ? [] : [def.env],
    keywords: [def.name.toLowerCase(), def.model.toLowerCase(), "custom"],
    pcb: def.color,
    custom: def,
    stamp: (c) => {
      if (!vcc || !gnd) return;
      const s = c.supply(vcc, gnd);
      if (s < 1.6) return;
      const params: Record<string, number> = {};
      for (const p of def.params) params[p.key] = Number(c.props[p.key] ?? p.default);
      let frac = 0;
      try {
        frac = Math.max(0, Math.min(1, compileSensorExpr(def.expr)(c.env, params, c.t)));
      } catch {
        frac = 0;
      }
      c.mem.frac = frac;
      if (ao) c.V(c.n(ao), c.n(gnd), frac * s, 1000);
      if (dout) {
        const hit = frac > def.threshold;
        const level = def.activeLow ? !hit : hit;
        c.mem.det = hit ? 1 : 0;
        c.V(c.n(dout), c.n(gnd), level ? s : 0, 1000);
      }
    },
    post: (c) => ({ powered: Boolean(vcc && gnd && c.supply(vcc, gnd) > 1.6), indicator: Boolean(c.mem.det), reading: (c.mem.frac ?? 0) * 100, readingUnit: "%" }),
  };
}

const registry = new Map<string, PartDef>(PARTS.map((p) => [p.type, p]));

export function registerPart(def: PartDef) {
  registry.set(def.type, def);
}

export function unregisterPart(type: string) {
  registry.delete(type);
}

export function getPart(type: string): PartDef | undefined {
  return registry.get(type);
}

export function allParts(): PartDef[] {
  return [...registry.values()];
}
