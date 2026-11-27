import { describe, expect, it } from "vitest";
import { SimEngine } from "../src/core/sim";
import type { PartInstance, Wire } from "../src/core/types";
import { transpileArduino } from "../src/core/runtime/cxx";
import { transpilePython } from "../src/core/runtime/python";

const board = (id: string): PartInstance => ({ id: "board", type: `board:${id}`, label: id, x: 0, y: 0, rot: 0, props: {} });
const part = (id: string, type: string, props: PartInstance["props"] = {}): PartInstance => ({ id, type, label: id, x: 100, y: 100, rot: 0, props });
const wire = (id: string, a: string, b: string): Wire => {
  const [ap, apin] = a.split(".");
  const [bp, bpin] = b.split(".");
  return { id, from: { part: ap, pin: apin }, to: { part: bp, pin: bpin }, color: "#f00", points: [] };
};

async function runFor(e: SimEngine, ms: number) {
  for (let t = 0; t < ms; t += 16) {
    await new Promise((r) => setTimeout(r, 0));
    await e.frame(16);
  }
}

describe("circuit solver", () => {
  it("lights an LED through a resistor from 5V", () => {
    const e = new SimEngine();
    e.setCircuit("arduino-uno", [board("arduino-uno"), part("R1", "resistor", { ohms: 220 }), part("L1", "led", { color: "red" })], [
      wire("w1", "board.5v", "R1.1"),
      wire("w2", "R1.2", "L1.A"),
      wire("w3", "L1.C", "board.gnd1"),
    ]);
    const live = e.snapshot()!.live.L1;
    expect(live.brightness).toBeGreaterThan(0.9);
    expect(live.reading).toBeGreaterThan(12);
    expect(live.reading).toBeLessThan(14.5);
  });

  it("flags an LED wired straight to 5V", async () => {
    const e = new SimEngine();
    e.setCircuit("arduino-uno", [board("arduino-uno"), part("L1", "led")], [wire("w1", "board.5v", "L1.A"), wire("w2", "L1.C", "board.gnd1")]);
    expect(e.snapshot()!.diags.some((d) => d.msg.includes("Short") || d.msg.includes("mA"))).toBe(true);
  });

  it("reads a potentiometer divider on an analog pin", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("arduino-uno", [board("arduino-uno"), part("P1", "pot", { position: 0.25, ohms: 10000 })], [
      wire("w1", "board.5v", "P1.1"),
      wire("w2", "P1.W", "board.a0"),
      wire("w3", "P1.2", "board.gnd1"),
    ]);
    expect(e.readVolts("a0")).toBeGreaterThan(1.2);
    expect(e.readVolts("a0")).toBeLessThan(1.3);
  });
});

describe("firmware runtime", () => {
  it("runs an Arduino blink sketch on ESP32 and toggles the LED", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("esp32-devkit-v1", [board("esp32-devkit-v1"), part("R1", "resistor", { ohms: 220 }), part("L1", "led")], [
      wire("w1", "board.b3", "R1.1"),
      wire("w2", "R1.2", "L1.A"),
      wire("w3", "L1.C", "board.b1"),
    ]);
    const lines: string[] = [];
    e.onSerial((ls) => lines.push(...ls.map((l) => l.text)));
    await e.start("arduino", `void setup(){ pinMode(2, OUTPUT); Serial.begin(115200); }
void loop(){ digitalWrite(2, HIGH); Serial.println("on"); delay(500); digitalWrite(2, LOW); delay(500); }`);
    await runFor(e, 250);
    expect(e.snapshot()!.live.L1.brightness).toBeGreaterThan(0.5);
    await runFor(e, 500);
    expect(e.snapshot()!.live.L1.brightness).toBeLessThan(0.05);
    expect(lines.filter((l) => l === "on").length).toBeGreaterThanOrEqual(1);
    await e.stop();
  });

  it("reads a DHT22 and an analog flame sensor", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("esp32-devkit-v1", [board("esp32-devkit-v1"), part("D1", "dht22"), part("F1", "flame")], [
      wire("w1", "board.b0", "D1.VCC"),
      wire("w2", "D1.GND", "board.b1"),
      wire("w3", "D1.DATA", "board.b4"),
      wire("w4", "board.b0", "F1.VCC"),
      wire("w5", "F1.GND", "board.b1"),
      wire("w6", "F1.AO", "board.t9"),
    ]);
    e.setEnvironment({ id: "lab", intensity: 1, duration: 1, startedAt: 0, params: {} }, { temperature: 31, flame: 0.8 });
    const lines: string[] = [];
    e.onSerial((ls) => lines.push(...ls.map((l) => l.text)));
    await e.start("arduino", `#include <DHT.h>
DHT dht(4, DHT22);
void setup(){ Serial.begin(115200); dht.begin(); }
void loop(){ float t = dht.readTemperature(); int f = analogRead(32); Serial.print(t); Serial.print(","); Serial.println(f); delay(1000); }`);
    await runFor(e, 300);
    const row = lines.find((l) => l.includes(","));
    expect(row).toBeTruthy();
    const [t, f] = row!.split(",").map(Number);
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(32);
    expect(f).toBeLessThan(1500);
    await e.stop();
  });

  it("runs gpiozero on a Raspberry Pi 4", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("rpi-4b", [board("rpi-4b"), part("R1", "resistor", { ohms: 330 }), part("L1", "led", { color: "green" })], [
      wire("w1", "board.h11", "R1.1"),
      wire("w2", "R1.2", "L1.A"),
      wire("w3", "L1.C", "board.h9"),
    ]);
    await e.start("python", `from gpiozero import LED
from time import sleep
led = LED(17)
while True:
    led.on()
    sleep(0.5)
    led.off()
    sleep(0.5)
`);
    await runFor(e, 200);
    expect(e.snapshot()!.live.L1.brightness).toBeGreaterThan(0.3);
    await runFor(e, 500);
    expect(e.snapshot()!.live.L1.brightness).toBeLessThan(0.05);
    await e.stop();
  });

  it("runs MicroPython servo PWM on a Pico", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("rpi-pico", [board("rpi-pico"), part("S1", "servo-sg90")], [
      wire("w1", "board.p40", "S1.V"),
      wire("w2", "S1.GND", "board.p38"),
      wire("w3", "S1.SIG", "board.p20"),
    ]);
    await e.start("micropython", `from machine import Pin, PWM
import utime
s = PWM(Pin(15))
s.freq(50)
s.duty_ns(2400000)
while True:
    utime.sleep_ms(100)
`);
    await runFor(e, 2500);
    expect(e.snapshot()!.live.S1.angle).toBeGreaterThan(170);
    await e.stop();
  });
});

describe("transpilers", () => {
  it("wraps 16-bit ints on AVR", () => {
    const js = transpileArduino("int x = 40000; void setup(){} void loop(){}", { intBits: 16 }).js;
    expect(js).toContain("__i16(40000)");
  });
  it("handles python tuples and floor division", () => {
    const js = transpilePython("a = (1, 2)\nb = 7 // 2\n").js;
    expect(js).toContain("[ 1 , 2 ]");
    expect(js).toContain("__floordiv(7, 2)");
  });
});

describe("vibration analysis", () => {
  it("samples a delay(5) sketch at 200 Hz and finds the motor's 1x peak", async () => {
    const { instantiateTemplate, TEMPLATES } = await import("../src/core/templates");
    const { spectrum } = await import("../src/lib/recorder");
    const t = TEMPLATES.find((x) => x.id === "vibration-monitor")!;
    const inst = instantiateTemplate(t, "esp32-devkit-v1", "arduino");
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("esp32-devkit-v1", inst.parts, inst.wires);
    e.setEnvironment(inst.scenario, {});
    const T: number[] = [];
    const V: number[] = [];
    e.onSerial((ls) => {
      for (const l of ls) {
        const m = l.text.match(/ax:(-?[\d.]+)/);
        if (m) {
          T.push(l.t / 1000);
          V.push(Number(m[1]));
        }
      }
    });
    await e.start("arduino", inst.code.arduino!);
    await runFor(e, 4000);
    await e.stop();
    expect(T.length).toBeGreaterThan(750);
    const sp = spectrum(T, V, 2);
    let best = 0;
    for (let i = 1; i < sp.a.length; i++) if (sp.a[i] > sp.a[best]) best = i;
    expect(Math.abs(sp.f[best] - 1480 / 60)).toBeLessThan(1);
  }, 30000);
});
