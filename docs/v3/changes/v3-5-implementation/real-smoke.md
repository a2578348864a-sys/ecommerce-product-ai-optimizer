# V3.5 Implementation — Real Smoke 记录

> 合同：§61/§64/§81/§82/§83；诚实记录，不虚报。

## 1. 手动 CLI 验证（2026-08-16 05:44，真实 1688）

实现过程中为确认 1688-cli v0.1.47 真实输出结构（normalize 依据），直接调用 TEMP 安装的 CLI：
- `whoami --json` → `{"loggedIn":true,...}`（session 复用，账号标识不入文档）
- `search "保温杯" --max 3 --json` → 3 条真实候选（结构同 Spike Route B 实测）
- `offer 930374004918 --json` → 完整详情（displayedPrice ¥21.30 vs priceTiers ¥16.5 差异复现）

**说明**：这是输出结构确认（spike 证据延续），**不是实现代码的 smoke**（§61：已有 Spike 真实证据不能冒充新 Implementation smoke）。

## 2. 实现代码真实 smoke（2026-08-16 05:59）

临时 vitest 用例调用正式实现（`searchOffersByKeyword` + `getOfferDetailById`，env V35_1688_CLI_PATH → TEMP CLI）：
- 结果：`1688-cli search 失败（exit 9）`，JSON 信封 `{ok:false,code:"DAEMON_PAUSED",message:"Daemon for profile default is paused until 2026-08-15T22:10:23.688Z after repeated 1688 failures.",failureKind:"risk_challenge",recoveryAction:"pause_for_manual_challenge"}`。
- 根因：**1688-cli daemon 因风控被自动暂停**（此前的多次调用触发 risk_challenge；pause 到 2026-08-15T22:10:23Z ≈ 北京 08-16 06:10）。
- **判定：外部服务风控暂停阻塞，非实现代码 bug**（exit 9 正确 fail-closed，未返回任何伪造数据）。
- **实现改进（已落地）**：driver 增加失败信封解析——exit≠0 且 `DAEMON_PAUSED`/risk 语义 → `risk_control_required`（403）+ 单测覆盖。

## 3. 验收阶段（2026-08-16 用户"继续验收"后）

### 3.1 真实关键词 smoke（实现代码）＝ **PASS**（1 次 search + 1 次 detail）

- `searchOffersByKeyword("保温杯")`：候选 >0，offerId/来源/PII 零泄漏断言通过。
- `getOfferDetailById` 交叉验证：**发现真实 bug** —— offer 674035283676 有 **128 个 SKU**（颜色×容量组合），原 SKU 上限 100 误拒绝合法 offer → 已修复（上限 500，commit d333fde）。
- 价格语义实测复现：详情显示价 ¥21.30 vs 阶梯价 ¥16.5（displayedPrice/priceTiers 分离生效）。

### 3.2 图搜环境探测（headless，能力验证）＝ 部分 PASS

- 真实启动专用 profile Chrome（headless）→ 导航 s.1688.com：**发现真实 bug** —— `Page.navigate` 返回 -32601：`PersistentBrowserSession.send` 未绑定 page target session，Page/DOM/Input 域命令发到了浏览器根 session → 已修复（send 默认 page session + sendRoot 显式浏览器域，commit 1579918）。
- 修复后导航成功（HREF=https://s.1688.com/...）；**headless 匿名会话撞 1688 登录墙**（login.taobao.com，与 Spike Route B 一致）→ 图搜真实 smoke 确认需要用户登录的持久 profile（前台窗口）。

### 3.3 图搜真实 smoke（2026-08-16 用户登录后）＝ **BLOCKED_BY_RISK_CONTROL（浏览器特征风控）**

- 用户已在**纯净窗口**（无调试端口）成功登录 1688；专用 profile 登录态可用。
- 驱动 attach/launch 调试端口窗口 → 导航 `offer_search.html` 上传页：**上传入口 proof 正常（found=true, y=109, unique=true）**；DataTransfer 注入（files 原型 setter）→ **1688 上传预览确认**（spike A.1 路径复现成功）。
- **但调试特征窗口触发 1688 持续风控：滑块验证必失败**（用户人工多次尝试 + 刷新均无法通过；同 IP 同账号在纯净窗口可正常登录/刷新）→ 图搜页被验证墙拦截，`upload_target_not_found`。
- 判定：**外部风控（1688 识别自动化调试浏览器特征），非实现代码 bug**；上传/提取机制已实测可行，解锁后即可跑通完整链。
- 解锁条件（任一）：风控冷却 / 换网络或 IP / 换账号；或正式评估最小专用 Extension 路径（Spike A.3 证明正常 Chrome + 扩展可绕过该检测，需 Contract 决策）。

### 3.4 上传注入实测（2026-08-16）＝ **可行**

- `HTMLInputElement.files` 原型 setter + DataTransfer + dispatch change → 1688 页面上传预览出现（tiny 1x1 PNG 与真实 76KB 主图均确认）。直接赋值 `input.files = dt.files` 会被静默忽略（只读属性）——已用 setter 修复。
- 导航 URL 必须为 `https://s.1688.com/selloffer/offer_search.html`（裸域根页无 `input#img-search-upload`）。

## 4. 最终状态

```
REAL_CLI_SMOKE   = PASS（1 search + 1 detail，真实数据；含 2 个真实 bug 修复）
REAL_IMAGE_SMOKE = BLOCKED_BY_RISK_CONTROL（调试浏览器特征被 1688 风控标记，滑块验证必失败；
                  上传注入机制已实测可行；解锁条件见 3.3）
REAL_CONFIRM_SMOKE（预览→确认→落盘） = PASS（真实 search → preview → save → GET 落盘；详情补全遇风控时降级）
REAL_AI_SMOKE    = NOT_RUN（本轮 UI 不调用真实 AI）
```

## 5. 下一步（不再需要用户反复操作滑块）

1. 风控冷却（数小时~数天）或更换网络/账号后，回复"继续图搜"即可重测完整图搜链（代码已就绪，上传注入实测可行）。
2. 或正式决策是否评估"最小专用 Extension"路径（新权限面，需 Contract 授权）。
3. V3.5 其余交付已完成并集成（关键词链 + 确认落盘链 PASS，main == origin/main）。
