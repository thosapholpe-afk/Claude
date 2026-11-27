import { describe, expect, it } from "vitest";
import { defaultScenarioState } from "../src/core/env";
import { SimEngine } from "../src/core/sim";
import { instantiateTemplate, TEMPLATES } from "../src/core/templates";
import type { Lang, PartInstance, Wire } from "../src/core/types";

const board = (id: string): PartInstance => ({ id: "board", type: `board:${id}`, label: id, x: 0, y: 0, rot: 0, props: {} });
const part = (id: string, type: string, props: PartInstance["props"] = {}): PartInstance => ({ id, type, label: id, x: 100, y: 100, rot: 0, props });
const wire = (id: string, a: string, b: string): Wire => {
  const [ap, apin] = a.split(".");
  const [bp, bpin] = b.split(".");
  return { id, from: { part: ap, pin: apin }, to: { part: bp, pin: bpin }, color: "#f00", points: [] };
};
async function runFor(e: SimEngine, ms: number) {
  for (let t = 0; t < ms; t += 20) {
    await new Promise((r) => setTimeout(r, 0));
    await e.frame(20);
  }
}
async function serialOf(boardId: string, parts: PartInstance[], wires: Wire[], lang: Lang, code: string, ms: number, scenario = "lab", overrides: Record<string, number> = {}) {
  const e = new SimEngine();
  e.autoFrames = false;
  e.setCircuit(boardId, [board(boardId), ...parts], wires);
  e.setEnvironment(defaultScenarioState(scenario), overrides);
  const out: string[] = [];
  e.onSerial((ls) => out.push(...ls.map((l) => `${l.kind}:${l.text}`)));
  await e.start(lang, code);
  await runFor(e, ms);
  await e.stop();
  return out;
}
const values = (lines: string[], key: string) =>
  lines.flatMap((l) => [...l.matchAll(new RegExp(`${key}:(-?[\\d.]+)`, "g"))].map((m) => Number(m[1])));

describe("new sensors", () => {
  it("BME280 reports pressure in hPa over I²C (Arduino)", async () => {
    const out = await serialOf(
      "esp32-devkit-v1",
      [part("B", "bme280")],
      [wire("1", "B.VCC", "board.b0"), wire("2", "B.GND", "board.b1"), wire("3", "B.SDA", "board.b10"), wire("4", "B.SCL", "board.b13")],
      "arduino",
      `#include <Adafruit_BME280.h>
Adafruit_BME280 bme;
void setup(){ Serial.begin(115200); bme.begin(0x76); }
void loop(){ Serial.print("p:"); Serial.print(bme.readPressure() / 100.0); Serial.print(",t:"); Serial.println(bme.readTemperature()); delay(200); }`,
      700,
      "lab",
      { pressure: 1002.5, temperature: 31 },
    );
    expect(out.filter((l) => l.startsWith("err"))).toEqual([]);
    expect(values(out, "p")[0]).toBeCloseTo(1002.5, 0);
    expect(values(out, "t")[0]).toBeCloseTo(31, 0);
  });

  it("DS18B20 works through OneWire + DallasTemperature with &oneWire", async () => {
    const out = await serialOf(
      "arduino-uno",
      [part("T", "ds18b20")],
      [wire("1", "T.VCC", "board.5v"), wire("2", "T.GND", "board.gnd1"), wire("3", "T.DATA", "board.d4")],
      "arduino",
      `#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(4);
DallasTemperature sensors(&oneWire);
void setup(){ Serial.begin(9600); sensors.begin(); }
void loop(){ sensors.requestTemperatures(); Serial.print("c:"); Serial.println(sensors.getTempCByIndex(0)); delay(300); }`,
      700,
      "lab",
      { temperature: -12 },
    );
    expect(values(out, "c")[0]).toBeCloseTo(-12, 0);
  });

  it("MicroPython bme280 and ds18x20 modules read the environment", async () => {
    const out = await serialOf(
      "rpi-pico",
      [part("B", "bme280"), part("T", "ds18b20")],
      [
        wire("1", "B.VCC", "board.p36"), wire("2", "B.GND", "board.p38"), wire("3", "B.SDA", "board.p6"), wire("4", "B.SCL", "board.p7"),
        wire("5", "T.VCC", "board.p36"), wire("6", "T.GND", "board.p3"), wire("7", "T.DATA", "board.p20"),
      ],
      "micropython",
      `from machine import Pin, I2C
import bme280, onewire, ds18x20, utime
bme = bme280.BME280(i2c=I2C(0, sda=Pin(4), scl=Pin(5)))
ds = ds18x20.DS18X20(onewire.OneWire(Pin(15)))
roms = ds.scan()
t, pa, h = bme.read_compensated_data()
ds.convert_temp()
print("hpa:{:.1f},probe:{}".format(pa / 100, ds.read_temp(roms[0])))
`,
      400,
      "lab",
      { pressure: 990, temperature: 22 },
    );
    expect(out.filter((l) => l.startsWith("err"))).toEqual([]);
    expect(values(out, "hpa")[0]).toBeCloseTo(990, 0);
    expect(values(out, "probe")[0]).toBeCloseTo(22, 0);
  });

  it("heart-rate template measures about 72 bpm", async () => {
    const t = TEMPLATES.find((x) => x.id === "heart-rate")!;
    const inst = instantiateTemplate(t, "arduino-uno", "arduino");
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("arduino-uno", inst.parts, inst.wires);
    e.setEnvironment(defaultScenarioState("lab"), { heartRate: 72 });
    const out: string[] = [];
    e.onSerial((ls) => out.push(...ls.map((l) => l.text)));
    await e.start("arduino", inst.code.arduino!);
    await runFor(e, 4000);
    await e.stop();
    const bpm = values(out, "bpm").filter((v) => v > 0);
    expect(bpm.length).toBeGreaterThan(0);
    expect(bpm[bpm.length - 1]).toBeGreaterThan(64);
    expect(bpm[bpm.length - 1]).toBeLessThan(80);
  }, 20000);

  it("rain plate and IR obstacle switch their digital outputs", async () => {
    const e = new SimEngine();
    e.autoFrames = false;
    e.setCircuit("arduino-uno", [board("arduino-uno"), part("R", "rain"), part("I", "ir-obstacle", { range: 20 }), part("H", "hall")], [
      wire("1", "R.VCC", "board.5v"), wire("2", "R.GND", "board.gnd1"),
      wire("3", "I.VCC", "board.5v"), wire("4", "I.GND", "board.gnd1"),
      wire("5", "H.VCC", "board.5v"), wire("6", "H.GND", "board.gnd1"),
    ]);
    e.setEnvironment(defaultScenarioState("lab"), { rain: 0.9, distance: 8, magnet: 40 });
    const live = e.snapshot()!.live;
    expect(live.R.indicator).toBe(true);
    expect(live.I.indicator).toBe(true);
    expect(live.H.indicator).toBe(true);
    e.setEnvironment(defaultScenarioState("lab"), { rain: 0, distance: 120, magnet: 0 });
    const dry = e.snapshot()!.live;
    expect(dry.R.indicator).toBe(false);
    expect(dry.I.indicator).toBe(false);
    expect(dry.H.indicator).toBe(false);
  });
});
