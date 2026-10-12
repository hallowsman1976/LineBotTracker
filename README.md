# LineBotTracker

LINE bot จดรายรับรายจ่าย บน Google Apps Script + Google Sheets ดูแผนทั้งหมดที่ [PLAN.md](PLAN.md)

## โครงสร้าง
- `src/webhook.ts` — logic ของ webhook (ไม่แตะ Apps Script โดยตรง จึงเทสต์ในเครื่องได้)
- `src/index.ts` — entry point ของ Apps Script (`doPost`, `setup`, ...)
- `src/store.ts`, `src/line.ts`, `src/config.ts` — Sheets, LINE API, ค่าคงที่
- `build.mjs` — bundle ด้วย esbuild เป็น `dist/Code.js` (clasp 3 ไม่แปลง TS ให้แล้ว)

## คำสั่ง
```bash
npm test          # unit test
npm run push      # typecheck + test + build + clasp push (ยังไม่กระทบ URL ที่ใช้งานจริง)
npm run deploy    # push แล้วอัปเดต deployment เดิม (URL webhook เดิม)
```

## Apps Script
- Project: https://script.google.com/d/1UTc8gAjUXovney3SOY3w_y3sC3A8Qt4EiXFa5mZ_zNhvWMQyo75YwpKp/edit
- Web app (webhook): `https://script.google.com/macros/s/AKfycbwMdiyG6iUfCJgOpMk0ODfp9zNioWKsCdyBSL3YiQZ5ZwwJtEAwXA1tfp6bZkq8-ISMUA/exec?key=<WEBHOOK_TOKEN>`

- Spreadsheet: `1E0_sRw-w9SJ2O-QUgaY79OHngzY0a-Iz8v8vS_doc68` (ค่าเริ่มต้นใน `src/config.ts`; `setup` จะบันทึกลง Script Property `SPREADSHEET_ID`)

## ตั้งค่าครั้งแรก (ทำเองครั้งเดียว)
1. เปิด Project ข้างบน → เลือกฟังก์ชัน `setup` → Run → อนุญาตสิทธิ์ (Sheets, เรียก URL ภายนอก)
   - จะสร้าง Spreadsheet `LineBotTracker DB` (sheets: transactions, users, logs) และ `WEBHOOK_TOKEN`
2. Project Settings → Script Properties → เพิ่ม `LINE_CHANNEL_ACCESS_TOKEN` (และ `GEMINI_API_KEY` ไว้ใช้เฟส 2)
3. Run `checkProperties` ดูว่าค่าครบ (แสดงแค่ความยาว ไม่แสดงค่า)
4. Run `showWebhookUrl` แล้วคัด URL ไปใส่ LINE Developers Console → Messaging API → Webhook URL → Verify → เปิด "Use webhook"
   - ปิด "Auto-reply messages" และ "Greeting messages" ใน LINE Official Account Manager
5. ส่งข้อความหา OA → บอทจะตอบว่าไม่มีสิทธิ์พร้อม userId → ใส่ userId ลงชีต `users` (คอลัมน์ `userId`, `name`, `active` = TRUE)
6. ส่งข้อความอีกครั้ง → บอทตอบ "✅ บันทึกแล้ว" = ท่อทั้งเส้นใช้ได้

## อัปเดตเฟส 2 (จดข้อความด้วย Gemini)
1. สร้าง API key ที่ https://aistudio.google.com/apikey แล้วใส่ Script Property `GEMINI_API_KEY`
2. Run `setup` อีกครั้ง → เพิ่มคอลัมน์ `date`, `status` ในชีต `transactions` (ไม่ลบข้อมูลเดิม) **ต้องทำก่อนส่งข้อความ ไม่งั้นบันทึก/ยกเลิกจะ error**
3. Run `testGemini` → ดู log ว่าได้ JSON ของ 3 ประโยคตัวอย่าง
   - ถ้า error 404 ชื่อรุ่น: ตั้ง Script Property `GEMINI_MODEL` เป็นรุ่นอื่น (ค่าเริ่มต้น `gemini-3.8-flash`)
4. ทดสอบใน LINE: `ข้าวมันไก่ 60`, `กาแฟ 45 ขนม 30`, `เมื่อวานได้ค่าแรงแปดร้อย`, `ยกเลิก`, `วิธีใช้`

## เฟส 3 (สรุป + Rich Menu)
- คำสั่ง: `สรุปวันนี้` (แสดงทุกรายการ), `สรุปเดือนนี้` / `สรุป`, `สรุปเดือนที่แล้ว` (แยกตามหมวด พร้อม %)
- Rich Menu 4 ปุ่ม ส่งข้อความคำสั่งเดียวกัน: สรุปวันนี้ / สรุปเดือนนี้ / ยกเลิก / วิธีใช้
  - ติดตั้ง: Run `setupRichMenu` ใน editor (ใช้ token ของบอทนี้ ตั้งเป็นเมนูเริ่มต้น; รันซ้ำจะแทนที่เมนูเดิมที่สคริปต์นี้สร้าง)
  - แก้รูป: แก้ `assets/richmenu.html` → `npm run render:richmenu` (ใช้ Edge headless) → `npm run deploy` → Run `setupRichMenu` อีกครั้ง

## เฟส 4 (เสียง)
- ส่งข้อความเสียง (ไม่เกิน 1 นาที) → ดึงไฟล์ m4a จาก LINE → Gemini ถอดเสียง + ตีความใน call เดียว
- จดรายการด้วยเสียง: **ถามยืนยันทุกครั้ง** พร้อมแสดงสิ่งที่ได้ยิน (`🎤 "..."`) → `source` = `voice`, `rawText` = คำที่ถอดได้
- สั่งด้วยเสียงได้: "สรุปวันนี้/เดือนนี้/เดือนที่แล้ว" (ทำทันที), "วิธีใช้", "ยกเลิก" (แสดงปุ่มให้กดยืนยันก่อน ไม่ลบทันที)
- ไม่ต้องตั้งค่าเพิ่ม ใช้ `GEMINI_API_KEY` เดิม

## เฟส 5 (สรุปสิ้นเดือนอัตโนมัติ)
1. Run `setupMonthlyTrigger` ครั้งเดียว → จะขออนุญาตสิทธิ์เพิ่ม (จัดการ trigger) **ต้องกดอนุญาต ไม่งั้นบอทอาจหยุดตอบ** เพราะ manifest มี scope ใหม่
2. trigger รันทุกวันช่วง 20:00–21:00 (เวลาไทย) แต่ส่งเฉพาะวันสุดท้ายของเดือน ให้ทุกคนในชีต `users` ที่ active
3. ทดสอบทันที: Run `sendMonthlySummaryNow` (ส่งสรุปเดือนนี้ให้ทุกคน active ตอนนี้เลย ไม่กระทบรอบจริง)
- กันส่งซ้ำ: Script Property `LAST_MONTHLY_SUMMARY` = เดือนล่าสุดที่ส่งแล้ว (ระบบเขียนเอง)
- ใช้โควต้า push message ของ OA 1 ข้อความ/คน/เดือน

ชีต `transactions`: `id` เดียวกัน = มาจากข้อความเดียวกัน (ยกเลิกพร้อมกัน), `status` = `active`/`cancelled`, `source` = `text` / `text-rule` (AI ขัดข้อง ใช้กฎสำรอง)

หมายเหตุ: Apps Script อ่าน header ไม่ได้ จึงตรวจ `x-line-signature` ไม่ได้ ใช้ `?key=` ใน URL แทน อย่าแชร์ URL นี้
