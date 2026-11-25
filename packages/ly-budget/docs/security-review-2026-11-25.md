# Google OAuth / CMS session 安全審查

日期：2026-11-25。範圍：`packages/ly-budget` 本次尚未提交的 OAuth、User、session、啟動與 migration 修改。
採原始碼檢查及本機攻擊案例測試；沒有對正式環境進行滲透測試或部署。

## 結論

修正三類條件式風險；33 項回歸測試通過。已測案例未找到可由未驗證的
header、URL、body、session 物件或偽造 cookie 取得 CMS 權限的路徑。
不能將此結論解讀為「有效 cookie 被竊取後也無法重放」；stateless session 的
登出撤銷限制仍存在，列於下方。

## 發現及修正

| 風險 | 修正前條件與影響 | 處理 |
| --- | --- | --- |
| 中：cookie 注入／同名 cookie 歧義 | 原本 session 與 OAuth state 使用一般 cookie 名稱。若攻擊者控制同一可註冊網域下的子網域，可嘗試植入父網域同名 cookie；一般 parser 選第一份。此情境可能造成登入身分混淆，並不代表能任意偽造 admin 簽章。 | HTTPS 改用 `__Host-ly-budget-session`、`__Host-ly-budget-oauth`；Secure、HttpOnly、Path=/、無 Domain。重複 cookie 一律拒絕，不依順序挑選。HTTP localhost 使用獨立名稱。 |
| 中：session／state 未隔離環境 | 原本若 dev/prod 共用密鑰且 User 身分資料相符，同一個有效 session 可在不同 CMS 驗證；OAuth state 也未綁定 origin/client。 | Session 密鑰依用途及 `CMS_ORIGIN` 衍生，payload 驗證 audience；state 另綁定 Google Client ID。各環境仍須使用不同原始密鑰，這不是密鑰洩漏後的保護。 |
| 中：缺少精確 Origin 檢查 | 原本只用 SameSite=Lax，無法單靠它區分同站的不同子網域；是否可達 GraphQL 寫入還受 CORS、內容類型及 Apollo 防護影響。 | 取得 session 時檢查固定 Host。POST 等非安全方法必須具有精確 CMS Origin；有 Sec-Fetch-Site 時必須為 same-origin。登出也檢查來源。不信任 X-Forwarded-Host。 |

相關實作：`auth-cookies.ts`、`session.ts`、`google-auth.ts`、`security-config.ts`。
Session 的加解密與訊息驗證沿用 `@hapi/iron`；沒有自製加密演算法。

## 已確認的認證與授權邊界

- 只有 Google code exchange 成功且 ID token 的簽章、issuer、audience、期限、nonce、verified email 通過後，才進入 User 對照並簽發 session。
- state、nonce 與 PKCE 防止替換 OAuth 回呼。Client 直接提供 id_token 或 session 參數不能取代 code exchange。
- 不自動建立 User；首次自動綁定限 Google 能證明 email 現行所有權的 Gmail／Workspace 帳號，第三方 email 必須預先綁定 sub。
- Session 只從指定 cookie 讀取。拒絕 Authorization（包含 Bearer），不採用自訂 header、query、body 或 req.session 提供的身分。
- 每次登入產生新的加密 session，不延用傳入 token。簽發只保存白名單身分欄位；角色不從 cookie 取用。
- 每次請求重新讀取 User 的 email、Google sub、isActive、role；停用、刪除或身分資料變更立即阻擋後續請求。
- User 的角色、啟用狀態、登入 email 與 Google 綁定只能由 admin 修改；既有 User 操作的角色／資料列限制保留。
- 公開 gql／preview 不開放 User、session、OAuth 或資料寫入；CMS 移除密碼登入與首次建帳 mutation。
- Runtime 憑證檢查在 migration 之前執行；migration 不合併重複 email，不重建 User ID 或資料關聯。

## 未消除的風險與驗證限制

**中：已竊取的有效 session 在登出後仍可能重放。** 本機重現確認：登出後複製的
cookie 仍可使用；維持 User.isActive=false 時則拒絕。現在沒有 server-side session
登錄或單一 session 撤銷功能。重新啟用 User 可能讓未到期的舊 token 再次有效。
需要永久撤銷所有既有 session 時可輪替 CMS_SESSION_SECRET；要支援逐一撤銷及
登出即失效，後續應改用 server-side session registry。沒有把這個限制列為已修復。

Origin、Host 及 Fetch Metadata 檢查是防瀏覽器 CSRF；非瀏覽器可自行設定這些
header，它們不能證明使用者身分。取得有效 cookie、密鑰，或能在 CMS 同源執行
惡意程式的攻擊者，超出單靠 token 格式與 cookie 屬性能防止的範圍。

本次未連線 Google 真實帳號或正式 DB，未在瀏覽器與 Cloud Run 代理上完成登入
端到端測試。Cookie prefix 的測試檢查正確的 Set-Cookie 屬性與伺服器拒絕行為，
不是瀏覽器 cookie jar 的實際攻擊演練。尚未部署，正式環境仍須上線後驗證。

完整建置的既有阻擋仍是本機 sharp 原生套件缺失；TypeScript 檢查仍有 Budget、
Meeting、Proposal 三個既存型別錯誤，本次 auth 修改沒有新增型別錯誤。

## 驗證紀錄

Node 18 執行 `node --test tests/security.test.cjs tests/startup.test.cjs tests/google-auth.test.cjs`：33/33 通過。
涵蓋 token 偽造／竄改、舊 cookie、重複 cookie、替代 token 輸入、跨環境、期限、
固定 session、Google JWT 驗證、OAuth state／nonce／PKCE、User 權限與公開唯讀模式。
另以實際 Keystone request context 執行注入案例，確認 updateUser 在到達 DB 前被拒絕。
`git diff --check` 通過。

## 參考

- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention：Origin 與 Host cookie prefix](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Google：Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
