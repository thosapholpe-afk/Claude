// Core data model for Thosaphol Connect. All geometry is in millimetres.

export type Lang = "arduino" | "micropython" | "python" | "ladder";

export type Cap =
  | "digital"
  | "pwm"
  | "adc"
  | "dac"
  | "sda"
  | "scl"
  | "tx"
  | "rx"
  | "touch"
  | "mosi"
  | "miso"
  | "sck";

export type PinKind = "gpio" | "power" | "gnd" | "nc" | "ctrl";

export interface BoardPin {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: PinKind;
  /** GPIO number used by code (Arduino pin number / BCM / GP number). */
  gpio?: number;
  caps: Cap[];
  /** Supply voltage for power pins. */
  volts?: number;
  /** Alternative names the wiring command bar accepts (e.g. "GP10", "D10", "GPIO10"). */
  aliases: string[];
  /** Physical header pin number (Raspberry Pi BOARD numbering, Pico pin number). */
  phys?: number;
  inputOnly?: boolean;
  /** Reserved / strapping / boot-sensitive pins are avoided by auto-wiring. */
  avoid?: string;
  /** ESP32 ADC2 channel: unusable while Wi-Fi is on. */
  adc2?: boolean;
}

export type ConnectorKind =
  | "usb-b"
  | "usb-micro"
  | "usb-c"
  | "usb-a"
  | "barrel"
  | "rj45"
  | "hdmi-micro"
  | "audio"
  | "button"
  | "sd"
  | "antenna"
  | "header";

export interface Connector {
  id: string;
  label: string;
  kind: ConnectorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height above the PCB top surface. */
  z: number;
  /** Board edge the connector faces (used for case cut-outs). */
  edge: "left" | "right" | "top" | "bottom" | null;
}

export interface Chip {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  z: number;
  metal?: boolean;
  /** Radio module (shielded can on a substrate), e.g. ESP-WROOM-32. */
  module?: boolean;
}

/** How a board's pins come out: male pins under the PCB, female sockets on top, or male pins on top. */
export type HeaderStyle = "male-down" | "female-up" | "male-up";

/** Silkscreen title and indicator LEDs, for drawing. */
export interface BoardLook {
  title: string;
  tx: number;
  ty: number;
  size: number;
  spacing?: number;
  radius?: number;
  leds: { x: number; y: number; color: string; label: string; role: "pwr" | "user" | "act" }[];
}

export interface BoardDef {
  id: string;
  name: string;
  short: string;
  vendor: string;
  mcu: string;
  family: "esp32" | "esp8266" | "avr" | "rp2040" | "bcm2711" | "plc";
  width: number;
  height: number;
  thickness: number;
  logicV: number;
  adcBits: number;
  adcVref: number;
  /** Size of the C/C++ `int` type in bits (AVR = 16). */
  intBits: 16 | 32;
  pcbColor: string;
  silkColor: string;
  pins: BoardPin[];
  holes: { x: number; y: number; d: number }[];
  connectors: Connector[];
  chips: Chip[];
  languages: Lang[];
  defaultLang: Lang;
  builtinLed?: string;
  /** Arduino constants such as A0, LED_BUILTIN. */
  constants: Record<string, number>;
  i2c: { sda: string; scl: string };
  notes: string[];
  /** Tallest component above the PCB (case design). */
  maxComponentZ: number;
  headers?: HeaderStyle;
  look?: BoardLook;
  /** Has a Wi-Fi radio the simulator can use. */
  wifi?: boolean;
  /** The built-in LED lights when its pin is LOW (ESP8266 boards). */
  builtinActiveLow?: boolean;
  /** Max current per output pin in A (default 0.04; PLC transistor outputs 0.5). */
  pinMaxA?: number;
}

export type PinRole =
  | "vcc"
  | "gnd"
  | "signal"
  | "analog"
  | "digital-out"
  | "digital-in"
  | "pwm-in"
  | "sda"
  | "scl"
  | "passive"
  | "anode"
  | "cathode"
  | "nc"
  /** Compressed-air port: its net's voltage is the line pressure in bar. */
  | "air";

export interface PartPin {
  id: string;
  label: string;
  x: number;
  y: number;
  role: PinRole;
  /** Capability the MCU pin needs when this pin is auto-wired. */
  need?: Cap;
}

export interface PropSpec {
  key: string;
  label: string;
  type: "number" | "select" | "color" | "text" | "boolean" | "range";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Shown as a live control while the simulation runs (e.g. knob position). */
  live?: boolean;
}

export type PartCategory =
  | "output"
  | "input"
  | "sensor"
  | "actuator"
  | "display"
  | "passive"
  | "prototyping"
  | "custom"
  | "control"
  | "pneumatic"
  | "instrument";

export type EnvKey =
  | "temperature"
  | "humidity"
  | "flame"
  | "smoke"
  | "gas"
  | "water"
  | "soil"
  | "lux"
  | "sound"
  | "distance"
  | "motion"
  | "vibration"
  | "pressure"
  | "rain"
  | "co2"
  | "magnet"
  | "heartRate";

export interface PartInstance {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
  props: Record<string, number | string | boolean>;
}

export interface Endpoint {
  part: string;
  pin: string;
}

export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
  color: string;
  /** Intermediate route points in mm (orthogonal router output or user bends). */
  points: { x: number; y: number }[];
}

export interface CustomSensorDef {
  type: string; // "custom:<slug>"
  name: string;
  model: string;
  description: string;
  color: string;
  w: number;
  h: number;
  pins: { id: string; label: string; role: PinRole }[];
  params: { key: string; label: string; default: number; min: number; max: number; unit: string }[];
  /** Environment variable this sensor responds to. */
  env: EnvKey | "none";
  /** Output mode for the main output pin. */
  output: "analog" | "digital" | "both";
  /**
   * JavaScript expression returning the analog output as a fraction of VCC (0..1).
   * Variables: env (object), p (params), t (seconds), noise(sd), clamp(x,a,b), lerp(a,b,x).
   */
  expr: string;
  /** Digital output: threshold on the analog fraction, plus active level. */
  threshold: number;
  activeLow: boolean;
  createdBy?: string;
  createdAt: number;
}

export interface CaseFeature {
  id: string;
  face: "lid" | "front" | "back" | "left" | "right";
  shape: "circle" | "rect";
  /** Position on the face in mm, measured from the face's lower-left corner. */
  u: number;
  v: number;
  w: number;
  h: number;
  label: string;
}

export interface CaseParams {
  wall: number;
  floor: number;
  clearance: number;
  cornerRadius: number;
  innerHeight: number;
  lidThickness: number;
  standoffHeight: number;
  screwHole: number;
  vents: "none" | "lid-slots" | "side-slots" | "honeycomb";
  waterproof: boolean;
  mountingEars: boolean;
  connectorCutouts: boolean;
  includeBreadboard: boolean;
  features: CaseFeature[];
  label: string;
}

export interface MqttConfig {
  url: string;
  clientId: string;
  username: string;
  password: string;
  prefix: string;
  intervalMs: number;
  retain: boolean;
  qos: 0 | 1;
  publishPins: boolean;
  publishSensors: boolean;
  publishEnv: boolean;
  publishSerial: boolean;
  acceptCommands: boolean;
}

export interface ScenarioState {
  id: string;
  intensity: number; // 0..1
  duration: number; // seconds for the timeline to reach full intensity
  startedAt: number; // sim seconds
  params: Record<string, number | string>;
}

export interface Project {
  id: string;
  name: string;
  boardId: string;
  parts: PartInstance[];
  wires: Wire[];
  lang: Lang;
  code: Partial<Record<Lang, string>>;
  scenario: ScenarioState;
  envOverrides: Partial<Record<string, number>>;
  caseParams?: Partial<CaseParams>;
  createdAt: number;
  updatedAt: number;
}

export interface ProbeSignal {
  id: string;
  label: string;
  unit: string;
  color: string;
}
