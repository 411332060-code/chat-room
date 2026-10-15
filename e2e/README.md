# 端對端測試

用 Playwright 開兩到三個獨立的瀏覽器(各自是一個匿名身分),對線上版做完整流程:進入、線上名單、進出提示、輸入中、互傳訊息、HTML 當文字、字數計數、手機寬度、頻率限制、斷網重連、離開。

不屬於網站本身,所以不在 package.json 裡。執行:

```n# 在任一個空資料夾
npm init -y && npm install playwright && npx playwright install chromium
copy e2e.mjs 到該資料夾,node e2e.mjs
```n
結果寫入 shots/e2e_result.json,截圖在 shots/。注意:測試會在聊天室留下以 [e2e] 開頭的訊息(訊息不能刪除)。
