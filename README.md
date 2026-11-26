# GAIT//LAB: 3D Gait + EMG Simulator

Real-time 3D gait simulation built with Three.js (bloom, soft shadows, PBR). It compares **TYPE 1** and **TYPE 2** side by side, shows muscle activity (EMG) across the gait cycle, and offers several environments.

Open `index.html` directly in a browser. It is a single self-contained file with no server.

## Highlights
- **Anatomical mannequin**: sculpted muscles (glutes, quadriceps, hamstrings, adductors, TA, gastrocnemius, soleus, peroneus, erector spinae, abdominals, deltoid and more) with a fiber texture. Body proportions follow Winter and scale with height, BMI and sex.
- **Muscles & EMG**: click a muscle on the model (or in the list or heatmap) to open a live HUD with a callout line, a %MVC envelope over the gait cycle with gait-phase bands, a simulated 1 kHz raw sEMG trace, and activation heatmaps for both types. Muscles glow by activation in real time.
- **Environments** (keys 1–5): lab (dual-belt treadmills), garden, beach, factory, snow.
  - **Garden**: trees and grass sway in the wind, birds take off as you approach, plus butterflies and falling leaves.
  - **Beach**: sand deforms into footprints, and depth scales with body weight. Waves run up the shore, palms sway, gulls fly, and sand kicks up.
  - **Factory**: welding robot arms with sparks, a conveyor belt, an overhead crane with a swinging load, beacons and steam.
  - **Snow**: deep footprints, snowfall, visible breath, and a cabin with chimney smoke.
- **Gait model**: BMI effects on knee varus and internal rotation (Ramathibodi normative study), BMI-level trends (Ahsan 2022), transtibial amputee gait and IMU + TCN event detection (Apidech et al., IEEE Access 2026).

## Development
```
npm install
npm run build   # bundles src/ → index.html
```
Source: `src/main.js` (UI and loop), `src/figure.js` (mannequin), `src/emg.js` (EMG model), `src/model.js` (gait model), `src/stage.js` (renderer), `src/envs/*` (environments).

EMG and pathology modifiers are illustrative. This is for education and demonstration only, not for diagnosis.
