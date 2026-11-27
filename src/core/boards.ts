import type { BoardDef, BoardPin, Cap } from "./types";

const P = 2.54;

function gpioPin(
  id: string,
  label: string,
  x: number,
  y: number,
  gpio: number,
  caps: Cap[],
  aliases: string[] = [],
  extra: Partial<BoardPin> = {},
): BoardPin {
  return { id, label, x, y, kind: "gpio", gpio, caps, aliases, ...extra };
}

function powerPin(id: string, label: string, x: number, y: number, volts: number, aliases: string[] = []): BoardPin {
  return { id, label, x, y, kind: volts === 0 ? "gnd" : "power", volts, caps: [], aliases };
}

function ctrlPin(id: string, label: string, x: number, y: number, aliases: string[] = []): BoardPin {
  return { id, label, x, y, kind: "ctrl", caps: [], aliases };
}

// ---------------------------------------------------------------------------
// ESP32 DevKit V1 (DOIT, 30 pin). Horizontal: USB on the left, antenna right.
// ---------------------------------------------------------------------------
function esp32(): BoardDef {
  const x0 = 7.0;
  const top = 1.3;
  const bottom = 26.7;
  const topRow: Array<[string, number | null]> = [
    ["VIN", null],
    ["GND", null],
    ["D13", 13],
    ["D12", 12],
    ["D14", 14],
    ["D27", 27],
    ["D26", 26],
    ["D25", 25],
    ["D33", 33],
    ["D32", 32],
    ["D35", 35],
    ["D34", 34],
    ["VN", 39],
    ["VP", 36],
    ["EN", null],
  ];
  const bottomRow: Array<[string, number | null]> = [
    ["3V3", null],
    ["GND", null],
    ["D15", 15],
    ["D2", 2],
    ["D4", 4],
    ["RX2", 16],
    ["TX2", 17],
    ["D5", 5],
    ["D18", 18],
    ["D19", 19],
    ["D21", 21],
    ["RX0", 3],
    ["TX0", 1],
    ["D22", 22],
    ["D23", 23],
  ];
  const adc1 = [32, 33, 34, 35, 36, 39];
  const adc2 = [0, 2, 4, 12, 13, 14, 15, 25, 26, 27];
  const touch = [0, 2, 4, 12, 13, 14, 15, 27, 32, 33];
  const inputOnly = [34, 35, 36, 39];
  const strapping: Record<number, string> = {
    0: "strapping pin (boot mode)",
    2: "strapping pin, on-board LED",
    5: "strapping pin",
    12: "strapping pin (flash voltage) — keep LOW at boot",
    15: "strapping pin",
    1: "UART0 TX (USB serial)",
    3: "UART0 RX (USB serial)",
  };
  const pins: BoardPin[] = [];
  const build = (row: Array<[string, number | null]>, y: number, side: string) => {
    row.forEach(([label, gpio], i) => {
      const x = x0 + i * P;
      const id = `${side}${i}`;
      if (gpio === null) {
        if (label === "GND") pins.push(powerPin(id, "GND", x, y, 0, ["GND"]));
        else if (label === "VIN") pins.push(powerPin(id, "VIN", x, y, 5, ["VIN", "5V", "VUSB"]));
        else if (label === "3V3") pins.push(powerPin(id, "3V3", x, y, 3.3, ["3V3", "3.3V", "VCC"]));
        else pins.push(ctrlPin(id, label, x, y, [label]));
        return;
      }
      const caps: Cap[] = ["digital"];
      if (!inputOnly.includes(gpio)) caps.push("pwm");
      if (adc1.includes(gpio) || adc2.includes(gpio)) caps.push("adc");
      if (gpio === 25 || gpio === 26) caps.push("dac");
      if (touch.includes(gpio)) caps.push("touch");
      if (gpio === 21) caps.push("sda");
      if (gpio === 22) caps.push("scl");
      if (gpio === 1 || gpio === 17) caps.push("tx");
      if (gpio === 3 || gpio === 16) caps.push("rx");
      if (gpio === 23) caps.push("mosi");
      if (gpio === 19) caps.push("miso");
      if (gpio === 18) caps.push("sck");
      const aliases = [`D${gpio}`, `GPIO${gpio}`, `IO${gpio}`, `G${gpio}`, String(gpio), label];
      const extra: Partial<BoardPin> = {};
      if (inputOnly.includes(gpio)) extra.inputOnly = true;
      if (strapping[gpio]) extra.avoid = strapping[gpio];
      if (adc2.includes(gpio) && !extra.avoid) extra.avoid = undefined;
      pins.push(gpioPin(id, label, x, y, gpio, caps, aliases, extra));
    });
  };
  build(topRow, top, "t");
  build(bottomRow, bottom, "b");
  return {
    id: "esp32-devkit-v1",
    name: "ESP32 DevKit V1 (30-pin)",
    short: "ESP32",
    vendor: "Espressif / DOIT",
    mcu: "ESP32-D0WD (Xtensa LX6 dual-core 240 MHz)",
    family: "esp32",
    width: 51.5,
    height: 28.0,
    thickness: 1.6,
    logicV: 3.3,
    adcBits: 12,
    adcVref: 3.3,
    intBits: 32,
    pcbColor: "#16191d",
    silkColor: "#e8ecef",
    pins,
    holes: [],
    connectors: [
      { id: "usb", label: "Micro-USB", kind: "usb-micro", x: -1.2, y: 10.2, w: 5.6, h: 7.6, z: 3.0, edge: "left" },
      { id: "en", label: "EN", kind: "button", x: 4.6, y: 4.2, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "boot", label: "BOOT", kind: "button", x: 4.6, y: 20.6, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "ant", label: "PCB antenna", kind: "antenna", x: 45.0, y: 5.0, w: 6.5, h: 18.0, z: 0.8, edge: "right" },
    ],
    chips: [
      { x: 26.0, y: 5.0, w: 19.0, h: 18.0, label: "ESP-WROOM-32", color: "#c9ccd1", z: 3.1, metal: true },
      { x: 12.5, y: 9.8, w: 5.0, h: 5.0, label: "CP2102", color: "#1d1f22", z: 1.0 },
      { x: 19.4, y: 10.2, w: 3.0, h: 6.0, label: "AMS1117", color: "#1d1f22", z: 1.6 },
    ],
    languages: ["arduino", "micropython"],
    defaultLang: "arduino",
    builtinLed: "b3",
    constants: {
      LED_BUILTIN: 2,
      A0: 36,
      A3: 39,
      A4: 32,
      A5: 33,
      A6: 34,
      A7: 35,
      A10: 4,
      A11: 0,
      A12: 2,
      A13: 15,
      A14: 13,
      A15: 12,
      A16: 14,
      A17: 27,
      A18: 25,
      A19: 26,
      SDA: 21,
      SCL: 22,
      DAC1: 25,
      DAC2: 26,
      T0: 4,
      T3: 15,
    },
    i2c: { sda: "b10", scl: "b13" },
    notes: [
      "Logic level is 3.3 V — 5 V signals on a GPIO can damage the chip.",
      "GPIO 34, 35, 36 (VP) and 39 (VN) are input-only and have no internal pull-ups.",
      "ADC2 pins cannot be read while Wi-Fi is active; prefer ADC1 (GPIO 32–39) for analog sensors.",
    ],
    maxComponentZ: 3.6,
  };
}

// ---------------------------------------------------------------------------
// Arduino Uno R3. USB-B and barrel jack on the left edge, digital header top.
// ---------------------------------------------------------------------------
function uno(): BoardDef {
  const IN = 25.4;
  const H = 53.34;
  const topY = H - 2.0 * IN; // 2.54
  const botY = H - 0.1 * IN; // 50.8
  const pins: BoardPin[] = [];
  const digitalX = (n: number) => (n <= 7 ? 2.6 - n * 0.1 : 1.74 - (n - 8) * 0.1) * IN;
  for (let n = 0; n <= 13; n++) {
    const caps: Cap[] = ["digital"];
    if ([3, 5, 6, 9, 10, 11].includes(n)) caps.push("pwm");
    if (n === 0) caps.push("rx");
    if (n === 1) caps.push("tx");
    if (n === 11) caps.push("mosi");
    if (n === 12) caps.push("miso");
    if (n === 13) caps.push("sck");
    const extra: Partial<BoardPin> = {};
    if (n === 0 || n === 1) extra.avoid = "used by USB serial (Serial.print)";
    pins.push(
      gpioPin(`d${n}`, `${n}${caps.includes("pwm") ? "~" : ""}`, digitalX(n), topY, n, caps, [`D${n}`, `PIN${n}`, String(n)], extra),
    );
  }
  pins.push(powerPin("gnd_t", "GND", 1.14 * IN, topY, 0, ["GND"]));
  pins.push(ctrlPin("aref", "AREF", 1.04 * IN, topY, ["AREF"]));
  pins.push(gpioPin("sda_t", "SDA", 0.94 * IN, topY, 18, ["digital", "sda"], ["SDA"], { avoid: "shared with A4" }));
  pins.push(gpioPin("scl_t", "SCL", 0.84 * IN, topY, 19, ["digital", "scl"], ["SCL"], { avoid: "shared with A5" }));
  // power header
  const pw: Array<[string, string, number | null]> = [
    ["nc", "NC", null],
    ["ioref", "IOREF", 5],
    ["reset", "RESET", null],
    ["3v3", "3.3V", 3.3],
    ["5v", "5V", 5],
    ["gnd1", "GND", 0],
    ["gnd2", "GND", 0],
    ["vin", "VIN", 5],
  ];
  pw.forEach(([id, label, v], i) => {
    const x = (1.1 + i * 0.1) * IN;
    if (v === null) pins.push(ctrlPin(id, label, x, botY, [label]));
    else pins.push(powerPin(id, label, x, botY, v, v === 0 ? ["GND"] : v === 3.3 ? ["3V3", "3.3V"] : id === "5v" ? ["5V", "VCC"] : [label]));
  });
  for (let a = 0; a <= 5; a++) {
    const caps: Cap[] = ["digital", "adc"];
    if (a === 4) caps.push("sda");
    if (a === 5) caps.push("scl");
    pins.push(gpioPin(`a${a}`, `A${a}`, (2.0 + a * 0.1) * IN, botY, 14 + a, caps, [`A${a}`, String(14 + a)]));
  }
  return {
    id: "arduino-uno",
    name: "Arduino Uno R3",
    short: "Uno",
    vendor: "Arduino",
    mcu: "ATmega328P (AVR 16 MHz)",
    family: "avr",
    width: 68.58,
    height: H,
    thickness: 1.6,
    logicV: 5,
    adcBits: 10,
    adcVref: 5,
    intBits: 16,
    pcbColor: "#00838a",
    silkColor: "#f4fbfb",
    pins,
    holes: [
      { x: 0.55 * IN, y: H - 0.1 * IN, d: 3.2 },
      { x: 0.6 * IN, y: H - 2.0 * IN, d: 3.2 },
      { x: 2.6 * IN, y: H - 0.3 * IN, d: 3.2 },
      { x: 2.6 * IN, y: H - 1.4 * IN, d: 3.2 },
    ],
    connectors: [
      { id: "usb", label: "USB-B", kind: "usb-b", x: -6.4, y: 9.4, w: 16.3, h: 12.0, z: 10.9, edge: "left" },
      { id: "dc", label: "DC jack 7–12 V", kind: "barrel", x: -1.9, y: 39.4, w: 14.2, h: 9.0, z: 11.0, edge: "left" },
      { id: "reset", label: "RESET", kind: "button", x: 5.2, y: 1.8, w: 6.0, h: 6.0, z: 4.0, edge: null },
      { id: "icsp", label: "ICSP", kind: "header", x: 63.0, y: 24.0, w: 5.1, h: 7.6, z: 8.5, edge: null },
    ],
    chips: [
      { x: 31.0, y: 36.4, w: 35.6, h: 7.6, label: "ATMEGA328P-PU", color: "#1b1d20", z: 4.2 },
      { x: 16.0, y: 12.4, w: 7.0, h: 7.0, label: "16U2", color: "#1b1d20", z: 1.0 },
      { x: 27.0, y: 44.6, w: 7.0, h: 3.0, label: "16MHz", color: "#c9ccd1", z: 3.5, metal: true },
    ],
    languages: ["arduino"],
    defaultLang: "arduino",
    builtinLed: "d13",
    constants: { LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, SDA: 18, SCL: 19 },
    i2c: { sda: "a4", scl: "a5" },
    notes: [
      "Each I/O pin should stay below 20 mA (40 mA absolute max).",
      "A4/A5 are also the I²C bus (SDA/SCL).",
      "`int` is 16-bit on AVR: values wrap past 32767.",
    ],
    maxComponentZ: 11.0,
  };
}

// ---------------------------------------------------------------------------
// Raspberry Pi Pico (RP2040). Horizontal: USB on the left.
// ---------------------------------------------------------------------------
function pico(): BoardDef {
  const W = 51;
  const H = 21;
  const topY = (H - 17.78) / 2;
  const botY = H - topY;
  const x0 = W / 2 - 9.5 * P;
  const pins: BoardPin[] = [];
  // bottom row: physical pins 1..20 (left to right)
  const left: Array<string | number> = ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND", "GP6", "GP7", "GP8", "GP9", "GND", "GP10", "GP11", "GP12", "GP13", "GND", "GP14", "GP15"];
  // top row: physical pins 40..21 (left to right)
  const right: string[] = ["VBUS", "VSYS", "GND", "3V3_EN", "3V3", "ADC_VREF", "GP28", "AGND", "GP27", "GP26", "RUN", "GP22", "GND", "GP21", "GP20", "GP19", "GP18", "GND", "GP17", "GP16"];
  const capsFor = (g: number): Cap[] => {
    const caps: Cap[] = ["digital", "pwm"];
    if (g >= 26 && g <= 28) caps.push("adc");
    if (g === 4 || g === 8 || g === 12 || g === 16 || g === 20 || g === 0 || g === 2 || g === 6 || g === 10 || g === 14 || g === 18 || g === 26) {
      if ([0, 4, 8, 12, 16, 20, 2, 6, 10, 14, 18, 26].includes(g)) caps.push("sda");
    }
    if ([1, 5, 9, 13, 17, 21, 3, 7, 11, 15, 19, 27].includes(g)) caps.push("scl");
    if ([0, 4, 8, 12, 16].includes(g)) caps.push("tx");
    if ([1, 5, 9, 13, 17].includes(g)) caps.push("rx");
    return caps;
  };
  const add = (label: string, x: number, y: number, phys: number) => {
    const id = `p${phys}`;
    if (label.startsWith("GP")) {
      const g = Number(label.slice(2));
      pins.push(gpioPin(id, label, x, y, g, capsFor(g), [label, `GPIO${g}`, `D${g}`, String(g), `PIN${phys}`], { phys }));
    } else if (label === "GND" || label === "AGND") {
      pins.push({ ...powerPin(id, label, x, y, 0, ["GND"]), phys });
    } else if (label === "VBUS") {
      pins.push({ ...powerPin(id, "VBUS", x, y, 5, ["VBUS", "5V", "VUSB"]), phys });
    } else if (label === "VSYS") {
      pins.push({ ...powerPin(id, "VSYS", x, y, 4.8, ["VSYS"]), phys });
    } else if (label === "3V3") {
      pins.push({ ...powerPin(id, "3V3", x, y, 3.3, ["3V3", "3.3V", "VCC", "3V3(OUT)"]), phys });
    } else {
      pins.push({ ...ctrlPin(id, label, x, y, [label]), phys });
    }
  };
  left.forEach((label, i) => add(String(label), x0 + i * P, botY, i + 1));
  right.forEach((label, i) => add(label, x0 + i * P, topY, 40 - i));
  return {
    id: "rpi-pico",
    name: "Raspberry Pi Pico",
    short: "Pico",
    vendor: "Raspberry Pi",
    mcu: "RP2040 (dual Cortex-M0+ 133 MHz)",
    family: "rp2040",
    width: W,
    height: H,
    thickness: 1.0,
    logicV: 3.3,
    adcBits: 12,
    adcVref: 3.3,
    intBits: 32,
    pcbColor: "#14623a",
    silkColor: "#f2f7f3",
    pins,
    holes: [
      { x: 2.0, y: 4.8, d: 2.1 },
      { x: 2.0, y: 16.2, d: 2.1 },
      { x: 49.0, y: 4.8, d: 2.1 },
      { x: 49.0, y: 16.2, d: 2.1 },
    ],
    connectors: [
      { id: "usb", label: "Micro-USB", kind: "usb-micro", x: -1.3, y: 6.75, w: 5.6, h: 7.5, z: 2.8, edge: "left" },
      { id: "bootsel", label: "BOOTSEL", kind: "button", x: 9.0, y: 6.5, w: 4.0, h: 3.4, z: 1.6, edge: null },
    ],
    chips: [
      { x: 22.0, y: 7.0, w: 7.0, h: 7.0, label: "RP2-B2", color: "#1b1d20", z: 0.9 },
      { x: 13.5, y: 11.0, w: 5.0, h: 5.0, label: "W25Q16", color: "#1b1d20", z: 0.9 },
      { x: 32.0, y: 8.5, w: 3.2, h: 2.5, label: "12MHz", color: "#c9ccd1", z: 0.9, metal: true },
    ],
    languages: ["micropython", "arduino"],
    defaultLang: "micropython",
    builtinLed: undefined,
    constants: { LED_BUILTIN: 25, A0: 26, A1: 27, A2: 28, SDA: 4, SCL: 5 },
    i2c: { sda: "p6", scl: "p7" },
    notes: [
      "3.3 V logic. ADC on GP26, GP27, GP28 (12-bit).",
      "The on-board LED is GP25 (not on the header). In MicroPython use Pin('LED').",
      "Every GP pin supports PWM.",
    ],
    maxComponentZ: 2.8,
  };
}

// ---------------------------------------------------------------------------
// Raspberry Pi 4 Model B. 40-pin header along the top edge.
// ---------------------------------------------------------------------------
function pi4(): BoardDef {
  const W = 85;
  const H = 56;
  const pins: BoardPin[] = [];
  const header: Array<[number, string, number | null]> = [
    [1, "3V3", null], [2, "5V", null], [3, "GPIO2", 2], [4, "5V", null], [5, "GPIO3", 3], [6, "GND", null],
    [7, "GPIO4", 4], [8, "GPIO14", 14], [9, "GND", null], [10, "GPIO15", 15], [11, "GPIO17", 17], [12, "GPIO18", 18],
    [13, "GPIO27", 27], [14, "GND", null], [15, "GPIO22", 22], [16, "GPIO23", 23], [17, "3V3", null], [18, "GPIO24", 24],
    [19, "GPIO10", 10], [20, "GND", null], [21, "GPIO9", 9], [22, "GPIO25", 25], [23, "GPIO11", 11], [24, "GPIO8", 8],
    [25, "GND", null], [26, "GPIO7", 7], [27, "GPIO0", 0], [28, "GPIO1", 1], [29, "GPIO5", 5], [30, "GND", null],
    [31, "GPIO6", 6], [32, "GPIO12", 12], [33, "GPIO13", 13], [34, "GND", null], [35, "GPIO19", 19], [36, "GPIO16", 16],
    [37, "GPIO26", 26], [38, "GPIO20", 20], [39, "GND", null], [40, "GPIO21", 21],
  ];
  const x1 = 32.5 - 9.5 * P;
  for (const [phys, label, g] of header) {
    const col = Math.floor((phys - 1) / 2);
    const x = x1 + col * P;
    const y = phys % 2 === 1 ? 3.5 + 1.27 : 3.5 - 1.27;
    const id = `h${phys}`;
    if (g === null) {
      if (label === "GND") pins.push({ ...powerPin(id, "GND", x, y, 0, ["GND"]), phys });
      else if (label === "5V") pins.push({ ...powerPin(id, "5V", x, y, 5, ["5V", "VCC5"]), phys });
      else pins.push({ ...powerPin(id, "3V3", x, y, 3.3, ["3V3", "3.3V", "VCC"]), phys });
      continue;
    }
    const caps: Cap[] = ["digital", "pwm"];
    if (g === 2) caps.push("sda");
    if (g === 3) caps.push("scl");
    if (g === 14) caps.push("tx");
    if (g === 15) caps.push("rx");
    if (g === 10) caps.push("mosi");
    if (g === 9) caps.push("miso");
    if (g === 11) caps.push("sck");
    const extra: Partial<BoardPin> = { phys };
    if (g === 0 || g === 1) extra.avoid = "reserved for HAT EEPROM (ID_SD/ID_SC)";
    if (g === 14 || g === 15) extra.avoid = "UART console";
    pins.push(gpioPin(id, label, x, y, g, caps, [label, `BCM${g}`, `GPIO${g}`, `GP${g}`, `BOARD${phys}`, `PIN${phys}`, String(g)], extra));
  }
  return {
    id: "rpi-4b",
    name: "Raspberry Pi 4 Model B",
    short: "Pi 4",
    vendor: "Raspberry Pi",
    mcu: "BCM2711 (quad Cortex-A72 1.5 GHz)",
    family: "bcm2711",
    width: W,
    height: H,
    thickness: 1.4,
    logicV: 3.3,
    adcBits: 0,
    adcVref: 3.3,
    intBits: 32,
    pcbColor: "#1f7a3a",
    silkColor: "#f4faf5",
    pins,
    holes: [
      { x: 3.5, y: 3.5, d: 2.75 },
      { x: 61.5, y: 3.5, d: 2.75 },
      { x: 3.5, y: 52.5, d: 2.75 },
      { x: 61.5, y: 52.5, d: 2.75 },
    ],
    connectors: [
      { id: "eth", label: "Gigabit Ethernet", kind: "rj45", x: 65.0, y: 2.25, w: 22.5, h: 16.0, z: 13.5, edge: "right" },
      { id: "usb3", label: "USB 3.0 ×2", kind: "usb-a", x: 69.0, y: 20.5, w: 18.5, h: 14.5, z: 16.0, edge: "right" },
      { id: "usb2", label: "USB 2.0 ×2", kind: "usb-a", x: 69.0, y: 38.5, w: 18.5, h: 14.5, z: 16.0, edge: "right" },
      { id: "usbc", label: "USB-C power", kind: "usb-c", x: 7.4, y: 49.5, w: 9.0, h: 7.5, z: 3.3, edge: "bottom" },
      { id: "hdmi0", label: "micro-HDMI 0", kind: "hdmi-micro", x: 22.8, y: 50.0, w: 6.5, h: 7.5, z: 3.0, edge: "bottom" },
      { id: "hdmi1", label: "micro-HDMI 1", kind: "hdmi-micro", x: 36.3, y: 50.0, w: 6.5, h: 7.5, z: 3.0, edge: "bottom" },
      { id: "audio", label: "3.5 mm A/V", kind: "audio", x: 50.5, y: 47.0, w: 7.0, h: 15.0, z: 6.0, edge: "bottom" },
      { id: "sd", label: "microSD (underside)", kind: "sd", x: -2.5, y: 22.0, w: 13.0, h: 12.0, z: -1.5, edge: "left" },
    ],
    chips: [
      { x: 22.0, y: 21.0, w: 15.0, h: 15.0, label: "BCM2711", color: "#b9bec4", z: 2.4, metal: true },
      { x: 40.0, y: 22.0, w: 14.0, h: 10.0, label: "LPDDR4", color: "#1b1d20", z: 1.1 },
      { x: 6.0, y: 24.0, w: 10.0, h: 12.0, label: "CYW43455", color: "#b9bec4", z: 1.6, metal: true },
      { x: 55.0, y: 26.0, w: 7.0, h: 7.0, label: "VL805", color: "#1b1d20", z: 1.0 },
    ],
    languages: ["python"],
    defaultLang: "python",
    constants: {},
    i2c: { sda: "h3", scl: "h5" },
    notes: [
      "3.3 V logic. The Pi has no analog inputs — use an ADC (e.g. MCP3008/ADS1115) for analog sensors.",
      "Hardware PWM on GPIO 12, 13, 18, 19. gpiozero and RPi.GPIO use BCM numbering by default.",
    ],
    maxComponentZ: 16.0,
  };
}

export const BOARDS: BoardDef[] = [esp32(), uno(), pico(), pi4()];

const byId = new Map(BOARDS.map((b) => [b.id, b]));
const customBoards = new Map<string, BoardDef>();

export function registerCustomBoard(def: BoardDef) {
  customBoards.set(def.id, def);
}

export function getBoard(id: string): BoardDef {
  return byId.get(id) ?? customBoards.get(id) ?? BOARDS[0];
}

export function allBoards(): BoardDef[] {
  return [...BOARDS, ...customBoards.values()];
}

/** Resolve a user-typed pin name ("GP10", "D13", "A0", "gpio 4", "pin 11") on a board. */
export function resolveBoardPin(board: BoardDef, raw: string): BoardPin | undefined {
  const q = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!q) return undefined;
  const exact = board.pins.find((p) => p.id.toUpperCase() === q || p.label.toUpperCase().replace("~", "") === q);
  if (exact && exact.kind === "gpio") return exact;
  const byAlias = board.pins.find((p) => p.aliases.some((a) => a.toUpperCase() === q));
  if (byAlias) return byAlias;
  if (exact) return exact;
  // Arduino constants like A0, LED_BUILTIN
  if (q in board.constants) {
    const g = board.constants[q];
    return board.pins.find((p) => p.gpio === g && p.kind === "gpio");
  }
  const m = q.match(/^(?:GPIO|GP|IO|D|G|BCM)?(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    return board.pins.find((p) => p.kind === "gpio" && p.gpio === n);
  }
  return undefined;
}

export function boardGpio(board: BoardDef, n: number) {
  return board.pins.find((p) => p.kind === "gpio" && p.gpio === n);
}
