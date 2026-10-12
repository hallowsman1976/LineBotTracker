# LINE Bot จดรายรับรายจ่าย — แผน (ตกลงจาก grill-me)

## เป้าหมาย
LINE OA สำหรับจดรายรับรายจ่ายด้วยข้อความและเสียง ใช้ส่วนตัวหรือกลุ่มเล็ก (ไม่เกิน ~10 คน) ค่าใช้จ่ายเป็นศูนย์

## Tech Stack
| ส่วน | เลือก |
|---|---|
| Runtime / โฮสต์ | Google Apps Script (Web App, webhook) |
| ฐานข้อมูล | Google Sheets (บัญชี hallowsman@gmail.com) |
| ภาษา / เครื่องมือ | TypeScript + clasp |
| LLM + ถอดเสียง | Gemini Flash (ข้อความและไฟล์เสียง m4a ใน call เดียว ได้ JSON) |
| Messaging | LINE Messaging API + Rich Menu (สร้างผ่าน MCP `line-bot`) |
| Scheduler | GAS time trigger (Asia/Bangkok) |

## Sheets
- `transactions`: วันที่-เวลา, userId, ประเภท (รับ/จ่าย), จำนวน (บาท), หมวด, โน้ต, ข้อความดิบ, แหล่งที่มา (text/voice)
- `users`: whitelist ของ LINE userId
- `logs`: error log
- (ภายใน) message id ที่ประมวลผลแล้ว เพื่อกันซ้ำ

หมวดตายตัว — จ่าย: อาหาร, เดินทาง, ของใช้, บิล/สาธารณูปโภค, บันเทิง, สุขภาพ, อื่นๆ (ปรับรายการได้ ~10 หมวด) / รับ: เงินเดือน, รายได้เสริม, อื่นๆ
LLM เลือกจากรายการเท่านั้น จัดไม่ได้ = "อื่นๆ"

## พฤติกรรม
- ตอบไทย กระชับ เช่น "✅ บันทึกแล้ว: อาหาร −60 บาท (ข้าวมันไก่)"
- ข้อความชัดเจน → บันทึกทันที; เสียงหรือ LLM ไม่มั่นใจ → ถามยืนยัน (Quick Reply); ทุกรายการมีปุ่มยกเลิก
- คำสั่ง: `สรุปวันนี้`, `สรุปเดือนนี้`, `สรุปเดือนที่แล้ว`, `ยกเลิก` (รายการล่าสุดของตัวเอง), `ช่วยเหลือ`
- ไม่ใช่รายการเงิน → ตอบว่าไม่เข้าใจพร้อมตัวอย่าง (ไม่เป็นแชทบอททั่วไป)
- Rich Menu 4 ปุ่ม: สรุปวันนี้ / สรุปเดือนนี้ / ยกเลิกล่าสุด / วิธีใช้ (ส่งข้อความคำสั่งเดียวกัน)
- สรุปอัตโนมัติ: push วันสุดท้ายของเดือน 20:00 เวลาไทย ให้ทุกคนใน whitelist
- เวลา/"วันนี้/เมื่อวาน" คิดตามเวลาไทยทั้งหมด

## ความปลอดภัยและความทนทาน
- GAS อ่าน header ไม่ได้ จึงตรวจ `x-line-signature` ไม่ได้ → ใช้ token ลับใน query ของ webhook URL
- Secret (LINE token, Gemini key, token ลับ) อยู่ใน Script Properties ไม่ใส่ในโค้ด
- ตอบเฉพาะ userId ใน whitelist
- กัน webhook ซ้ำด้วย message id; LockService กันเขียน Sheet ชนกัน; ตอบด้วย reply token ให้เร็ว
- Gemini ล่ม/หมดโควต้า: ข้อความรูปแบบ "ชื่อ ตัวเลข" ใช้ regex fallback บันทึกได้; อย่างอื่นตอบว่าระบบขัดข้อง ไม่บันทึกครึ่งๆ กลางๆ; log ลง `logs`

## เฟส
1. โครง clasp + TS, webhook รับ/ตอบ, token + whitelist + กันซ้ำ (พิสูจน์ท่อทั้งเส้นกับ OA จริง)
2. ข้อความ → Gemini → Sheets + regex fallback + ยกเลิก
3. สรุปวัน/เดือน + Rich Menu
4. เสียง (ดึงไฟล์จาก LINE → Gemini → ยืนยัน)
5. trigger สรุปสิ้นเดือน

หลังเฟส 5 (นอกขอบเขตตอนนี้): OCR สลิป, ตั้งงบและแจ้งเตือน, export

## การทดสอบ
- Unit test ฟังก์ชันล้วนรันในเครื่อง: แปลง JSON จาก LLM, คำนวณสรุป, คิดวันที่/timezone
- ส่วนที่เรียก LINE/Sheets: ทดสอบด้วยข้อความจริงใน OA

## สิ่งที่ผู้ใช้ต้องทำเอง
- `clasp login` (OAuth ในเบราว์เซอร์)
- สร้าง/ยืนยัน LINE OA + Messaging API channel และให้ channel access token
- สร้าง Gemini API key
- ใส่ secret ลง Script Properties เอง
