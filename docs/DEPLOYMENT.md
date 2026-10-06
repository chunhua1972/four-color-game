# 部署與連線

前端：[GitHub Pages](https://chunhua1972.github.io/four-color-game/)

原始碼：[chunhua1972/four-color-game](https://github.com/chunhua1972/four-color-game)

後端：Supabase Games（`aabjctsxjwsismfrwpja`），於 2026-10-06 從 Fourcolor 搬移。Games 同時承載 Tetris；四個顏色的資料表與資料庫函式使用 `4color_` 前綴，私密表位於 `4color_private`，Realtime topic 使用 `4color_game:`／`4color_room:`。Edge Function 名稱必須以英文字母開頭，使用 `fourcolor_game_api`／`fourcolor_job_dispatch`。

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
# 指定已安裝的 Supabase CLI 執行檔路徑：
$env:SUPABASE_CLI = 'C:\path\to\supabase.exe'
node scripts/4color-deploy-migrations.mjs
npx supabase@2.119.0 functions deploy fourcolor_game_api fourcolor_job_dispatch --project-ref aabjctsxjwsismfrwpja --use-api
```

Games 的 migration history 包含 Tetris。此專案使用 `4color-deploy-migrations.mjs` 只套用尚未執行的 `*_4color_*.sql`，並在同一交易記錄版本；避免單一遊戲的 `db push` 因其他遊戲的歷史檔案不在本機而失敗。

完整搬移備份位於已忽略的 `.deploy/4color-migration`，含原始應用資料、Auth 記錄、資料庫函式、Vault 排程設定與連線設定。2026-10-06 已依使用者明確授權，永久清除 Fourcolor 舊資料表、資料庫函式、使用者、Cron、Edge Functions 與原遊戲的服務密鑰，並關閉舊專案匿名註冊；保留 Supabase 專案本身與本機備份。清除及 Games／Tetris 後續驗證見 `4color-source-retirement.json`。

初次部署／輪替排程憑證時執行 `node scripts/prepare-deployment.mjs`，把忽略目錄內的 `job.env` 送到 Games 的 Supabase secrets，再執行 `cron.sql` 將同一憑證放入 Vault。使用獨立的 `FOURCOLOR_JOB_DISPATCH_SECRET`／`FOURCOLOR_PUBLIC_ORIGINS`，避免覆蓋 Tetris 設定。**不要將這些檔案提交或貼入公開 issue。** `set-github-public-config.mjs` 只傳送公開 frontend variables。

新環境的 migrations 建立排程函式但不立即啟用 Cron。資料與 Vault 設定完成後，執行：

```sql
select cron.schedule('4color_jobs', '2 seconds', 'select "4color_private"."4color_invoke_game_jobs"()');
select cron.schedule('4color_outbox', '1 second', 'select "4color_private"."4color_dispatch_outbox"()');
```

Supabase Cron 每 2 秒檢查到期工作；無到期工作時不呼叫 Edge。每秒重送未完成 outbox。工作有 20 秒租約與重試，不使用瀏覽器或 Edge 常駐計時器。排程的實際 HTTP 延遲仍受雲端服務影響。

健康查詢（管理者 CLI，無憑證輸出）：

```powershell
npx supabase@2.119.0 db query --linked --project-ref aabjctsxjwsismfrwpja 'select public."4color_server_health"();'
```

檢查 overdueJobs、cron.job_run_details 失敗及 net._http_response 失敗；診斷時不要查出 Vault 解密值或記錄 JWT／暗手／牌庫。前端可重新部署前一 commit；DB schema 保持向前兼容，避免直接 reset 正式資料庫。

## 尚需實機與規模驗收

本次驗證證據：`cloud-verification.json` 記錄 Games 上獨立訪客、RLS／RPC／Realtime 隔離、2–6 席操作競態與真實終局／零和分數；`4color-migrated-guest-verification.json` 記錄原訪客的身分與房間恢復；`4color-migration-verification.json` 記錄搬移內容及既有 Tetris 資料一致性。161 項自動測試包含首次匿名登入競態與移轉登入的回歸測試。

已驗證瀏覽器尺寸不等於 iPhone／iPad／Android 實機驗收。熟手房規確認、50 房／300 席壓測、帳號綁定、跨裝置同一身分、雲端歷史介面與外部告警仍屬後續工程；不要將目前發佈解讀為 DEVplan 所有 M7 條件已完成。
