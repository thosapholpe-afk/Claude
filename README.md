# Gait Simulator

Single-page web simulation (open `index.html` in a browser) of human gait:

- **Normal gait** with BMI effects on knee angles. The Ramathibodi normative study found that each +1 kg/m² of BMI gives −0.33° knee varus at heel strike and +0.9–1.1° internal rotation. Trends in joint angles and loads across BMI levels follow Ahsan (2022).
- **Unilateral transtibial amputee gait** (left or right prosthesis), using walking speeds from Apidech et al., *IEEE Access* 2026, Table 2.
- **IMU + TCN gait-event detection**: predicted foot contact against force-plate contact, with IC/FC timing errors sampled from Table 6 (median/IQR) and F1 scores from Table 5.

Model coefficients can be edited in the UI. This page is for education and demonstration only, not for diagnosis.
