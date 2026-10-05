# 實作進度 — 2026-10-05

交付：本地練習與雲端 2–6 席真人／AI 混合對戰，部署到 GitHub Pages 與 Supabase Fourcolor。本文件記錄 DEVplan 的證據與剩餘驗收；部署操作見 `DEPLOYMENT.md`。

| 階段 | 目前成果 | 尚缺退出條件 |
|---|---|---|
| M0 | 版本化 2–6 席 preset、黃金牌型、教學、五尺寸桌面 | 熟手核准、真實多人 fixture、擴充房規平衡 |
| M1 | pnpm workspace、strict TS、Vite、Web/Edge ESM build、CI、已部署 Supabase Auth 與 Edge | Docker 本地完整 stack |
| M2 | patterns、incoming token exact solver、fixed meld、花／娛樂分、獨立小手 oracle、測試與桌面 baseline | 最壞案例基準、實機／Edge CPU、聽牌 UI、budget 持久續算 |
| M3 | reducer、順位、雙版本意向、Easy/Normal 白名單觀測、每 N 千局模擬 | 人工核准真實場景、AI CPU 完整量測 |
| M4 | 2–6 席單人練習、Worker、IndexedDB、結算／下一莊／重玩、棄牌與明組、歷史、驗牌工坊 | 吃法專用 sheet、更完整鍵盤朗讀、旋轉保選牌、UI 實機驗收 |
| M5 | private/public schema、RLS、JWT membership、本人快照、service-only CAS／原子牌位置／收據、DB 截止與凍窗、PostgreSQL 與真實雲端隔離／競態測試 | 更大規模並發、故障注入、solver 持久續算 |
| M6 | 2–6 席房間／邀請／準備／混合 AI、CloudGateway、private Realtime、Cron／job lease／outbox、刷新恢復與 90 秒 AI 接管 | 帳號綁定、跨裝置同身分、完整管理介面 |
| M7 | PWA 子目錄 cache、PNG icons、reduced motion、五 viewport E2E、CI／Pages 發佈、secret check、後端健康查詢 | Safari/Android/Windows 實機、50 房／300 席 load、外部告警、更新提示、雲端歷史介面 |

所有後端表採 migration。已依使用者授權部署到 Supabase Fourcolor；GitHub 只保存原始碼及公開 build 設定，不保存環境檔或 server keys。權威局面僅由可信 Edge 產生，客戶端不能提供 nextState。通知僅含識別碼，完整牌庫與暗手不出伺服器。

## 一般 AI，5,000 局固定種子結果

| 席數 | 胡 | 流局 | 相公 |
|---:|---:|---:|---:|
| 2 | 997 | 0 | 3 |
| 3 | 995 | 2 | 3 |
| 4 | 958 | 41 | 1 |
| 5 | 774 | 198 | 28 |
| 6 | 468 | 487 | 45 |

每局最多 2,000 步保護，實際最長 148 步。無非法動作、112 張守恆錯誤或卡局。相公是被正式規則判定的合法終局，不算程式失敗。六席流局 48.7%，不能宣稱已平衡；仍依 preset 維持 10 胡。

## 已修正的具體問題

- 自己手牌排序後，合法 claim 選到另一實體副本：現在驗 ID 所有權與唯一性，再比較同型牌型；裁決重新驗證。
- 天胡與出牌同時可用時，UI 出牌分支遮住天胡：現在同時呈現。
- 窄螢幕 main 的 auto margin 造成手牌溢出、遮住 footer：main 固定填滿 grid，可內部捲動；短螢幕縮短桌面。
- 離線 precache 與 Vite 的 Vary: Origin：對白名單靜態檔使用 ignoreVary；Auth/REST/API 不 cache。
- reload 保留 router 開桌設定導致開新局：開桌後消耗路由設定，reload 只恢復同一 gameId。
- 重玩保留原難度與下一莊，由 Worker 從既有權威 state 推導，建立新 gameId。

## 下一工作順序

1. 熟手檢查 preset/fixtures；有變更新增版本，不覆蓋已存舊局。
2. iPhone、iPad、Android 平板與 PC 真實裝置驗收、旋轉與慢網路測試。
3. staging 50 同時房間／300 席壓測，故障注入與還原演練。
4. 帳號綁定、雲端歷史與外部告警；量測 Cron／Edge 最壞延遲。
5. 增加熟手多人場景 fixture；規則有變動時保留已開局版本。

公開連線設定由本機 `.env.local` 與 GitHub Actions public variables 注入；service_role 僅用 Supabase 內建 Edge 環境，排程憑證只存 Edge secrets／Vault。真實雲端檢查報告見 `cloud-verification.json`。
