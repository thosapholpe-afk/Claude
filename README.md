# GAIT//LAB: 3D Gait + EMG Simulator

Real-time 3D gait simulation built with Three.js (bloom, soft shadows, PBR). It compares **up to 6 people at once**, shows muscle activity (EMG) across the gait cycle, and offers several environments.

Open `index.html` directly in a browser. It is a single self-contained file with no server.

## Highlights
- **Realistic humans**: Asian male and female body shapes from MakeHuman (CC0). Shape changes with sex, age and BMI through MakeHuman's own macro targets, and height is scaled exactly. Each person gets a skeleton fitted to the morphed body, driven by the gait model (pelvis, trunk, arms, hips, knees, ankles, toes). Clothes, hair, shoes and eyes deform with the body. Amputees get a carbon socket and titanium pylon.
- **Multi-person comparison**: add or remove people, rename them, and hide them from charts. Each person keeps one colour across their shirt in 3D, chart lines, heatmaps and tables (validated categorical palette). Charts have hover crosshairs with values for everyone.
- **Muscles & EMG**: click a leg, hip or back to open a live EMG HUD with a callout line. You get a %MVC envelope over the gait cycle with gait-phase bands, a simulated 1 kHz raw sEMG trace for every person, and an activation heatmap per person. The EMG toggle paints muscle activity on the skin.
- **Environments** (keys 1–5): lab (one dual-belt treadmill per person), garden, beach (footprints sink into the sand, deeper for heavier subjects), factory, snow.
- **Gait model**: BMI effects on knee varus and internal rotation (Ramathibodi normative study), BMI-level trends (Ahsan 2022), transtibial amputee gait and IMU + TCN event detection (Apidech et al., IEEE Access 2026).

## Development
```
npm install
python3 tools/prep_human.py   # (only to regenerate) MakeHuman → src/assets/human.bin
npm run build                 # bundles src/ → index.html
```
Source: `src/main.js` (people, UI, loop), `src/human.js` (realistic human), `src/emg.js` (EMG model), `src/model.js` (gait model), `src/stage.js` (renderer), `src/envs/*` (environments).

## Credits
- MakeHuman base mesh, targets, default skeleton/weights and high-poly eyes: CC0 1.0, https://github.com/makehumancommunity/makehuman
- Three.js (MIT)

EMG and pathology modifiers are illustrative. This is for education and demonstration only, not for diagnosis.
