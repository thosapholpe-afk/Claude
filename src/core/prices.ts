/**
 * Rough street prices (USD, single units from common hobby / industrial suppliers) so a
 * project can show what it would cost to build for real. Estimates, not quotes.
 */
import { getBoard } from "./boards";
import { isBoard } from "./circuit";
import { getPart } from "./parts";
import type { Project } from "./types";

const PART_USD: Record<string, number> = {
  led: 0.1,
  "rgb-led": 0.3,
  buzzer: 0.5,
  "servo-sg90": 2.5,
  "servo-mg996r": 6,
  relay: 1.5,
  "dc-motor": 2,
  lcd1602: 3.5,
  "neopixel-ring": 4,
  button: 0.1,
  pot: 0.5,
  resistor: 0.02,
  ldr: 0.2,
  lm35: 1.5,
  dht22: 4,
  "hc-sr04": 1.5,
  flame: 1,
  water: 0.8,
  soil: 1,
  mq2: 1.8,
  pir: 1.5,
  sw420: 0.8,
  adxl335: 4,
  sound: 1,
  bme280: 4,
  bh1750: 1.8,
  ds18b20: 1.5,
  "ir-obstacle": 0.8,
  hall: 0.8,
  touch: 0.5,
  joystick: 1.5,
  pulse: 3,
  mq135: 2.5,
  rain: 1,
  "pb-no": 4,
  "pb-nc": 4,
  estop: 9,
  selector2: 6,
  selector3: 7,
  "limit-switch": 8,
  "pilot-lamp": 3.5,
  contactor: 18,
  overload: 16,
  "timer-relay": 14,
  "air-supply": 35,
  valve52: 22,
  valve52d: 28,
  cylinder: 30,
  psu24: 20,
  supply3: 0,
  mcb3: 12,
  motor3: 85,
  multimeter: 25,
  breadboard: 3,
  perfboard: 1.5,
};

const BOARD_USD: Record<string, number> = {
  "esp32-devkit-v1": 8,
  "esp32-s3-devkitc": 12,
  "nodemcu-esp8266": 4,
  "arduino-uno": 25,
  "arduino-nano": 22,
  "arduino-mega": 45,
  "rpi-pico": 4,
  "rpi-pico-w": 6,
  "rpi-4b": 55,
  "plc-fx16": 120,
};

export const partPrice = (type: string) => PART_USD[type] ?? (type.startsWith("custom:") ? 2 : undefined);
export const boardPrice = (id: string) => BOARD_USD[id];
export const usd = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toFixed(0)}`;

export interface BomLine {
  name: string;
  labels: string[];
  qty: number;
  each: number;
}

/** Bill of materials with an estimated total. Parts without a price (mains supply) count as zero. */
export function bomOf(p: Pick<Project, "boardId" | "parts">): { lines: BomLine[]; total: number } {
  const board = getBoard(p.boardId);
  const lines = new Map<string, BomLine>();
  for (const inst of p.parts) {
    if (isBoard(inst)) continue;
    const def = getPart(inst.type);
    const each = partPrice(inst.type) ?? 0;
    const l = lines.get(inst.type) ?? { name: def?.name ?? inst.type, labels: [], qty: 0, each };
    l.qty++;
    l.labels.push(inst.label);
    lines.set(inst.type, l);
  }
  const list = [{ name: board.name, labels: [board.short], qty: 1, each: boardPrice(board.id) ?? 0 }, ...lines.values()];
  return { lines: list, total: list.reduce((a, l) => a + l.qty * l.each, 0) };
}
