# เปิดเว็บ Thosaphol Connect ให้คนอื่นใช้ (มี login + บันทึกลง Google Form)

ใช้เวลาประมาณ 30–45 นาที แบ่งเป็น 4 ขั้น ทำทีละขั้นได้ และเว็บใช้งานได้ตั้งแต่ขั้นที่ 1 (ยังไม่มีปุ่ม login จนกว่าจะทำขั้นที่ 2)

สิ่งที่ต้องมี: บัญชี GitHub (repo นี้), บัญชี [Render](https://render.com) (สมัครฟรีด้วย GitHub), บัญชี Google

---

## ขั้นที่ 1 — ขึ้นเว็บบน Render

1. เข้า <https://dashboard.render.com> → **Sign in with GitHub**
2. กด **New +** → **Blueprint**
3. เลือก repo `thosapholpe-afk/claude`
   - ถ้าไม่เห็น repo ให้กด **Configure GitHub App** แล้วอนุญาตให้ Render เห็น repo นี้
4. **Branch** เลือก `claude/optimistic-allen-1tuwsi` — Render จะอ่านไฟล์ `render.yaml` เอง
5. หน้าถัดไปจะให้กรอกค่าต่าง ๆ — **เว้นว่างไว้ก่อนได้ทั้งหมด** แล้วกด **Apply**
6. รอ build 3–5 นาที จนสถานะเป็น **Live** แล้วจด URL ของเว็บ เช่น `https://thosaphol-connect.onrender.com`
   (ถ้าชื่อซ้ำ Render จะต่อท้ายให้ — ใช้ URL ที่แสดงจริงในหน้า service)
7. เปิด `https://<URL ของคุณ>/api/health` ต้องเห็น `"ok":true`
8. ดูแท็บ **Logs** จะมีรายการ **redirect URIs** ของแต่ละเจ้า เช่น
   `github    https://thosaphol-connect.onrender.com/auth/github/callback` — ใช้ในขั้นที่ 2

> แผนฟรีของ Render: ถ้าไม่มีคนเข้า 15 นาทีเว็บจะหลับ คนแรกที่เข้าจะรอประมาณ 1 นาที

---

## ขั้นที่ 2 — เปิดปุ่ม login

ทำเฉพาะเจ้าที่อยากใช้ ทุกเจ้าจบด้วยการเอาค่า 2 ค่าไปใส่ที่ Render:
**service → Environment → แก้ค่า → Save Changes** (Render จะ deploy ใหม่ให้เองประมาณ 2–3 นาที)

แทน `<URL>` ด้วย URL เว็บจากขั้นที่ 1

### GitHub (ง่ายที่สุด ลองอันนี้ก่อน)
1. <https://github.com/settings/developers> → **New OAuth App**
2. Homepage URL: `<URL>` · Authorization callback URL: `<URL>/auth/github/callback`
3. **Register application** → คัดลอก **Client ID** → กด **Generate a new client secret** แล้วคัดลอก
4. ใส่ใน Render: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

### Google
1. <https://console.cloud.google.com> → สร้าง project ใหม่
2. **APIs & Services → OAuth consent screen** → External → กรอกชื่อแอป + อีเมล
3. **Credentials → Create credentials → OAuth client ID** → Application type: **Web application**
4. **Authorized redirect URIs**: `<URL>/auth/google/callback` → Create
5. ใส่ใน Render: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
6. ตอนแอปยังเป็นโหมด **Testing** จะ login ได้เฉพาะอีเมลที่เพิ่มไว้ใน Test users — กด **Publish app** เมื่อพร้อมให้ทุกคนใช้

### Facebook
1. <https://developers.facebook.com/apps> → **Create app** → เลือกการใช้งานแบบ Facebook Login
2. ใน Facebook Login → Settings → **Valid OAuth Redirect URIs**: `<URL>/auth/facebook/callback`
3. App settings → Basic → คัดลอก **App ID** และ **App Secret** → ใส่ `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
4. ใส่ลิงก์ Privacy Policy แล้วสลับแอปเป็น **Live** — ก่อนหน้านั้น login ได้เฉพาะบัญชีที่เป็น admin/tester ของแอป

### Instagram
1. ในแอปเดียวกันบน developers.facebook.com → เพิ่ม product **Instagram** → **API setup with Instagram login**
2. ตั้ง redirect URL: `<URL>/auth/instagram/callback`
3. คัดลอก **Instagram app ID / secret** → ใส่ `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`
4. ใช้ได้เฉพาะบัญชี IG แบบ **professional** (Business/Creator) และระหว่างโหมด development ต้องเพิ่มบัญชีเป็น tester ก่อน

---

## ขั้นที่ 3 — บันทึกคนสมัครลง Google Form

1. <https://forms.google.com> → ฟอร์มเปล่า → สร้างคำถามแบบ **คำตอบสั้น** 7 ข้อ:
   `ชื่อ`, `อีเมล`, `Provider`, `บทบาท`, `องค์กร`, `Event`, `เวลา`
   - ตั้ง "จำเป็น" ได้เฉพาะ `ชื่อ` (ข้ออื่นบางครั้งเป็นค่าว่าง)
2. **ตั้งค่า → คำตอบ**: "เก็บอีเมล" = **ไม่เก็บ** และปิดทุกตัวเลือกที่บังคับให้ต้องลงชื่อเข้าใช้ Google
3. กด **ส่ง** → ไอคอนลิงก์ → คัดลอกลิงก์
4. ในเครื่องของคุณ (ในโฟลเดอร์โปรเจกต์ หลัง `npm install`):
   ```bash
   npm run form:setup -- https://docs.google.com/forms/d/e/xxxx/viewform
   ```
   จะได้บรรทัด `GFORM_ID=…` และ `GFORM_ENTRY_…=…` ครบ พร้อมเตือนถ้ามีคำถามที่ตั้งผิด
5. ใส่ค่าเหล่านั้นใน Render → Environment (มีปุ่ม **Add from .env** วางทีเดียวได้ทั้งก้อน) → Save
6. ทดสอบ: ใส่ค่าเดียวกันใน `.env` ในเครื่องแล้วรัน `npm run form:test` → ฟอร์มจะได้แถว "Test row from Thosaphol Connect"
7. ในแท็บ **คำตอบ** ของฟอร์ม กด **ลิงก์กับชีต** เพื่อดูเป็นตาราง

ไม่มี Node ในเครื่อง? ทำแบบมือได้: ⋮ → **รับลิงก์ที่กรอกไว้ล่วงหน้า** → กรอกทุกข้อ → คัดลอกลิงก์ → ตัวเลขหลัง `entry.` ของแต่ละข้อคือค่า `GFORM_ENTRY_…` และ `GFORM_ID` คือส่วน `/forms/d/e/<ตรงนี้>/viewform`

ตัวเลือกเพิ่ม: `GFORM_LOG_LOGINS=true` บันทึกทุกครั้งที่มีคน login, `GFORM_LOG_GUESTS=true` บันทึกคนที่เข้าแบบไม่มีบัญชีด้วย

---

## ขั้นที่ 4 — ตรวจ

1. เปิดเว็บ → กดไอคอน GitHub/Google → login → ตั้งชื่อ
2. ฟอร์มต้องมีแถวใหม่ `Event = signup`
3. `<URL>/api/health` จะบอกว่าเปิดอะไรอยู่บ้าง: `providers`, `googleForm`, `copilot`

---

## เรื่องที่ควรรู้

- **รายชื่อผู้ใช้บนแผนฟรี**: ไฟล์ `users.json` จะหายเมื่อ Render รีสตาร์ท แต่คนที่ login อยู่จะ**ไม่หลุด**และ**ไม่ต้องตั้งชื่อใหม่** (โปรไฟล์ถูกเก็บแบบเซ็นไว้ใน cookie) และข้อมูลใน Google Form ไม่หาย
  ถ้าต้องการเก็บถาวร ใช้แผนแบบเสียเงิน + เปิด `disk` ใน `render.yaml` แล้วตั้ง `DATA_DIR=/var/data`
- **โดเมนของตัวเอง**: Render → Settings → Custom Domains แล้วตั้ง `PUBLIC_URL=https://โดเมนของคุณ` และเพิ่ม redirect URI ใหม่ในทุกเจ้า
- **AI Copilot / สแกนบอร์ด**: ใส่ `ANTHROPIC_API_KEY` ใน Environment
- **ห้าม** commit ไฟล์ `.env` ขึ้น GitHub — ค่าลับใส่ใน Render เท่านั้น

## โฮสต์อื่น (ใช้ `Dockerfile`)

- **Railway**: New Project → Deploy from GitHub repo → เลือก branch → Variables ใส่ค่า → Settings → Generate Domain (ไม่ต้องตั้ง `PUBLIC_URL`)
- **Fly.io**: `fly launch` → `fly secrets set GITHUB_CLIENT_ID=… …` → `fly deploy` (ไม่ต้องตั้ง `PUBLIC_URL`) และสร้าง volume แล้ว mount ที่ `/data` ถ้าต้องการเก็บรายชื่อผู้ใช้
- **เครื่อง/VPS ของตัวเอง**:
  ```bash
  docker build -t thosaphol-connect .
  docker run -d -p 80:8787 --env-file .env -v tc-data:/data thosaphol-connect
  ```
  (ตั้ง `PUBLIC_URL` เป็นที่อยู่ที่คนอื่นเข้าถึงได้ และควรมี https)
