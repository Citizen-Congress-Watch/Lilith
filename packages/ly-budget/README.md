# Ly-Budget

立法院預算管理系統

## 功能概述

本系統用於管理立法院預算相關資料，包含以下主要功能：

### 核心資料管理
- **屆期管理** (Term): 管理立法院各屆期資料
- **委員會管理** (Committee): 管理各委員會及其成員
- **立法委員管理** (People): 管理立委及黨團資料
- **政府部會管理** (Government): 管理政府各部會資料

### 預算管理
- **預算書管理** (Budget): 管理政府預算書資料
- **會議管理** (Meeting): 管理預算審議相關會議
- **提案管理** (Proposal): 管理立委提案單

### 圖像辨識
- **辨識圖檔** (RecognitionImage): 管理會議相關圖檔
- **辨識狀態** (RecognitionStatus): 管理圖像辨識結果

## 技術架構

- **Keystone 6**: 後端 CMS 框架
- **PostgreSQL**: 資料庫
- **TypeScript**: 開發語言
- **Docker**: 容器化部署

## 開發環境設置

1. 安裝依賴：
```bash
yarn install
```

2. 設置環境變數：
```bash
cp .env.example .env
# 編輯 .env 文件設定資料庫連線等參數
```

3. 啟動開發伺服器：
```bash
yarn dev
```

## 部署

使用 Docker 進行部署：

```bash
docker build -t ly-budget .
docker run -p 3000:3000 ly-budget
```

## 資料庫遷移

```bash
yarn db-migrate
```

## 權限管理

系統包含以下角色：
- **admin**: 完整管理權限
- **moderator**: 內容管理權限
- **editor**: 編輯權限
- **contributor**: 貢獻者權限

## 下拉選單 label/value 對照

- Proposal
  - proposalTypes：freeze/凍結、reduce/刪減、other/其他建議
  - result：passed/通過、withdrawn/撤案、reserved/保留
  - unfreezeStatus：not_reviewed/尚未審議、reviewing/審議中、unfrozen/已解凍
  - publishStatus：draft/草稿、published/已發布
- Meeting
  - location：committee/委員會、plenary/院會、negotiation/黨團協商
  - type：budget_review/預算審議、budget_unfreeze/預算解凍
- Budget
  - type：budget/預算、legal_budget/法定預算
- People
  - type：legislator/立法委員、party/黨團
- RecognitionImage
  - result：passed/通過、withdrawn/撤案、reserved/保留
  - verificationStatus：verified/已驗證、not_verified/未驗證
- RecognitionStatus
  - type：recognition/辨識、verification/驗證
- User
  - role：admin/admin、moderator/moderator、editor/editor、contributor/contributor
- BudgetYear
  - budgetProgress：government-proposed/中央政府提出預算、committee-review/立法院委員會審議、party-negotiation/黨團協商、plenary-decision/院會決議、final-reviewed/預算三讀通過、presidential-promulgation/預算總統公布
  - dataProgress：in-progress/進行中（預設）、completed/已完成
  - unfreezeProgress：ministry-reporting/部會開始提出解凍報告、legislative-review/立法院審議中、unfreeze-complete/全數凍結案解凍完畢


## 安全設定與事件後部署

- `ACCESS_CONTROL_STRATEGY=cms`：只提供 Google OAuth 登入，依 `User` list 授權寫入。
- `ACCESS_CONTROL_STRATEGY=gql` 或 `preview`：所有 list 禁止新增、修改、刪除；移除 User 查詢、登入、首次建帳及資料寫入 mutations；停用 Admin UI 和 session。辨識程式也不能再透過公開 gql 寫入。
- 未知 strategy 會直接報錯。未設定時沿用 `cms`，但仍必須驗證身分。

CMS 啟動前必須設定 **新的 `CMS_SESSION_SECRET`**。不再接受舊的
`SESSION_SECRET`，也沒有預設密鑰。請用密碼學亂數產生至少 32 字元的值，例如
`openssl rand -hex 32`，存入 Secret Manager 後注入 CMS 執行環境；不要把密鑰
提交到 git 或放進映像檔。所有 CMS instances 使用同一個新值，並把流量完全切離
舊 revision，才能讓舊 session 全數失效。CMS 缺少有效密鑰時會拒絕啟動；
`build`/`postinstall` 不需取得執行環境密鑰。公開 gql 不需配置密鑰。

`SESSION_MAX_AGE` 預設為 86400 秒，只接受正整數。正式部署使用
`NODE_ENV=production`，以啟用 Secure cookie（舊的 `prod` 值也支援）。

部署前確認：

1. 保存事件紀錄及受影響資料的快照；檢查 User 的新增帳號、角色、email、Google 綁定與啟用狀態。
2. 為 CMS 設定新的 `CMS_SESSION_SECRET` 及下列 Google OAuth 設定，再部署 CMS 與公開 gql／preview，移除舊 revision 的流量與可直接存取的標籤網址。
3. 確認公開查詢正常，所有資料 mutations、User 查詢及登入 mutation 均遭拒絕；舊 cookie／token 不能登入 CMS。
4. 原本由公開 gql 寫入辨識結果的程式，必須改用受驗證的 CMS 入口及必要角色。

只有 admin 能修改 `role`、`isProtected`、`isActive`、登入 email 與 Google 綁定。Editor 只能修改自己的 User（以 ID
判斷）；moderator 不能修改 admin 或受保護帳號。Moderator 建立帳號時省略 role，
新帳號預設 contributor，再由 admin 授權。公開首次建帳功能已移除；新的空資料庫
需透過受控的管理程序建立第一位管理員。

共用映像在建置時產生 CMS schema。`run.sh` 會先驗證 CMS 的執行環境設定，通過後才在 `cms` 模式執行 migration；
`gql`／`preview` 直接以各自的唯讀設定啟動，不執行資料庫遷移，也不需要 session
密鑰。部署順序應先 CMS、再公開服務，讓 CMS 先完成資料庫遷移。
不要在公開服務啟動時執行 `keystone prisma migrate deploy`：Keystone 會檢查
建置時的 CMS schema，與執行時的唯讀 schema 不同而拒絕啟動。

可另外為公開 gql 配置只具 SELECT 權限的資料庫帳號，增加資料庫層的限制。
本次程式修正不會自行修改正式資料庫權限或密鑰。

### Google OAuth 與 User 帳號

Google 負責驗證身分；`User` 是允許登入的帳號清單與角色權限來源。
沒有對應 User、`isActive=false`、email 不符或 Google 帳號綁定不同，都拒絕登入。
不會自動建立 User，也不會依 email 網域授予 admin 權限。

CMS 執行環境需要：

| 變數 | 用途 |
| --- | --- |
| `CMS_ORIGIN` | CMS 的固定網址，例如 `https://ly-budget-prod-702918025200.asia-east1.run.app`，不含路徑 |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth「網頁應用程式」的 Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 對應的 Client Secret，透過 Secret Manager 注入 |
| `CMS_SESSION_SECRET` | 簽署 CMS session 與 OAuth 暫存交易，仍使用事件後的新密鑰 |

在 Google OAuth client 設定 Authorized redirect URI 為
`<CMS_ORIGIN>/auth/google/callback`。dev 與 prod 分別設定自己的 origin 和 callback；
建議分開使用 OAuth client。若 consent screen 處於 Testing，需將管理員帳號列為測試使用者。
本流程只要求 `openid email profile`，不申請 Google API 的離線存取或保存 Google access/refresh token。
`gql`／`preview` 不開放 OAuth 路由，也不需設定上述 Google 憑證。

首次登入會以已驗證的 Google email 對照既有 User，並把 Google 的穩定識別碼 `sub`
記錄在 `googleSubject`；後續須同時符合該綁定與 User.email。
自動綁定只接受 Gmail 或帶有 `hd` 的 Google Workspace 身分。
若使用非 Workspace 的第三方 email Google 帳號，需由管理員透過可信管道確認其
Google `sub`，預先填入 `googleSubject`；不以第三方 email 的 `email_verified` 單獨授權。
User.email 必須是 Google 回傳的帳號 email，群組信箱或別名不會自動視為同一個帳號。

每個 CMS 請求都會從 User 重新載入角色與啟用狀態。停用或刪除 User、修改 email
或 Google 綁定會使原 session 失效。所有舊密碼登入 session 也會失效，需重新用 Google 登入。
密碼登入、忘記密碼與首次建立管理員的公開 API 全部移除；Keystone 原本的登出功能保留。

HTTPS 使用 `__Host-ly-budget-session` 與 `__Host-ly-budget-oauth` cookie，
皆為 Secure、HttpOnly、SameSite=Lax、Path=/，不設定 Domain；HTTP localhost
開發模式使用不同 cookie 名稱。舊 `keystonejs-session` 不再接受。
Session 與 OAuth state 的密鑰分開衍生並綁定 `CMS_ORIGIN`，state 另外綁定 Client ID。
拒絕重複 cookie、Bearer token、URL/body/header 中自行指定的 session，以及非固定 Host。
CMS 寫入請求須帶有精確的 `Origin: <CMS_ORIGIN>`；若提供 `Sec-Fetch-Site`，須為
`same-origin`。透過程式呼叫 CMS 的 POST 也必須提供正確 Origin，且仍需有效 cookie。
這些 header 是瀏覽器 CSRF 防護，不是身份憑證。

目前是 stateless session：登出清除瀏覽器 cookie，但已被複製的有效 token 在到期前
仍可能重放。需要阻斷該帳號時應維持 `isActive=false`，或輪替 `CMS_SESSION_SECRET`
使所有 session 失效。重新啟用帳號不等於永久撤銷舊 token；此版本沒有單一 session
撤銷表。各環境仍應使用不同密鑰；知道原始密鑰者仍能產生 token。
本次 review 詳見 [安全審查紀錄](docs/security-review-2026-11-25.md)。

部署前先確認至少一位 admin 的 Google email 正確，並配置 OAuth 變數。
`20261125040000_google_oauth_login` migration 會正規化 email、加入 `googleSubject`
及 `isActive`、移除 password 欄位及舊密碼雜湊；既有 User 的 ID、角色和資料關聯保留，
既有帳號預設啟用。大小寫或前後空白正規化後若有重複 email，migration 會失敗，
需先由管理員處理，不會任意合併帳號。此 migration 不適用直接回退到舊密碼登入版本。

### 安全回歸測試

在 Node 18（與目前 Dockerfile 相同）及安裝依賴後執行：

```bash
cd packages/ly-budget
yarn test:security
```

測試使用 Keystone 產出的實際 schema 與 session 加解密，涵蓋公開服務全 list
寫入阻擋、匿名 CMS 寫入阻擋、User 權限、偽造 cookie／Bearer token、密鑰輪替
與缺少安全設定時拒絕啟動，以及 CMS／唯讀模式的容器啟動流程。
另涵蓋 Google JWT 簽章／issuer／audience／到期檢查、state／nonce／PKCE、
未授權與停用帳號、首次綁定競爭、第三方 email 限制，以及舊密碼 session 失效。
另測試 cookie 注入、跨環境重放、過期、固定 session、跨來源寫入與 Keystone
實際 request context 對偽造 session 物件的處理。
測試不連線正式資料庫；縮圖、掛載和外部啟動命令以測試替身隔離。

Keystone 5.2.0 的 `context.db` 要求 schema 仍有 Mutation type，因此唯讀服務
保留唯一的 `_readOnly` 欄位；呼叫必定失敗，不執行寫入。
