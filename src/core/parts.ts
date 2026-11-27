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
  /** Travel 0..1 (cylinder rod, valve spool). */
  pos?: number;
  /** Small status LEDs (reed switches a0 / a1). */
  leds?: boolean[];
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
  /** Click / hold on the canvas while running presses it (buttons, touch pads, joystick switch). */
  pressable?: boolean;
  /** Click flips a latching control (selector, E-stop, breaker): returns the new input state. */
  toggle?: (input: Record<string, unknown>) => Record<string, number | boolean>;
  /** Short state shown on the inspector button, e.g. "ON" / "OFF". */
  toggleLabel?: (input: Record<string, unknown>) => string;
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
    pressable: true,
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
  // ------------------------------------------------------------------ more sensors
  {
    type: "bme280",
    name: "BME280 weather (I²C)",
    category: "sensor",
    description: "Bosch temperature, humidity and barometric pressure sensor on a GY-BME280 board. Adafruit_BME280 library, address 0x76.",
    w: 12.7,
    h: 15.24,
    h3: 3,
    pins: [pin("VCC", "VIN", 2.54, 13.97, "vcc"), pin("GND", "GND", 5.08, 13.97, "gnd"), pin("SCL", "SCL", 7.62, 13.97, "scl", "scl"), pin("SDA", "SDA", 10.16, 13.97, "sda", "sda")],
    props: [
      { key: "model", label: "Chip", type: "select", default: "BME280", options: [{ value: "BME280", label: "BME280 (T, RH, P)" }, { value: "BMP280", label: "BMP280 (T, P)" }] },
      { key: "address", label: "I²C address", type: "select", default: "0x76", options: [{ value: "0x76", label: "0x76" }, { value: "0x77", label: "0x77" }] },
    ],
    env: ["temperature", "humidity", "pressure"],
    supplyMin: 1.8,
    lib: "Adafruit_BME280.h",
    keywords: ["bme280", "bmp280", "pressure", "barometer", "altitude", "weather", "ความกดอากาศ", "อุณหภูมิ", "ความชื้น", "สภาพอากาศ"],
    stamp: (c) => {
      c.R(c.n("SDA"), c.n("VCC"), 10_000);
      c.R(c.n("SCL"), c.n("VCC"), 10_000);
      c.R(c.n("VCC"), c.n("GND"), 30_000);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 1.7, reading: c.env.pressure, readingUnit: "hPa" }),
  },
  {
    type: "bh1750",
    name: "BH1750 light meter (I²C)",
    category: "sensor",
    description: "Digital ambient light sensor (GY-30), 1–65535 lx. BH1750 library, address 0x23.",
    w: 15.24,
    h: 18.5,
    h3: 3,
    pins: [
      pin("VCC", "VCC", 2.54, 17.2, "vcc"),
      pin("GND", "GND", 5.08, 17.2, "gnd"),
      pin("SCL", "SCL", 7.62, 17.2, "scl", "scl"),
      pin("SDA", "SDA", 10.16, 17.2, "sda", "sda"),
      pin("ADDR", "ADDR", 12.7, 17.2, "nc"),
    ],
    props: [],
    env: ["lux"],
    supplyMin: 2.4,
    lib: "BH1750.h",
    keywords: ["bh1750", "gy-30", "light", "lux", "illuminance", "แสง", "ความสว่าง"],
    stamp: (c) => {
      c.R(c.n("SDA"), c.n("VCC"), 10_000);
      c.R(c.n("SCL"), c.n("VCC"), 10_000);
      c.R(c.n("VCC"), c.n("GND"), 30_000);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.3, reading: Math.round(clamp(c.env.lux, 0, 65535)), readingUnit: "lx" }),
  },
  {
    type: "ds18b20",
    name: "DS18B20 waterproof probe",
    category: "sensor",
    description: "1-Wire digital thermometer in a steel probe, −55…125 °C. OneWire + DallasTemperature libraries. The 4.7 kΩ pull-up is included in this model.",
    w: 10.16,
    h: 40.64,
    h3: 6,
    pins: [pin("GND", "GND (black)", 2.54, 39.37, "gnd"), pin("DATA", "DATA (yellow)", 5.08, 39.37, "digital-out", "digital"), pin("VCC", "VDD (red)", 7.62, 39.37, "vcc")],
    props: [],
    env: ["temperature"],
    supplyMin: 3.0,
    lib: "DallasTemperature.h",
    keywords: ["ds18b20", "onewire", "1-wire", "dallas", "temperature", "waterproof", "probe", "อุณหภูมิ", "กันน้ำ", "หัววัด"],
    stamp: (c) => c.R(c.n("DATA"), c.n("VCC"), 4700),
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.9, reading: c.env.temperature, readingUnit: "°C" }),
  },
  {
    type: "ir-obstacle",
    name: "IR obstacle sensor FC-51",
    category: "sensor",
    description: "IR LED + photodiode pair. OUT goes LOW when something is closer than the trim-pot range (2–30 cm).",
    w: 32,
    h: 14,
    h3: 8,
    pins: [pin("OUT", "OUT", 30.73, 4.46, "digital-out", "digital"), pin("GND", "GND", 30.73, 7.0, "gnd"), pin("VCC", "VCC", 30.73, 9.54, "vcc")],
    props: [{ key: "range", label: "Detection range", type: "number", default: 15, min: 2, max: 30, step: 1, unit: "cm" }],
    env: ["distance"],
    supplyMin: 3.0,
    keywords: ["ir", "obstacle", "fc-51", "proximity", "avoid", "robot", "infrared", "สิ่งกีดขวาง", "อินฟราเรด", "หุ่นยนต์"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      const near = c.env.distance < Number(c.props.range ?? 15);
      c.mem.det = near ? 1 : 0;
      digitalOut(c, "OUT", "GND", !near, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, indicator: Boolean(c.mem.det), reading: c.env.distance, readingUnit: "cm" }),
  },
  {
    type: "hall",
    name: "Hall magnetic sensor KY-003",
    category: "sensor",
    description: "A3144 Hall switch. S goes LOW while a magnet's south pole is near (> 3.5 mT).",
    w: 20,
    h: 12,
    h3: 5,
    pins: [pin("S", "S", 18.73, 3.46, "digital-out", "digital"), pin("VCC", "+", 18.73, 6.0, "vcc"), pin("GND", "−", 18.73, 8.54, "gnd")],
    props: [],
    env: ["magnet"],
    supplyMin: 3.0,
    keywords: ["hall", "magnet", "magnetic", "a3144", "ky-003", "rpm", "tachometer", "แม่เหล็ก", "รอบ"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      // A3144: operate at ~3.5 mT, release at ~2.4 mT (hysteresis)
      const B = c.env.magnet;
      if (B > 3.5) c.mem.det = 1;
      else if (B < 2.4) c.mem.det = 0;
      digitalOut(c, "S", "GND", !c.mem.det, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, indicator: Boolean(c.mem.det), reading: c.env.magnet, readingUnit: "mT" }),
  },
  {
    type: "touch",
    name: "Touch sensor TTP223",
    category: "input",
    description: "Capacitive touch pad. SIG goes HIGH while the pad is touched — click and hold it while the simulation runs.",
    w: 15.24,
    h: 12.7,
    h3: 2,
    pins: [pin("GND", "GND", 5.08, 11.43, "gnd"), pin("SIG", "I/O", 7.62, 11.43, "digital-out", "digital"), pin("VCC", "VCC", 10.16, 11.43, "vcc")],
    props: [{ key: "mode", label: "Output", type: "select", default: "momentary", options: [{ value: "momentary", label: "Momentary (HIGH while touched)" }, { value: "toggle", label: "Toggle (each touch flips)" }] }],
    supplyMin: 2.0,
    pressable: true,
    keywords: ["touch", "ttp223", "capacitive", "สัมผัส", "แตะ", "ปุ่มสัมผัส"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 1.9) return;
      const pressed = !!c.input.pressed;
      if (c.props.mode === "toggle") {
        if (pressed && !c.mem.was) c.mem.state = c.mem.state ? 0 : 1;
        c.mem.was = pressed ? 1 : 0;
      } else c.mem.state = pressed ? 1 : 0;
      c.V(c.n("SIG"), c.n("GND"), c.mem.state ? s : 0, 300);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 1.9, on: Boolean(c.mem.state), indicator: Boolean(c.mem.state) }),
  },
  {
    type: "joystick",
    name: "Joystick KY-023",
    category: "input",
    description: "Two 10 kΩ pots (VRx, VRy) and a push switch (SW → GND, use INPUT_PULLUP). Move it with the sliders; click to press.",
    w: 34,
    h: 26,
    h3: 32,
    pins: [
      pin("GND", "GND", 32.73, 7.92, "gnd"),
      pin("VCC", "+5V", 32.73, 10.46, "vcc"),
      pin("VRX", "VRx", 32.73, 13.0, "analog", "adc"),
      pin("VRY", "VRy", 32.73, 15.54, "analog", "adc"),
      pin("SW", "SW", 32.73, 18.08, "signal", "digital"),
    ],
    props: [
      { key: "x", label: "Stick X", type: "range", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "y", label: "Stick Y", type: "range", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    supplyMin: 2.5,
    pressable: true,
    switches: (_p, input) => (input.pressed ? [["SW", "GND"]] : []),
    keywords: ["joystick", "thumbstick", "ky-023", "game", "จอยสติ๊ก", "คันโยก"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 1) return;
      const x = clamp(Number(c.props.x ?? 0.5), 0, 1);
      const y = clamp(Number(c.props.y ?? 0.5), 0, 1);
      c.V(c.n("VRX"), c.n("GND"), s * x, 2500);
      c.V(c.n("VRY"), c.n("GND"), s * y, 2500);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 1, on: Boolean(c.input.pressed), reading: Math.round(Number(c.props.x ?? 0.5) * 100), readingUnit: "% X" }),
  },
  {
    type: "pulse",
    name: "Pulse / heart-rate sensor",
    category: "sensor",
    description: "Optical PPG sensor (Pulse Sensor Amped). S outputs the blood-volume waveform around VCC/2 — count the peaks for BPM.",
    w: 16,
    h: 24,
    h3: 3,
    pins: [pin("S", "S", 5.46, 22.86, "analog", "adc"), pin("VCC", "+", 8.0, 22.86, "vcc"), pin("GND", "−", 10.54, 22.86, "gnd")],
    props: [],
    env: ["heartRate"],
    supplyMin: 3.0,
    keywords: ["pulse", "heart", "heartbeat", "bpm", "ppg", "หัวใจ", "ชีพจร", "การเต้นของหัวใจ"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      const bpm = clamp(c.env.heartRate, 20, 240);
      const ph = ((c.t * bpm) / 60) % 1;
      const w = Math.exp(-Math.pow((ph - 0.14) / 0.055, 2)) + 0.32 * Math.exp(-Math.pow((ph - 0.42) / 0.08, 2)) - 0.12 * Math.exp(-Math.pow((ph - 0.3) / 0.03, 2));
      c.mem.beat = ph < 0.25 ? 1 : 0;
      c.V(c.n("S"), c.n("GND"), s * clamp(0.5 + 0.3 * (w - 0.25) + 0.006 * vnoise(c.t * 60, 14), 0, 1), 1000);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, indicator: Boolean(c.mem.beat), reading: Math.round(c.env.heartRate), readingUnit: "bpm", outV: c.v(c.n("S")) - c.v(c.n("GND")) }),
  },
  {
    type: "mq135",
    name: "Air quality MQ-135",
    category: "sensor",
    description: "Heated SnO₂ sensor for CO₂, NH₃, benzene and smoke. Needs ~20 s warm-up; AO rises with pollution.",
    w: 32,
    h: 22,
    h3: 18,
    pins: [pin("VCC", "VCC", 12.19, 20.73, "vcc"), pin("GND", "GND", 14.73, 20.73, "gnd"), pin("DO", "DO", 17.27, 20.73, "digital-out", "digital"), pin("AO", "AO", 19.81, 20.73, "analog", "adc")],
    props: [{ key: "threshold", label: "Alarm threshold", type: "range", default: 0.5, min: 0.05, max: 0.95, step: 0.01 }],
    env: ["co2", "smoke"],
    supplyMin: 4.5,
    prefer5v: true,
    keywords: ["mq135", "mq-135", "air", "quality", "co2", "pollution", "คุณภาพอากาศ", "มลพิษ", "คาร์บอนไดออกไซด์"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 3) {
        c.mem.on = -1;
        return;
      }
      if (c.mem.on === undefined || c.mem.on < 0) c.mem.on = c.t;
      const ppm = Math.max(300, c.env.co2 + 1.5 * c.env.smoke);
      let frac = 0.12 + 0.78 * clamp(Math.log10(ppm / 400) / Math.log10(10000 / 400), 0, 1);
      const warm = clamp((c.t - c.mem.on) / 20, 0, 1);
      frac = frac + (1 - warm) * 0.3 * (1 - frac);
      frac = clamp(frac * (s / 5) + 0.003 * vnoise(c.t * 4, 18), 0, 1);
      c.V(c.n("AO"), c.n("GND"), s * frac, 1000);
      const alarm = frac > Number(c.props.threshold ?? 0.5);
      c.mem.det = alarm ? 1 : 0;
      digitalOut(c, "DO", "GND", !alarm, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 3, indicator: Boolean(c.mem.det), reading: Math.round(c.env.co2), readingUnit: "ppm", outV: c.v(c.n("AO")) - c.v(c.n("GND")) }),
  },
  {
    type: "rain",
    name: "Rain sensor FC-37",
    category: "sensor",
    description: "Rain plate + LM393 comparator board. AO falls as the plate gets wet; DO goes LOW past the trim threshold.",
    w: 60,
    h: 22,
    h3: 6,
    pins: [pin("AO", "A0", 58.73, 7.19, "analog", "adc"), pin("DO", "D0", 58.73, 9.73, "digital-out", "digital"), pin("GND", "GND", 58.73, 12.27, "gnd"), pin("VCC", "VCC", 58.73, 14.81, "vcc")],
    props: [{ key: "sensitivity", label: "Sensitivity (trim pot)", type: "range", default: 0.5, min: 0, max: 1, step: 0.01 }],
    env: ["rain", "water"],
    supplyMin: 3.0,
    keywords: ["rain", "raindrop", "fc-37", "yl-83", "weather", "wet", "ฝน", "ฝนตก", "เปียก"],
    stamp: (c) => {
      const s = c.supply("VCC", "GND");
      if (s < 2.8) return;
      const wet = clamp(Math.max(c.env.rain, c.env.water * 1.2) + 0.01 * vnoise(c.t * 7, 19), 0, 1);
      c.mem.wet = wet;
      c.V(c.n("AO"), c.n("GND"), s * clamp(0.97 - 0.78 * Math.pow(wet, 0.6), 0, 1), 1000);
      const det = wet > 1 - Number(c.props.sensitivity ?? 0.5) * 0.95;
      c.mem.det = det ? 1 : 0;
      digitalOut(c, "DO", "GND", !det, s);
    },
    post: (c) => ({ powered: c.supply("VCC", "GND") > 2.8, indicator: Boolean(c.mem.det), reading: Math.round((c.mem.wet ?? 0) * 100), readingUnit: "% wet", outV: c.v(c.n("AO")) - c.v(c.n("GND")) }),
  },
  // ------------------------------------------------------------------ industrial control (24 V DC / 3-phase)
  {
    type: "pb-no",
    name: "Push button NO (Start)",
    category: "control",
    description: "22 mm panel push button with a normally-open contact 3-4. Closes while pressed — hold it on the canvas while the simulation runs.",
    w: 22.86,
    h: 25.4,
    h3: 18,
    pins: [pin("3", "3 (NO)", 6.35, 22.86, "passive"), pin("4", "4 (NO)", 16.51, 22.86, "passive")],
    props: [
      { key: "color", label: "Color", type: "select", default: "green", options: ["green", "red", "black", "yellow", "blue", "white"].map((v) => ({ value: v, label: v })) },
      { key: "legend", label: "Legend", type: "text", default: "START" },
    ],
    pressable: true,
    switches: (_p, input) => (input.pressed ? [["3", "4"]] : []),
    keywords: ["push button", "start", "no", "normally open", "ปุ่มกด", "สตาร์ท", "เริ่ม"],
    post: (c) => ({ on: Boolean(c.input.pressed) }),
  },
  {
    type: "pb-nc",
    name: "Push button NC (Stop)",
    category: "control",
    description: "22 mm panel push button with a normally-closed contact 1-2. Opens while pressed.",
    w: 22.86,
    h: 25.4,
    h3: 18,
    pins: [pin("1", "1 (NC)", 6.35, 22.86, "passive"), pin("2", "2 (NC)", 16.51, 22.86, "passive")],
    props: [
      { key: "color", label: "Color", type: "select", default: "red", options: ["red", "green", "black", "yellow", "blue", "white"].map((v) => ({ value: v, label: v })) },
      { key: "legend", label: "Legend", type: "text", default: "STOP" },
    ],
    pressable: true,
    switches: (_p, input) => (input.pressed ? [] : [["1", "2"]]),
    keywords: ["push button", "stop", "nc", "normally closed", "ปุ่มกด", "หยุด", "สต็อป"],
    post: (c) => ({ on: Boolean(c.input.pressed) }),
  },
  {
    type: "estop",
    name: "Emergency stop",
    category: "control",
    description: "Mushroom-head latching E-stop with an NC contact 1-2. Click to hit it, click again to twist-release.",
    w: 27.94,
    h: 30.48,
    h3: 30,
    pins: [pin("1", "1 (NC)", 8.89, 27.94, "passive"), pin("2", "2 (NC)", 19.05, 27.94, "passive")],
    props: [],
    toggle: (i) => ({ latched: !i.latched }),
    toggleLabel: (i) => (i.latched ? "LATCHED (open)" : "Released"),
    switches: (_p, input) => (input.latched ? [] : [["1", "2"]]),
    keywords: ["emergency", "e-stop", "estop", "mushroom", "ฉุกเฉิน", "หยุดฉุกเฉิน"],
    post: (c) => ({ on: Boolean(c.input.latched) }),
  },
  {
    type: "selector2",
    name: "Selector switch 0-1",
    category: "control",
    description: "Two-position latching selector. NC 1-2 is closed at 0, NO 3-4 is closed at 1. Click to turn.",
    w: 22.86,
    h: 30.48,
    h3: 20,
    pins: [pin("1", "1 (NC)", 3.81, 27.94, "passive"), pin("2", "2 (NC)", 8.89, 27.94, "passive"), pin("3", "3 (NO)", 13.97, 27.94, "passive"), pin("4", "4 (NO)", 19.05, 27.94, "passive")],
    props: [
      { key: "label0", label: "Position 0", type: "text", default: "OFF" },
      { key: "label1", label: "Position 1", type: "text", default: "ON" },
    ],
    toggle: (i) => ({ pos: i.pos ? 0 : 1 }),
    toggleLabel: (i) => (i.pos ? "Position 1" : "Position 0"),
    switches: (_p, input) => (input.pos ? [["3", "4"]] : [["1", "2"]]),
    keywords: ["selector", "switch", "rotary", "on off", "สวิตช์", "ซีเลคเตอร์", "สวิตช์เลือก"],
    post: (c) => ({ on: Boolean(c.input.pos), reading: Number(c.input.pos ?? 0), readingUnit: "pos" }),
  },
  {
    type: "selector3",
    name: "Selector switch 1-0-2",
    category: "control",
    description: "Three-position selector (e.g. MAN-OFF-AUTO). NO 13-14 closes at position 1 (left), NO 23-24 at position 2 (right). Click to turn.",
    w: 22.86,
    h: 30.48,
    h3: 20,
    pins: [pin("13", "13", 3.81, 27.94, "passive"), pin("14", "14", 8.89, 27.94, "passive"), pin("23", "23", 13.97, 27.94, "passive"), pin("24", "24", 19.05, 27.94, "passive")],
    props: [
      { key: "label1", label: "Left (1)", type: "text", default: "MAN" },
      { key: "label0", label: "Center (0)", type: "text", default: "OFF" },
      { key: "label2", label: "Right (2)", type: "text", default: "AUTO" },
    ],
    toggle: (i) => {
      const step = (Number(i.step ?? 0) + 1) % 4;
      return { step, pos: [0, 1, 0, 2][step] };
    },
    toggleLabel: (i) => ["Center (0)", "Left (1)", "Right (2)"][Number(i.pos ?? 0)] ?? "Center (0)",
    switches: (_p, input) => (input.pos === 1 ? [["13", "14"]] : input.pos === 2 ? [["23", "24"]] : []),
    keywords: ["selector", "3 position", "hand off auto", "man auto", "สวิตช์เลือก", "ออโต้", "แมนนวล"],
    post: (c) => ({ reading: Number(c.input.pos ?? 0), readingUnit: "pos" }),
  },
  {
    type: "limit-switch",
    name: "Limit switch",
    category: "control",
    description: "Roller-lever limit switch with NC 1-2 and NO 3-4. Hold it on the canvas to actuate the lever.",
    w: 30.48,
    h: 35.56,
    h3: 30,
    pins: [pin("1", "1 (NC)", 5.08, 33.02, "passive"), pin("2", "2 (NC)", 10.16, 33.02, "passive"), pin("3", "3 (NO)", 20.32, 33.02, "passive"), pin("4", "4 (NO)", 25.4, 33.02, "passive")],
    props: [],
    pressable: true,
    switches: (_p, input) => (input.pressed ? [["3", "4"]] : [["1", "2"]]),
    keywords: ["limit switch", "lever", "end stop", "ลิมิตสวิตช์", "ลิมิต"],
    post: (c) => ({ on: Boolean(c.input.pressed) }),
  },
  {
    type: "pilot-lamp",
    name: "Pilot lamp 24 V",
    category: "control",
    description: "22 mm LED indicator lamp for 24 V AC/DC (≈20 mA), terminals X1-X2.",
    w: 22.86,
    h: 25.4,
    h3: 16,
    pins: [pin("X1", "X1", 6.35, 22.86, "passive"), pin("X2", "X2", 16.51, 22.86, "passive")],
    props: [{ key: "color", label: "Color", type: "select", default: "green", options: ["green", "red", "amber", "white", "blue"].map((v) => ({ value: v, label: v })) }],
    keywords: ["pilot lamp", "indicator", "lamp", "ไฟแสดงสถานะ", "หลอดไฟ", "ไพลอตแลมป์"],
    stamp: (c) => c.R(c.n("X1"), c.n("X2"), 1200),
    post: (c) => {
      const v = Math.abs(c.v(c.n("X1")) - c.v(c.n("X2")));
      return { brightness: clamp(v / 24, 0, 1.25), on: v > 8, reading: v, readingUnit: "V", warn: v > 30 ? `Lamp sees ${v.toFixed(0)} V — rated 24 V` : undefined };
    },
  },
  {
    type: "contactor",
    name: "Contactor 24 VDC (3P + NO + NC)",
    category: "control",
    description: "Magnetic contactor: coil A1-A2 (24 VDC, pull-in > 16 V), main poles L1-T1, L2-T2, L3-T3, auxiliary NO 13-14 and NC 21-22.",
    w: 45.72,
    h: 76.2,
    h3: 75,
    pins: [
      pin("A1", "A1", 5.08, 2.54, "passive"),
      pin("L1", "1/L1", 15.24, 2.54, "passive"),
      pin("L2", "3/L2", 22.86, 2.54, "passive"),
      pin("L3", "5/L3", 30.48, 2.54, "passive"),
      pin("13", "13 NO", 38.1, 2.54, "passive"),
      pin("21", "21 NC", 43.18, 2.54, "passive"),
      pin("A2", "A2", 5.08, 73.66, "passive"),
      pin("T1", "2/T1", 15.24, 73.66, "passive"),
      pin("T2", "4/T2", 22.86, 73.66, "passive"),
      pin("T3", "6/T3", 30.48, 73.66, "passive"),
      pin("14", "14 NO", 38.1, 73.66, "passive"),
      pin("22", "22 NC", 43.18, 73.66, "passive"),
    ],
    props: [],
    switches: (_p, _i, mem) => (mem.on ? [["L1", "T1"], ["L2", "T2"], ["L3", "T3"], ["13", "14"]] : [["21", "22"]]),
    keywords: ["contactor", "magnetic", "coil", "relay", "คอนแทคเตอร์", "แมกเนติก", "รีเลย์"],
    stamp: (c) => c.R(c.n("A1"), c.n("A2"), 600),
    post: (c) => {
      const v = Math.abs(c.v(c.n("A1")) - c.v(c.n("A2")));
      if (v > 16) c.mem.on = 1;
      else if (v < 8) c.mem.on = 0;
      return { on: Boolean(c.mem.on), reading: v, readingUnit: "V coil", warn: v > 30 ? `Coil sees ${v.toFixed(0)} V — this is a 24 V coil` : undefined };
    },
  },
  {
    type: "overload",
    name: "Thermal overload relay",
    category: "control",
    description: "Bimetal overload on the motor line: main path L→T, NC 95-96 opens and NO 97-98 closes when tripped. Trips on > 120 % of the setting; click to test / reset.",
    w: 45.72,
    h: 40.64,
    h3: 40,
    pins: [
      pin("L1", "L1", 15.24, 2.54, "passive"),
      pin("L2", "L2", 22.86, 2.54, "passive"),
      pin("L3", "L3", 30.48, 2.54, "passive"),
      pin("95", "95 NC", 38.1, 2.54, "passive"),
      pin("97", "97 NO", 43.18, 2.54, "passive"),
      pin("T1", "T1", 15.24, 38.1, "passive"),
      pin("T2", "T2", 22.86, 38.1, "passive"),
      pin("T3", "T3", 30.48, 38.1, "passive"),
      pin("96", "96 NC", 38.1, 38.1, "passive"),
      pin("98", "98 NO", 43.18, 38.1, "passive"),
    ],
    props: [{ key: "setting", label: "Current setting", type: "number", default: 8, min: 0.5, max: 40, step: 0.5, unit: "A" }],
    toggle: (i) => ({ tripped: !i.tripped }),
    toggleLabel: (i) => (i.tripped ? "Tripped — click to reset" : "Normal — click to test"),
    switches: (_p, _i, mem) => (mem.trip ? [["97", "98"]] : [["95", "96"]]),
    keywords: ["overload", "thermal", "ol", "โอเวอร์โหลด", "ป้องกันมอเตอร์"],
    stamp: (c) => {
      for (const k of ["1", "2", "3"]) c.R(c.n(`L${k}`), c.n(`T${k}`), 0.02);
      const req = c.input.tripped ? 1 : 0;
      if (req !== (c.mem.req ?? 0)) {
        c.mem.req = req;
        c.mem.trip = req;
        c.mem.heat = 0;
      }
    },
    post: (c) => {
      const I = Math.max(...["1", "2", "3"].map((k) => Math.abs(c.v(c.n(`L${k}`)) - c.v(c.n(`T${k}`))) / 0.02));
      const set = Number(c.props.setting ?? 8);
      c.mem.heat = Math.max(0, (c.mem.heat ?? 0) + (I > set * 1.2 ? c.dt : -c.dt * 0.3));
      if (c.mem.heat > 2) c.mem.trip = 1;
      return { on: Boolean(c.mem.trip), reading: I, readingUnit: "A", warn: c.mem.trip ? "Overload tripped — click it to reset" : I > set * 1.2 ? `Motor draws ${I.toFixed(1)} A (> ${set} A setting)` : undefined };
    },
  },
  {
    type: "timer-relay",
    name: "Timer relay (on-delay)",
    category: "control",
    description: "On-delay timer, coil A1-A2 (24 V). After the set time, 15-18 (NO) closes and 15-16 (NC) opens. Star-delta, sequencing, delays.",
    w: 22.86,
    h: 76.2,
    h3: 65,
    pins: [
      pin("A1", "A1", 5.08, 2.54, "passive"),
      pin("15", "15", 15.24, 2.54, "passive"),
      pin("A2", "A2", 5.08, 73.66, "passive"),
      pin("16", "16 NC", 12.7, 73.66, "passive"),
      pin("18", "18 NO", 17.78, 73.66, "passive"),
    ],
    props: [{ key: "delay", label: "Delay", type: "number", default: 3, min: 0.1, max: 600, step: 0.1, unit: "s" }],
    switches: (_p, _i, mem) => (mem.done ? [["15", "18"]] : [["15", "16"]]),
    keywords: ["timer", "on delay", "time delay relay", "ไทม์เมอร์", "หน่วงเวลา"],
    stamp: (c) => c.R(c.n("A1"), c.n("A2"), 2000),
    post: (c) => {
      const v = Math.abs(c.v(c.n("A1")) - c.v(c.n("A2")));
      const on = v > 16;
      if (on && c.mem.since === undefined) c.mem.since = c.t;
      if (!on) delete c.mem.since;
      const el = on ? c.t - (c.mem.since ?? c.t) : 0;
      c.mem.done = on && el >= Number(c.props.delay ?? 3) ? 1 : 0;
      return { indicator: on, on: Boolean(c.mem.done), reading: el, readingUnit: "s" };
    },
  },
  // ------------------------------------------------------------------ pneumatics
  // Air lines are nets of their own: a net's voltage is its gauge pressure in bar.
  {
    type: "air-supply",
    name: "Air supply 6 bar (FRL)",
    category: "pneumatic",
    description: "Compressed-air service unit: filter, regulator with gauge and a ball valve. Port P feeds the valves' port 1. Click it while running to open or close the ball valve; the pressure is adjustable live.",
    w: 30.48,
    h: 45.72,
    h3: 72,
    pins: [pin("P", "P (out)", 15.24, 2.54, "air")],
    props: [{ key: "bar", label: "Pressure", type: "range", default: 6, min: 0, max: 10, step: 0.5, unit: "bar", live: true }],
    toggle: (i) => ({ off: !i.off }),
    toggleLabel: (i) => (i.off ? "Ball valve closed" : "Ball valve open"),
    keywords: ["air", "compressor", "frl", "regulator", "pneumatic supply", "ลม", "ปั๊มลม", "แหล่งจ่ายลม"],
    stamp: (c) => {
      if (c.input.off) c.R(c.n("P"), -1, 2);
      else c.V(c.n("P"), -1, clamp(Number(c.input.bar ?? c.props.bar ?? 6), 0, 12), 0.05);
    },
    post: (c) => {
      const p = c.v(c.n("P"));
      return { on: !c.input.off, reading: p, readingUnit: "bar", warn: !c.input.off && p < Number(c.input.bar ?? c.props.bar ?? 6) * 0.5 ? "Air is escaping — is a supply line open to exhaust?" : undefined };
    },
  },
  {
    type: "valve52",
    name: "5/2 solenoid valve, spring return",
    category: "pneumatic",
    description: "Single-solenoid 5/2 valve with a 24 VDC coil (Y14) on A1-A2. At rest 1→2 and 4→5 (exhaust); energised 1→4 and 2→3. Click it while running to hold the manual override.",
    w: 45.72,
    h: 27.94,
    h3: 32,
    pins: [
      pin("A1", "A1", 3.81, 2.54, "passive"),
      pin("A2", "A2", 8.89, 2.54, "passive"),
      pin("4", "4 (A)", 22.86, 2.54, "air"),
      pin("2", "2 (B)", 33.02, 2.54, "air"),
      pin("1", "1 (P)", 27.94, 25.4, "air"),
    ],
    props: [],
    pressable: true,
    switches: (_p, _i, mem) => (mem.shift ? [["1", "4"]] : [["1", "2"]]),
    keywords: ["5/2", "solenoid valve", "valve", "directional valve", "pneumatic", "โซลินอยด์วาล์ว", "วาล์วลม", "วาล์ว 5/2"],
    stamp: (c) => {
      c.R(c.n("A1"), c.n("A2"), 480);
      c.R(c.n(c.mem.shift ? "2" : "4"), -1, 1); // the other cylinder line vents through 3 / 5
    },
    post: (c) => {
      const v = Math.abs(c.v(c.n("A1")) - c.v(c.n("A2")));
      const coil = v > (c.mem.coil ? 8 : 16);
      c.mem.coil = coil ? 1 : 0;
      c.mem.shift = coil || c.input.pressed ? 1 : 0;
      return { on: !!c.mem.shift, indicator: coil, pos: c.mem.shift, reading: c.v(c.n("1")), readingUnit: "bar", warn: v > 30 ? `Coil sees ${v.toFixed(0)} V — rated 24 V` : undefined };
    },
  },
  {
    type: "valve52d",
    name: "5/2 solenoid valve, double solenoid",
    category: "pneumatic",
    description: "Bistable 5/2 valve: a pulse on Y14 (A1-A2) shifts it to 1→4, a pulse on Y12 (B1-B2) back to 1→2; it stays where it was last sent. Click it while running to flip the spool by hand.",
    w: 55.88,
    h: 27.94,
    h3: 32,
    pins: [
      pin("A1", "A1 (Y14)", 3.81, 2.54, "passive"),
      pin("A2", "A2 (Y14)", 8.89, 2.54, "passive"),
      pin("4", "4 (A)", 22.86, 2.54, "air"),
      pin("2", "2 (B)", 33.02, 2.54, "air"),
      pin("B1", "B1 (Y12)", 46.99, 2.54, "passive"),
      pin("B2", "B2 (Y12)", 52.07, 2.54, "passive"),
      pin("1", "1 (P)", 27.94, 25.4, "air"),
    ],
    props: [],
    toggle: (i) => ({ flip: Number(i.flip ?? 0) + 1 }),
    toggleLabel: () => "Manual override — flip the spool",
    switches: (_p, _i, mem) => (mem.shift ? [["1", "4"]] : [["1", "2"]]),
    keywords: ["5/2", "double solenoid", "bistable", "memory valve", "โซลินอยด์วาล์ว 2 หัว"],
    stamp: (c) => {
      c.R(c.n("A1"), c.n("A2"), 480);
      c.R(c.n("B1"), c.n("B2"), 480);
      c.R(c.n(c.mem.shift ? "2" : "4"), -1, 1);
    },
    post: (c) => {
      const y14 = Math.abs(c.v(c.n("A1")) - c.v(c.n("A2"))) > 16;
      const y12 = Math.abs(c.v(c.n("B1")) - c.v(c.n("B2"))) > 16;
      if (y14 && !y12) c.mem.shift = 1;
      else if (y12 && !y14) c.mem.shift = 0;
      const flip = Number(c.input.flip ?? 0);
      if (flip !== (c.mem.flip ?? 0)) {
        c.mem.flip = flip;
        c.mem.shift = c.mem.shift ? 0 : 1;
      }
      return { on: !!c.mem.shift, indicator: y14 || y12, leds: [y14, y12], pos: c.mem.shift ?? 0, reading: c.v(c.n("1")), readingUnit: "bar", warn: y14 && y12 ? "Both coils energised — the spool stays put" : undefined };
    },
  },
  {
    type: "cylinder",
    name: "Double-acting air cylinder",
    category: "pneumatic",
    description: "Ø32 double-acting cylinder with a magnetic piston. Air on A (cap end) extends it, air on B (rod end) retracts it. Reed switches a0 (retracted) and a1 (extended) close at the ends: wire 24 V to a0+ / a1+ and a0 / a1 to PLC inputs. Speed is the flow-control setting.",
    w: 91.44,
    h: 20.32,
    h3: 34,
    pins: [
      pin("A", "A (extend)", 7.62, 2.54, "air"),
      pin("B", "B (retract)", 58.42, 2.54, "air"),
      pin("a0p", "a0+", 12.7, 17.78, "passive"),
      pin("a0", "a0 out", 17.78, 17.78, "passive"),
      pin("a1p", "a1+", 48.26, 17.78, "passive"),
      pin("a1", "a1 out", 53.34, 17.78, "passive"),
    ],
    props: [
      { key: "stroke", label: "Stroke", type: "number", default: 100, min: 10, max: 500, step: 10, unit: "mm" },
      { key: "speed", label: "Speed (flow control)", type: "range", default: 200, min: 20, max: 800, step: 10, unit: "mm/s", live: true },
    ],
    switches: (p, _i, mem) => {
      const s = Number(p.stroke ?? 100);
      const pos = mem.pos ?? 0;
      const out: [string, string][] = [];
      if (pos <= 1) out.push(["a0p", "a0"]);
      if (pos >= s - 1) out.push(["a1p", "a1"]);
      return out;
    },
    keywords: ["cylinder", "air cylinder", "pneumatic cylinder", "actuator", "กระบอกลม", "กระบอกสูบ", "ลูกสูบ"],
    post: (c) => {
      const s = Number(c.props.stroke ?? 100);
      const dp = c.v(c.n("A")) - c.v(c.n("B"));
      const vmax = Number(c.input.speed ?? c.props.speed ?? 200);
      // needs ~0.5 bar to break away, full speed from ~3.5 bar difference
      const k = clamp((Math.abs(dp) - 0.5) / 3, 0, 1);
      const vel = Math.sign(dp) * vmax * Math.sqrt(k);
      const pos = clamp((c.mem.pos ?? 0) + vel * c.dt, 0, s);
      c.mem.pos = pos;
      const moving = k > 0 && ((vel > 0 && pos < s) || (vel < 0 && pos > 0));
      return { pos: pos / s, on: moving, speed: moving ? Math.round(vel) : 0, reading: pos, readingUnit: "mm", leds: [pos <= 1, pos >= s - 1] };
    },
  },
  {
    type: "psu24",
    name: "Power supply 24 VDC",
    category: "control",
    description: "DIN-rail switching supply, 24 V / 2.5 A out on +V / −V. Tie −V to the PLC's 0V for a common reference.",
    w: 45.72,
    h: 60.96,
    h3: 55,
    pins: [pin("L", "L", 10.16, 2.54, "nc"), pin("N", "N", 17.78, 2.54, "nc"), pin("VP", "+V", 27.94, 58.42, "vcc"), pin("VN", "−V", 38.1, 58.42, "gnd")],
    props: [],
    keywords: ["power supply", "24v", "psu", "smps", "แหล่งจ่ายไฟ", "พาวเวอร์ซัพพลาย"],
    stamp: (c) => c.V(c.n("VP"), c.n("VN"), 24, 0.05),
    post: (c) => {
      const v = c.v(c.n("VP")) - c.v(c.n("VN"));
      const I = (24 - v) / 0.05;
      return { powered: true, on: true, reading: v, readingUnit: "V", warn: I > 3 ? `Overloaded: ${I.toFixed(1)} A — short circuit?` : undefined };
    },
  },
  {
    type: "supply3",
    name: "3-phase supply 400 V",
    category: "control",
    description: "Mains feed L1, L2, L3, N, PE. (The DC solver gives each phase a distinct level so motors can tell phase order and missing phases.)",
    w: 45.72,
    h: 20.32,
    h3: 30,
    pins: [pin("L1", "L1", 5.08, 17.78, "passive"), pin("L2", "L2", 12.7, 17.78, "passive"), pin("L3", "L3", 20.32, 17.78, "passive"), pin("N", "N", 30.48, 17.78, "passive"), pin("PE", "PE", 40.64, 17.78, "passive")],
    props: [],
    ties: [["N", "PE"]],
    keywords: ["3 phase", "three phase", "mains", "400v", "supply", "ไฟ 3 เฟส", "สามเฟส"],
    stamp: (c) => {
      // a frozen instant of 325 V-peak phases (75°, −45°, 195°): distinct levels encode L1/L2/L3
      c.V(c.n("L1"), c.n("N"), 314, 0.05);
      c.V(c.n("L2"), c.n("N"), -230, 0.05);
      c.V(c.n("L3"), c.n("N"), -84, 0.05);
    },
    post: () => ({ powered: true, on: true }),
  },
  {
    type: "mcb3",
    name: "Circuit breaker 3P",
    category: "control",
    description: "3-pole MCB. Click the handle to switch ON/OFF.",
    w: 30.48,
    h: 50.8,
    h3: 45,
    pins: [pin("L1", "1", 5.08, 2.54, "passive"), pin("L2", "3", 15.24, 2.54, "passive"), pin("L3", "5", 25.4, 2.54, "passive"), pin("T1", "2", 5.08, 48.26, "passive"), pin("T2", "4", 15.24, 48.26, "passive"), pin("T3", "6", 25.4, 48.26, "passive")],
    props: [],
    toggle: (i) => ({ off: !i.off }),
    toggleLabel: (i) => (i.off ? "OFF" : "ON"),
    switches: (_p, input) => (input.off ? [] : [["L1", "T1"], ["L2", "T2"], ["L3", "T3"]]),
    keywords: ["breaker", "mcb", "circuit breaker", "เบรกเกอร์", "ตัดไฟ"],
    post: (c) => ({ on: !c.input.off }),
  },
  {
    type: "motor3",
    name: "3-phase induction motor",
    category: "control",
    description: "M 3~ with terminals U1, V1, W1. Runs when all three phases are present; swapping two phases reverses it; a missing phase is flagged.",
    w: 50.8,
    h: 50.8,
    h3: 45,
    pins: [pin("U", "U1", 15.24, 48.26, "passive"), pin("V", "V1", 25.4, 48.26, "passive"), pin("W", "W1", 35.56, 48.26, "passive")],
    props: [{ key: "rpm", label: "Rated speed", type: "number", default: 1450, min: 300, max: 3600, step: 10, unit: "rpm" }],
    keywords: ["motor", "3 phase", "induction", "มอเตอร์", "มอเตอร์สามเฟส"],
    stamp: (c) => {
      c.R(c.n("U"), c.n("V"), 150);
      c.R(c.n("V"), c.n("W"), 150);
      c.R(c.n("W"), c.n("U"), 150);
    },
    post: (c) => {
      const u = c.v(c.n("U"));
      const v = c.v(c.n("V"));
      const w = c.v(c.n("W"));
      const Iu = Math.abs((u - v) / 150 + (u - w) / 150);
      const Iv = Math.abs((v - u) / 150 + (v - w) / 150);
      const Iw = Math.abs((w - u) / 150 + (w - v) / 150);
      const all = Math.min(Iu, Iv, Iw) > 0.5;
      const some = Math.max(Iu, Iv, Iw) > 0.5;
      // L1→U, L2→V, L3→W (or any rotation of it) gives a positive product: forward
      const dir = (u - v) * (v - w) * (w - u) > 0 ? 1 : -1;
      const target = all ? dir : 0;
      c.mem.speed = (c.mem.speed ?? 0) + (target - (c.mem.speed ?? 0)) * Math.min(1, c.dt * 1.5);
      const sp = c.mem.speed;
      return {
        on: all,
        speed: sp,
        reading: Math.round(Math.abs(sp) * Number(c.props.rpm ?? 1450)) * Math.sign(sp || 1),
        readingUnit: "rpm",
        warn: !all && some ? "Single-phasing: one phase is missing — the motor hums and overheats" : undefined,
      };
    },
  },
  // ------------------------------------------------------------------ instruments
  {
    type: "multimeter",
    name: "Digital multimeter",
    category: "instrument",
    description: "Measure DC volts, current (in series), resistance and continuity between the COM (black) and V/Ω/A (red) jacks. Click the dial to change mode.",
    w: 40.64,
    h: 76.2,
    h3: 30,
    pins: [pin("COM", "COM", 12.7, 71.12, "passive"), pin("VO", "VΩA", 27.94, 71.12, "passive")],
    props: [],
    toggle: (i) => ({ mode: (Number(i.mode ?? 0) + 1) % 4 }),
    toggleLabel: (i) => ["DC volts", "DC amps", "Resistance Ω", "Continuity"][Number(i.mode ?? 0)],
    keywords: ["multimeter", "meter", "voltmeter", "ammeter", "ohm", "มัลติมิเตอร์", "มิเตอร์", "วัดไฟ"],
    stamp: (c) => {
      const mode = Number(c.input.mode ?? 0);
      if (mode === 0) c.R(c.n("VO"), c.n("COM"), 10e6);
      else if (mode === 1) c.R(c.n("VO"), c.n("COM"), 0.1);
      else c.V(c.n("VO"), c.n("COM"), 1, 1000);
    },
    post: (c) => {
      const mode = Number(c.input.mode ?? 0);
      const v = c.v(c.n("VO")) - c.v(c.n("COM"));
      const fmt = (x: number, d: number) => (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(d));
      if (mode === 0) return { reading: v, readingUnit: "V", text: [fmt(v, Math.abs(v) < 10 ? 3 : 2), "V DC"] };
      if (mode === 1) {
        const a = v / 0.1;
        return Math.abs(a) < 1 ? { reading: a * 1000, readingUnit: "mA", text: [fmt(a * 1000, 1), "mA DC"] } : { reading: a, readingUnit: "A", text: [fmt(a, 3), "A DC"] };
      }
      const r = v >= 0.999 || v < 0 ? Infinity : (1000 * v) / (1 - v);
      const shown = !Number.isFinite(r) || r > 2e6 ? "OL" : r >= 1000 ? `${(r / 1000).toFixed(2)}k` : r.toFixed(1);
      if (mode === 2) return { reading: Number.isFinite(r) ? r : 0, readingUnit: "Ω", text: [shown, "Ω"] };
      const beep = Number.isFinite(r) && r < 30;
      return { on: beep, indicator: beep, reading: Number.isFinite(r) ? r : 0, readingUnit: "Ω", text: [beep ? shown : "OL", "•)))"] };
    },
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
