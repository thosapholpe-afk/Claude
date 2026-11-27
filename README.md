# Thosaphol Connect — digital twin สำหรับวงจร ESP32 · Arduino · Raspberry Pi

Thosaphol Connect เป็นแพลตฟอร์มจำลองวงจรไมโครคอนโทรลเลอร์บนเว็บ (แนวเดียวกับ Wokwi / Tinkercad) ที่ต่อยอดเป็น **digital twin**:
รันเฟิร์มแวร์จริงในเบราว์เซอร์ คำนวณแรงดัน/กระแสจริงด้วย circuit solver แล้ว “โยนบอร์ดเข้าไปในสถานการณ์” เช่น ตึกไฟไหม้ น้ำท่วม มอเตอร์สั่น
พร้อม AI copilot ที่สั่งงานเป็นภาษาไทยได้ ส่งข้อมูลออก MQTT ส่งออกแบบ drawing และสร้างเคส STL

> v0.1 — first version. UI theme follows the dark-green engineering references (plus a light theme).

## What's in v1 (mapped to the brief)

| # | Requirement | Where |
|---|---|---|
| 1 | Wokwi/Tinkercad-style simulator for **ESP32 DevKit V1, ESP32-S3-DevKitC-1, NodeMCU (ESP8266), Arduino Uno R3, Nano, Mega 2560, Raspberry Pi Pico, Pico W, Raspberry Pi 4B** + **import a board by scanning it** | `src/core/boards.ts`, `src/ui/Canvas.tsx`, Scan dialog (`src/ui/Modals.tsx`) → Claude vision identifies the board or builds a new board from its silkscreen |
| 2 | Realistic graphics that run, **external stimuli**, AI you can talk to about what to simulate | Real-dimension SVG boards/parts, live LED glow / servo horn / LCD text / NeoPixels; 3D twin (`src/ui/Twin3D.tsx`) with fire + smoke, rising water, vibrating motor, intruder, day/night, freezer, gas, earthquake, greenhouse; scenarios in `src/core/env.ts` |
| 3 | Analog graphs + **compare against a historian** (e.g. vibration on a motor) | Plotter: small multiples per unit, crosshair tooltips, FFT spectrum, stats (RMS, crest), saved runs in IndexedDB overlaid as dashed baselines, CSV import/export (`src/ui/Plotter.tsx`, `src/lib/recorder.ts`) |
| 4 | Dynamic effects on every click | Ripple on all buttons, current-flow animation on live wires, part drop bursts, marching selection, spring panels, buzzer audio + relay clicks |
| 5 | Developers add **their own sensors** with names and parameters | Custom sensor builder: pins, parameters, environment link, output model expression, live response curve, JSON export/import |
| 6 | **MQTT export** and **board drawings** with dimensions | MQTT bridge over WebSockets (telemetry + per-sensor topics + remote commands; firmware PubSubClient/umqtt/paho goes through it). 1:1 SVG and DXF drawings with hole/outline dimensions |
| 7 | Login with **Google, Facebook, GitHub, Instagram**, name after sign-up, **record to Google Form** | `server/index.ts` OAuth code flow, onboarding dialog, Google Form `formResponse` logging |
| 8 | Ask the AI for a circuit + **starter templates** (SG90, MG996R, LED…) | 14 templates that auto-pick free pins on any board and generate Arduino / MicroPython / Python code; copilot tools `load_template`, `add_part`, `connect`, `write_code` |
| 9 | AI-generated **case → STL** | Case Studio: parametric CSG enclosure (standoffs or rails, connector cut-outs, vents, waterproof gasket + gland, mounting ears, custom openings) → base & lid STL |
| 10 | Easy wiring: type “GP10 → …” and the AI picks the free/neatest port, or drag | Command bar (`GP10 -> LED1`, `LED1 -> auto`, `ต่อ servo1`, `auto wire all`), capability-aware pin picker (ADC1 on ESP32, PWM for servos, never input-only pins for outputs, avoids strapping pins), automatic series resistors for LEDs, A* router for tidy orthogonal wires, or drag pin-to-pin |
| 11 | **3D board models** you can orbit, mounted on a **perfboard (บอร์ดไข่ปลา) or breadboard** with a configurable **X × Y** hole grid | `src/ui/three/models.tsx` builds each board in millimetres: extruded PCB with real mounting holes, its own silkscreen as the top texture, header pins (male-down ESP32/Pico, female Uno, 2×20 male-up Pi 4), chips with legs, connectors, SMD parts, live status LEDs. Viewer (`src/ui/Viewer3D.tsx`): 360° orbit incl. underside, Iso/Top/Front/Side/Under, auto-spin, explode the stack, live W×D×H. Inspector → **Mount** plans the fit (`src/core/mount.ts`): straddles the breadboard channel, sizes a perfboard around the headers, puts a perfboard HAT on a Pi 4, refuses the Uno with the reason. Breadboard: 5–80 columns, rails on/off; perfboard: 4–90 × 4–70 holes, isolated pads or stripboard, FR4 green / phenolic / white |
| 12 | More sensors + dynamic 3D | BME280/BMP280 & BH1750 (I²C), DS18B20 (OneWire/DallasTemperature), FC-51 IR obstacle, KY-003 Hall, TTP223 touch, KY-023 joystick, pulse sensor, MQ-135, FC-37 rain — with Arduino, MicroPython and Pi library shims and a thunderstorm scenario. Every part has an animated 3D model (`src/ui/three/parts3d.tsx`): servo horns follow the angle, motors spin up, LEDs/NeoPixels/LCDs glow with bloom, buzzers ripple, sonar pings travel to the target, current flows along live wires |
| 13 | **PLC mode + ladder** and **electrical control** | Switch MCU ⇄ PLC in the top bar. TC-PLC 16MT (8 × 24 V in, 8 × 24 V out, FX-style X/Y/M/T/C) runs a ladder program (`src/core/plc.ts`) on a 10 ms scan; the ladder editor (`src/ui/Ladder.tsx`) has NO/NC/P/N contacts, branches, coils, Set/Reset, TON/TOF, CTU/RST, symbols and live power-flow monitoring. Control parts: NO/NC pushbuttons, E-stop, 0-1 and 1-0-2 selectors, limit switch, pilot lamps, contactor, overload, timer relay, 24 V PSU, 3-phase supply, MCB, 3-phase motor (phase order → direction). Templates: DOL start/stop, forward/reverse interlock, MAN-OFF-AUTO with timers, hard-wired relay start/stop |
| 14 | **Multimeter** and **wiring-diagram view** | Digital multimeter part (V / mA·A / Ω / continuity, click the dial). *Wiring* view draws every part as a labelled block with IEC-style symbols and live wire voltages |
| 15 | Compact, **iPad / phone** layout | One-row top bar with a ⋯ menu, floating canvas tools, icon rail; iPad gets slide-over panels, phones a bottom tab bar with bottom sheets |

### Simulation model
- **Circuit**: nodal analysis (`src/core/solver.ts`) — supplies, GPIO drivers (25 Ω), pull-ups, resistors, pots, LDRs, piecewise-linear LEDs and opto-couplers, breadboard strips, switch/relay contacts. It flags shorts, GPIO overcurrent (> 40 mA), 5 V on 3.3 V pins and burns LEDs that have no resistor.
- **Firmware**: Arduino C++ and Python/MicroPython are transpiled to async JavaScript and run against a virtual clock, so `delay()` / `time.sleep()` suspend without freezing the page. AVR `int` is 16-bit, ESP32 ADC is non-linear near the rails.
- **Libraries**: Arduino core, Servo/ESP32Servo, DHT, LiquidCrystal_I2C, Adafruit_NeoPixel, WiFi + PubSubClient, ESP32 LEDC; MicroPython `machine`, `utime`, `dht`, `neopixel`, `network`, `umqtt`; Python `gpiozero`, `RPi.GPIO`, `adafruit_dht`, `paho-mqtt`.
- **Not yet**: cycle-accurate CPU emulation (planned via avr8js + a compile service), user-defined `struct`/`class`, SPI devices, OLED displays.

## Run it

```bash
npm install
cp .env.example .env      # optional — works without any keys
npm run dev               # web on http://localhost:5173, API on :8787
```

- `npm test` — solver, runtime and all 63 template × board × language combinations
- `npm run build && npm start` — production build served by the API server on `PORT`
- **Put it online with sign-in + Google Form logging:** step-by-step in [DEPLOY.md](DEPLOY.md) (Render Blueprint `render.yaml`, or the `Dockerfile` for Railway / Fly.io / your own server)
- `npm run form:setup -- <form link>` prints the `GFORM_*` settings for your Google Form; `npm run form:test` sends a test row

## Configure

### Claude copilot
Set `ANTHROPIC_API_KEY`. The server proxies to `claude-opus-5-5` with tool use; the browser executes the tools on the live canvas (so the key never reaches the client). Server-side refusal fallback is enabled (`fallbacks: "default"`). Without a key the copilot uses an offline Thai/English keyword assistant.

### Sign-in providers
Register `${PUBLIC_URL}/auth/<provider>/callback` as the redirect URI:

| Provider | Console | Notes |
|---|---|---|
| Google | Google Cloud Console → Credentials → OAuth client (Web) | scopes `openid email profile` |
| GitHub | Settings → Developer settings → OAuth Apps | scopes `read:user user:email` |
| Facebook | developers.facebook.com → app with **Facebook Login** | `public_profile,email` |
| Instagram | developers.facebook.com → app with **Instagram API with Instagram Login** | Only Instagram **professional** (business/creator) accounts can sign in — the old Basic Display API for personal accounts was retired in December 2024 |

Users are stored in `server/data/users.json` (swap for a database before scaling).

### Google Form log
1. Make a Google Form with short-answer questions (Name, Email, Provider, Role, Organization, Event, Time).
2. ⋮ → **Get pre-filled link**, fill dummy answers, copy the link: each field appears as `entry.123456789=…`.
3. Put the form id (from `/forms/d/e/<id>/viewform`) in `GFORM_ID` and the numbers in `GFORM_ENTRY_*`.

A row is added when someone finishes choosing their display name (`event = signup`); set `GFORM_LOG_LOGINS=true` / `GFORM_LOG_GUESTS=true` to log returning logins and guests too.

### MQTT topics (prefix configurable)
| Direction | Topic | Payload |
|---|---|---|
| out | `<prefix>/telemetry` | JSON: pins, sensors, environment, scenario |
| out | `<prefix>/sensors/<label>` | latest reading |
| in | `<prefix>/cmd/env` | `{"temperature": 85}` or `{"clear": true}` |
| in | `<prefix>/cmd/scenario` | `"building-fire"` or `{"id":"flood","intensity":0.8}` |
| in | `<prefix>/cmd/sim` | `start` / `stop` |
| in | `<prefix>/cmd/serial` | text to the board's serial input |
| in | `<prefix>/cmd/input/<label>` | `{"pressed": true}` / `{"position": 0.7}` |

Browsers can only reach brokers over WebSockets (`ws://` / `wss://`).

## Project layout
```
src/core      boards, parts, solver, environment, wiring, templates, agent tool schemas
src/core/runtime  C++ and Python transpilers + Arduino / MicroPython / Python HAL shims
src/lib       AI client loop, MQTT bridge, case CSG, drawings, recorder/historian, audio, effects
src/ui        editor shell, canvas, 3D twin, plotter, panels, landing + onboarding
server        Express API: OAuth, sessions, profile + Google Form, Claude proxy
tests         vitest suites
```
