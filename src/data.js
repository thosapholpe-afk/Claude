// Research data — Apidech et al., IEEE Access 14 (2026) 113223–113234
// Table 2 group means (m/s)
export const AMP_SPEED = { comf: 0.68, fast: 0.82, slow: 0.54, self: 0.72 };

// Table 1 + Table 2: participants (all male, unilateral transtibial)
// [id, age, weight kg, height cm, amputated side, comfortable, fast, slow, self-paced]
export const SUBJECTS = [
  ["S01", 56, 58, 160, "L", 0.65, 0.78, 0.52, 0.72],
  ["S02", 54, 78, 172, "R", 0.70, 0.84, 0.56, 0.71],
  ["S03", 53, 80, 175, "R", 0.70, 0.84, 0.56, 0.75],
  ["S04", 63, 59, 165, "R", 0.65, 0.78, 0.52, 0.68],
  ["S05", 52, 70.5, 176, "L", 0.75, 0.90, 0.60, 0.77],
  ["S06", 52, 50, 160, "R", 0.70, 0.84, 0.56, 0.73],
  ["S07", 49, 61, 175, "R", 0.50, 0.60, 0.40, 0.65],
  ["S08", 59, 70, 165, "R", 0.70, 0.84, 0.56, 0.70],
  ["S09", 38, 68, 167, "L", 0.75, 0.90, 0.60, 0.74],
  ["S10", 48, 61, 160, "L", 0.65, 0.78, 0.52, 0.68],
  ["S11", 28, 46, 167, "L", 0.90, 1.08, 0.72, 0.88],
  ["S12", 66, 56, 156, "L", 0.55, 0.66, 0.39, 0.60],
].map(([id, age, wt, ht, side, comf, fast, slow, self]) => ({ id, age, wt, ht, side, speeds: { comf, fast, slow, self } }));

// Table 6 rows: [config, IC median, IC IQR, IC MAE, FC median, FC IQR, FC MAE, F1 (Table 5) | null, group]
export const T6 = {
  AMP: [
    ["L5", 0.006, 0.028, 0.019, -0.008, 0.018, 0.017, null, "1 IMU"],
    ["L4", 0.013, 0.013, 0.020, 0.027, 0.018, 0.034, 0.93, "1 IMU"],
    ["L5+L6", -0.010, 0.015, 0.015, 0.008, 0.015, 0.015, null, "2 IMU"],
    ["L3+L5", 0.007, 0.015, 0.016, 0.017, 0.013, 0.020, null, "2 IMU"],
    ["L3+L5+L6", -0.003, 0.014, 0.013, 0.025, 0.015, 0.027, null, "3 IMU"],
    ["L1+L3+L5", 0.002, 0.010, 0.013, 0.022, 0.017, 0.025, null, "3 IMU"],
    ["L3+L4+L5+L6", 0.004, 0.001, 0.012, 0.017, 0.013, 0.023, 0.97, "4 IMU"],
    ["L1+L3+L5+L6", 0.002, 0.015, 0.014, 0.014, 0.019, 0.018, null, "4 IMU"],
    ["ALL16", 0.004, 0.009, 0.013, 0.019, 0.010, 0.023, 0.92, "16 IMU"],
  ],
  SOU: [
    ["L6", -0.006, 0.017, 0.016, 0.022, 0.015, 0.030, 0.94, "1 IMU"],
    ["L3", 0.012, 0.010, 0.018, 0.015, 0.015, 0.024, 0.96, "1 IMU"],
    ["L3+L6", 0.003, 0.013, 0.013, 0.015, 0.013, 0.021, 0.95, "2 IMU"],
    ["L4+L5", 0.005, 0.014, 0.013, 0.013, 0.015, 0.021, 0.95, "2 IMU"],
    ["L4+L5+L6", 0.004, 0.011, 0.012, 0.023, 0.015, 0.028, 0.96, "3 IMU"],
    ["L1+L5+L6", 0.000, 0.011, 0.012, 0.008, 0.015, 0.020, null, "3 IMU"],
    ["L1+L3+L4+L5", 0.004, 0.013, 0.013, 0.017, 0.013, 0.024, null, "4 IMU"],
    ["L3+L4+L5+L6", 0.008, 0.008, 0.013, 0.015, 0.011, 0.011, 0.96, "4 IMU"],
    ["ALL16", 0.005, 0.009, 0.014, 0.028, 0.013, 0.031, 0.94, "16 IMU"],
  ],
};

// Fig. 1 sensor codes → [side, segment]
export const IMU_SITES = {
  H1: ["C", "head"], B1: ["C", "chest"], B2: ["C", "lumbar"], B3: ["C", "pelvis"],
  U1: ["R", "upperarm"], U2: ["L", "upperarm"], U3: ["R", "forearm"], U4: ["L", "forearm"], U5: ["R", "hand"], U6: ["L", "hand"],
  L1: ["R", "thigh"], L2: ["L", "thigh"], L3: ["R", "shank"], L4: ["L", "shank"], L5: ["R", "foot"], L6: ["L", "foot"],
};

export const SCENARIOS = [
  { id: "healthy", tag: "BASELINE", name: "ผู้ใหญ่สุขภาพดี", desc: "BMI ปกติ เดินด้วยความเร็วที่สบาย ใช้เป็นค่าอ้างอิง",
    cfg: { mode: "normal", speed: "comf", sex: "M", age: 28, ht: 172, wt: 64, subject: null } },
  { id: "overweight", tag: "BMI 27.7", name: "น้ำหนักเกิน", desc: "พนักงานออฟฟิศ BMI 27.7 varus ลดลง IR เพิ่มขึ้น ส่วนแรงที่เข่าเพิ่มตามแนวโน้มของ Ahsan (2022)",
    cfg: { mode: "normal", speed: "comf", sex: "M", age: 42, ht: 170, wt: 80, subject: null } },
  { id: "obese", tag: "BMI 32", name: "ภาวะอ้วน", desc: "BMI 32 ฐานก้าวกว้างขึ้น stance ยาวขึ้น เดินช้าลง แรงและโมเมนต์ที่เข่าสูงขึ้น",
    cfg: { mode: "normal", speed: "comf", sex: "F", age: 45, ht: 158, wt: 80, subject: null } },
  { id: "elderly", tag: "AGE 72", name: "ผู้สูงอายุ", desc: "ก้าวสั้นลง แรงถีบส่งน้อยลง ลำตัวโน้มไปข้างหน้า (ขนาดของผลเป็นค่าสาธิต)",
    cfg: { mode: "normal", speed: "comf", sex: "F", age: 72, ht: 155, wt: 55, subject: null } },
  { id: "ampL", tag: "TTA · L", name: "ขาเทียมใต้เข่าซ้าย", desc: "ค่าเฉลี่ยผู้เข้าร่วมงานวิจัย: อายุ 51 ปี สูง 166.5 cm หนัก 63 kg เดิน 0.68 m/s",
    cfg: { mode: "ampL", speed: "comf", sex: "M", age: 51, ht: 166.5, wt: 63, subject: null } },
  { id: "ampR", tag: "TTA · R", name: "ขาเทียมใต้เข่าขวา", desc: "ค่าเฉลี่ยผู้เข้าร่วมเหมือนกัน แต่ขาเทียมอยู่ข้างขวา เดินเร็ว 0.82 m/s",
    cfg: { mode: "ampR", speed: "fast", sex: "M", age: 51, ht: 166.5, wt: 63, subject: null } },
  { id: "ampObese", tag: "TTA + BMI 31", name: "ขาเทียม + อ้วน", desc: "ขาเทียมซ้ายร่วมกับ BMI 31 เป็นการยืดผลออกนอกช่วงข้อมูลของทั้งสองงานวิจัย",
    cfg: { mode: "ampL", speed: "comf", sex: "M", age: 55, ht: 168, wt: 88, subject: null } },
  { id: "S11", tag: "S11", name: "ผู้เข้าร่วม S11", desc: "อายุ 28 ปี หนัก 46 kg ขาเทียมซ้าย คนที่เดินเร็วที่สุดในงานวิจัย (0.90 m/s)",
    cfg: { mode: "ampL", speed: "comf", sex: "M", age: 28, ht: 167, wt: 46, subject: "S11" } },
];
