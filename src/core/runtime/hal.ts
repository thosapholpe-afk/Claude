import type { EnvState } from "../env";
import type { PinMode } from "../solver";
import type { BoardDef, BoardPin } from "../types";

export const STOP = Symbol("stop");

export interface MqttHal {
  connected(): boolean;
  publish(topic: string, payload: string, retain?: boolean): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  onMessage(cb: (topic: string, payload: string) => void): () => void;
  broker(): string;
}

/** Hardware abstraction the firmware shims talk to. Implemented by SimEngine. */
export interface Hal {
  board: BoardDef;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  yieldNow(force?: boolean): Promise<void>;
  pin(n: number | string): BoardPin | undefined;
  physPin(n: number): BoardPin | undefined;
  setMode(pinId: string, mode: PinMode): void;
  getMode(pinId: string): PinMode | undefined;
  writeDigital(pinId: string, level: number): void;
  writePwm(pinId: string, duty: number, freq?: number): void;
  writeServo(pinId: string, us: number): void;
  writeTone(pinId: string, hz: number, durMs?: number): void;
  writeDac(pinId: string, volts: number): void;
  readVolts(pinId: string): number;
  readDigital(pinId: string): 0 | 1;
  findPart(pinId: string, types: string[]): { id: string; pin: string; props: Record<string, unknown> } | undefined;
  findI2C(types: string[], sda?: string, scl?: string): { id: string; props: Record<string, unknown> } | undefined;
  partSupply(partId: string, vcc: string, gnd: string): number;
  trigFired(partId: string, trigPin: string): boolean;
  env(): EnvState;
  setLib(partId: string, patch: Record<string, unknown>): void;
  getLib(partId: string): Record<string, unknown>;
  serialOut(text: string): void;
  serialAvailable(): number;
  serialRead(): number;
  serialPeek(): number;
  attachInterrupt(pinId: string, fn: () => unknown, mode: "RISING" | "FALLING" | "CHANGE"): void;
  detachInterrupt(pinId: string): void;
  mqtt: MqttHal;
  warn(msg: string): void;
  isStopped(): boolean;
  wifiStart: number | null;
}
