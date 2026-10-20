# ตัวส่งข้อความเข้า LINE คลินิก (Cloudflare Worker)

เว็บส่งรายการสีมาที่ Worker นี้ แล้ว Worker ส่งต่อเข้า LINE ของแอดมิน/กลุ่มผ่าน Messaging API
คนไข้ไม่ต้องเห็นแชท และใช้ได้แม้เปิดเว็บนอกแอป LINE

## ติดตั้ง
1. สร้าง Messaging API channel ของ `@dentory` (LINE Official Account Manager → Settings → Messaging API → Enable) แล้วออก **Channel access token (long-lived)** ที่ developers.line.biz
2. หา userId ของแอดมินที่จะรับข้อความ: ในหน้า channel แท็บ Basic settings → **Your user ID** (แอดมินต้องกดเพิ่มเพื่อน `@dentory` ไว้ก่อน)
3. ติดตั้งและ deploy:
   ```
   cd worker
   npx wrangler login
   npx wrangler secret put LINE_TOKEN   # วาง Channel access token
   npx wrangler secret put LINE_TO      # วาง userId (หรือ groupId)
   npx wrangler deploy
   ```
4. เอา URL ที่ได้ (เช่น `https://dentory-color-notify.xxx.workers.dev`) ไปใส่ใน `index.html` ที่ `var NOTIFY_URL = "..."`
5. ตรวจ `ALLOWED_ORIGIN` ใน `wrangler.toml` ให้ตรงกับโดเมนเว็บ
