# 部署與連線

前端：[GitHub Pages](https://chunhua1972.github.io/four-color-game/)

原始碼：[chunhua1972/four-color-game](https://github.com/chunhua1972/four-color-game)

後端：Supabase Fourcolor（`pojhgousjmrlussvslwu`）。

## 使用

選「邀朋友同桌」，輸入暱稱並建立 2–6 席房間。把 12 碼邀請碼交給朋友；空席可設為 AI。真人各自按「我準備好了」，房主即可開局。只有一人時，其他席填入 AI 即為雲端單人。

訪客身分由 Supabase Auth 建立並保存在瀏覽器。重新整理、斷線後使用同一身分恢復快照；離線超過 90 秒由 AI 代打本局，下一局重新準備。結算後房間回到等待狀態，房主可再開下一局。

GitHub Pages 使用子目錄與 HashRouter，重新載入 `/#/game/...` 不需伺服器 SPA fallback。PWA 的 manifest、圖示、靜態快取與 Service Worker 都限定在專案子目錄。雲端 API、身分與暗手不進入 Service Worker cache。

## 安全

`.env`、`.env.*`（除空白 `.env.example`）、`.deploy/`、Supabase 暫存檔、私鑰都被 Git 忽略。`scripts/check-secrets.mjs` 檢查追蹤檔案，CI 與 Pages build 也執行檢查。不要使用 `git add -f` 加入環境檔。

GitHub Actions 只有 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY` 公開 build variables。它們會進入瀏覽器 bundle；不可替換成 secret／service_role key。Supabase 內建 server credential 僅由 Edge 的 `Deno.env` 讀取。

牌庫、其他暗手、未裁決意向、收據、工作與邀請雜湊保存在 private schema。service-only RPC 拒絕 authenticated／anon 呼叫。Edge 驗證 JWT，再按 membership 決定操作者座位，不接受客戶端指定座位或 nextState。

每次狀態提交以 hash CAS、資料庫鎖、112 張牌的位置約束與原子收據保護；同窗反應採 DB deadline，裁決先凍結。Realtime 私有 topic 只送局號、版本及序號，客戶端重新取得本人快照。

## 發佈

推送 main 會觸發 `.github/workflows/pages.yml`：安裝鎖定依賴、secret check、lint／TypeScript／核心與資料庫測試、production build、部署 Pages。`.github/workflows/ci.yml` 另外執行模擬與瀏覽器 E2E。

後端採 migration 與 Edge function 手動受控發佈：

```powershell
npx supabase@2.119.0 db push --linked
npx supabase@2.119.0 functions deploy game-api --use-api
npx supabase@2.119.0 functions deploy job-dispatch --use-api
```

初次部署／輪替排程憑證時執行 `node scripts/prepare-deployment.mjs`，把忽略目錄內的 `job.env` 送到 Supabase secrets，再執行 `cron.sql` 將同一憑證放入 Vault。**不要將這些檔案提交或貼入公開 issue。** `set-github-public-config.mjs` 只傳送公開 frontend variables。

Supabase Cron 每 2 秒檢查到期工作；無到期工作時不呼叫 Edge。每秒重送未完成 outbox。工作有 20 秒租約與重試，不使用瀏覽器或 Edge 常駐計時器。排程的實際 HTTP 延遲仍受雲端服務影響。

健康查詢（管理者 CLI，無憑證輸出）：

```powershell
npx supabase@2.119.0 db query --linked "select public.server_health();"
```

檢查 overdueJobs、cron.job_run_details 失敗及 net._http_response 失敗；診斷時不要查出 Vault 解密值或記錄 JWT／暗手／牌庫。前端可重新部署前一 commit；DB schema 保持向前兼容，避免直接 reset 正式資料庫。

## 尚需實機與規模驗收

本次驗證證據：`cloud-verification.json` 記錄獨立訪客、RLS／RPC／Realtime 隔離、每種席數的操作競態与五種席數的真實終局／零和分數；`pages-verification.json` 記錄已發布網站在手機與桌面兩個獨立瀏覽器的建房／加入／準備／開局／同步／刷新／重連。159 項自動測試包含首次匿名登入競態的回歸測試，另有 13 項瀏覽器 E2E。

已驗證瀏覽器尺寸不等於 iPhone／iPad／Android 實機驗收。熟手房規確認、50 房／300 席壓測、帳號綁定、跨裝置同一身分、雲端歷史介面與外部告警仍屬後續工程；不要將目前發佈解讀為 DEVplan 所有 M7 條件已完成。
