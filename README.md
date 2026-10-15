# 匿名聊天室

不用登入的匿名聊天室,所有人在同一個聊天室裡。原生 TypeScript + Vite + Supabase。

架構、安全設計與驗證清單見 [`docs/architecture.md`](docs/architecture.md)。

## 功能

- 不用登入:瀏覽器自動拿到匿名身分和隨機暱稱
- 即時聊天、線上名單、進出提示
- 「正在輸入…」提示
- 傳送狀態(傳送中 / 已送出 / 傳送失敗並重試,重送不會重複)
- 字數計數器(N / 500)
- 載入更早的訊息(聊天室累積超過 50 則才會出現按鈕)
- 斷線時顯示「重新連線中…」,超過 60 秒回到進入畫面
- 資料庫端的頻率限制(10 秒最多 5 則)與內容清理

## 兩種模式

| | 展示模式 `demo` | 正式模式 `live` |
|---|---|---|
| 後端 | 無,假使用者在記憶體裡 | Supabase |
| 金鑰 | 不需要 | 需要網址與 publishable key |
| 用途 | 階段一:不接資料庫就能看完整畫面 | 階段二 |

展示模式的小技巧:送出以 `/fail` 開頭的訊息,會失敗一次,可以試「重試」;連續快速送 6 則可看到頻率限制。
斷線重連:在瀏覽器 DevTools 的 Network 切到 Offline,會出現「重新連線中…」。

## 本機執行

```
npm install
npm run dev      # 沒有 .env.local 時是展示模式
npm test         # parsePost 單元測試
```

接 Supabase:

1. 在 Supabase SQL Editor 執行 `supabase/schema.sql`(可重複執行)。
2. Authentication → Sign In / Providers 打開 **Allow anonymous sign-ins**。
3. 複製 `.env.example` 為 `.env.local`,填入專案網址與 publishable key。

## 部署

推到 `main` 會自動用 GitHub Actions 部署到 GitHub Pages(正式模式)。
Actions → Deploy to GitHub Pages → Run workflow 可以選 `demo` 或 `live`。
Settings → Secrets and variables → Actions → **Variables** 需要有 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。

## 安全

- 前端只使用 publishable key;secret / service_role key 不放前端也不放 repo。
- 發言者、暱稱、時間都由資料庫填入,前端只能寫 `id` 與 `content`;沒有人能修改或刪除訊息。
- 訊息一律以 `textContent` 顯示,不會被當成 HTML 執行。
