import { BOARDS, getBoard } from "./boards";
import { BOARD_ID, endpointPos } from "./circuit";
import { defaultScenarioState } from "./env";
import { getPart } from "./parts";
import { choosePin, choosePowerPin, chooseGnd, newId, WIRE_COLORS } from "./wiring";
import type { BoardDef, BoardPin, Cap, Lang, PartInstance, Project, Wire } from "./types";

export interface PinRef {
  id: string;
  gpio: number;
  label: string;
  /** Arduino pin expression (e.g. "A0" on Uno analog pins, otherwise the GPIO number). */
  ard: string;
}

type CodeGen = (p: Record<string, PinRef>, b: BoardDef) => string;

export interface Template {
  id: string;
  name: string;
  thai: string;
  description: string;
  icon: string;
  boards?: string[];
  scenario?: string;
  scenarioParams?: Record<string, number | string>;
  parts: { id: string; type: string; label: string; dx: number; dy: number; rot?: 0 | 90 | 180 | 270; props?: PartInstance["props"] }[];
  /** [part.pin, token]. Tokens: @gnd @5v @3v3 @logic @<cap>:<name> or another part.pin */
  wiring: [string, string][];
  code: Partial<Record<Lang, CodeGen>>;
}

/** Boards with at least `n` analog inputs (the Pi 4 has none). */
const withAdc = (n = 1) => BOARDS.filter((b) => b.pins.filter((p) => p.caps.includes("adc")).length >= n).map((b) => b.id);
const MCU_BOARDS = BOARDS.filter((b) => b.family !== "bcm2711").map((b) => b.id);
const WIFI_MCUS = BOARDS.filter((b) => b.wifi && b.family !== "bcm2711").map((b) => b.id);

const servoInclude = (b: BoardDef) => (b.family === "esp32" ? "#include <ESP32Servo.h>" : "#include <Servo.h>");

export const TEMPLATES: Template[] = [
  {
    id: "blink",
    name: "Blink an LED",
    thai: "ไฟกะพริบ",
    description: "The hello-world of hardware: an LED and a resistor on one GPIO.",
    icon: "lightbulb",
    parts: [
      { id: "L1", type: "led", label: "LED1", dx: 30, dy: 0, props: { color: "red" } },
      { id: "R1", type: "resistor", label: "R1", dx: 14, dy: 18, props: { ohms: 220 } },
    ],
    wiring: [
      ["R1.1", "@digital:led"],
      ["R1.2", "L1.A"],
      ["L1.C", "@gnd"],
    ],
    code: {
      arduino: (p) => `// Blink — LED on ${p.led.label}
const int LED_PIN = ${p.led.ard};

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED off");
  delay(500);
}
`,
      micropython: (p) => `# Blink — LED on ${p.led.label}
from machine import Pin
import utime

led = Pin(${p.led.gpio}, Pin.OUT)

while True:
    led.toggle()
    print("LED", led.value())
    utime.sleep_ms(500)
`,
      python: (p) => `# Blink — LED on ${p.led.label} (BCM ${p.led.gpio})
from gpiozero import LED
from time import sleep

led = LED(${p.led.gpio})

while True:
    led.on()
    print("LED on")
    sleep(0.5)
    led.off()
    print("LED off")
    sleep(0.5)
`,
    },
  },
  {
    id: "servo-sg90",
    name: "Servo SG90 sweep",
    thai: "เซอร์โว SG90 กวาด",
    description: "Sweep a 9 g servo from 0° to 180° and back.",
    icon: "rotate",
    parts: [{ id: "S1", type: "servo-sg90", label: "SERVO1", dx: 24, dy: 0 }],
    wiring: [
      ["S1.GND", "@gnd"],
      ["S1.V", "@5v"],
      ["S1.SIG", "@pwm:servo"],
    ],
    code: {
      arduino: (p, b) => `${servoInclude(b)}

Servo servo;
const int SERVO_PIN = ${p.servo.ard};

void setup() {
  Serial.begin(115200);
  servo.attach(SERVO_PIN, 544, 2400);
}

void loop() {
  for (int a = 0; a <= 180; a += 2) {
    servo.write(a);
    delay(15);
  }
  Serial.println("reached 180");
  for (int a = 180; a >= 0; a -= 2) {
    servo.write(a);
    delay(15);
  }
  Serial.println("back to 0");
}
`,
      micropython: (p) => `# SG90 on ${p.servo.label} — 50 Hz PWM, 0.5–2.4 ms pulse
from machine import Pin, PWM
import utime

servo = PWM(Pin(${p.servo.gpio}))
servo.freq(50)

def angle(deg):
    us = 544 + deg * (2400 - 544) / 180
    servo.duty_ns(int(us * 1000))

while True:
    for a in range(0, 181, 2):
        angle(a)
        utime.sleep_ms(15)
    for a in range(180, -1, -2):
        angle(a)
        utime.sleep_ms(15)
`,
      python: (p) => `# SG90 on BCM ${p.servo.gpio}
from gpiozero import AngularServo
from time import sleep

servo = AngularServo(${p.servo.gpio}, min_angle=0, max_angle=180, min_pulse_width=0.544/1000, max_pulse_width=2.4/1000)

while True:
    for a in range(0, 181, 5):
        servo.angle = a
        sleep(0.03)
    for a in range(180, -1, -5):
        servo.angle = a
        sleep(0.03)
`,
    },
  },
  {
    id: "servo-mg996r",
    name: "MG996R + knob",
    thai: "เซอร์โว MG996R คุมด้วยโพเทนชิโอ",
    description: "A potentiometer sets the angle of a high-torque MG996R servo.",
    icon: "gauge",
    boards: withAdc(1),
    parts: [
      { id: "S1", type: "servo-mg996r", label: "SERVO1", dx: 26, dy: -4 },
      { id: "P1", type: "pot", label: "POT1", dx: 26, dy: 30, props: { position: 0.3 } },
    ],
    wiring: [
      ["S1.GND", "@gnd"],
      ["S1.V", "@5v"],
      ["S1.SIG", "@pwm:servo"],
      ["P1.1", "@logic"],
      ["P1.W", "@adc:pot"],
      ["P1.2", "@gnd"],
    ],
    code: {
      arduino: (p, b) => `${servoInclude(b)}

Servo servo;
const int SERVO_PIN = ${p.servo.ard};
const int POT_PIN = ${p.pot.ard};

void setup() {
  Serial.begin(115200);
  servo.attach(SERVO_PIN, 544, 2400);
}

void loop() {
  int raw = analogRead(POT_PIN);
  int angle = map(raw, 0, ${b.family === "esp32" ? 4095 : 1023}, 0, 180);
  servo.write(angle);
  Serial.print("pot:");
  Serial.print(raw);
  Serial.print(",angle:");
  Serial.println(angle);
  delay(20);
}
`,
      micropython: (p) => `from machine import Pin, PWM, ADC
import utime

servo = PWM(Pin(${p.servo.gpio}))
servo.freq(50)
pot = ADC(${p.pot.gpio})

while True:
    raw = pot.read_u16()
    angle = raw * 180 // 65535
    servo.duty_ns(int((544 + angle * 1856 / 180) * 1000))
    print("pot:{},angle:{}".format(raw, angle))
    utime.sleep_ms(20)
`,
    },
  },
  {
    id: "traffic-light",
    name: "Traffic light",
    thai: "ไฟจราจร",
    description: "Red, yellow and green LEDs cycling like a crossing.",
    icon: "traffic",
    parts: [
      { id: "L1", type: "led", label: "RED", dx: 26, dy: -6, props: { color: "red" } },
      { id: "L2", type: "led", label: "YELLOW", dx: 36, dy: -6, props: { color: "yellow" } },
      { id: "L3", type: "led", label: "GREEN", dx: 46, dy: -6, props: { color: "green" } },
    ],
    wiring: [
      ["L1.A", "@digital:red"],
      ["L2.A", "@digital:yellow"],
      ["L3.A", "@digital:green"],
      ["L1.C", "@gnd"],
      ["L2.C", "@gnd"],
      ["L3.C", "@gnd"],
    ],
    code: {
      arduino: (p) => `const int RED = ${p.red.ard}, YELLOW = ${p.yellow.ard}, GREEN = ${p.green.ard};

void light(int r, int y, int g) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  light(HIGH, LOW, LOW);  delay(3000);
  light(HIGH, HIGH, LOW); delay(800);
  light(LOW, LOW, HIGH);  delay(3000);
  light(LOW, HIGH, LOW);  delay(1000);
}
`,
      micropython: (p) => `from machine import Pin
import utime

red, yellow, green = Pin(${p.red.gpio}, Pin.OUT), Pin(${p.yellow.gpio}, Pin.OUT), Pin(${p.green.gpio}, Pin.OUT)

def light(r, y, g):
    red.value(r)
    yellow.value(y)
    green.value(g)

while True:
    light(1, 0, 0); utime.sleep(3)
    light(1, 1, 0); utime.sleep(0.8)
    light(0, 0, 1); utime.sleep(3)
    light(0, 1, 0); utime.sleep(1)
`,
      python: (p) => `from gpiozero import LED
from time import sleep

red, yellow, green = LED(${p.red.gpio}), LED(${p.yellow.gpio}), LED(${p.green.gpio})

def light(r, y, g):
    red.value, yellow.value, green.value = r, y, g

while True:
    light(1, 0, 0); sleep(3)
    light(1, 1, 0); sleep(0.8)
    light(0, 0, 1); sleep(3)
    light(0, 1, 0); sleep(1)
`,
    },
  },
  {
    id: "flame-alarm",
    name: "Fire alarm",
    thai: "สัญญาณเตือนไฟไหม้",
    description: "IR flame sensor triggers a buzzer and a flashing LED. Try it in the burning-building scenario.",
    icon: "flame",
    scenario: "building-fire",
    parts: [
      { id: "F1", type: "flame", label: "FLAME1", dx: 24, dy: -10 },
      { id: "B1", type: "buzzer", label: "BZ1", dx: 28, dy: 18 },
      { id: "L1", type: "led", label: "LED1", dx: 50, dy: 18, props: { color: "red" } },
    ],
    wiring: [
      ["F1.VCC", "@logic"],
      ["F1.GND", "@gnd"],
      ["F1.DO", "@digital:flame_do"],
      ["F1.AO", "@adc?:flame_ao"],
      ["B1.P", "@digital:buzzer"],
      ["B1.N", "@gnd"],
      ["L1.A", "@digital:led"],
      ["L1.C", "@gnd"],
    ],
    code: {
      arduino: (p, b) => `// Fire alarm — flame sensor DO goes LOW when it sees fire
const int FLAME_DO = ${p.flame_do.ard};
${p.flame_ao ? `const int FLAME_AO = ${p.flame_ao.ard};` : ""}
const int BUZZER = ${p.buzzer.ard};
const int LED = ${p.led.ard};

void setup() {
  Serial.begin(115200);
  pinMode(FLAME_DO, INPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  bool fire = digitalRead(FLAME_DO) == LOW;
${p.flame_ao ? `  int ir = analogRead(FLAME_AO);
  Serial.print("ir:");
  Serial.print(ir);
  Serial.print(",fire:");
  Serial.println(fire ? ${b.family === "esp32" ? 4095 : 1023} : 0);` : `  Serial.println(fire ? "FIRE!" : "clear");`}
  if (fire) {
    digitalWrite(BUZZER, HIGH);
    digitalWrite(LED, (millis() / 150) % 2);
  } else {
    digitalWrite(BUZZER, LOW);
    digitalWrite(LED, LOW);
  }
  delay(50);
}
`,
      micropython: (p) => `from machine import Pin${p.flame_ao ? ", ADC" : ""}
import utime

flame = Pin(${p.flame_do.gpio}, Pin.IN)
${p.flame_ao ? `ir = ADC(${p.flame_ao.gpio})` : ""}
buzzer = Pin(${p.buzzer.gpio}, Pin.OUT)
led = Pin(${p.led.gpio}, Pin.OUT)

while True:
    fire = flame.value() == 0
${p.flame_ao ? `    print("ir:{},fire:{}".format(ir.read_u16(), 65535 if fire else 0))` : `    print("FIRE!" if fire else "clear")`}
    buzzer.value(1 if fire else 0)
    led.value((utime.ticks_ms() // 150) % 2 if fire else 0)
    utime.sleep_ms(50)
`,
      python: (p) => `from gpiozero import DigitalInputDevice, Buzzer, LED
from time import sleep

flame = DigitalInputDevice(${p.flame_do.gpio})
buzzer = Buzzer(${p.buzzer.gpio})
led = LED(${p.led.gpio})

while True:
    fire = flame.value == 0
    print("FIRE!" if fire else "clear")
    if fire:
        buzzer.on()
        led.toggle()
    else:
        buzzer.off()
        led.off()
    sleep(0.15)
`,
    },
  },
  {
    id: "water-leak",
    name: "Water leak detector",
    thai: "ตรวจจับน้ำรั่ว / น้ำท่วม",
    description: "Water level sensor plus buzzer. Run it in the flood scenario.",
    icon: "droplets",
    boards: withAdc(1),
    scenario: "flood",
    parts: [
      { id: "W1", type: "water", label: "WATER1", dx: 26, dy: -20 },
      { id: "B1", type: "buzzer", label: "BZ1", dx: 54, dy: 10 },
    ],
    wiring: [
      ["W1.VCC", "@logic"],
      ["W1.GND", "@gnd"],
      ["W1.S", "@adc:water"],
      ["B1.P", "@digital:buzzer"],
      ["B1.N", "@gnd"],
    ],
    code: {
      arduino: (p, b) => `const int WATER = ${p.water.ard};
const int BUZZER = ${p.buzzer.ard};
const int LIMIT = ${b.family === "esp32" ? 1200 : 300};

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  int level = analogRead(WATER);
  Serial.print("level:");
  Serial.println(level);
  digitalWrite(BUZZER, level > LIMIT ? HIGH : LOW);
  delay(100);
}
`,
      micropython: (p) => `from machine import Pin, ADC
import utime

water = ADC(${p.water.gpio})
buzzer = Pin(${p.buzzer.gpio}, Pin.OUT)

while True:
    level = water.read_u16()
    print("level:", level)
    buzzer.value(1 if level > 20000 else 0)
    utime.sleep_ms(100)
`,
    },
  },
  {
    id: "ultrasonic",
    name: "Ultrasonic distance",
    thai: "วัดระยะอัลตราโซนิก",
    description: "HC-SR04 measures distance; LED lights when something comes within 50 cm.",
    icon: "radar",
    scenario: "intruder",
    parts: [
      { id: "U1", type: "hc-sr04", label: "SONAR1", dx: 24, dy: -12 },
      { id: "L1", type: "led", label: "LED1", dx: 60, dy: 20, props: { color: "green" } },
    ],
    wiring: [
      ["U1.VCC", "@5v"],
      ["U1.GND", "@gnd"],
      ["U1.TRIG", "@digital:trig"],
      ["U1.ECHO", "@digital:echo"],
      ["L1.A", "@digital:led"],
      ["L1.C", "@gnd"],
    ],
    code: {
      arduino: (p) => `const int TRIG = ${p.trig.ard};
const int ECHO = ${p.echo.ard};
const int LED = ${p.led.ard};

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long duration = pulseIn(ECHO, HIGH, 30000);
  float cm = duration / 58.3;
  Serial.print("distance_cm:");
  Serial.println(cm);
  digitalWrite(LED, cm > 0 && cm < 50 ? HIGH : LOW);
  delay(100);
}
`,
      micropython: (p) => `from machine import Pin, time_pulse_us
import utime

trig = Pin(${p.trig.gpio}, Pin.OUT)
echo = Pin(${p.echo.gpio}, Pin.IN)
led = Pin(${p.led.gpio}, Pin.OUT)

def distance_cm():
    trig.value(0)
    utime.sleep_us(2)
    trig.value(1)
    utime.sleep_us(10)
    trig.value(0)
    t = time_pulse_us(echo, 1, 30000)
    return t / 58.3 if t > 0 else -1

while True:
    cm = distance_cm()
    print("distance_cm:", cm)
    led.value(1 if 0 < cm < 50 else 0)
    utime.sleep_ms(100)
`,
      python: (p) => `from gpiozero import DistanceSensor, LED
from time import sleep

sensor = DistanceSensor(echo=${p.echo.gpio}, trigger=${p.trig.gpio}, max_distance=4)
led = LED(${p.led.gpio})

while True:
    cm = sensor.distance * 100
    print(f"distance_cm:{cm:.1f}")
    led.value = 1 if cm < 50 else 0
    sleep(0.1)
`,
    },
  },
  {
    id: "pir-alarm",
    name: "Motion alarm (PIR)",
    thai: "กันขโมยด้วย PIR",
    description: "PIR motion sensor sounds a buzzer. Pairs with the intruder scenario.",
    icon: "scan",
    scenario: "intruder",
    parts: [
      { id: "P1", type: "pir", label: "PIR1", dx: 24, dy: -14 },
      { id: "B1", type: "buzzer", label: "BZ1", dx: 62, dy: 8 },
    ],
    wiring: [
      ["P1.VCC", "@5v"],
      ["P1.GND", "@gnd"],
      ["P1.OUT", "@digital:pir"],
      ["B1.P", "@digital:buzzer"],
      ["B1.N", "@gnd"],
    ],
    code: {
      arduino: (p) => `const int PIR = ${p.pir.ard};
const int BUZZER = ${p.buzzer.ard};

void setup() {
  Serial.begin(115200);
  pinMode(PIR, INPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  int motion = digitalRead(PIR);
  digitalWrite(BUZZER, motion);
  Serial.println(motion ? "Motion detected!" : "...");
  delay(200);
}
`,
      micropython: (p) => `from machine import Pin
import utime

pir = Pin(${p.pir.gpio}, Pin.IN)
buzzer = Pin(${p.buzzer.gpio}, Pin.OUT)

while True:
    m = pir.value()
    buzzer.value(m)
    print("Motion detected!" if m else "...")
    utime.sleep_ms(200)
`,
      python: (p) => `from gpiozero import MotionSensor, Buzzer
from signal import pause

pir = MotionSensor(${p.pir.gpio})
buzzer = Buzzer(${p.buzzer.gpio})

def alarm():
    print("Motion detected!")
    buzzer.on()

def quiet():
    print("All clear")
    buzzer.off()

pir.when_motion = alarm
pir.when_no_motion = quiet
pause()
`,
    },
  },
  {
    id: "weather-lcd",
    name: "Weather station LCD",
    thai: "สถานีวัดอากาศ + จอ LCD",
    description: "DHT22 temperature and humidity on a 16×2 I²C display.",
    icon: "thermometer",
    boards: MCU_BOARDS,
    scenario: "cold-storage",
    parts: [
      { id: "D1", type: "dht22", label: "DHT1", dx: 26, dy: -16 },
      { id: "LCD", type: "lcd1602", label: "LCD1", dx: 48, dy: -16 },
    ],
    wiring: [
      ["D1.VCC", "@logic"],
      ["D1.GND", "@gnd"],
      ["D1.DATA", "@digital:dht"],
      ["LCD.GND", "@gnd"],
      ["LCD.VCC", "@logic"],
      ["LCD.SDA", "@sda"],
      ["LCD.SCL", "@scl"],
    ],
    code: {
      arduino: (p) => `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

DHT dht(${p.dht.ard}, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(115200);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.print("TC Weather");
  delay(1000);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Failed to read DHT22");
    return;
  }
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Temp: ");
  lcd.print(t, 1);
  lcd.print((char)223);
  lcd.print("C");
  lcd.setCursor(0, 1);
  lcd.print("Hum:  ");
  lcd.print(h, 1);
  lcd.print(" %");
  Serial.print("temp:");
  Serial.print(t);
  Serial.print(",hum:");
  Serial.println(h);
  delay(2000);
}
`,
      micropython: (p) => `# MicroPython DHT22 → serial (LCD driver not bundled in the simulator)
from machine import Pin
import dht, utime

sensor = dht.DHT22(Pin(${p.dht.gpio}))

while True:
    sensor.measure()
    print("temp:{},hum:{}".format(sensor.temperature(), sensor.humidity()))
    utime.sleep(2)
`,
    },
  },
  {
    id: "storm-station",
    name: "Storm weather station",
    thai: "สถานีตรวจพายุ (BME280 + ฝน)",
    description: "BME280 pressure, temperature and humidity plus a rain plate. Run it in the thunderstorm scenario and watch the pressure fall.",
    icon: "cloud-lightning",
    boards: withAdc(1),
    scenario: "storm",
    parts: [
      { id: "B1", type: "bme280", label: "BME1", dx: 28, dy: -18 },
      { id: "RN", type: "rain", label: "RAIN1", dx: 26, dy: 24 },
    ],
    wiring: [
      ["B1.VCC", "@3v3"],
      ["B1.GND", "@gnd"],
      ["B1.SDA", "@sda"],
      ["B1.SCL", "@scl"],
      ["RN.VCC", "@logic"],
      ["RN.GND", "@gnd"],
      ["RN.AO", "@adc:rain"],
    ],
    code: {
      arduino: (p, b) => `#include <Wire.h>
#include <Adafruit_BME280.h>

Adafruit_BME280 bme;
const int RAIN_PIN = ${p.rain.ard};   // rain plate AO: lower = wetter

void setup() {
  Serial.begin(115200);
  if (!bme.begin(0x76)) {
    Serial.println("BME280 not found - check SDA/SCL");
  }
}

void loop() {
  float t = bme.readTemperature();
  float h = bme.readHumidity();
  float hpa = bme.readPressure() / 100.0;
  int raw = analogRead(RAIN_PIN);
  float wet = 100.0 - raw * 100.0 / ${2 ** (b.family === "esp32" ? 12 : 10) - 1}.0;

  Serial.print("temp:");
  Serial.print(t);
  Serial.print(",hum:");
  Serial.print(h);
  Serial.print(",pressure:");
  Serial.print(hpa);
  Serial.print(",rain:");
  Serial.println(wet);
  if (hpa < 995) Serial.println("Storm warning: pressure is low");
  delay(1000);
}
`,
      micropython: (p, b) => {
        const g = (id: string) => b.pins.find((x) => x.id === id)?.gpio ?? 0;
        return `from machine import Pin, I2C, ADC
import bme280, utime

i2c = I2C(0, sda=Pin(${g(b.i2c.sda)}), scl=Pin(${g(b.i2c.scl)}))
bme = bme280.BME280(i2c=i2c)
rain = ${b.family === "esp8266" ? "ADC(0)" : `ADC(Pin(${p.rain.gpio}))`}

while True:
    t, pa, h = bme.read_compensated_data()
    wet = 100 - rain.read_u16() * 100 / 65535
    print("temp:{:.2f},hum:{:.1f},pressure:{:.1f},rain:{:.0f}".format(t, h, pa / 100, wet))
    utime.sleep(1)
`;
      },
    },
  },
  {
    id: "heart-rate",
    name: "Heart-rate monitor",
    thai: "วัดชีพจร / อัตราการเต้นหัวใจ",
    description: "Pulse sensor waveform on the plotter; the LED flashes on every beat and BPM is computed from beat-to-beat time.",
    icon: "heart-pulse",
    boards: withAdc(1),
    parts: [
      { id: "PS", type: "pulse", label: "PULSE1", dx: 28, dy: -16 },
      { id: "L1", type: "led", label: "LED1", dx: 52, dy: 14, props: { color: "red" } },
      { id: "R1", type: "resistor", label: "R1", dx: 36, dy: 28, props: { ohms: 220 } },
    ],
    wiring: [
      ["PS.VCC", "@logic"],
      ["PS.GND", "@gnd"],
      ["PS.S", "@adc:pulse"],
      ["R1.1", "@digital:led"],
      ["R1.2", "L1.A"],
      ["L1.C", "@gnd"],
    ],
    code: {
      arduino: (p, b) => {
        const max = 2 ** (b.family === "esp32" ? 12 : 10) - 1;
        return `const int PULSE_PIN = ${p.pulse.ard};
const int LED_PIN = ${p.led.ard};
const int THRESHOLD = ${Math.round(max * 0.58)};   // above the waveform's resting level
const int HYSTERESIS = ${Math.round(max * 0.05)};

bool inBeat = false;
unsigned long lastBeat = 0;
int bpm = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int v = analogRead(PULSE_PIN);
  if (!inBeat && v > THRESHOLD) {
    inBeat = true;
    unsigned long now = millis();
    if (lastBeat > 0) bpm = 60000UL / (now - lastBeat);
    lastBeat = now;
    digitalWrite(LED_PIN, HIGH);
  } else if (inBeat && v < THRESHOLD - HYSTERESIS) {
    inBeat = false;
    digitalWrite(LED_PIN, LOW);
  }
  Serial.print("ppg:");
  Serial.print(v);
  Serial.print(",bpm:");
  Serial.println(bpm);
  delay(20);
}
`;
      },
      micropython: (p, b) => `from machine import Pin, ADC
import utime

sensor = ${b.family === "esp8266" ? "ADC(0)" : `ADC(Pin(${p.pulse.gpio}))`}
led = Pin(${p.led.gpio}, Pin.OUT)
THRESHOLD = 38000
in_beat = False
last = 0
bpm = 0

while True:
    v = sensor.read_u16()
    if not in_beat and v > THRESHOLD:
        in_beat = True
        now = utime.ticks_ms()
        if last:
            bpm = 60000 // utime.ticks_diff(now, last)
        last = now
        led.on()
    elif in_beat and v < THRESHOLD - 3000:
        in_beat = False
        led.off()
    print("ppg:{},bpm:{}".format(v, bpm))
    utime.sleep_ms(20)
`,
    },
  },
  {
    id: "vibration-monitor",
    name: "Motor vibration monitor",
    thai: "วิเคราะห์การสั่นของมอเตอร์",
    description: "ADXL335 on a motor streams X/Y/Z at 200 Hz for the plotter, FFT and historian.",
    icon: "waves",
    boards: withAdc(3),
    scenario: "motor-vibration",
    scenarioParams: { rpm: 1480, fault: "imbalance" },
    parts: [{ id: "A1", type: "adxl335", label: "ACC1", dx: 26, dy: -8 }],
    wiring: [
      ["A1.VCC", "@3v3"],
      ["A1.GND", "@gnd"],
      ["A1.X", "@adc:ax"],
      ["A1.Y", "@adc:ay"],
      ["A1.Z", "@adc:az"],
    ],
    code: {
      arduino: (p, b) => `// ADXL335: 1.65 V at 0 g, 330 mV/g
const int AX = ${p.ax.ard}, AY = ${p.ay.ard}, AZ = ${p.az.ard};
const float VREF = ${b.family === "avr" ? "5.0" : "3.3"};
const int MAXC = ${b.family === "esp32" ? 4095 : 1023};

float g(int pin) {
  float v = analogRead(pin) * VREF / MAXC;
  return (v - 1.65) / 0.33;
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.print("ax:");
  Serial.print(g(AX), 3);
  Serial.print(",ay:");
  Serial.print(g(AY), 3);
  Serial.print(",az:");
  Serial.println(g(AZ), 3);
  delay(5); // ~200 Hz
}
`,
      micropython: (p) => `from machine import ADC
import utime

ax, ay, az = ADC(${p.ax.gpio}), ADC(${p.ay.gpio}), ADC(${p.az.gpio})

def g(adc):
    v = adc.read_u16() * 3.3 / 65535
    return (v - 1.65) / 0.33

while True:
    print("ax:{:.3f},ay:{:.3f},az:{:.3f}".format(g(ax), g(ay), g(az)))
    utime.sleep_ms(5)
`,
    },
  },
  {
    id: "neopixel",
    name: "NeoPixel rainbow",
    thai: "ไฟวง NeoPixel สีรุ้ง",
    description: "Twelve WS2812B LEDs chasing a rainbow.",
    icon: "palette",
    parts: [{ id: "N1", type: "neopixel-ring", label: "RING1", dx: 26, dy: -12 }],
    wiring: [
      ["N1.VCC", "@5v"],
      ["N1.GND", "@gnd"],
      ["N1.DIN", "@digital:np"],
    ],
    code: {
      arduino: (p) => `#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel ring(12, ${p.np.ard}, NEO_GRB + NEO_KHZ800);

void setup() {
  ring.begin();
  ring.setBrightness(120);
}

void loop() {
  for (long hue = 0; hue < 65536; hue += 1024) {
    for (int i = 0; i < ring.numPixels(); i++) {
      ring.setPixelColor(i, ring.ColorHSV(hue + i * 65536L / ring.numPixels()));
    }
    ring.show();
    delay(20);
  }
}
`,
      micropython: (p) => `from machine import Pin
import neopixel, utime

np = neopixel.NeoPixel(Pin(${p.np.gpio}), 12)

def wheel(pos):
    if pos < 85:
        return (255 - pos * 3, pos * 3, 0)
    if pos < 170:
        pos -= 85
        return (0, 255 - pos * 3, pos * 3)
    pos -= 170
    return (pos * 3, 0, 255 - pos * 3)

j = 0
while True:
    for i in range(12):
        np[i] = wheel((i * 21 + j) % 255)
    np.write()
    j = (j + 4) % 255
    utime.sleep_ms(20)
`,
    },
  },
  {
    id: "iot-mqtt",
    name: "IoT sensor → MQTT",
    thai: "ส่งค่าเซนเซอร์ขึ้น MQTT",
    description: "ESP32 publishes DHT22 readings over Wi-Fi/MQTT and listens for LED commands.",
    icon: "wifi",
    boards: WIFI_MCUS,
    parts: [
      { id: "D1", type: "dht22", label: "DHT1", dx: 26, dy: -16 },
      { id: "L1", type: "led", label: "LED1", dx: 50, dy: 12, props: { color: "blue" } },
    ],
    wiring: [
      ["D1.VCC", "@3v3"],
      ["D1.GND", "@gnd"],
      ["D1.DATA", "@digital:dht"],
      ["L1.A", "@digital:led"],
      ["L1.C", "@gnd"],
    ],
    code: {
      arduino: (p, b) => `#include <${b.family === "esp8266" ? "ESP8266WiFi.h" : "WiFi.h"}>
#include <PubSubClient.h>
#include <DHT.h>

const char* SSID = "Thosaphol-Sim";
const char* PASS = "simulated";
const char* BROKER = "broker.hivemq.com";

WiFiClient net;
PubSubClient mqtt(net);
DHT dht(${p.dht.ard}, DHT22);
const int LED = ${p.led.ard};

void onMessage(char* topic, byte* payload, unsigned int len) {
  String msg = "";
  for (int i = 0; i < len; i++) msg += (char)payload[i];
  Serial.print("cmd ");
  Serial.println(msg);
  digitalWrite(LED, msg == "on" ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  dht.begin();
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(" Wi-Fi connected");
  mqtt.setServer(BROKER, 1883);
  mqtt.setCallback(onMessage);
  while (!mqtt.connect("tconnect-esp32")) delay(500);
  mqtt.subscribe("thosaphol/demo/led");
  Serial.println("MQTT connected");
}

void loop() {
  mqtt.loop();
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  String json = "{\\"temp\\":" + String(t, 1) + ",\\"hum\\":" + String(h, 1) + "}";
  mqtt.publish("thosaphol/demo/dht", json.c_str());
  Serial.println(json);
  delay(2000);
}
`,
      micropython: (p) => `import network, utime, dht
from machine import Pin
from umqtt.simple import MQTTClient

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect("Thosaphol-Sim", "simulated")
while not wlan.isconnected():
    utime.sleep_ms(250)
print("Wi-Fi", wlan.ifconfig()[0])

led = Pin(${p.led.gpio}, Pin.OUT)
sensor = dht.DHT22(Pin(${p.dht.gpio}))

def on_msg(topic, msg):
    print("cmd", msg)
    led.value(1 if msg == "on" else 0)

c = MQTTClient("tconnect-esp32", "broker.hivemq.com")
c.set_callback(on_msg)
c.connect()
c.subscribe("thosaphol/demo/led")

while True:
    sensor.measure()
    c.publish("thosaphol/demo/dht", '{"temp":%.1f,"hum":%.1f}' % (sensor.temperature(), sensor.humidity()))
    c.check_msg()
    utime.sleep(2)
`,
    },
  },
];

export function templateFor(id: string) {
  return TEMPLATES.find((t) => t.id === id);
}

export function templateSupports(t: Template, boardId: string) {
  if (t.boards && !t.boards.includes(boardId)) return false;
  const b = getBoard(boardId);
  return b.languages.some((l) => t.code[l]);
}

export const BOARD_ORIGIN = { x: 20.32, y: 30.48 };

export function instantiateTemplate(t: Template, boardId: string, langPref?: Lang): Pick<Project, "parts" | "wires" | "lang" | "code" | "scenario"> & { log: string[] } {
  const board = getBoard(boardId);
  const log: string[] = [];
  const boardInst: PartInstance = { id: BOARD_ID, type: `board:${board.id}`, label: board.short, x: BOARD_ORIGIN.x, y: BOARD_ORIGIN.y, rot: 0, props: {} };
  const parts: PartInstance[] = [boardInst];
  const right = BOARD_ORIGIN.x + board.width;
  const midY = BOARD_ORIGIN.y + board.height / 2;
  for (const p of t.parts) {
    const def = getPart(p.type)!;
    parts.push({
      id: p.id,
      type: p.type,
      label: p.label,
      x: Math.round((right + p.dx) / 2.54) * 2.54 - 1.27,
      y: Math.round((midY + p.dy - def.h / 2) / 2.54) * 2.54 - 1.27,
      rot: p.rot ?? 0,
      props: { ...Object.fromEntries(def.props.map((s) => [s.key, s.default])), ...(p.props ?? {}) },
    });
  }
  const wires: Wire[] = [];
  const pins: Record<string, PinRef> = {};
  const reserved = new Set<string>();
  let colorIdx = 0;
  const toRef = (bp: BoardPin): PinRef => ({
    id: bp.id,
    gpio: bp.gpio ?? -1,
    label: bp.label,
    ard: board.family === "avr" && bp.label.startsWith("A") ? bp.label : String(bp.gpio),
  });
  const project = { parts, wires };
  // resolve explicit board-pin tokens first so later choices stay distinct
  const ordered = [...t.wiring].sort((a, b) => (a[1].startsWith("@adc") ? -1 : 0) - (b[1].startsWith("@adc") ? -1 : 0));
  for (const [ep, token] of ordered) {
    const [pid, pinId] = ep.split(".");
    const inst = parts.find((x) => x.id === pid);
    const def = inst && getPart(inst.type);
    const pin = def?.pins.find((x) => x.id === pinId);
    if (!inst || !pin) continue;
    const at = endpointPos(parts, inst.id, pin.id);
    let target: BoardPin | undefined;
    if (!token.startsWith("@")) {
      const [p2, pin2] = token.split(".");
      wires.push({ id: newId("w"), from: { part: p2, pin: pin2 }, to: { part: pid, pin: pinId }, color: WIRE_COLORS.signal[colorIdx++ % WIRE_COLORS.signal.length], points: [] });
      continue;
    }
    const tk = token.slice(1);
    if (tk === "gnd") target = chooseGnd(board, at, parts);
    else if (tk === "5v") target = choosePowerPin(board, true, at, parts);
    else if (tk === "3v3") target = choosePowerPin(board, false, at, parts);
    else if (tk === "logic") target = choosePowerPin(board, board.logicV >= 5, at, parts);
    else if (tk === "sda" || tk === "scl") target = choosePin(board, project, tk as Cap, pin.role, at, reserved);
    else {
      const m = tk.match(/^(\w+)(\?)?:(\w+)$/);
      if (!m) continue;
      const [, cap, optional, name] = m;
      target = choosePin(board, project, cap as Cap, pin.role, at, reserved);
      if (!target) {
        if (!optional) log.push(`${board.short} has no free ${cap.toUpperCase()} pin for ${inst.label}.${pin.label}`);
        continue;
      }
      pins[name] = toRef(target);
    }
    if (!target) continue;
    reserved.add(target.id);
    if ((inst.type === "led" || inst.type === "rgb-led") && pin.role === "anode" && target.kind === "gpio") {
      // every LED gets a current-limiting resistor
      const rid = `R_${inst.id}_${pin.id}`;
      const count = parts.filter((x) => x.type === "resistor").length;
      parts.push({ id: rid, type: "resistor", label: `R${count + 1}`, x: Math.round((inst.x - 4) / 2.54) * 2.54 - 1.27, y: Math.round((inst.y + 18 + (count % 3) * 4) / 2.54) * 2.54 - 1.27, rot: 0, props: { ohms: board.logicV >= 5 ? 220 : 100 } });
      const c = WIRE_COLORS.signal[colorIdx++ % WIRE_COLORS.signal.length];
      wires.push({ id: newId("w"), from: { part: BOARD_ID, pin: target.id }, to: { part: rid, pin: "1" }, color: c, points: [] });
      wires.push({ id: newId("w"), from: { part: rid, pin: "2" }, to: { part: pid, pin: pinId }, color: c, points: [] });
      continue;
    }
    const color = pin.role === "vcc" ? WIRE_COLORS.vcc : pin.role === "gnd" || pin.role === "cathode" ? WIRE_COLORS.gnd : WIRE_COLORS.signal[colorIdx++ % WIRE_COLORS.signal.length];
    wires.push({ id: newId("w"), from: { part: BOARD_ID, pin: target.id }, to: { part: pid, pin: pinId }, color, points: [] });
  }
  const lang: Lang = langPref && board.languages.includes(langPref) && t.code[langPref] ? langPref : board.languages.find((l) => t.code[l]) ?? board.defaultLang;
  const code: Partial<Record<Lang, string>> = {};
  for (const l of board.languages) {
    const gen = t.code[l];
    if (gen) {
      try {
        code[l] = gen(pins, board);
      } catch {
        code[l] = `// This template needs pins that ${board.short} cannot provide.`;
      }
    }
  }
  const scenario = defaultScenarioState(t.scenario ?? "lab");
  if (t.scenarioParams) scenario.params = { ...scenario.params, ...t.scenarioParams };
  return { parts, wires, lang, code, scenario, log };
}
