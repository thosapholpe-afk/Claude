import { STOP, type Hal } from "./hal";
import { topicMatch } from "./arduino-api";

type Kw = Record<string, unknown> & { __kw?: number };

function splitKw(args: unknown[]): [unknown[], Kw] {
  const last = args[args.length - 1] as Kw | undefined;
  if (last && typeof last === "object" && last.__kw === 1) return [args.slice(0, -1), last];
  return [args, {}];
}
const num = (x: unknown) => (typeof x === "boolean" ? (x ? 1 : 0) : Number(x) || 0);

class PyError extends Error {
  pyName: string;
  constructor(name: string, msg: string) {
    super(msg);
    this.pyName = name;
    this.name = name;
  }
}

export function pyStr(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (x === true) return "True";
  if (x === false) return "False";
  if (Array.isArray(x)) return "[" + x.map(pyRepr).join(", ") + "]";
  if (typeof x === "number") {
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    return String(Math.round(x * 1e10) / 1e10);
  }
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.__str__ === "function") return String((o.__str__ as () => unknown)());
    if (o.constructor === Object) return "{" + Object.entries(o).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ") + "}";
    return `<${o.constructor?.name ?? "object"}>`;
  }
  return String(x);
}
function pyRepr(x: unknown): string {
  return typeof x === "string" ? `'${x}'` : pyStr(x);
}

function pyFormat(v: unknown, spec: string): string {
  const m = spec.match(/^(?:(.)?([<>^=]))?([+\- ])?(#)?(0)?(\d+)?(,)?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/);
  if (!m) return pyStr(v);
  const [, fill = " ", align, sign, , zero, width, comma, prec, type] = m;
  let s: string;
  const n = num(v);
  switch (type) {
    case "f":
    case "F":
      s = n.toFixed(prec !== undefined ? Number(prec) : 6);
      break;
    case "e":
    case "E":
      s = n.toExponential(prec !== undefined ? Number(prec) : 6);
      break;
    case "%":
      s = (n * 100).toFixed(prec !== undefined ? Number(prec) : 6) + "%";
      break;
    case "d":
      s = String(Math.trunc(n));
      break;
    case "x":
      s = Math.trunc(n).toString(16);
      break;
    case "X":
      s = Math.trunc(n).toString(16).toUpperCase();
      break;
    case "b":
      s = Math.trunc(n).toString(2);
      break;
    case "g":
      s = String(Number(n.toPrecision(prec ? Number(prec) : 6)));
      break;
    default:
      s = prec !== undefined && typeof v === "number" ? n.toFixed(Number(prec)) : pyStr(v);
  }
  if (comma) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (sign === "+" && n >= 0) s = "+" + s;
  const w = width ? Number(width) : 0;
  if (s.length < w) {
    const f = zero ? "0" : fill;
    const al = align ?? (typeof v === "number" ? ">" : "<");
    if (al === "<") s = s.padEnd(w, f);
    else if (al === "^") {
      const l = Math.floor((w - s.length) / 2);
      s = f.repeat(l) + s + f.repeat(w - s.length - l);
    } else s = s.padStart(w, f);
  }
  return s;
}

export function createPythonGlobals(hal: Hal): Record<string, unknown> {
  const board = hal.board;
  const warned = new Set<string>();
  const warnOnce = (k: string, msg: string) => {
    if (!warned.has(k)) {
      warned.add(k);
      hal.warn(msg);
    }
  };
  let gpioMode: "BCM" | "BOARD" = "BCM";
  const resolve = (p: unknown, mode: "BCM" | "BOARD" = "BCM"): string | undefined => {
    if (p && typeof p === "object" && "pinId" in (p as object)) return (p as { pinId?: string }).pinId;
    if (typeof p === "string") {
      const s = p.toUpperCase();
      if (s === "LED" || s === "WL_GPIO0") return hal.pin(25)?.id ?? "LED";
      const bm = s.match(/^(?:BOARD|J8:)(\d+)$/);
      if (bm) return hal.physPin(Number(bm[1]))?.id;
      const pin = hal.pin(s);
      if (!pin) warnOnce(`p${s}`, `Pin ${p} does not exist on ${board.short}`);
      return pin?.id;
    }
    const n = num(p);
    const pin = mode === "BOARD" ? hal.physPin(n) : hal.pin(n);
    if (!pin) warnOnce(`p${n}`, `Pin ${n} does not exist on ${board.short}`);
    return pin?.id;
  };
  const sleepS = (s: unknown) => hal.sleep(num(s) * 1000);
  const t0Epoch = Date.now() / 1000;

  // background pollers for callbacks (when_pressed etc.)
  const poll = (fn: () => void, everyMs = 10) => {
    void (async () => {
      try {
        for (;;) {
          await hal.sleep(everyMs);
          fn();
        }
      } catch {
        /* stopped */
      }
    })();
  };
  const call = (f: unknown, ...a: unknown[]) => {
    if (typeof f === "function") void Promise.resolve(f(...a)).catch((e) => e !== STOP && hal.warn(String(e?.message ?? e)));
  };

  // ------------------------------------------------------------- machine (MicroPython)
  class Pin {
    static IN = 0;
    static OUT = 1;
    static OPEN_DRAIN = 2;
    static PULL_UP = 1;
    static PULL_DOWN = 2;
    static IRQ_RISING = 1;
    static IRQ_FALLING = 2;
    pinId?: string;
    out = 0;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.pinId = resolve(a[0]);
      this.init(a[1] ?? kw.mode ?? -1, a[2] ?? kw.pull ?? -1, a[3] ?? kw.value);
    }
    init(mode: unknown = -1, pull: unknown = -1, value?: unknown) {
      if (!this.pinId) return;
      const m = num(mode);
      const p = num(pull);
      if (m === 1) hal.setMode(this.pinId, "OUTPUT");
      else if (m === 0) hal.setMode(this.pinId, p === 1 ? "INPUT_PULLUP" : p === 2 ? "INPUT_PULLDOWN" : "INPUT");
      if (value !== undefined && value !== null) this.value(value);
    }
    value(v?: unknown) {
      if (!this.pinId) return 0;
      if (v === undefined) return hal.getMode(this.pinId) === "OUTPUT" ? this.out : hal.readDigital(this.pinId);
      this.out = num(v) ? 1 : 0;
      hal.writeDigital(this.pinId, this.out);
      return null;
    }
    on() {
      this.value(1);
    }
    off() {
      this.value(0);
    }
    high() {
      this.value(1);
    }
    low() {
      this.value(0);
    }
    toggle() {
      this.value(this.out ? 0 : 1);
    }
    irq(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      const handler = a[0] ?? kw.handler;
      const trig = num(a[1] ?? kw.trigger ?? 3);
      if (this.pinId) hal.attachInterrupt(this.pinId, () => call(handler, this), trig === 1 ? "RISING" : trig === 2 ? "FALLING" : "CHANGE");
    }
    __call__(v?: unknown) {
      return this.value(v);
    }
  }
  class PWM {
    pinId?: string;
    f = 1000;
    d = 0;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.pinId = resolve(a[0]);
      if (this.pinId) hal.setMode(this.pinId, "OUTPUT");
      if (kw.freq !== undefined) this.f = num(kw.freq);
      if (kw.duty_u16 !== undefined) this.duty_u16(kw.duty_u16);
      if (kw.duty !== undefined) this.duty(kw.duty);
    }
    private apply() {
      if (!this.pinId) return;
      if (this.f <= 400) hal.writeServo(this.pinId, (this.d * 1e6) / this.f);
      else hal.writePwm(this.pinId, this.d, this.f);
    }
    freq(f?: unknown) {
      if (f === undefined) return this.f;
      this.f = num(f);
      this.apply();
      return null;
    }
    duty_u16(d?: unknown) {
      if (d === undefined) return Math.round(this.d * 65535);
      this.d = Math.max(0, Math.min(1, num(d) / 65535));
      this.apply();
      return null;
    }
    duty(d?: unknown) {
      if (d === undefined) return Math.round(this.d * 1023);
      this.d = Math.max(0, Math.min(1, num(d) / 1023));
      this.apply();
      return null;
    }
    duty_ns(ns?: unknown) {
      if (ns === undefined) return Math.round((this.d * 1e9) / this.f);
      this.d = Math.max(0, Math.min(1, (num(ns) * this.f) / 1e9));
      this.apply();
      return null;
    }
    deinit() {
      if (this.pinId) hal.writeDigital(this.pinId, 0);
    }
  }
  class ADC {
    static ATTN_0DB = 0;
    static ATTN_2_5DB = 1;
    static ATTN_6DB = 2;
    static ATTN_11DB = 3;
    static WIDTH_12BIT = 3;
    static CORE_TEMP = 4;
    pinId?: string;
    temp = false;
    constructor(p: unknown) {
      if (p === 4 && board.family === "rp2040") this.temp = true;
      else if (typeof p === "number" && board.family === "rp2040" && p <= 3) this.pinId = hal.pin(26 + p)?.id;
      else if (p === 0 && board.family === "esp8266") this.pinId = board.pins.find((x) => x.label === "A0")?.id;
      else this.pinId = resolve(p);
      const pin = board.pins.find((x) => x.id === this.pinId);
      if (pin && !pin.caps.includes("adc")) warnOnce(`adc${pin.id}`, `${pin.label} is not an ADC pin on ${board.short}`);
    }
    private volts() {
      if (this.temp) return 0.706 - (hal.env().temperature + 4 - 27) * 0.001721;
      return this.pinId ? hal.readVolts(this.pinId) : 0;
    }
    read_u16() {
      const f = Math.max(0, Math.min(1, this.volts() / 3.3));
      return Math.max(0, Math.min(65535, Math.round(f * 4095 + (Math.random() - 0.5) * 3) << 4));
    }
    read() {
      const f = Math.max(0, Math.min(1, (this.volts() - 0.075) / 3.05));
      return Math.round(f * 4095);
    }
    read_uv() {
      return Math.round(this.volts() * 1e6);
    }
    atten() {}
    width() {}
  }
  const i2cScan = () => {
    const DEF: Record<string, string> = { lcd1602: "0x27", bme280: "0x76", bh1750: "0x23" };
    return Object.keys(DEF)
      .map((t) => {
        const p = hal.findI2C([t]);
        return p ? parseInt(String(p.props.address ?? DEF[t]), 16) : -1;
      })
      .filter((a) => a >= 0);
  };
  const machine = {
    Pin,
    PWM,
    ADC,
    I2C: class {
      scan() {
        return i2cScan();
      }
    },
    time_pulse_us: (pin: unknown, _level: unknown = 1, timeout: unknown = 1_000_000) => {
      const id = (pin as { pinId?: string })?.pinId ?? resolve(pin);
      const sonar = id ? hal.findPart(id, ["hc-sr04"]) : undefined;
      if (!sonar || sonar.pin !== "ECHO") return -2;
      if (hal.partSupply(sonar.id, "VCC", "GND") < 4.3 || !hal.trigFired(sonar.id, "TRIG")) return -1;
      const d = hal.env().distance;
      const us = Math.round(d * 58.3);
      return d > 400 || us > num(timeout) ? -1 : us;
    },
    freq: () => (board.family === "rp2040" ? 125_000_000 : board.family === "esp8266" ? 80_000_000 : 240_000_000),
    reset: () => {
      throw STOP;
    },
    unique_id: () => [0xe6, 0x61, 0x38, 0x52],
  };
  const utime = {
    sleep: sleepS,
    sleep_ms: (ms: unknown) => hal.sleep(num(ms)),
    sleep_us: (us: unknown) => (num(us) >= 1000 ? hal.sleep(num(us) / 1000) : hal.yieldNow()),
    ticks_ms: () => Math.floor(hal.nowMs()),
    ticks_us: () => Math.floor(hal.nowMs() * 1000),
    ticks_diff: (a: unknown, b: unknown) => num(a) - num(b),
    ticks_add: (a: unknown, b: unknown) => num(a) + num(b),
    time: () => Math.floor(t0Epoch + hal.nowMs() / 1000),
    time_ns: () => Math.floor((t0Epoch + hal.nowMs() / 1000) * 1e9),
    monotonic: () => hal.nowMs() / 1000,
    perf_counter: () => hal.nowMs() / 1000,
    localtime: () => {
      const d = new Date((t0Epoch + hal.nowMs() / 1000) * 1000);
      return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getDay(), 0];
    },
    strftime: (fmt: unknown) => {
      const d = new Date((t0Epoch + hal.nowMs() / 1000) * 1000);
      const p = (n: number) => String(n).padStart(2, "0");
      return String(fmt).replace("%H", p(d.getHours())).replace("%M", p(d.getMinutes())).replace("%S", p(d.getSeconds())).replace("%Y", String(d.getFullYear())).replace("%m", p(d.getMonth() + 1)).replace("%d", p(d.getDate()));
    },
  };

  // ------------------------------------------------------------- dht / neopixel (MicroPython)
  class MPDHT {
    pinId?: string;
    t = NaN;
    h = NaN;
    eleven: boolean;
    constructor(p: unknown, eleven = false) {
      this.pinId = resolve(p);
      this.eleven = eleven;
    }
    measure() {
      const part = this.pinId ? hal.findPart(this.pinId, ["dht22"]) : undefined;
      if (!part || hal.partSupply(part.id, "VCC", "GND") < 2.9) throw new PyError("OSError", "[Errno 110] ETIMEDOUT");
      const env = hal.env();
      this.t = this.eleven ? Math.round(env.temperature) : Math.round(env.temperature * 10) / 10;
      this.h = this.eleven ? Math.round(env.humidity) : Math.round(env.humidity * 10) / 10;
    }
    temperature() {
      return this.t;
    }
    humidity() {
      return this.h;
    }
  }
  const dht = {
    DHT22: class extends MPDHT {
      constructor(p: unknown) {
        super(p, false);
      }
    },
    DHT11: class extends MPDHT {
      constructor(p: unknown) {
        super(p, true);
      }
    },
  };
  class NeoPixel {
    pinId?: string;
    n: number;
    buf: [number, number, number][];
    constructor(p: unknown, n: unknown) {
      this.pinId = resolve(p);
      this.n = num(n);
      this.buf = Array.from({ length: this.n }, () => [0, 0, 0] as [number, number, number]);
      return new Proxy(this, {
        get: (t, k) => (typeof k === "string" && /^\d+$/.test(k) ? t.buf[Number(k)] : (t as unknown as Record<string | symbol, unknown>)[k]),
        set: (t, k, v) => {
          if (typeof k === "string" && /^\d+$/.test(k)) t.buf[Number(k)] = v as [number, number, number];
          else (t as unknown as Record<string | symbol, unknown>)[k] = v;
          return true;
        },
      });
    }
    fill(c: [number, number, number]) {
      this.buf = this.buf.map(() => [...c] as [number, number, number]);
    }
    write() {
      if (!this.pinId) return;
      const part = hal.findPart(this.pinId, ["neopixel-ring"]);
      if (part) hal.setLib(part.id, { pixels: this.buf.map(([r, g, b]) => ((num(r) & 255) << 16) | ((num(g) & 255) << 8) | (num(b) & 255)) });
    }
    __len__() {
      return this.n;
    }
  }

  // ------------------------------------------------------------- network + MQTT
  const network = {
    STA_IF: 0,
    AP_IF: 1,
    WLAN: class {
      active() {
        return true;
      }
      connect() {
        if (!board.wifi) warnOnce("wifi", `${board.short} has no Wi-Fi radio — use an ESP32, ESP8266 or Pico W`);
        hal.wifiStart = hal.nowMs();
      }
      isconnected() {
        return hal.wifiStart !== null && hal.nowMs() - hal.wifiStart > 1500;
      }
      ifconfig() {
        return ["192.168.1.42", "255.255.255.0", "192.168.1.1", "8.8.8.8"];
      }
      disconnect() {
        hal.wifiStart = null;
      }
      status() {
        return this.isconnected() ? 3 : 1;
      }
    },
  };
  class MQTTClient {
    cb: unknown = null;
    queue: [string, string][] = [];
    off: (() => void) | null = null;
    subs = new Set<string>();
    constructor(..._a: unknown[]) {}
    set_callback(f: unknown) {
      this.cb = f;
    }
    connect() {
      this.off = hal.mqtt.onMessage((t, p) => {
        if ([...this.subs].some((s) => topicMatch(s, t))) this.queue.push([t, p]);
      });
      return 0;
    }
    disconnect() {
      this.off?.();
    }
    publish(topic: unknown, msg: unknown, ...rest: unknown[]) {
      const [a, kw] = splitKw(rest);
      hal.mqtt.publish(String(topic), pyStr(msg), Boolean(a[0] ?? kw.retain));
    }
    subscribe(topic: unknown) {
      this.subs.add(String(topic));
      hal.mqtt.subscribe(String(topic));
    }
    check_msg() {
      while (this.queue.length) {
        const [t, p] = this.queue.shift()!;
        call(this.cb, t, p);
      }
    }
    async wait_msg() {
      while (!this.queue.length) await hal.sleep(20);
      this.check_msg();
    }
    ping() {}
  }
  class PahoClient {
    on_message: unknown = null;
    on_connect: unknown = null;
    subs = new Set<string>();
    off: (() => void) | null = null;
    constructor(..._a: unknown[]) {}
    username_pw_set() {}
    connect() {
      this.off = hal.mqtt.onMessage((t, p) => {
        if ([...this.subs].some((s) => topicMatch(s, t))) call(this.on_message, this, null, { topic: t, payload: p, decode: () => p });
      });
      setTimeout(() => call(this.on_connect, this, null, {}, 0), 0);
      return 0;
    }
    loop_start() {}
    loop_stop() {}
    async loop_forever() {
      for (;;) await hal.sleep(1000);
    }
    loop() {}
    publish(topic: unknown, payload: unknown, ...rest: unknown[]) {
      const [a, kw] = splitKw(rest);
      hal.mqtt.publish(String(topic), pyStr(payload), Boolean(a[1] ?? kw.retain));
    }
    subscribe(topic: unknown) {
      this.subs.add(String(topic));
      hal.mqtt.subscribe(String(topic));
    }
    disconnect() {
      this.off?.();
    }
  }

  // ------------------------------------------------------------- RPi.GPIO
  const GPIO = {
    BCM: 11,
    BOARD: 10,
    OUT: 0,
    IN: 1,
    HIGH: 1,
    LOW: 0,
    PUD_OFF: 20,
    PUD_DOWN: 21,
    PUD_UP: 22,
    RISING: 31,
    FALLING: 32,
    BOTH: 33,
    setmode: (m: unknown) => {
      gpioMode = num(m) === 10 ? "BOARD" : "BCM";
    },
    getmode: () => (gpioMode === "BOARD" ? 10 : 11),
    setwarnings: () => undefined,
    setup: (...args: unknown[]) => {
      const [a, kw] = splitKw(args);
      const chans = Array.isArray(a[0]) ? (a[0] as unknown[]) : [a[0]];
      for (const ch of chans) {
        const id = resolve(ch, gpioMode);
        if (!id) continue;
        if (num(a[1]) === 0) {
          hal.setMode(id, "OUTPUT");
          if (kw.initial !== undefined) hal.writeDigital(id, num(kw.initial));
        } else {
          const pud = num(a[2] ?? kw.pull_up_down ?? 20);
          hal.setMode(id, pud === 22 ? "INPUT_PULLUP" : pud === 21 ? "INPUT_PULLDOWN" : "INPUT");
        }
      }
    },
    output: (ch: unknown, v: unknown) => {
      const chans = Array.isArray(ch) ? ch : [ch];
      const vals = Array.isArray(v) ? v : chans.map(() => v);
      chans.forEach((c, i) => {
        const id = resolve(c, gpioMode);
        if (!id) return;
        if (hal.getMode(id) !== "OUTPUT") warnOnce(`o${id}`, `GPIO.output on channel ${String(c)} before GPIO.setup(..., GPIO.OUT)`);
        hal.writeDigital(id, num(vals[i]) ? 1 : 0);
      });
    },
    input: (ch: unknown) => {
      const id = resolve(ch, gpioMode);
      return id ? hal.readDigital(id) : 0;
    },
    PWM: class {
      id?: string;
      f: number;
      dc = 0;
      constructor(ch: unknown, f: unknown) {
        this.id = resolve(ch, gpioMode);
        this.f = num(f);
      }
      private apply() {
        if (!this.id) return;
        if (this.f <= 400 && this.f >= 30) hal.writeServo(this.id, (this.dc / 100) * (1e6 / this.f));
        else hal.writePwm(this.id, this.dc / 100, this.f);
      }
      start(dc: unknown) {
        this.dc = num(dc);
        this.apply();
      }
      ChangeDutyCycle(dc: unknown) {
        this.dc = Math.max(0, Math.min(100, num(dc)));
        this.apply();
      }
      ChangeFrequency(f: unknown) {
        this.f = num(f);
        this.apply();
      }
      stop() {
        if (this.id) hal.writeDigital(this.id, 0);
      }
    },
    cleanup: () => {
      for (const p of board.pins) if (hal.getMode(p.id) === "OUTPUT") hal.writeDigital(p.id, 0);
    },
    add_event_detect: (...args: unknown[]) => {
      const [a, kw] = splitKw(args);
      const id = resolve(a[0], gpioMode);
      const edge = num(a[1]);
      if (id) hal.attachInterrupt(id, () => call(a[2] ?? kw.callback, a[0]), edge === 31 ? "RISING" : edge === 32 ? "FALLING" : "CHANGE");
    },
    add_event_callback: () => undefined,
    remove_event_detect: (ch: unknown) => {
      const id = resolve(ch, gpioMode);
      if (id) hal.detachInterrupt(id);
    },
    event_detected: () => false,
  };

  // ------------------------------------------------------------- gpiozero
  const devPin = (p: unknown) => resolve(p, "BCM");
  class OutputDevice {
    pinId?: string;
    activeHigh = true;
    _v = 0;
    blinkToken = 0;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.pinId = devPin(a[0] ?? kw.pin);
      if (kw.active_high === false) this.activeHigh = false;
      if (this.pinId) hal.setMode(this.pinId, "OUTPUT");
      this.set(num(kw.initial_value ?? 0));
    }
    protected set(v: number) {
      this._v = v;
      if (this.pinId) hal.writeDigital(this.pinId, (v > 0) === this.activeHigh ? 1 : 0);
    }
    on() {
      this.blinkToken++;
      this.set(1);
    }
    off() {
      this.blinkToken++;
      this.set(0);
    }
    toggle() {
      this.blinkToken++;
      this.set(this._v ? 0 : 1);
    }
    get value() {
      return this._v;
    }
    set value(v: unknown) {
      this.blinkToken++;
      this.set(num(v));
    }
    get is_lit() {
      return this._v > 0;
    }
    get is_active() {
      return this._v > 0;
    }
    blink(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      const on = num(a[0] ?? kw.on_time ?? 1);
      const off = num(a[1] ?? kw.off_time ?? 1);
      const n = (a[2] ?? kw.n ?? null) as number | null;
      const token = ++this.blinkToken;
      void (async () => {
        try {
          for (let i = 0; n === null || i < n; i++) {
            if (token !== this.blinkToken) return;
            this.set(1);
            await hal.sleep(on * 1000);
            if (token !== this.blinkToken) return;
            this.set(0);
            await hal.sleep(off * 1000);
          }
        } catch {
          /* stopped */
        }
      })();
    }
    close() {
      this.off();
    }
  }
  class PWMOutputDevice extends OutputDevice {
    freq = 100;
    constructor(...args: unknown[]) {
      super(...args);
      const [, kw] = splitKw(args);
      if (kw.frequency) this.freq = num(kw.frequency);
    }
    protected set(v: number) {
      this._v = Math.max(0, Math.min(1, v));
      if (this.pinId) hal.writePwm(this.pinId, this.activeHigh ? this._v : 1 - this._v, this.freq);
    }
    pulse(fadeIn: unknown = 1, fadeOut: unknown = 1) {
      const token = ++this.blinkToken;
      void (async () => {
        try {
          for (;;) {
            for (let i = 0; i <= 20; i++) {
              if (token !== this.blinkToken) return;
              this.set(i / 20);
              await hal.sleep((num(fadeIn) * 1000) / 20);
            }
            for (let i = 20; i >= 0; i--) {
              if (token !== this.blinkToken) return;
              this.set(i / 20);
              await hal.sleep((num(fadeOut) * 1000) / 20);
            }
          }
        } catch {
          /* stopped */
        }
      })();
    }
  }
  class RGBLED {
    r: PWMOutputDevice;
    g: PWMOutputDevice;
    b: PWMOutputDevice;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.r = new PWMOutputDevice(a[0] ?? kw.red);
      this.g = new PWMOutputDevice(a[1] ?? kw.green);
      this.b = new PWMOutputDevice(a[2] ?? kw.blue);
    }
    get color() {
      return [this.r.value, this.g.value, this.b.value];
    }
    set color(c: unknown) {
      const [r, g, b] = c as number[];
      this.r.value = r;
      this.g.value = g;
      this.b.value = b;
    }
    get value() {
      return this.color;
    }
    set value(c: unknown) {
      this.color = c;
    }
    on() {
      this.color = [1, 1, 1];
    }
    off() {
      this.color = [0, 0, 0];
    }
  }
  class InputDevice {
    pinId?: string;
    pullUp: boolean;
    cbs: Record<string, unknown> = {};
    polling = false;
    last = 0;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.pinId = devPin(a[0] ?? kw.pin);
      this.pullUp = (kw.pull_up ?? this.defaultPull()) !== false && (kw.pull_up ?? this.defaultPull()) !== null;
      if (this.pinId) hal.setMode(this.pinId, this.pullUp ? "INPUT_PULLUP" : "INPUT");
    }
    defaultPull(): boolean | null {
      return false;
    }
    get value() {
      if (!this.pinId) return 0;
      const raw = hal.readDigital(this.pinId);
      return this.pullUp ? 1 - raw : raw;
    }
    get is_active() {
      return this.value === 1;
    }
    private ensurePoll() {
      if (this.polling) return;
      this.polling = true;
      this.last = this.value;
      poll(() => {
        const v = this.value;
        if (v !== this.last) {
          call(v ? this.cbs.on : this.cbs.offcb);
          this.last = v;
        }
      });
    }
    protected setCb(kind: "on" | "offcb", f: unknown) {
      this.cbs[kind] = f;
      this.ensurePoll();
    }
    async waitFor(v: number, timeout?: unknown) {
      const end = timeout === undefined || timeout === null ? Infinity : hal.nowMs() + num(timeout) * 1000;
      while (this.value !== v && hal.nowMs() < end) await hal.sleep(5);
      return this.value === v;
    }
  }
  class Button extends InputDevice {
    defaultPull() {
      return true;
    }
    get is_pressed() {
      return this.value === 1;
    }
    set when_pressed(f: unknown) {
      this.setCb("on", f);
    }
    set when_released(f: unknown) {
      this.setCb("offcb", f);
    }
    wait_for_press(t?: unknown) {
      return this.waitFor(1, t);
    }
    wait_for_release(t?: unknown) {
      return this.waitFor(0, t);
    }
  }
  class MotionSensor extends InputDevice {
    get motion_detected() {
      return this.value === 1;
    }
    set when_motion(f: unknown) {
      this.setCb("on", f);
    }
    set when_no_motion(f: unknown) {
      this.setCb("offcb", f);
    }
    wait_for_motion(t?: unknown) {
      return this.waitFor(1, t);
    }
    wait_for_no_motion(t?: unknown) {
      return this.waitFor(0, t);
    }
  }
  class DigitalInputDevice extends InputDevice {
    set when_activated(f: unknown) {
      this.setCb("on", f);
    }
    set when_deactivated(f: unknown) {
      this.setCb("offcb", f);
    }
    wait_for_active(t?: unknown) {
      return this.waitFor(1, t);
    }
    wait_for_inactive(t?: unknown) {
      return this.waitFor(0, t);
    }
  }
  class GZServo {
    pinId?: string;
    minPw: number;
    maxPw: number;
    _v: number | null = 0;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.pinId = devPin(a[0] ?? kw.pin);
      this.minPw = num(kw.min_pulse_width ?? 0.001);
      this.maxPw = num(kw.max_pulse_width ?? 0.002);
      if (this.pinId) hal.setMode(this.pinId, "OUTPUT");
      this.value = kw.initial_value ?? 0;
    }
    get value() {
      return this._v;
    }
    set value(v: unknown) {
      if (v === null) {
        this._v = null;
        if (this.pinId) hal.writeDigital(this.pinId, 0);
        return;
      }
      this._v = Math.max(-1, Math.min(1, num(v)));
      const pw = this.minPw + ((this._v + 1) / 2) * (this.maxPw - this.minPw);
      if (this.pinId) hal.writeServo(this.pinId, Math.max(400, Math.min(2600, pw * 1e6)));
    }
    min() {
      this.value = -1;
    }
    mid() {
      this.value = 0;
    }
    max() {
      this.value = 1;
    }
    detach() {
      this.value = null;
    }
  }
  class AngularServo extends GZServo {
    minA: number;
    maxA: number;
    constructor(...args: unknown[]) {
      super(...args);
      const [, kw] = splitKw(args);
      this.minA = num(kw.min_angle ?? -90);
      this.maxA = num(kw.max_angle ?? 90);
    }
    get angle() {
      const v = this.value as number | null;
      return v === null ? null : this.minA + ((v + 1) / 2) * (this.maxA - this.minA);
    }
    set angle(a: unknown) {
      this.value = ((num(a) - this.minA) / (this.maxA - this.minA)) * 2 - 1;
    }
  }
  class DistanceSensor {
    echo?: string;
    trig?: string;
    maxD: number;
    constructor(...args: unknown[]) {
      const [a, kw] = splitKw(args);
      this.echo = devPin(a[0] ?? kw.echo);
      this.trig = devPin(a[1] ?? kw.trigger);
      this.maxD = num(kw.max_distance ?? 1);
      if (this.trig) hal.setMode(this.trig, "OUTPUT");
      if (this.echo) hal.setMode(this.echo, "INPUT");
    }
    get distance() {
      if (!this.echo) return this.maxD;
      const p = hal.findPart(this.echo, ["hc-sr04"]);
      if (!p || hal.partSupply(p.id, "VCC", "GND") < 4.3) return this.maxD;
      if (this.trig) {
        hal.writeDigital(this.trig, 1);
        hal.writeDigital(this.trig, 0);
      }
      return Math.min(this.maxD, hal.env().distance / 100);
    }
    get value() {
      return this.distance / this.maxD;
    }
  }
  class Buzzer extends OutputDevice {
    beep(on: unknown = 1, off: unknown = 1, n: unknown = null) {
      this.blink(on, off, n);
    }
  }
  const pause = async () => {
    for (;;) await hal.sleep(1000);
  };
  const gpiozero = {
    LED: OutputDevice,
    PWMLED: PWMOutputDevice,
    RGBLED,
    Buzzer,
    Button,
    MotionSensor,
    DigitalInputDevice,
    DigitalOutputDevice: OutputDevice,
    OutputDevice,
    PWMOutputDevice,
    Servo: GZServo,
    AngularServo,
    DistanceSensor,
    LineSensor: DigitalInputDevice,
  };

  const adafruit_dht = {
    DHT22: class {
      pinId?: string;
      constructor(p: unknown) {
        this.pinId = devPin(p);
      }
      private part() {
        const part = this.pinId ? hal.findPart(this.pinId, ["dht22"]) : undefined;
        if (!part || hal.partSupply(part.id, "VCC", "GND") < 2.9) throw new PyError("RuntimeError", "DHT sensor not found, check wiring");
        return part;
      }
      get temperature() {
        this.part();
        return Math.round(hal.env().temperature * 10) / 10;
      }
      get humidity() {
        this.part();
        return Math.round(hal.env().humidity * 10) / 10;
      }
      exit() {}
    },
  };
  (adafruit_dht as Record<string, unknown>).DHT11 = adafruit_dht.DHT22;
  const boardMod: Record<string, unknown> = {};
  for (let i = 0; i <= 27; i++) boardMod[`D${i}`] = i;
  Object.assign(boardMod, { SDA: 2, SCL: 3, I2C: () => ({ scan: i2cScan, try_lock: () => true, unlock: () => undefined }) });

  // ------------------------------------------------------------- I²C / 1-Wire sensors
  const i2cPart = (type: string) => hal.findI2C([type]);
  const noDev = (what: string) => new PyError("OSError", `[Errno 19] ENODEV — ${what} not found on the I2C bus`);
  const bmeRead = () => {
    const p = i2cPart("bme280");
    if (!p) throw noDev("BME280");
    const e = hal.env();
    const t = Math.round((e.temperature + (Math.random() - 0.5) * 0.04) * 100) / 100;
    const pa = Math.round((e.pressure + (Math.random() - 0.5) * 0.04) * 100 * 100) / 100;
    const h = p.props.model === "BMP280" ? 0 : Math.round(Math.max(0, Math.min(100, e.humidity)) * 100) / 100;
    return { t, pa, h };
  };
  class MPBME280 {
    constructor(..._a: unknown[]) {
      bmeRead();
    }
    get values() {
      const r = bmeRead();
      return [`${r.t.toFixed(2)}C`, `${(r.pa / 100).toFixed(2)}hPa`, `${r.h.toFixed(2)}%`];
    }
    get temperature() {
      return this.values[0];
    }
    get pressure() {
      return this.values[1];
    }
    get humidity() {
      return this.values[2];
    }
    read_compensated_data() {
      const r = bmeRead();
      return [r.t, r.pa, r.h];
    }
  }
  const bme280 = { BME280: MPBME280 };
  class MPBH1750 {
    static CONT_HIRES_1 = 0x10;
    static CONT_HIRES_2 = 0x11;
    static ONCE_HIRES_1 = 0x20;
    constructor(..._a: unknown[]) {
      if (!i2cPart("bh1750")) throw noDev("BH1750");
    }
    luminance(_mode?: unknown) {
      if (!i2cPart("bh1750")) throw noDev("BH1750");
      return Math.round(Math.max(0, Math.min(65535, hal.env().lux)) * 10) / 10;
    }
    get lux() {
      return this.luminance();
    }
    on() {}
    off() {}
    reset() {}
  }
  const bh1750 = { BH1750: MPBH1750 };
  class MPOneWire {
    pinId?: string;
    constructor(p: unknown) {
      this.pinId = (p as { pinId?: string })?.pinId ?? resolve(p);
    }
    probe() {
      const part = this.pinId ? hal.findPart(this.pinId, ["ds18b20"]) : undefined;
      return part && part.pin === "DATA" && hal.partSupply(part.id, "VCC", "GND") > 2.9 ? part : undefined;
    }
    scan() {
      return this.probe() ? [[0x28, 0xff, 0x64, 0x1e, 0x0f, 0x3c, 0x45, 0x91]] : [];
    }
    reset() {
      return !!this.probe();
    }
  }
  class DS18X20 {
    ow: MPOneWire;
    constructor(ow: unknown) {
      this.ow = ow as MPOneWire;
    }
    scan() {
      return this.ow.scan();
    }
    convert_temp() {}
    read_temp(_rom?: unknown) {
      if (!this.ow.probe()) throw new PyError("Exception", "CRC error — no DS18B20 answered");
      return Math.round((hal.env().temperature + (Math.random() - 0.5) * 0.1) * 16) / 16;
    }
  }
  const onewire = { OneWire: MPOneWire };
  const ds18x20 = { DS18X20 };
  // Raspberry Pi (Blinka / w1thermsensor)
  class BlinkaBME280 {
    sea_level_pressure = 1013.25;
    constructor(..._a: unknown[]) {
      bmeRead();
    }
    get temperature() {
      return bmeRead().t;
    }
    get relative_humidity() {
      return bmeRead().h;
    }
    get humidity() {
      return bmeRead().h;
    }
    get pressure() {
      return bmeRead().pa / 100;
    }
    get altitude() {
      return 44330 * (1 - Math.pow(bmeRead().pa / 100 / this.sea_level_pressure, 0.1903));
    }
  }
  const adafruit_bme280 = { Adafruit_BME280_I2C: BlinkaBME280, basic: { Adafruit_BME280_I2C: BlinkaBME280 } };
  const adafruit_bh1750 = {
    BH1750: class {
      constructor(..._a: unknown[]) {
        if (!i2cPart("bh1750")) throw noDev("BH1750");
      }
      get lux() {
        return Math.round(Math.max(0, hal.env().lux) * 10) / 10;
      }
    },
  };
  const w1thermsensor = {
    W1ThermSensor: class {
      constructor(..._a: unknown[]) {
        const pin = board.pins.find((x) => x.gpio === 4);
        const part = pin ? hal.findPart(pin.id, ["ds18b20"]) : undefined;
        if (!part) throw new PyError("NoSensorFoundError", "No DS18B20 on GPIO4 (the 1-Wire pin) — wire DATA to GPIO4");
      }
      get_temperature() {
        return Math.round(hal.env().temperature * 16) / 16;
      }
    },
  };

  const random = {
    randint: (a: unknown, b: unknown) => num(a) + Math.floor(Math.random() * (num(b) - num(a) + 1)),
    random: () => Math.random(),
    uniform: (a: unknown, b: unknown) => num(a) + Math.random() * (num(b) - num(a)),
    choice: (s: unknown[]) => s[Math.floor(Math.random() * s.length)],
    getrandbits: (n: unknown) => Math.floor(Math.random() * 2 ** num(n)),
    randrange: (a: unknown, b?: unknown) => (b === undefined ? Math.floor(Math.random() * num(a)) : num(a) + Math.floor(Math.random() * (num(b) - num(a)))),
    seed: () => undefined,
  };
  const math = {
    pi: Math.PI,
    e: Math.E,
    inf: Infinity,
    nan: NaN,
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    atan: Math.atan,
    atan2: Math.atan2,
    asin: Math.asin,
    acos: Math.acos,
    floor: Math.floor,
    ceil: Math.ceil,
    fabs: Math.abs,
    log: (x: number, b?: number) => (b ? Math.log(x) / Math.log(b) : Math.log(x)),
    log10: Math.log10,
    exp: Math.exp,
    pow: Math.pow,
    radians: (d: number) => (d * Math.PI) / 180,
    degrees: (r: number) => (r * 180) / Math.PI,
    isnan: Number.isNaN,
    hypot: Math.hypot,
    trunc: Math.trunc,
  };

  const isClass = (f: unknown): f is new (...a: unknown[]) => unknown => typeof f === "function" && /^class[\s{]/.test(Function.prototype.toString.call(f));
  const proxied = new WeakMap<object, unknown>();
  const callable = (C: new (...a: unknown[]) => unknown) => {
    if (proxied.has(C)) return proxied.get(C);
    const p = new Proxy(C, { apply: (target, _this, args) => new target(...args) });
    proxied.set(C, p);
    return p;
  };
  const wrapModule = (m: unknown, depth = 0): unknown => {
    if (!m || typeof m !== "object" || depth > 3) return m;
    for (const k of Object.keys(m)) {
      const v = (m as Record<string, unknown>)[k];
      if (isClass(v)) (m as Record<string, unknown>)[k] = callable(v);
      else if (v && typeof v === "object" && !Array.isArray(v)) wrapModule(v, depth + 1);
    }
    return m;
  };
  const modules: Record<string, unknown> = {
    machine,
    utime,
    time: utime,
    dht,
    neopixel: { NeoPixel },
    network,
    "umqtt.simple": { MQTTClient },
    "umqtt.robust": { MQTTClient },
    umqtt: { simple: { MQTTClient } },
    "RPi.GPIO": GPIO,
    RPi: { GPIO },
    gpiozero,
    signal: { pause },
    adafruit_dht,
    adafruit_bme280,
    "adafruit_bme280.basic": adafruit_bme280.basic,
    adafruit_bh1750,
    w1thermsensor,
    bme280,
    bh1750,
    onewire,
    ds18x20,
    board: boardMod,
    random,
    math,
    json: { dumps: (o: unknown) => JSON.stringify(o), loads: (s: string) => JSON.parse(s) },
    ujson: { dumps: (o: unknown) => JSON.stringify(o), loads: (s: string) => JSON.parse(s) },
    sys: { exit: () => { throw STOP; }, platform: board.family === "bcm2711" ? "linux" : "rp2" },
    gc: { collect: () => undefined, mem_free: () => 180_000 },
    "paho.mqtt.client": { Client: PahoClient },
    paho: { mqtt: { client: { Client: PahoClient } } },
    os: { uname: () => ({ sysname: board.short }) },
  };

  for (const m of Object.values(modules)) wrapModule(m);

  const print = (...args: unknown[]) => {
    const [a, kw] = splitKw(args);
    const sep = kw.sep !== undefined ? String(kw.sep) : " ";
    const end = kw.end !== undefined ? String(kw.end) : "\n";
    hal.serialOut(a.map(pyStr).join(sep) + end);
  };
  const range = (a: unknown, b?: unknown, s: unknown = 1) => {
    let start = 0;
    let stop = num(a);
    if (b !== undefined) {
      start = num(a);
      stop = num(b);
    }
    const step = num(s) || 1;
    const out: number[] = [];
    if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
    else for (let i = start; i > stop; i += step) out.push(i);
    return out;
  };
  const iter = (x: unknown): Iterable<unknown> => {
    if (x === null || x === undefined) return [];
    if (typeof x === "string" || Array.isArray(x)) return x;
    if (typeof x === "object" && Symbol.iterator in (x as object)) return x as Iterable<unknown>;
    if (typeof x === "object") return Object.keys(x as object);
    throw new PyError("TypeError", `'${typeof x}' object is not iterable`);
  };
  const len = (x: unknown) => {
    if (typeof x === "string" || Array.isArray(x)) return x.length;
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.__len__ === "function") return (o.__len__ as () => number)();
      return Object.keys(o).length;
    }
    return 0;
  };
  const truthy = (x: unknown) => {
    if (Array.isArray(x) || typeof x === "string") return x.length > 0;
    if (x && typeof x === "object" && x.constructor === Object) return Object.keys(x).length > 0;
    return !!x;
  };
  const excCls = (name: string) => (msg: unknown = "") => new PyError(name, pyStr(msg));

  return {
    __mod: (name: string) => {
      const m = modules[name];
      if (m === undefined) {
        warnOnce(`mod${name}`, `Module '${name}' is not available in the simulator`);
        return {};
      }
      return m;
    },
    __y: () => hal.yieldNow(),
    __t: truthy,
    __iter: iter,
    __in: (a: unknown, b: unknown) => {
      if (typeof b === "string") return b.includes(String(a));
      if (Array.isArray(b)) return b.some((x) => x === a || (Array.isArray(x) && Array.isArray(a) && x.join() === a.join()));
      if (b && typeof b === "object") return Object.prototype.hasOwnProperty.call(b, String(a));
      return false;
    },
    __floordiv: (a: unknown, b: unknown) => Math.floor(num(a) / num(b)),
    __fmt: pyFormat,
    __str: pyStr,
    __pctfmt: (fmt: string, args: unknown) => {
      const list = Array.isArray(args) ? args : [args];
      let i = 0;
      return fmt.replace(/%([-0 +]*)(\d*)(?:\.(\d+))?([sdifxXr%])/g, (_m, _f, w, p, c) => {
        if (c === "%") return "%";
        const v = list[i++];
        let s = c === "d" || c === "i" ? String(Math.trunc(num(v))) : c === "f" ? num(v).toFixed(p ? Number(p) : 6) : c === "x" ? Math.trunc(num(v)).toString(16) : c === "X" ? Math.trunc(num(v)).toString(16).toUpperCase() : pyStr(v);
        if (w) s = s.padStart(Number(w));
        return s;
      });
    },
    __rethrowStop: (e: unknown) => {
      if (e === STOP) throw e;
    },
    __raise: (e: unknown) => (e instanceof Error ? e : typeof e === "function" ? (e as () => Error)() : new PyError("Exception", pyStr(e))),
    __assert: (c: unknown) => {
      if (!truthy(c)) throw new PyError("AssertionError", "assertion failed");
    },
    __name__: "__main__",
    print,
    range,
    len,
    str: (x: unknown = "") => pyStr(x),
    repr: pyRepr,
    int: (x: unknown = 0, base?: unknown) => (typeof x === "string" ? parseInt(x, base ? num(base) : 10) : Math.trunc(num(x))),
    float: (x: unknown = 0) => (typeof x === "string" ? parseFloat(x) : num(x)),
    bool: truthy,
    abs: (x: unknown) => Math.abs(num(x)),
    min: (...a: unknown[]) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? (a[0] as unknown[]) : a).map(num)),
    max: (...a: unknown[]) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? (a[0] as unknown[]) : a).map(num)),
    sum: (a: unknown[]) => a.reduce((s: number, x) => s + num(x), 0),
    round: (x: unknown, n?: unknown) => (n === undefined || n === null ? Math.round(num(x)) : Math.round(num(x) * 10 ** num(n)) / 10 ** num(n)),
    sorted: (a: unknown[], ...rest: unknown[]) => {
      const [, kw] = splitKw(rest);
      const out = [...a].sort((x, y) => (num(x) > num(y) ? 1 : num(x) < num(y) ? -1 : 0));
      return kw.reverse ? out.reverse() : out;
    },
    reversed: (a: unknown[]) => [...a].reverse(),
    list: (a: unknown = []) => [...iter(a)],
    tuple: (a: unknown = []) => [...iter(a)],
    dict: (o: unknown = {}) => ({ ...(o as object) }),
    enumerate: (a: unknown, start: unknown = 0) => [...iter(a)].map((x, i) => [i + num(start), x]),
    zip: (...arrs: unknown[][]) => arrs[0].map((_, i) => arrs.map((a) => a[i])).filter((_, i) => arrs.every((a) => i < a.length)),
    chr: (n: unknown) => String.fromCharCode(num(n)),
    ord: (s: unknown) => String(s).charCodeAt(0),
    hex: (n: unknown) => "0x" + Math.trunc(num(n)).toString(16),
    bin: (n: unknown) => "0b" + Math.trunc(num(n)).toString(2),
    isinstance: () => true,
    input: () => {
      let s = "";
      while (hal.serialAvailable()) s += String.fromCharCode(hal.serialRead());
      return s.trim();
    },
    Exception: excCls("Exception"),
    ValueError: excCls("ValueError"),
    RuntimeError: excCls("RuntimeError"),
    OSError: excCls("OSError"),
    TypeError: excCls("TypeError"),
    KeyboardInterrupt: excCls("KeyboardInterrupt"),
    // common bare names from `from X import Y` are injected via __mod, but also expose a few
    sleep: sleepS,
    sleep_ms: utime.sleep_ms,
    sleep_us: utime.sleep_us,
    pause,
  };
}

// Python list helpers (append/extend) and str helpers used by transpiled code
let pyPatched = false;
export function patchPythonPrototypes() {
  if (pyPatched) return;
  pyPatched = true;
  const def = (proto: object, name: string, fn: (...a: never[]) => unknown) => {
    if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, enumerable: false, writable: true, configurable: true });
  };
  def(Array.prototype, "append", function (this: unknown[], x: never) {
    this.push(x);
  });
  def(Array.prototype, "extend", function (this: unknown[], x: never) {
    this.push(...(x as unknown[]));
  });
  def(Array.prototype, "insert", function (this: unknown[], i: never, x: never) {
    this.splice(i, 0, x);
  });
  def(Array.prototype, "remove", function (this: unknown[], x: never) {
    const i = this.indexOf(x);
    if (i >= 0) this.splice(i, 1);
  });
  def(Array.prototype, "count", function (this: unknown[], x: never) {
    return this.filter((y) => y === x).length;
  });
  def(Array.prototype, "index", function (this: unknown[], x: never) {
    return this.indexOf(x);
  });
  def(String.prototype, "upper", function (this: string) {
    return this.toUpperCase();
  });
  def(String.prototype, "lower", function (this: string) {
    return this.toLowerCase();
  });
  def(String.prototype, "strip", function (this: string) {
    return this.trim();
  });
  def(String.prototype, "startswith", function (this: string, s: never) {
    return this.startsWith(s);
  });
  def(String.prototype, "endswith", function (this: string, s: never) {
    return this.endsWith(s);
  });
  def(String.prototype, "format", function (this: string, ...a: never[]) {
    let i = 0;
    return this.replace(/\{(\d*)(?::([^}]*))?\}/g, (_m, idx: string, spec: string) => {
      const v = a[idx === "" ? i++ : Number(idx)];
      return spec ? pyFormat(v, spec) : pyStr(v);
    });
  });
  def(String.prototype, "encode", function (this: string) {
    return this;
  });
  def(String.prototype, "decode", function (this: string) {
    return this;
  });
}
