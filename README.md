# 四色・十胡仔

依 `DEVplan.md` 實作的 Vite + React + TypeScript + Supabase 工作區。支援本地練習與 2–6 席雲端真人／AI 混合對戰。

網站：[四色・十胡仔](https://chunhua1972.github.io/four-color-game/)。部署、安全與使用方式見 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 開始

使用 Node 24 LTS 與 pnpm 12.9.1。專案已鎖定依賴版本與 `pnpm-lock.yaml`。

```powershell
npx pnpm@12.9.1 install --frozen-lockfile
npm run dev
```

開啟 `http://localhost:5173`。在同一區網的裝置可用此電腦的區網 IP 與 5173 連接；請按實際 Windows 防火牆設定放行。手機測試開發伺服器不等於已通過正式 Safari 實機驗收。

PWA/離線模式需 production build，透過 localhost 或 HTTPS 存取：

```powershell
npm run build
npx pnpm --filter @four-colors/web preview --port 4173
```

先在線完整載入一次，之後可離線開啟練習並恢復 IndexedDB 暫局。一般 HTTP 區網網址不能註冊 Service Worker。GitHub Pages 子目錄使用 HashRouter；雲端對戰需要網路。

## 已可使用

- 1 位真人 + 1–5 位 AI；總席數 2–6，輕鬆／一般難度。
- 112 張實體牌、版本化房規、依 N 發牌、公開翻牌、吃碰槓胡過。
- 私密意向鎖定、12 秒反應窗、按規則順位裁決，不依提交先後。
- 完整 exact-cover 拆組、明暗胡數、點花、零和娛樂分、流局／相公與下一莊。
- Worker 內本地權威，前端只取得自己手牌與公開 DTO；練習不提供雲端反作弊保障。
- 暫局恢復、本人視角結果紀錄、房規教學、可互動驗牌工坊 `/lab`。
- 手機捲動雙排手牌、明組／棄牌抽屜、鍵盤選牌與取消、獨立確認出牌。

5–6 席採單副牌擴充房規（16／17 張、14／15 張），皆維持 10 胡門檻，未宣稱傳統通用或已平衡。地方規則與熟手 fixture 核准仍待 M0 人工驗收。

## Supabase 設定與界線

將根目錄 `.env.example` 複製為 `.env.local`，填入 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。Vite 從工作區根目錄讀取環境變數；設定後重啟開發伺服器。前端只能放 publishable／anon 公開金鑰。

`/lobby` 建立訪客身分後可建房、邀請朋友、設定 AI 與準備開局。Supabase Games 已啟用 Anonymous Sign-ins；原 Fourcolor 訪客可自動恢復身分。不要清除網站資料，否則訪客身分會遺失。

`supabase/migrations` 提供公開／私密分層、RLS、本人快照、房間鎖、service-only CAS、冪等收據、凍窗、持久 jobs、outbox 與 private Realtime。資料庫物件統一使用 `4color_` 前綴，私密表位於 `4color_private`。`fourcolor_game_api` 是權威 API；`fourcolor_job_dispatch` 由持久 Cron 呼叫。Edge Function 名稱必須以字母開頭，因此使用 `fourcolor_`。`fourcolor_core_proof` 僅為核心 bundle 證明。

本人 JWT 決定座位；所有暗手與牌庫只存在後端，通知只帶公開識別碼。斷線 90 秒由 AI 代打本局。實機、規模壓測與帳號綁定等剩餘驗收見進度文件。

## 驗證

```powershell
npm run check
npm run simulate -- 1000
npm run simulate -- 1000 easy
npm run benchmark
npm exec playwright install chromium
npm run test:e2e
```

157 項 core 測試包含獨立 physical-subset oracle、黃金牌型、incoming 明暗、非法動作、同窗排序、最後一牌、相公與實體牌守恆。`test:db` 使用 PGlite 的實際 PostgreSQL 執行 migration，以 A／B／C 身分與 anon 驗證本人暗手、非成員禁止讀取、禁止客戶端 DML、private schema 隔離與席位約束。它不代替 Supabase REST／Realtime／pgTAP／多連線競態測試。

Playwright 使用 production 預览，以 320×568、390×844、768×1024、1024×768、1440×900 驗證 2–6 席開局、同 gameId 恢復、天胡結算與重玩、選牌防誤送、離線恢復與工坊。瀏覽器 viewport 不能代替 iPhone、iPad 與 Android 平板實機。

模擬報告：`docs/simulation.json`、`docs/simulation-easy.json`。每份報告都驗證每席數 1,000 局、每個 transition 守恆、無非法 AI 動作、零和分數與終局。胡率是特定 AI 互打結果，不是真人勝率。

## 結構

`apps/web`：頁面、DOM 牌面、CSS Modules、Worker Gateway、IndexedDB、PWA。

`packages/game-core`：不依賴 React／Supabase／Node 的共用純 TS 核心；時刻、識別碼與亂數由 adapter 注入。

`supabase`：migration、權威 API、AI／逾時排程、共用核心 Edge ESM 建置。

`scripts`：固定種子模擬、基準、PostgreSQL 隔離測試、PWA 與 icons 建置。

開發進度與下一階段見 `docs/IMPLEMENTATION.md`。原計畫規格保留於 `DEVplan.md`。

技術查核參考：[Vite](https://vite.dev/guide/)、[Supabase Anonymous Sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Database Functions](https://supabase.com/docs/guides/database/functions)。
