import { STOP, type Hal } from "./hal";

/** Character value: behaves like an integer in arithmetic, prints as a character. */
export class Char {
  constructor(public code: number) {}
  [Symbol.toPrimitive](hint: string) {
    return hint === "string" ? String.fromCharCode(this.code) : this.code;
  }
  toString() {
    return String.fromCharCode(this.code);
  }
  valueOf() {
    return this.code;
  }
}
const charCache = new Map<number, Char>();
export const __ch = (code: number) => {
  const c = ((Math.trunc(Number(code)) % 256) + 256) % 256;
  let ch = charCache.get(c);
  if (!ch) {
    ch = new Char(c);
    charCache.set(c, ch);
  }
  return ch;
};

const toNum = (x: unknown): number => {
  if (x instanceof Char) return x.code;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") return Number(x) || 0;
  return Number(x) || 0;
};
const wrap = (x: unknown, bits: number, signed: boolean) => {
  let n = Math.trunc(toNum(x));
  if (!Number.isFinite(n)) return 0;
  const m = 2 ** bits;
  n = ((n % m) + m) % m;
  if (signed && n >= m / 2) n -= m;
  return n;
};

let patched = false;
function patchStringPrototype() {
  if (patched) return;
  patched = true;
  const def = (name: string, fn: (...a: unknown[]) => unknown) => {
    if (!(name in String.prototype)) Object.defineProperty(String.prototype, name, { value: fn, enumerable: false, writable: true, configurable: true });
  };
  def("toInt", function (this: string) {
    return Math.trunc(parseFloat(this)) || 0;
  });
  def("toFloat", function (this: string) {
    return parseFloat(this) || 0;
  });
  def("toDouble", function (this: string) {
    return parseFloat(this) || 0;
  });
  def("equals", function (this: string, o: unknown) {
    return this === String(o);
  });
  def("equalsIgnoreCase", function (this: string, o: unknown) {
    return this.toLowerCase() === String(o).toLowerCase();
  });
  def("c_str", function (this: string) {
    return this;
  });
  def("__charAt", function (this: string, i: unknown) {
    return __ch(this.charCodeAt(toNum(i)) || 0);
  });
  def("compareTo", function (this: string, o: unknown) {
    return this < String(o) ? -1 : this > String(o) ? 1 : 0;
  });
  def("startsWith_", function (this: string, o: unknown) {
    return this.startsWith(String(o));
  });
}

function formatC(fmt: string, args: unknown[]): string {
  let ai = 0;
  return String(fmt).replace(/%([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?(hh|h|ll|l|z)?([diuxXfFeEgGcsp%])/g, (_m, flags: string, width: string, prec: string, _len, conv: string) => {
    if (conv === "%") return "%";
    const arg = args[ai++];
    let s: string;
    switch (conv) {
      case "d":
      case "i":
        s = String(Math.trunc(toNum(arg)));
        break;
      case "u":
        s = String(Math.trunc(toNum(arg)) >>> 0);
        break;
      case "x":
        s = (Math.trunc(toNum(arg)) >>> 0).toString(16);
        break;
      case "X":
        s = (Math.trunc(toNum(arg)) >>> 0).toString(16).toUpperCase();
        break;
      case "f":
      case "F":
        s = toNum(arg).toFixed(prec !== undefined ? Number(prec) : 6);
        break;
      case "e":
      case "E":
        s = toNum(arg).toExponential(prec !== undefined ? Number(prec) : 6);
        break;
      case "g":
      case "G":
        s = String(Number(toNum(arg).toPrecision(prec ? Number(prec) : 6)));
        break;
      case "c":
        s = arg instanceof Char ? arg.toString() : String.fromCharCode(toNum(arg));
        break;
      default:
        s = String(arg instanceof Char ? arg.toString() : arg);
    }
    const w = width && width !== "*" ? Number(width) : 0;
    if (s.length < w) {
      const left = flags.includes("-");
      const pad = flags.includes("0") && !left && conv !== "s" ? "0" : " ";
      s = left ? s.padEnd(w) : pad === "0" && s.startsWith("-") ? "-" + s.slice(1).padStart(w - 1, "0") : s.padStart(w, pad);
    }
    if (flags.includes("+") && toNum(arg) >= 0 && "dif".includes(conv)) s = "+" + s;
    return s;
  });
}

function printable(x: unknown, fmt?: unknown): string {
  if (x instanceof Char) return x.toString();
  if (typeof x === "number") {
    if (fmt === 16) return (Math.trunc(x) >>> 0).toString(16).toUpperCase();
    if (fmt === 2) return (Math.trunc(x) >>> 0).toString(2);
    if (fmt === 8) return (Math.trunc(x) >>> 0).toString(8);
    if (typeof fmt === "number" && fmt !== 10) return x.toFixed(fmt);
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    return Number.isInteger(x) ? String(x) : x.toFixed(2);
  }
  if (typeof x === "boolean") return x ? "1" : "0";
  if (x === null || x === undefined) return "";
  return String(x);
}

export function createArduinoGlobals(hal: Hal): Record<string, unknown> {
  patchStringPrototype();
  const board = hal.board;
  const warned = new Set<string>();
  const warnOnce = (k: string, msg: string) => {
    if (!warned.has(k)) {
      warned.add(k);
      hal.warn(msg);
    }
  };
  const P = (p: unknown) => {
    const pin = hal.pin(toNum(p));
    if (!pin) warnOnce(`pin${String(p)}`, `Pin ${String(p)} does not exist on ${board.short}`);
    return pin?.id;
  };
  let adcBits = board.family === "esp32" ? 12 : 10;
  let pwmBits = 8;
  const ledcChannels = new Map<number, { pin?: string; freq: number; bits: number }>();
  const ledcPins = new Map<string, { freq: number; bits: number }>();
  const startTime = Date.now();

  const SerialObj = {
    begin: (_baud?: unknown) => undefined,
    end: () => undefined,
    print: (x: unknown, f?: unknown) => hal.serialOut(printable(x, f)),
    println: (x: unknown = "", f?: unknown) => hal.serialOut(printable(x, f) + "\r\n"),
    printf: (fmt: unknown, ...a: unknown[]) => hal.serialOut(formatC(String(fmt), a)),
    write: (x: unknown) => hal.serialOut(typeof x === "string" ? x : String.fromCharCode(toNum(x))),
    available: () => hal.serialAvailable(),
    read: () => hal.serialRead(),
    peek: () => hal.serialPeek(),
    flush: () => undefined,
    setTimeout: () => undefined,
    readString: () => {
      let s = "";
      while (hal.serialAvailable()) s += String.fromCharCode(hal.serialRead());
      return s;
    },
    readStringUntil: (term: unknown) => {
      const code = toNum(term);
      let s = "";
      while (hal.serialAvailable()) {
        const c = hal.serialRead();
        if (c === code) break;
        s += String.fromCharCode(c);
      }
      return s;
    },
    parseInt: () => {
      let s = "";
      while (hal.serialAvailable()) {
        const c = hal.serialPeek();
        if ((c >= 48 && c <= 57) || (c === 45 && !s)) s += String.fromCharCode(hal.serialRead());
        else if (s) break;
        else hal.serialRead();
      }
      return parseInt(s, 10) || 0;
    },
    parseFloat: () => {
      let s = "";
      while (hal.serialAvailable()) {
        const c = hal.serialPeek();
        if ((c >= 48 && c <= 57) || c === 46 || (c === 45 && !s)) s += String.fromCharCode(hal.serialRead());
        else if (s) break;
        else hal.serialRead();
      }
      return parseFloat(s) || 0;
    },
  };
  const truthySerial = Object.assign(Object.create(null), SerialObj);

  // ----------------------------------------------------------------- Servo
  class Servo {
    pinId?: string;
    min = 544;
    max = 2400;
    us = 1500;
    attach(p: unknown, min?: unknown, max?: unknown) {
      this.pinId = P(p);
      if (min !== undefined) this.min = toNum(min);
      if (max !== undefined) this.max = toNum(max);
      if (this.pinId) {
        hal.setMode(this.pinId, "OUTPUT");
        hal.writeServo(this.pinId, this.us);
      }
      return 1;
    }
    setPeriodHertz() {}
    write(a: unknown) {
      let v = toNum(a);
      if (v < 200) {
        v = Math.max(0, Math.min(180, v));
        this.us = this.min + (v / 180) * (this.max - this.min);
      } else this.us = v;
      if (this.pinId) hal.writeServo(this.pinId, this.us);
    }
    writeMicroseconds(us: unknown) {
      this.us = toNum(us);
      if (this.pinId) hal.writeServo(this.pinId, this.us);
    }
    read() {
      return Math.round(((this.us - this.min) / (this.max - this.min)) * 180);
    }
    readMicroseconds() {
      return this.us;
    }
    attached() {
      return !!this.pinId;
    }
    detach() {
      if (this.pinId) hal.writeDigital(this.pinId, 0);
      this.pinId = undefined;
    }
  }

  // ----------------------------------------------------------------- DHT
  class DHT {
    pinId?: string;
    type: number;
    last = -1e9;
    cache = { t: NaN, h: NaN };
    constructor(p: unknown, type: unknown = 22) {
      this.pinId = P(p);
      this.type = toNum(type);
    }
    begin() {}
    private sample() {
      const now = hal.nowMs();
      if (now - this.last < 2000 && !Number.isNaN(this.cache.t)) return this.cache;
      this.last = now;
      const part = this.pinId ? hal.findPart(this.pinId, ["dht22"]) : undefined;
      if (!part) {
        warnOnce("dht", "DHT: no sensor found on that pin — check the DATA wire");
        this.cache = { t: NaN, h: NaN };
        return this.cache;
      }
      if (hal.partSupply(part.id, "VCC", "GND") < 2.9) {
        this.cache = { t: NaN, h: NaN };
        return this.cache;
      }
      const env = hal.env();
      const dht11 = this.type === 11 || part.props.model === "DHT11";
      const t = env.temperature + (Math.random() - 0.5) * 0.2;
      const h = Math.max(0, Math.min(100, env.humidity + (Math.random() - 0.5) * 1.2));
      this.cache = dht11 ? { t: Math.round(Math.max(0, Math.min(50, t))), h: Math.round(Math.max(20, Math.min(90, h))) } : { t: Math.round(t * 10) / 10, h: Math.round(h * 10) / 10 };
      return this.cache;
    }
    readTemperature(f: unknown = false) {
      const t = this.sample().t;
      return f ? (t * 9) / 5 + 32 : t;
    }
    readHumidity() {
      return this.sample().h;
    }
    computeHeatIndex(t: unknown, h: unknown, isF: unknown = true) {
      let T = toNum(t);
      if (!isF) T = (T * 9) / 5 + 32;
      const H = toNum(h);
      let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + H * 0.094);
      if (hi > 79) hi = -42.379 + 2.04901523 * T + 10.14333127 * H - 0.22475541 * T * H - 0.00683783 * T * T - 0.05481717 * H * H + 0.00122874 * T * T * H + 0.00085282 * T * H * H - 0.00000199 * T * T * H * H;
      return isF ? hi : ((hi - 32) * 5) / 9;
    }
    convertCtoF(c: unknown) {
      return (toNum(c) * 9) / 5 + 32;
    }
    convertFtoC(f: unknown) {
      return ((toNum(f) - 32) * 5) / 9;
    }
  }

  // ----------------------------------------------------------------- I2C LCD
  let i2cPins: { sda?: string; scl?: string } = {};
  class LiquidCrystal_I2C {
    addr: number;
    cols: number;
    rows: number;
    cur = { c: 0, r: 0 };
    lines: string[];
    light = true;
    constructor(addr: unknown = 0x27, cols: unknown = 16, rows: unknown = 2) {
      this.addr = toNum(addr);
      this.cols = toNum(cols);
      this.rows = toNum(rows);
      this.lines = Array.from({ length: this.rows }, () => " ".repeat(this.cols));
    }
    private target() {
      const p = hal.findI2C(["lcd1602"], i2cPins.sda, i2cPins.scl);
      if (!p) {
        warnOnce("lcd", "LCD: no I²C display found — wire SDA/SCL to the board's I²C pins");
        return undefined;
      }
      const a = parseInt(String(p.props.address ?? "0x27"), 16);
      if (a !== this.addr) {
        warnOnce("lcdaddr", `LCD: nothing answers at 0x${this.addr.toString(16)} (display is at 0x${a.toString(16)})`);
        return undefined;
      }
      return p;
    }
    private flush() {
      const p = this.target();
      if (p) hal.setLib(p.id, { lcd: { lines: [...this.lines], backlight: this.light } });
    }
    init() {
      this.clear();
    }
    begin() {
      this.clear();
    }
    backlight() {
      this.light = true;
      this.flush();
    }
    noBacklight() {
      this.light = false;
      this.flush();
    }
    clear() {
      this.lines = this.lines.map(() => " ".repeat(this.cols));
      this.cur = { c: 0, r: 0 };
      this.flush();
    }
    home() {
      this.cur = { c: 0, r: 0 };
    }
    setCursor(c: unknown, r: unknown) {
      this.cur = { c: toNum(c), r: Math.min(this.rows - 1, toNum(r)) };
    }
    print(x: unknown, f?: unknown) {
      const s = printable(x, f);
      for (const ch of s) {
        if (this.cur.c < this.cols && this.cur.r < this.rows) {
          const line = this.lines[this.cur.r];
          this.lines[this.cur.r] = line.slice(0, this.cur.c) + ch + line.slice(this.cur.c + 1);
        }
        this.cur.c++;
      }
      this.flush();
      return s.length;
    }
    write(x: unknown) {
      return this.print(x instanceof Char ? x : __ch(toNum(x)));
    }
    display() {}
    noDisplay() {}
    cursor() {}
    noCursor() {}
    blink() {}
    noBlink() {}
    createChar() {}
    scrollDisplayLeft() {}
    scrollDisplayRight() {}
  }

  // ----------------------------------------------------------------- NeoPixel
  class Adafruit_NeoPixel {
    n: number;
    pinId?: string;
    px: number[];
    bright = 255;
    static Color(r: unknown, g: unknown, b: unknown) {
      return ((toNum(r) & 255) << 16) | ((toNum(g) & 255) << 8) | (toNum(b) & 255);
    }
    static ColorHSV(h: unknown, s: unknown = 255, v: unknown = 255) {
      const H = ((toNum(h) % 65536) / 65536) * 6;
      const S = toNum(s) / 255;
      const V = toNum(v) / 255;
      const i = Math.floor(H);
      const f = H - i;
      const p = V * (1 - S);
      const q = V * (1 - S * f);
      const t = V * (1 - S * (1 - f));
      const [r, g, b] = [
        [V, t, p],
        [q, V, p],
        [p, V, t],
        [p, q, V],
        [t, p, V],
        [V, p, q],
      ][i % 6];
      return Adafruit_NeoPixel.Color(r * 255, g * 255, b * 255);
    }
    static gamma32(c: unknown) {
      return toNum(c);
    }
    constructor(n: unknown = 12, p: unknown = 6, _t?: unknown) {
      this.n = toNum(n);
      this.pinId = P(p);
      this.px = new Array(this.n).fill(0);
    }
    Color(r: unknown, g: unknown, b: unknown) {
      return Adafruit_NeoPixel.Color(r, g, b);
    }
    ColorHSV(h: unknown, s?: unknown, v?: unknown) {
      return Adafruit_NeoPixel.ColorHSV(h, s, v);
    }
    gamma32(c: unknown) {
      return toNum(c);
    }
    begin() {
      if (this.pinId) hal.setMode(this.pinId, "OUTPUT");
    }
    setPixelColor(i: unknown, r: unknown, g?: unknown, b?: unknown) {
      const k = toNum(i);
      if (k < 0 || k >= this.n) return;
      this.px[k] = g === undefined ? toNum(r) : Adafruit_NeoPixel.Color(r, g, b);
    }
    getPixelColor(i: unknown) {
      return this.px[toNum(i)] ?? 0;
    }
    fill(c: unknown = 0, first: unknown = 0, count: unknown = 0) {
      const f = toNum(first);
      const cnt = toNum(count) || this.n - f;
      for (let i = f; i < f + cnt && i < this.n; i++) this.px[i] = toNum(c);
    }
    clear() {
      this.px.fill(0);
    }
    setBrightness(b: unknown) {
      this.bright = toNum(b);
    }
    getBrightness() {
      return this.bright;
    }
    numPixels() {
      return this.n;
    }
    show() {
      if (!this.pinId) return;
      const p = hal.findPart(this.pinId, ["neopixel-ring"]);
      if (!p) {
        warnOnce("neo", "NeoPixel: no ring found on the data pin");
        return;
      }
      const k = this.bright / 255;
      hal.setLib(p.id, {
        pixels: this.px.map((c) => {
          const r = Math.round(((c >> 16) & 255) * k);
          const g = Math.round(((c >> 8) & 255) * k);
          const b = Math.round((c & 255) * k);
          return (r << 16) | (g << 8) | b;
        }),
      });
    }
  }

  // ----------------------------------------------------------------- WiFi / MQTT
  const isWifiBoard = board.family === "esp32";
  const WiFi = {
    mode: () => undefined,
    begin: (ssid?: unknown) => {
      if (!isWifiBoard) {
        warnOnce("wifi", `${board.short} has no Wi-Fi radio — use an ESP32`);
        return;
      }
      hal.wifiStart = hal.nowMs();
      hal.serialOut("");
      void ssid;
    },
    status: () => (isWifiBoard && hal.wifiStart !== null && hal.nowMs() - hal.wifiStart > 1200 ? 3 : 6),
    isConnected: () => isWifiBoard && hal.wifiStart !== null && hal.nowMs() - hal.wifiStart > 1200,
    localIP: () => "192.168.1.42",
    macAddress: () => "24:6F:28:AB:CD:EF",
    RSSI: () => -48 - Math.round(Math.random() * 6),
    disconnect: () => {
      hal.wifiStart = null;
    },
    setHostname: () => undefined,
    SSID: () => "Thosaphol-Sim",
  };
  class WiFiClient {}
  class WiFiClientSecure {
    setInsecure() {}
    setCACert() {}
  }
  class IPAddress {
    parts: number[];
    constructor(...p: unknown[]) {
      this.parts = p.map(toNum);
    }
    toString() {
      return this.parts.join(".");
    }
  }
  class PubSubClient {
    cb: ((topic: string, payload: Char[], len: number) => unknown) | null = null;
    isConn = false;
    host = "";
    off: (() => void) | null = null;
    subs = new Set<string>();
    constructor(_client?: unknown) {}
    setServer(host: unknown, _port?: unknown) {
      this.host = String(host);
      return this;
    }
    setCallback(cb: (topic: string, payload: Char[], len: number) => unknown) {
      this.cb = cb;
      return this;
    }
    setBufferSize() {
      return true;
    }
    setKeepAlive() {
      return this;
    }
    connect(_id?: unknown) {
      if (!WiFi.isConnected()) return false;
      this.isConn = true;
      this.off?.();
      this.off = hal.mqtt.onMessage((topic, payload) => {
        if (!this.cb) return;
        if (![...this.subs].some((s) => topicMatch(s, topic))) return;
        const bytes = [...payload].map((c) => __ch(c.charCodeAt(0)));
        void Promise.resolve(this.cb(topic, bytes, bytes.length)).catch(() => undefined);
      });
      return true;
    }
    connected() {
      return this.isConn && WiFi.isConnected();
    }
    disconnect() {
      this.isConn = false;
      this.off?.();
    }
    publish(topic: unknown, payload: unknown, retained: unknown = false) {
      if (!this.isConn) return false;
      hal.mqtt.publish(String(topic), payload instanceof Char ? payload.toString() : String(payload), Boolean(retained));
      return true;
    }
    subscribe(topic: unknown) {
      this.subs.add(String(topic));
      hal.mqtt.subscribe(String(topic));
      return true;
    }
    unsubscribe(topic: unknown) {
      this.subs.delete(String(topic));
      hal.mqtt.unsubscribe(String(topic));
      return true;
    }
    loop() {
      return this.isConn;
    }
    state() {
      return this.isConn ? 0 : -1;
    }
  }

  const Wire = {
    begin: (sda?: unknown, scl?: unknown) => {
      if (sda !== undefined && scl !== undefined) i2cPins = { sda: P(sda), scl: P(scl) };
    },
    setClock: () => undefined,
    _addr: 0,
    beginTransmission(addr: unknown) {
      this._addr = toNum(addr);
    },
    write: () => 1,
    endTransmission() {
      const p = hal.findI2C(["lcd1602"], i2cPins.sda, i2cPins.scl);
      const a = p ? parseInt(String(p.props.address ?? "0x27"), 16) : -1;
      return a === this._addr ? 0 : 2;
    },
    requestFrom: () => 0,
    available: () => 0,
    read: () => 0,
  };

  const analogReadCounts = (pinId: string) => {
    const v = hal.readVolts(pinId);
    const max = 2 ** adcBits - 1;
    let frac: number;
    if (board.family === "esp32") frac = (v - 0.075) / (3.12 - 0.075);
    else frac = v / board.adcVref;
    frac = Math.max(0, Math.min(1, frac));
    const noise = (Math.random() - 0.5) * (board.family === "esp32" ? 6 : 1.2) * (max / 4095) * (board.family === "esp32" ? 1 : 4);
    return Math.max(0, Math.min(max, Math.round(frac * max + noise)));
  };

  const g: Record<string, unknown> = {
    // constants
    HIGH: 1,
    LOW: 0,
    INPUT: "INPUT",
    OUTPUT: "OUTPUT",
    INPUT_PULLUP: "INPUT_PULLUP",
    INPUT_PULLDOWN: "INPUT_PULLDOWN",
    RISING: "RISING",
    FALLING: "FALLING",
    CHANGE: "CHANGE",
    DEC: 10,
    HEX: 16,
    OCT: 8,
    BIN: 2,
    LSBFIRST: 0,
    MSBFIRST: 1,
    PI: Math.PI,
    HALF_PI: Math.PI / 2,
    TWO_PI: Math.PI * 2,
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,
    DHT11: 11,
    DHT21: 21,
    DHT22: 22,
    AM2301: 21,
    AM2302: 22,
    NEO_GRB: 0x52,
    NEO_RGB: 0x06,
    NEO_GRBW: 0xd2,
    NEO_KHZ800: 0,
    NEO_KHZ400: 0x100,
    WL_CONNECTED: 3,
    WL_DISCONNECTED: 6,
    WL_IDLE_STATUS: 0,
    WL_NO_SSID_AVAIL: 1,
    WL_CONNECT_FAILED: 4,
    WIFI_STA: 1,
    WIFI_AP: 2,
    WIFI_AP_STA: 3,
    ADC_0db: 0,
    ADC_2_5db: 1,
    ADC_6db: 2,
    ADC_11db: 3,
    ...board.constants,
    // casts & helpers used by the transpiler
    __i8: (x: unknown) => wrap(x, 8, true),
    __u8: (x: unknown) => wrap(x, 8, false),
    __i16: (x: unknown) => wrap(x, 16, true),
    __u16: (x: unknown) => wrap(x, 16, false),
    __i32: (x: unknown) => wrap(x, 32, true),
    __u32: (x: unknown) => wrap(x, 32, false),
    __trunc: (x: unknown) => Math.trunc(toNum(x)),
    __bool: (x: unknown) => !!toNum(x),
    __char: (x: unknown) => (x instanceof Char ? x : typeof x === "string" ? __ch(x.charCodeAt(0) || 0) : __ch(toNum(x))),
    __ch,
    __num: (x: unknown) => (x instanceof Char ? x.code : x),
    __String: (x: unknown = "", f?: unknown) => printable(x, f),
    __cat: (a: unknown, b: unknown) => String(a) + (b instanceof Char ? b.toString() : printable(b)),
    __arr: (...dims: unknown[]) => {
      const make = (d: number[]): unknown[] => (d.length === 1 ? new Array(d[0]).fill(0) : Array.from({ length: d[0] }, () => make(d.slice(1))));
      return make(dims.map(toNum));
    },
    __sizeof: (x: unknown) => (Array.isArray(x) ? x.length : typeof x === "string" ? x.length + 1 : 1),
    __sizeofT: (t: string) => ({ char: 1, byte: 1, bool: 1, int: board.intBits / 8, long: 4, float: 4, double: board.family === "avr" ? 4 : 8 } as Record<string, number>)[t] ?? 4,
    __y: () => hal.yieldNow(),
    F: (s: unknown) => s,
    // timing
    millis: () => Math.floor(hal.nowMs()),
    micros: () => Math.floor(hal.nowMs() * 1000),
    delay: (ms: unknown) => hal.sleep(Math.max(0, toNum(ms))),
    delayMicroseconds: (us: unknown) => (toNum(us) >= 1000 ? hal.sleep(toNum(us) / 1000) : hal.yieldNow()),
    yield: () => hal.yieldNow(true),
    // digital / analog
    pinMode: (p: unknown, mode: unknown) => {
      const id = P(p);
      if (!id) return;
      const pin = board.pins.find((x) => x.id === id);
      if (pin?.inputOnly && mode === "OUTPUT") warnOnce(`io${id}`, `GPIO${pin.gpio} is input-only on the ESP32 — it cannot be an OUTPUT`);
      if (pin?.inputOnly && (mode === "INPUT_PULLUP" || mode === "INPUT_PULLDOWN")) warnOnce(`pu${id}`, `GPIO${pin.gpio} has no internal pull resistors`);
      hal.setMode(id, (pin?.inputOnly && mode !== "INPUT" ? "INPUT" : mode) as never);
    },
    digitalWrite: (p: unknown, v: unknown) => {
      const id = P(p);
      if (!id) return;
      const mode = hal.getMode(id);
      if (mode === "INPUT" || mode === "INPUT_PULLUP") {
        // digitalWrite on an input toggles the pull-up on AVR
        if (board.family === "avr") hal.setMode(id, toNum(v) ? "INPUT_PULLUP" : "INPUT");
        return;
      }
      if (mode === undefined) warnOnce(`pm${id}`, `digitalWrite(${String(p)}) before pinMode(${String(p)}, OUTPUT)`);
      hal.writeDigital(id, toNum(v) ? 1 : 0);
    },
    digitalRead: (p: unknown) => {
      const id = P(p);
      return id ? hal.readDigital(id) : 0;
    },
    analogRead: (p: unknown) => {
      const id = P(p);
      if (!id) return 0;
      const pin = board.pins.find((x) => x.id === id);
      if (pin && !pin.caps.includes("adc")) {
        warnOnce(`adc${id}`, `${pin.label} is not an analog input on ${board.short}`);
        return 0;
      }
      return analogReadCounts(id);
    },
    analogReadMilliVolts: (p: unknown) => {
      const id = P(p);
      return id ? Math.round(hal.readVolts(id) * 1000) : 0;
    },
    analogReadResolution: (b: unknown) => {
      adcBits = toNum(b);
    },
    analogWriteResolution: (b: unknown) => {
      pwmBits = toNum(b);
    },
    analogSetAttenuation: () => undefined,
    analogSetPinAttenuation: () => undefined,
    analogReference: () => undefined,
    analogWrite: (p: unknown, v: unknown) => {
      const id = P(p);
      if (!id) return;
      const pin = board.pins.find((x) => x.id === id);
      if (pin && !pin.caps.includes("pwm")) warnOnce(`pwm${id}`, `${pin.label} does not support PWM on ${board.short} — analogWrite acts like digitalWrite`);
      const max = 2 ** pwmBits - 1;
      const duty = Math.max(0, Math.min(1, toNum(v) / max));
      if (pin && !pin.caps.includes("pwm")) hal.writeDigital(id, duty >= 0.5 ? 1 : 0);
      else hal.writePwm(id, duty, board.family === "avr" ? 490 : 1000);
    },
    dacWrite: (p: unknown, v: unknown) => {
      const id = P(p);
      if (id) hal.writeDac(id, (Math.max(0, Math.min(255, toNum(v))) / 255) * 3.3);
    },
    // ESP32 LEDC (core 2.x and 3.x)
    ledcSetup: (ch: unknown, freq: unknown, bits: unknown) => {
      ledcChannels.set(toNum(ch), { freq: toNum(freq), bits: toNum(bits) });
      return toNum(freq);
    },
    ledcAttachPin: (p: unknown, ch: unknown) => {
      const c = ledcChannels.get(toNum(ch)) ?? { freq: 5000, bits: 8 };
      c.pin = P(p);
      ledcChannels.set(toNum(ch), c);
      if (c.pin) hal.setMode(c.pin, "OUTPUT");
    },
    ledcAttach: (p: unknown, freq: unknown, bits: unknown) => {
      const id = P(p);
      if (id) {
        ledcPins.set(id, { freq: toNum(freq), bits: toNum(bits) });
        hal.setMode(id, "OUTPUT");
      }
      return true;
    },
    ledcAttachChannel: (p: unknown, freq: unknown, bits: unknown, ch: unknown) => {
      const id = P(p);
      ledcChannels.set(toNum(ch), { pin: id, freq: toNum(freq), bits: toNum(bits) });
      if (id) hal.setMode(id, "OUTPUT");
      return true;
    },
    ledcWrite: (chOrPin: unknown, duty: unknown) => {
      const n = toNum(chOrPin);
      const viaPin = (() => {
        const id = hal.pin(n)?.id;
        return id && ledcPins.has(id) ? { id, ...ledcPins.get(id)! } : undefined;
      })();
      const ch = ledcChannels.get(n);
      const target = viaPin ?? (ch?.pin ? { id: ch.pin, freq: ch.freq, bits: ch.bits } : undefined);
      if (!target) return;
      const d = Math.max(0, Math.min(1, toNum(duty) / (2 ** target.bits - 1)));
      if (target.freq > 30 && target.freq < 400) hal.writeServo(target.id, (d * 1e6) / target.freq);
      else hal.writePwm(target.id, d, target.freq);
    },
    ledcWriteTone: (chOrPin: unknown, freq: unknown) => {
      const n = toNum(chOrPin);
      const id = ledcChannels.get(n)?.pin ?? hal.pin(n)?.id;
      if (id) hal.writeTone(id, toNum(freq));
    },
    ledcDetachPin: () => undefined,
    ledcDetach: () => undefined,
    tone: (p: unknown, f: unknown, d?: unknown) => {
      const id = P(p);
      if (id) {
        hal.setMode(id, "OUTPUT");
        hal.writeTone(id, toNum(f), d === undefined ? undefined : toNum(d));
      }
    },
    noTone: (p: unknown) => {
      const id = P(p);
      if (id) hal.writeTone(id, 0);
    },
    pulseIn: (p: unknown, level: unknown = 1, timeout: unknown = 1_000_000) => {
      const id = P(p);
      if (!id) return 0;
      const sonar = hal.findPart(id, ["hc-sr04"]);
      if (sonar && sonar.pin === "ECHO") {
        if (hal.partSupply(sonar.id, "VCC", "GND") < 4.3) return 0;
        if (!hal.trigFired(sonar.id, "TRIG")) return 0;
        const d = hal.env().distance;
        if (d > 400 || d < 2) return d > 400 ? 0 : 116;
        const us = Math.round(d * 58.3 * (1 + (Math.random() - 0.5) * 0.004));
        return us > toNum(timeout) ? 0 : us;
      }
      void level;
      return 0;
    },
    shiftOut: () => undefined,
    attachInterrupt: (p: unknown, fn: () => unknown, mode: unknown) => {
      const id = P(p);
      if (id) hal.attachInterrupt(id, fn, String(mode) as "RISING");
    },
    detachInterrupt: (p: unknown) => {
      const id = P(p);
      if (id) hal.detachInterrupt(id);
    },
    digitalPinToInterrupt: (p: unknown) => p,
    interrupts: () => undefined,
    noInterrupts: () => undefined,
    touchRead: () => 72 + Math.round(Math.random() * 3),
    hallRead: () => Math.round((Math.random() - 0.5) * 20),
    temperatureRead: () => hal.env().temperature + 18,
    // math
    map: (x: unknown, a: unknown, b: unknown, c: unknown, d: unknown) => {
      const [X, A, B, C, D] = [x, a, b, c, d].map(toNum);
      if (B === A) return C;
      return Math.trunc(((X - A) * (D - C)) / (B - A) + C);
    },
    constrain: (x: unknown, a: unknown, b: unknown) => Math.max(toNum(a), Math.min(toNum(b), toNum(x))),
    min: (a: unknown, b: unknown) => Math.min(toNum(a), toNum(b)),
    max: (a: unknown, b: unknown) => Math.max(toNum(a), toNum(b)),
    abs: (x: unknown) => Math.abs(toNum(x)),
    fabs: (x: unknown) => Math.abs(toNum(x)),
    sq: (x: unknown) => toNum(x) ** 2,
    sqrt: Math.sqrt,
    pow: Math.pow,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    exp: Math.exp,
    log: Math.log,
    log10: Math.log10,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    isnan: Number.isNaN,
    isinf: (x: number) => !Number.isFinite(x) && !Number.isNaN(x),
    random: (a: unknown, b?: unknown) => (b === undefined ? Math.floor(Math.random() * toNum(a)) : toNum(a) + Math.floor(Math.random() * (toNum(b) - toNum(a)))),
    randomSeed: () => undefined,
    esp_random: () => (Math.random() * 2 ** 32) >>> 0,
    bitRead: (x: unknown, n: unknown) => (toNum(x) >> toNum(n)) & 1,
    bitSet: (x: unknown, n: unknown) => toNum(x) | (1 << toNum(n)),
    bitClear: (x: unknown, n: unknown) => toNum(x) & ~(1 << toNum(n)),
    bitWrite: (x: unknown, n: unknown, b: unknown) => (toNum(b) ? toNum(x) | (1 << toNum(n)) : toNum(x) & ~(1 << toNum(n))),
    bit: (n: unknown) => 1 << toNum(n),
    lowByte: (x: unknown) => toNum(x) & 0xff,
    highByte: (x: unknown) => (toNum(x) >> 8) & 0xff,
    dtostrf: (v: unknown, w: unknown, p: unknown) => toNum(v).toFixed(toNum(p)).padStart(toNum(w)),
    sprintf: (_buf: unknown, fmt: unknown, ...a: unknown[]) => formatC(String(fmt), a),
    snprintf: (_buf: unknown, _n: unknown, fmt: unknown, ...a: unknown[]) => formatC(String(fmt), a),
    // objects
    Serial: truthySerial,
    Serial1: truthySerial,
    Serial2: truthySerial,
    Wire,
    WiFi,
    WiFiClient,
    WiFiClientSecure,
    IPAddress,
    PubSubClient,
    Servo,
    ESP32PWM: class {
      static allocateTimer() {}
    },
    DHT,
    LiquidCrystal_I2C,
    Adafruit_NeoPixel,
    HTTPClient: class {
      begin() {
        return true;
      }
      GET() {
        hal.warn("HTTPClient: HTTP requests are not simulated — use MQTT export instead");
        return -1;
      }
      POST() {
        return -1;
      }
      getString() {
        return "";
      }
      end() {}
    },
    Preferences: class {
      store = new Map<string, unknown>();
      begin() {
        return true;
      }
      end() {}
      putInt(k: string, v: unknown) {
        this.store.set(k, v);
      }
      getInt(k: string, d: unknown = 0) {
        return this.store.get(k) ?? d;
      }
      putFloat(k: string, v: unknown) {
        this.store.set(k, v);
      }
      getFloat(k: string, d: unknown = 0) {
        return this.store.get(k) ?? d;
      }
      putString(k: string, v: unknown) {
        this.store.set(k, v);
      }
      getString(k: string, d: unknown = "") {
        return this.store.get(k) ?? d;
      }
      clear() {
        this.store.clear();
      }
    },
    ESP: {
      restart: () => {
        throw STOP;
      },
      getChipModel: () => "ESP32-D0WD-V3",
      getFreeHeap: () => 281_000 - Math.round(Math.random() * 400),
      getCpuFreqMHz: () => 240,
      getEfuseMac: () => 0x24_6f_28_ab_cd_ef,
    },
    __startTime: startTime,
  };
  return g;
}

export function topicMatch(filter: string, topic: string) {
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export { formatC, printable };
