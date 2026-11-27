import type { BoardDef, BoardLook, BoardPin, Cap, HeaderStyle } from "./types";

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
      if (adc2.includes(gpio)) extra.adc2 = true;
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
    wifi: true,
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
      { x: 26.0, y: 5.0, w: 19.0, h: 18.0, label: "ESP-WROOM-32", color: "#c9ccd1", z: 3.1, metal: true, module: true },
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
    headers: "female-up",
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
function pico(wireless = false): BoardDef {
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
    id: wireless ? "rpi-pico-w" : "rpi-pico",
    name: wireless ? "Raspberry Pi Pico W" : "Raspberry Pi Pico",
    short: wireless ? "Pico W" : "Pico",
    vendor: "Raspberry Pi",
    mcu: wireless ? "RP2040 + CYW43439 Wi-Fi/Bluetooth" : "RP2040 (dual Cortex-M0+ 133 MHz)",
    wifi: wireless,
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
      ...(wireless ? [{ id: "ant", label: "PCB antenna", kind: "antenna" as const, x: 45.2, y: 6.6, w: 5.4, h: 7.8, z: 0.8, edge: "right" as const }] : []),
    ],
    chips: [
      { x: 22.0, y: 7.0, w: 7.0, h: 7.0, label: "RP2-B2", color: "#1b1d20", z: 0.9 },
      { x: 13.5, y: 11.0, w: 5.0, h: 5.0, label: "W25Q16", color: "#1b1d20", z: 0.9 },
      ...(wireless
        ? [{ x: 33.6, y: 5.2, w: 10.4, h: 10.6, label: "CYW43439", color: "#c9ccd1", z: 1.4, metal: true }]
        : [{ x: 32.0, y: 8.5, w: 3.2, h: 2.5, label: "12MHz", color: "#c9ccd1", z: 0.9, metal: true }]),
    ],
    languages: ["micropython", "arduino"],
    defaultLang: "micropython",
    builtinLed: undefined,
    constants: { LED_BUILTIN: 25, A0: 26, A1: 27, A2: 28, SDA: 4, SCL: 5 },
    i2c: { sda: "p6", scl: "p7" },
    notes: [
      "3.3 V logic. ADC on GP26, GP27, GP28 (12-bit).",
      wireless ? "The on-board LED is wired to the Wi-Fi chip. In MicroPython use Pin('LED')." : "The on-board LED is GP25 (not on the header). In MicroPython use Pin('LED').",
      ...(wireless ? ["Wi-Fi with network.WLAN (MicroPython) or WiFi.h (Arduino)."] : []),
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
    wifi: true,
    headers: "male-up",
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


// ---------------------------------------------------------------------------
// Arduino Nano (ATmega328P). Horizontal: mini-USB on the left, 2 × 15 pins 0.6" apart.
// ---------------------------------------------------------------------------
function nano(): BoardDef {
  const W = 43.18;
  const H = 18.54;
  const topY = (H - 6 * P) / 2;
  const botY = H - topY;
  const x0 = (W - 14 * P) / 2;
  const pins: BoardPin[] = [];
  const digital = (n: number, x: number, y: number) => {
    const caps: Cap[] = ["digital"];
    if ([3, 5, 6, 9, 10, 11].includes(n)) caps.push("pwm");
    if (n === 0) caps.push("rx");
    if (n === 1) caps.push("tx");
    if (n === 11) caps.push("mosi");
    if (n === 12) caps.push("miso");
    if (n === 13) caps.push("sck");
    const label = n === 0 ? "RX0" : n === 1 ? "TX1" : `D${n}`;
    const extra: Partial<BoardPin> = n <= 1 ? { avoid: "used by USB serial (Serial.print)" } : {};
    pins.push(gpioPin(`d${n}`, label, x, y, n, caps, [`D${n}`, `PIN${n}`, String(n), label], extra));
  };
  // top row, mini-USB end first: D12 … D2, GND, RST, RX0, TX1
  const top: Array<number | string> = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, "GND", "RST", 0, 1];
  top.forEach((v, i) => {
    const x = x0 + i * P;
    if (v === "GND") pins.push(powerPin("gnd_t", "GND", x, topY, 0, ["GND"]));
    else if (v === "RST") pins.push(ctrlPin("rst_t", "RST", x, topY, ["RST", "RESET"]));
    else digital(v as number, x, topY);
  });
  // bottom row: D13, 3V3, AREF, A0 … A7, 5V, RST, GND, VIN
  const bottom = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"];
  bottom.forEach((v, i) => {
    const x = x0 + i * P;
    if (v === "D13") digital(13, x, botY);
    else if (v === "3V3") pins.push(powerPin("3v3", "3V3", x, botY, 3.3, ["3V3", "3.3V"]));
    else if (v === "5V") pins.push(powerPin("5v", "5V", x, botY, 5, ["5V", "VCC"]));
    else if (v === "VIN") pins.push(powerPin("vin", "VIN", x, botY, 5, ["VIN"]));
    else if (v === "GND") pins.push(powerPin("gnd_b", "GND", x, botY, 0, ["GND"]));
    else if (v === "RST") pins.push(ctrlPin("rst_b", "RST", x, botY, ["RST"]));
    else if (v === "AREF") pins.push(ctrlPin("aref", "AREF", x, botY, ["AREF"]));
    else {
      const a = Number(v.slice(1));
      const analogOnly = a >= 6;
      const caps: Cap[] = analogOnly ? ["adc"] : ["digital", "adc"];
      if (a === 4) caps.push("sda");
      if (a === 5) caps.push("scl");
      pins.push(gpioPin(`a${a}`, v, x, botY, 14 + a, caps, [v, String(14 + a)], analogOnly ? { inputOnly: true, avoid: "analog input only" } : {}));
    }
  });
  return {
    id: "arduino-nano",
    name: "Arduino Nano",
    short: "Nano",
    vendor: "Arduino",
    mcu: "ATmega328P (AVR 16 MHz)",
    family: "avr",
    headers: "male-down",
    width: W,
    height: H,
    thickness: 1.6,
    logicV: 5,
    adcBits: 10,
    adcVref: 5,
    intBits: 16,
    pcbColor: "#0b5f8f",
    silkColor: "#f2f8fb",
    pins,
    holes: [
      { x: 1.27, y: 1.6, d: 1.7 },
      { x: 1.27, y: H - 1.6, d: 1.7 },
      { x: W - 1.27, y: 1.6, d: 1.7 },
      { x: W - 1.27, y: H - 1.6, d: 1.7 },
    ],
    connectors: [
      { id: "usb", label: "Mini-USB", kind: "usb-micro", x: -1.8, y: 5.4, w: 9.0, h: 7.8, z: 4.0, edge: "left" },
      { id: "reset", label: "RESET", kind: "button", x: 27.2, y: 7.0, w: 4.4, h: 4.4, z: 2.2, edge: null },
      { id: "icsp", label: "ICSP", kind: "header", x: 36.4, y: 5.4, w: 5.1, h: 7.6, z: 8.5, edge: null },
    ],
    chips: [
      { x: 17.6, y: 5.6, w: 7.2, h: 7.2, label: "MEGA328P", color: "#1b1d20", z: 1.0 },
      { x: 12.0, y: 7.6, w: 3.4, h: 3.2, label: "16M", color: "#c9ccd1", z: 1.0, metal: true },
    ],
    languages: ["arduino"],
    defaultLang: "arduino",
    builtinLed: "d13",
    constants: { LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21, SDA: 18, SCL: 19 },
    i2c: { sda: "a4", scl: "a5" },
    notes: [
      "Same ATmega328P as the Uno, in a breadboard-friendly 0.6″ footprint.",
      "A6 and A7 are analog inputs only — digitalRead/digitalWrite don't work on them.",
      "`int` is 16-bit on AVR: values wrap past 32767.",
    ],
    maxComponentZ: 4.0,
    look: {
      title: "NANO",
      tx: 8.6,
      ty: 12.6,
      size: 2.6,
      spacing: 0.4,
      leds: [
        { x: 32.6, y: 5.0, color: "#3b8cff", label: "PWR", role: "pwr" },
        { x: 32.6, y: 13.2, color: "#ffb020", label: "L", role: "user" },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Arduino Mega 2560 R3. Uno-compatible headers plus 14–21, A8–A15 and the 22–53 double row.
// ---------------------------------------------------------------------------
function mega(): BoardDef {
  const IN = 25.4;
  const W = 101.6;
  const H = 53.34;
  const topY = H - 2.0 * IN;
  const botY = H - 0.1 * IN;
  const pins: BoardPin[] = [];
  const caps = (n: number): Cap[] => {
    const c: Cap[] = ["digital"];
    if ((n >= 2 && n <= 13) || (n >= 44 && n <= 46)) c.push("pwm");
    if ([0, 15, 17, 19].includes(n)) c.push("rx");
    if ([1, 14, 16, 18].includes(n)) c.push("tx");
    if (n === 20) c.push("sda");
    if (n === 21) c.push("scl");
    if (n === 51) c.push("mosi");
    if (n === 50) c.push("miso");
    if (n === 52) c.push("sck");
    return c;
  };
  const SER: Record<number, string> = { 0: "RX0", 1: "TX0", 14: "TX3", 15: "RX3", 16: "TX2", 17: "RX2", 18: "TX1", 19: "RX1", 20: "SDA", 21: "SCL" };
  const dpin = (n: number, x: number, y: number) => {
    const c = caps(n);
    const label = SER[n] ? `${n} ${SER[n]}` : `${n}${c.includes("pwm") ? "~" : ""}`;
    const extra: Partial<BoardPin> = n <= 1 ? { avoid: "used by USB serial (Serial.print)" } : {};
    pins.push(gpioPin(`d${n}`, label, x, y, n, c, [`D${n}`, `PIN${n}`, String(n), ...(SER[n] ? [SER[n]] : [])], extra));
  };
  const unoX = (n: number) => (n <= 7 ? 2.6 - n * 0.1 : 1.74 - (n - 8) * 0.1) * IN;
  for (let n = 0; n <= 13; n++) dpin(n, unoX(n), topY);
  for (let n = 14; n <= 21; n++) dpin(n, (2.74 + (n - 14) * 0.1) * IN, topY);
  pins.push(powerPin("gnd_t", "GND", 1.14 * IN, topY, 0, ["GND"]));
  pins.push(ctrlPin("aref", "AREF", 1.04 * IN, topY, ["AREF"]));
  pins.push(gpioPin("sda_t", "SDA", 0.94 * IN, topY, 20, ["digital", "sda"], ["SDA"], { avoid: "same as pin 20" }));
  pins.push(gpioPin("scl_t", "SCL", 0.84 * IN, topY, 21, ["digital", "scl"], ["SCL"], { avoid: "same as pin 21" }));
  const pw: Array<[string, string, number | null]> = [
    ["nc", "NC", null], ["ioref", "IOREF", 5], ["reset", "RESET", null], ["3v3", "3.3V", 3.3], ["5v", "5V", 5], ["gnd1", "GND", 0], ["gnd2", "GND", 0], ["vin", "VIN", 5],
  ];
  pw.forEach(([id, label, v], i) => {
    const x = (1.1 + i * 0.1) * IN;
    if (v === null) pins.push(ctrlPin(id, label, x, botY, [label]));
    else pins.push(powerPin(id, label, x, botY, v, v === 0 ? ["GND"] : v === 3.3 ? ["3V3", "3.3V"] : id === "5v" ? ["5V", "VCC"] : [label]));
  });
  for (let a = 0; a <= 15; a++) {
    const x = (a <= 7 ? 2.0 + a * 0.1 : 2.9 + (a - 8) * 0.1) * IN;
    pins.push(gpioPin(`a${a}`, `A${a}`, x, botY, 54 + a, ["digital", "adc"], [`A${a}`, String(54 + a)]));
  }
  // double-row header on the right edge: 5V 5V / 22 23 / … / 52 53 / GND GND
  const colX = [3.8 * IN, 3.9 * IN];
  for (let r = 0; r < 18; r++) {
    const y = 4.45 + r * P;
    for (let c = 0; c < 2; c++) {
      if (r === 0) pins.push(powerPin(`5v_${c}`, "5V", colX[c], y, 5, ["5V"]));
      else if (r === 17) pins.push(powerPin(`gnd_${c}`, "GND", colX[c], y, 0, ["GND"]));
      else dpin(22 + (r - 1) * 2 + c, colX[c], y);
    }
  }
  return {
    id: "arduino-mega",
    name: "Arduino Mega 2560 R3",
    short: "Mega",
    vendor: "Arduino",
    mcu: "ATmega2560 (AVR 16 MHz, 256 KB flash)",
    family: "avr",
    headers: "female-up",
    width: W,
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
      { x: 3.55 * IN, y: 2.9, d: 3.2 },
      { x: 3.75 * IN, y: H - 2.6, d: 3.2 },
    ],
    connectors: [
      { id: "usb", label: "USB-B", kind: "usb-b", x: -6.4, y: 9.4, w: 16.3, h: 12.0, z: 10.9, edge: "left" },
      { id: "dc", label: "DC jack 7–12 V", kind: "barrel", x: -1.9, y: 39.4, w: 14.2, h: 9.0, z: 11.0, edge: "left" },
      { id: "reset", label: "RESET", kind: "button", x: 5.2, y: 1.8, w: 6.0, h: 6.0, z: 4.0, edge: null },
      { id: "icsp", label: "ICSP", kind: "header", x: 84.0, y: 24.0, w: 5.1, h: 7.6, z: 8.5, edge: null },
    ],
    chips: [
      { x: 50.0, y: 18.0, w: 14.0, h: 14.0, label: "ATMEGA2560", color: "#1b1d20", z: 1.2 },
      { x: 16.0, y: 12.4, w: 7.0, h: 7.0, label: "16U2", color: "#1b1d20", z: 1.0 },
      { x: 27.0, y: 44.6, w: 7.0, h: 3.0, label: "16MHz", color: "#c9ccd1", z: 3.5, metal: true },
    ],
    languages: ["arduino"],
    defaultLang: "arduino",
    builtinLed: "d13",
    constants: {
      LED_BUILTIN: 13,
      ...Object.fromEntries(Array.from({ length: 16 }, (_, a) => [`A${a}`, 54 + a])),
      SDA: 20,
      SCL: 21,
    },
    i2c: { sda: "d20", scl: "d21" },
    notes: [
      "54 digital pins (15 PWM), 16 analog inputs and four hardware serial ports (Serial … Serial3).",
      "I²C is on pins 20 (SDA) and 21 (SCL), also brought out next to AREF.",
      "`int` is 16-bit on AVR: values wrap past 32767.",
    ],
    maxComponentZ: 11.0,
    look: {
      title: "MEGA 2560",
      tx: 12,
      ty: 34,
      size: 4.6,
      spacing: 0.5,
      leds: [
        { x: 40.5, y: 14.0, color: "#3bd16f", label: "ON", role: "pwr" },
        { x: 40.5, y: 17.6, color: "#ffb020", label: "L", role: "user" },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// ESP32-S3-DevKitC-1. Horizontal: two USB-C on the left, WROOM-1 module on the right.
// ---------------------------------------------------------------------------
function esp32s3(): BoardDef {
  const W = 62.7;
  const H = 25.5;
  const topY = (H - 9 * P) / 2;
  const botY = H - topY;
  const xPin1 = W - 3.4;
  const J1: Array<string | number> = ["3V3", "3V3", "RST", 4, 5, 6, 7, 15, 16, 17, 18, 8, 3, 46, 9, 10, 11, 12, 13, 14, "5V", "GND"];
  const J3: Array<string | number> = ["GND", 43, 44, 1, 2, 42, 41, 40, 39, 38, 37, 36, 35, 0, 45, 48, 47, 21, 20, 19, "GND", "GND"];
  const avoid: Record<number, string> = {
    0: "strapping pin (BOOT button)",
    3: "strapping pin (JTAG select)",
    45: "strapping pin (flash voltage)",
    46: "strapping pin (boot mode)",
    19: "USB D− (native USB)",
    20: "USB D+ (native USB)",
    35: "used by octal PSRAM on N8R8 modules",
    36: "used by octal PSRAM on N8R8 modules",
    37: "used by octal PSRAM on N8R8 modules",
    43: "UART0 TX (USB serial)",
    44: "UART0 RX (USB serial)",
    48: "on-board RGB LED",
  };
  const pins: BoardPin[] = [];
  const add = (v: string | number, side: "t" | "b", i: number) => {
    const x = xPin1 - i * P;
    const y = side === "t" ? topY : botY;
    const id = `${side}${i + 1}`;
    if (typeof v === "string") {
      if (v === "GND") pins.push(powerPin(id, "GND", x, y, 0, ["GND"]));
      else if (v === "3V3") pins.push(powerPin(id, "3V3", x, y, 3.3, ["3V3", "3.3V", "VCC"]));
      else if (v === "5V") pins.push(powerPin(id, "5V", x, y, 5, ["5V", "VIN", "VBUS"]));
      else pins.push(ctrlPin(id, v, x, y, [v, "EN"]));
      return;
    }
    const g = v;
    const caps: Cap[] = ["digital", "pwm"];
    if (g >= 1 && g <= 20) caps.push("adc");
    if (g >= 1 && g <= 14) caps.push("touch");
    if (g === 8) caps.push("sda");
    if (g === 9) caps.push("scl");
    if (g === 43 || g === 17) caps.push("tx");
    if (g === 44 || g === 18) caps.push("rx");
    if (g === 11) caps.push("mosi");
    if (g === 13) caps.push("miso");
    if (g === 12) caps.push("sck");
    const label = g === 43 ? "TX" : g === 44 ? "RX" : String(g);
    const extra: Partial<BoardPin> = {};
    if (avoid[g]) extra.avoid = avoid[g];
    if (g >= 11 && g <= 20) extra.adc2 = true;
    pins.push(gpioPin(id, label, x, y, g, caps, [`GPIO${g}`, `IO${g}`, `G${g}`, `D${g}`, String(g), label], extra));
  };
  J1.forEach((v, i) => add(v, "t", i));
  J3.forEach((v, i) => add(v, "b", i));
  const id = (g: number) => pins.find((p) => p.gpio === g)!.id;
  return {
    id: "esp32-s3-devkitc",
    name: "ESP32-S3-DevKitC-1",
    short: "ESP32-S3",
    vendor: "Espressif",
    mcu: "ESP32-S3 (Xtensa LX7 dual-core 240 MHz, USB OTG)",
    family: "esp32",
    wifi: true,
    headers: "male-down",
    width: W,
    height: H,
    thickness: 1.6,
    logicV: 3.3,
    adcBits: 12,
    adcVref: 3.3,
    intBits: 32,
    pcbColor: "#17191d",
    silkColor: "#eef1f3",
    pins,
    holes: [],
    connectors: [
      { id: "usb_uart", label: "USB-C (UART)", kind: "usb-c", x: -1.2, y: 3.6, w: 7.4, h: 9.0, z: 3.2, edge: "left" },
      { id: "usb_otg", label: "USB-C (USB)", kind: "usb-c", x: -1.2, y: 13.0, w: 7.4, h: 9.0, z: 3.2, edge: "left" },
      { id: "boot", label: "BOOT", kind: "button", x: 9.4, y: 3.6, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "rst", label: "RST", kind: "button", x: 9.4, y: 18.7, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "ant", label: "PCB antenna", kind: "antenna", x: 55.6, y: 4.0, w: 6.8, h: 17.5, z: 0.8, edge: "right" },
    ],
    chips: [
      { x: 36.6, y: 3.75, w: 19.0, h: 18.0, label: "ESP32-S3-WROOM-1", color: "#c9ccd1", z: 3.1, metal: true, module: true },
      { x: 16.0, y: 10.2, w: 5.0, h: 5.0, label: "CP2102N", color: "#1d1f22", z: 1.0 },
      { x: 23.5, y: 9.8, w: 3.0, h: 6.0, label: "LDO", color: "#1d1f22", z: 1.2 },
    ],
    languages: ["arduino", "micropython"],
    defaultLang: "arduino",
    builtinLed: id(48),
    constants: {
      LED_BUILTIN: 48,
      RGB_BUILTIN: 48,
      ...Object.fromEntries(Array.from({ length: 20 }, (_, a) => [`A${a}`, a + 1])),
      ...Object.fromEntries(Array.from({ length: 14 }, (_, t) => [`T${t + 1}`, t + 1])),
      SDA: 8,
      SCL: 9,
      TX: 43,
      RX: 44,
    },
    i2c: { sda: id(8), scl: id(9) },
    notes: [
      "3.3 V logic. Every GPIO can do PWM; ADC1 is GPIO 1–10 (ADC2, GPIO 11–20, is blocked while Wi-Fi runs).",
      "Two USB-C ports: UART (left) for flashing and serial, USB for native USB/JTAG.",
      "The RGB LED is on GPIO 48 (GPIO 38 on board revision 1.1).",
    ],
    maxComponentZ: 3.6,
    look: {
      title: "ESP32-S3-DevKitC-1",
      tx: 15.2,
      ty: 19.4,
      size: 1.55,
      spacing: 0.05,
      leds: [
        { x: 28.6, y: 5.6, color: "#ff3b30", label: "PWR", role: "pwr" },
        { x: 31.0, y: 14.6, color: "#b98cff", label: "RGB", role: "user" },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// NodeMCU v2 (ESP-12E, ESP8266). Horizontal: micro-USB on the left, module on the right.
// ---------------------------------------------------------------------------
function nodemcu(): BoardDef {
  const W = 48.3;
  const H = 25.6;
  const topY = (H - 9 * P) / 2;
  const botY = H - topY;
  const x0 = (W - 14 * P) / 2 - 1.0;
  const top = ["VIN", "GND", "RST", "EN", "3V3", "GND", "CLK", "SD0", "CMD", "SD1", "SD2", "SD3", "RSV", "RSV", "A0"];
  const bottom = ["3V3", "GND", "TX", "RX", "D8", "D7", "D6", "D5", "GND", "3V3", "D4", "D3", "D2", "D1", "D0"];
  const D: Record<string, number> = { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, RX: 3, TX: 1, SD2: 9, SD3: 10 };
  const avoid: Record<number, string> = {
    0: "strapping pin (FLASH button) — must be HIGH at boot",
    2: "strapping pin, on-board LED (active LOW)",
    15: "strapping pin — must be LOW at boot",
    1: "UART TX (USB serial)",
    3: "UART RX (USB serial)",
    9: "connected to the flash chip",
    10: "connected to the flash chip",
  };
  const pins: BoardPin[] = [];
  const add = (label: string, side: "t" | "b", i: number) => {
    const x = x0 + i * P;
    const y = side === "t" ? topY : botY;
    const id = `${side}${i}`;
    if (label === "GND") pins.push(powerPin(id, "GND", x, y, 0, ["GND"]));
    else if (label === "3V3") pins.push(powerPin(id, "3V3", x, y, 3.3, ["3V3", "3.3V", "VCC"]));
    else if (label === "VIN") pins.push(powerPin(id, "VIN", x, y, 5, ["VIN", "5V", "VU"]));
    else if (label === "A0") pins.push(gpioPin(id, "A0", x, y, 17, ["adc"], ["A0", "ADC0", "17"], { inputOnly: true }));
    else if (label in D) {
      const g = D[label];
      const caps: Cap[] = ["digital"];
      if (g !== 16) caps.push("pwm");
      if (g === 4) caps.push("sda");
      if (g === 5) caps.push("scl");
      if (g === 1) caps.push("tx");
      if (g === 3) caps.push("rx");
      if (g === 13) caps.push("mosi");
      if (g === 12) caps.push("miso");
      if (g === 14) caps.push("sck");
      const extra: Partial<BoardPin> = avoid[g] ? { avoid: avoid[g] } : {};
      pins.push(gpioPin(id, label, x, y, g, caps, [label, `GPIO${g}`, `IO${g}`, String(g)], extra));
    } else pins.push(ctrlPin(id, label, x, y, [label]));
  };
  top.forEach((l, i) => add(l, "t", i));
  bottom.forEach((l, i) => add(l, "b", i));
  return {
    id: "nodemcu-esp8266",
    name: "NodeMCU v2 (ESP8266)",
    short: "NodeMCU",
    vendor: "NodeMCU / Ai-Thinker",
    mcu: "ESP8266EX (Tensilica L106 80 MHz, Wi-Fi)",
    family: "esp8266",
    wifi: true,
    headers: "male-down",
    width: W,
    height: H,
    thickness: 1.6,
    logicV: 3.3,
    adcBits: 10,
    adcVref: 3.3,
    intBits: 32,
    pcbColor: "#17191c",
    silkColor: "#eef0f2",
    pins,
    holes: [
      { x: 1.9, y: 1.9, d: 3.0 },
      { x: 1.9, y: H - 1.9, d: 3.0 },
      { x: W - 1.9, y: 1.9, d: 3.0 },
      { x: W - 1.9, y: H - 1.9, d: 3.0 },
    ],
    connectors: [
      { id: "usb", label: "Micro-USB", kind: "usb-micro", x: -1.2, y: 9.0, w: 5.6, h: 7.6, z: 3.0, edge: "left" },
      { id: "flash", label: "FLASH", kind: "button", x: 4.3, y: 3.6, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "rst", label: "RST", kind: "button", x: 4.3, y: 18.8, w: 4.2, h: 3.2, z: 1.8, edge: null },
      { id: "ant", label: "PCB antenna", kind: "antenna", x: 40.6, y: 5.6, w: 5.6, h: 14.4, z: 0.8, edge: "right" },
    ],
    chips: [
      { x: 22.6, y: 4.8, w: 18.0, h: 16.0, label: "ESP-12E", color: "#c9ccd1", z: 3.0, metal: true, module: true },
      { x: 11.4, y: 10.3, w: 5.0, h: 5.0, label: "CP2102", color: "#1d1f22", z: 1.0 },
      { x: 17.6, y: 9.8, w: 3.0, h: 6.0, label: "1117", color: "#1d1f22", z: 1.6 },
    ],
    languages: ["arduino", "micropython"],
    defaultLang: "arduino",
    builtinLed: "b10",
    builtinActiveLow: true,
    constants: { ...D, A0: 17, LED_BUILTIN: 2, BUILTIN_LED: 2, SDA: 4, SCL: 5 },
    i2c: { sda: "b12", scl: "b13" },
    notes: [
      "3.3 V logic and a single 10-bit analog input (A0, 0–3.3 V on NodeMCU).",
      "Use the D-numbers printed on the board (D1, D2 …) — they map to different GPIOs (D1 = GPIO5).",
      "The blue LED is on D4 / GPIO2 and lights when the pin is LOW.",
    ],
    maxComponentZ: 3.6,
    look: {
      title: "NodeMCU",
      tx: 10.2,
      ty: 7.6,
      size: 1.9,
      spacing: 0.1,
      leds: [{ x: 38.6, y: 6.2, color: "#3b8cff", label: "LED", role: "user" }],
    },
  };
}

/** Header style, with the original boards' defaults. */
export function boardHeaders(b: BoardDef): HeaderStyle {
  return b.headers ?? (b.family === "avr" ? "female-up" : b.family === "bcm2711" ? "male-up" : "male-down");
}

/** Silkscreen title and status-LED placement (defaults reproduce the original four boards). */
export function boardLook(b: BoardDef): BoardLook {
  if (b.look) return b.look;
  const f = b.family;
  if (f === "avr")
    return { title: "UNO R3", tx: b.width * 0.52, ty: b.height * 0.52, size: 5.5, spacing: 0.6, leds: [{ x: 52, y: 20, color: "#ff3b30", label: "PWR", role: "pwr" }, { x: 52, y: 23.6, color: "#7cff5b", label: "L", role: "user" }] };
  if (f === "bcm2711")
    return { title: b.name, tx: b.width * 0.12, ty: b.height * 0.82, size: 2.8, radius: 3, leds: [{ x: 2.6, y: 47, color: "#ff3b30", label: "PWR", role: "pwr" }, { x: 2.6, y: 51, color: "#7cff5b", label: "ACT", role: "act" }] };
  if (f === "rp2040")
    return { title: b.short, tx: b.width * 0.32, ty: b.height * 0.62, size: 1.9, spacing: 0.1, leds: [{ x: 6.2, y: 4.3, color: "#ff3b30", label: "PWR", role: "pwr" }, { x: 6.2, y: 16.6, color: "#7cff5b", label: "LED", role: "user" }] };
  if (b.id === "esp32-devkit-v1")
    return { title: "ESP32 DEVKIT V1", tx: b.width * 0.32, ty: b.height * 0.62, size: 1.9, spacing: 0.1, leds: [{ x: 10.8, y: 5.2, color: "#ff3b30", label: "PWR", role: "pwr" }, { x: 10.8, y: 22.6, color: "#2f8bff", label: "LED", role: "user" }] };
  return { title: b.short, tx: b.width * 0.3, ty: b.height * 0.6, size: Math.min(2.4, b.height * 0.08), leds: [{ x: 4, y: 4, color: "#ff3b30", label: "PWR", role: "pwr" }] };
}

/** Pin id that drives the on-board LED, if any. */
export const builtinLedId = (b: BoardDef) => b.builtinLed ?? (b.family === "rp2040" ? "LED" : undefined);
/** Whether the on-board LED is lit for a driven pin level. */
export const builtinLedLit = (b: BoardDef, drive: { level?: number } | undefined) => (drive ? (b.builtinActiveLow ? drive.level === 0 : !!drive.level) : false);

export const BOARDS: BoardDef[] = [esp32(), esp32s3(), nodemcu(), uno(), nano(), mega(), pico(), pico(true), pi4()];

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
