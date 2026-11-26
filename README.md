# GAIT//LAB: 3D Gait Simulator

Real-time 3D gait simulation (Three.js, bloom, soft shadows). Two subjects, **TYPE 1** and **TYPE 2**, walk side by side on dual-belt treadmills. You can compare them in lanes or as a ghost overlay, and compare their curves directly.

Open `index.html` directly in a browser. It is a single self-contained file with no server.

## Features
- Anthropometric mannequin (Winter segment ratios). Body shape scales with height, BMI and sex.
- Full-body kinematics: pelvis rotation and obliquity, trunk counter-rotation, arm swing, lateral CoM sway, toe joint, foot-to-belt locking.
- Scenarios: healthy, overweight, obese, elderly, transtibial amputee (left or right), amputee + obesity, and research participants S01–S12.
- BMI → knee varus (−0.33°/BMI at heel strike) and internal rotation (+0.9–1.1°/BMI), from the Ramathibodi normative study. Load trends follow Ahsan (2022).
- Amputee gait with walking speeds from Apidech et al. (IEEE Access 2026), Tables 1–2.
- IMU + TCN gait-event detection: IC/FC error sampled from Table 6, F1 from Table 5. Sensors are shown on the body.
- TYPE 1 vs TYPE 2 comparison charts (hip, knee, ankle, varus, IR, vGRF), a Δ view, and a metrics table.

## Development
```
npm install
npm run build   # bundles src/ → index.html
```

This is for education and demonstration only, not for diagnosis.
