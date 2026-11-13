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

- `ACCESS_CONTROL_STRATEGY=cms`：保留 CMS 登入及依角色授權的寫入。
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

1. 保存事件紀錄及受影響資料的快照；檢查 User 的新增帳號、角色、email 和密碼是否遭修改。
2. 為 CMS 設定新的 `CMS_SESSION_SECRET`，重新部署 CMS 與公開 gql／preview，移除舊 revision 的流量與可直接存取的標籤網址。
3. 確認公開查詢正常，所有資料 mutations、User 查詢及登入 mutation 均遭拒絕；舊 cookie／token 不能登入 CMS。
4. 原本由公開 gql 寫入辨識結果的程式，必須改用受驗證的 CMS 入口及必要角色。

只有 admin 能修改 `role`、`isProtected`。Editor 只能修改自己的 User（以 ID
判斷）；moderator 不能修改 admin 或受保護帳號。Moderator 建立帳號時省略 role，
新帳號預設 contributor，再由 admin 授權。公開首次建帳功能已移除；新的空資料庫
需透過受控的管理程序建立第一位管理員。

共用映像在建置時產生 CMS schema。`run.sh` 只在 `cms` 模式執行 migration；
`gql`／`preview` 直接以各自的唯讀設定啟動，不執行資料庫遷移，也不需要 session
密鑰。部署順序應先 CMS、再公開服務，讓 CMS 先完成資料庫遷移。
不要在公開服務啟動時執行 `keystone prisma migrate deploy`：Keystone 會檢查
建置時的 CMS schema，與執行時的唯讀 schema 不同而拒絕啟動。

可另外為公開 gql 配置只具 SELECT 權限的資料庫帳號，增加資料庫層的限制。
本次程式修正不會自行修改正式資料庫權限或密鑰。

### 安全回歸測試

在 Node 18（與目前 Dockerfile 相同）及安裝依賴後執行：

```bash
cd packages/ly-budget
yarn test:security
```

測試使用 Keystone 產出的實際 schema 與 session 加解密，涵蓋公開服務全 list
寫入阻擋、匿名 CMS 寫入阻擋、User 權限、偽造 cookie／Bearer token、密鑰輪替
與缺少安全設定時拒絕啟動，以及 CMS／唯讀模式的容器啟動流程。
測試不連線正式資料庫；縮圖、掛載和外部啟動命令以測試替身隔離。

Keystone 5.2.0 的 `context.db` 要求 schema 仍有 Mutation type，因此唯讀服務
保留唯一的 `_readOnly` 欄位；呼叫必定失敗，不執行寫入。
