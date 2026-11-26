# GAIT//LAB: 3D Gait Simulator + Real World video analysis

Two modes in one page:

- **จำลองการเดิน (Simulation)**: real-time 3D gait of **up to 6 people at once**, with muscle activity (EMG) across the gait cycle and several environments.
- **Real World**: film a friend walking (or pick a video), and the browser finds the body's 33 landmarks in every frame, measures joint angles and step timing, compares them with normal gait for the same age, sex, BMI and speed, and says whether the walk follows correct gait principles. The measured gait is then replayed on a 3D human next to a transparent "normal" reference.

Open `index.html` directly in a browser. It is a single self-contained file with no server. Real World needs internet the first time only, to download the MediaPipe pose model (about 15–20 MB, cached afterwards). **The video itself never leaves the device.**

## Real World mode
- **Input**: record with the phone camera (`ถ่ายคลิป`), choose a file, or drag and drop. Two built-in demos (a normal walk and a below-knee prosthesis) show the output without a video.
- **Pose**: MediaPipe Pose Landmarker (BlazePose GHUM, lite/full/heavy), loaded on demand from jsDelivr (unpkg as fallback). The clip is stepped at a fixed 30 Hz, so results don't depend on device speed. GPU first, CPU fallback.
- **Clean-up**: drops frames where the body is cut by the image border; a two-leg tracker fixes left/right label flips around leg crossings and drops frames where the legs merge; 6 Hz zero-phase Butterworth filtering; camera roll from the floor line.
- **Side view**: sagittal hip (thigh vs vertical), knee and ankle angles, trunk lean and arm swing. Heel strike and toe-off use Zeni et al. (2008), with the stride period from autocorrelation. Joint angles are judged only on the leg facing the camera, because the far leg is partly hidden; walking back and forth measures both legs. Scale comes from stature (eye height = 0.936 H). Speed comes from pelvis travel with a fixed camera, or from step lengths with a panning camera.
- **Front view**: knee frontal-plane projection angle (valgus/varus), pelvic drop, trunk lateral lean, step width, and cadence.
- **Assessment**: 11 gait principles (heel strike, loading-response knee flexion, mid-stance extension, hip extension, push-off, swing knee flexion, foot clearance, upright trunk, symmetry, speed for age, arm swing), each marked ผ่าน / ควรปรับ / ผิดปกติ with an explanation and an exercise tip. These roll up into a 0–100 score, a verdict and a reliability rating. Normal references come from the simulator's own model at the measured speed (Ramathibodi BMI coefficients included), plus Bohannon & Andrews (2011) speed norms.
- **Outputs**: score card, principle checklist, angle curves with normal bands, a stance timeline synced to the video, a table of values vs norms, and CSV export. "เพิ่มเข้าโหมดจำลอง" adds the measured walker to the simulation for multi-person comparison.

Tested on clips rendered from the simulator itself and run through MediaPipe in headless Chromium, with ground truth from the simulator:
- Heel-strike and toe-off timing was mostly within 0.03–0.08 s.
- Cadence was within 0–7% (front view within 0.2%).
- The near leg's hip and knee waveforms had an SD of about 4–8° after bias.
- Normal walks scored 95–100; the two below-knee prosthesis clips were flagged ("ยังไม่ถูกหลัก").

## Simulation mode
- **Realistic humans**: Asian male and female body shapes from MakeHuman (CC0). Shape follows sex, age and BMI, and height is scaled exactly. The skeleton is driven by the gait model.
- **Multi-person comparison** with one colour per person across 3D, charts, heatmaps and tables.
- **Muscles & EMG**: click a leg, hip or back to see live EMG, %MVC envelopes with gait-phase bands, simulated raw sEMG and heatmaps.
- **Environments** (keys 1–5): clinical gait lab with motion-capture cameras and one treadmill per person, garden, beach (footprints in the sand), factory, snow.
- **Gait model**: BMI effects on knee varus and internal rotation (Ramathibodi normative study), BMI-level trends (Ahsan 2022), transtibial amputee gait and IMU + TCN event detection (Apidech et al., IEEE Access 2026).

## Development
```
npm install
python3 tools/prep_human.py   # (only to regenerate) MakeHuman → src/assets/human.bin
npm run build                 # bundles src/ → index.html
```
Source:
- `src/main.js`: modes, people, UI, loop
- `src/realworld/`: `pose.js` (MediaPipe loader and frame stepping), `analyze.js` (gait analysis), `ui.js` (Real World panel), `demo.js` (packed demo landmarks)
- `src/human.js`: realistic human
- `src/model.js`: gait model, which also accepts measured curves
- `src/emg.js`: EMG model
- `src/stage.js`: renderer
- `src/envs/*`: environments

For local testing without the CDN, add `?mp=<base of @mediapipe/tasks-vision>&mpmodel=<folder with pose_landmarker_*.task>` to the page URL.

## Credits
- MakeHuman base mesh, targets, default skeleton/weights and high-poly eyes: CC0 1.0, https://github.com/makehumancommunity/makehuman
- MediaPipe Tasks Vision (Apache-2.0), loaded at runtime
- Three.js (MIT)

EMG and pathology modifiers are illustrative. Real World results are a screening and teaching aid, not a diagnosis.
