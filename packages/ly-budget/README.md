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
