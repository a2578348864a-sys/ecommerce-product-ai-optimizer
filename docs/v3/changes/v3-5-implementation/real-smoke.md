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

### 3.3 真实 API 全链（search → preview → save → GET）＝ **BLOCKED_BY_RISK_CONTROL（持续）**

- 1688-cli daemon 风控升级：**每次恢复后第一次真实 search 即触发 risk_challenge**，daemon 自动暂停 10-15 分钟循环（pause until 12:10 → 12:2x → ...）。
- 实现行为正确：exit 9 + DAEMON_PAUSED → `risk_control_required`（403），无任何伪造数据。
- 判定：**外部服务风控（1688 对当前会话/IP 持续挑战），非实现代码 bug**（Spike 已记录海外 IP 风控稳定性风险）。
- 需要用户动作：在 1688 页面完成人工验证（滑块）或更换网络后重试；产品 UI 会显示"需要在 1688 页面完成验证"。

## 4. 最终状态

```
REAL_CLI_SMOKE   = PASS（1 search + 1 detail，真实数据；含 2 个真实 bug 修复）
REAL_IMAGE_SMOKE = BLOCKED_BY_USER_ACTION（需：1688 登录的持久 profile + 前台浏览器窗口；headless 撞登录墙已实测确认）
REAL_CONFIRM_SMOKE（预览→确认→落盘） = BLOCKED_BY_RISK_CONTROL（1688 持续风控；实现 fail-closed 正确；单测全链已覆盖）
REAL_AI_SMOKE    = NOT_RUN（本轮 UI 不调用真实 AI）
```

## 5. Morning Action（继续验收所需，最多 3 个动作）

1. 在 1688 页面（任意正常浏览器）完成一次人工验证/滑块，解除当前会话风控；确认后告诉我"验证完成"。
2. （图搜）在专用测试 Chrome（profile `%USERPROFILE%/.qingxuan/1688-browser-profile`）正常登录 1688，保持窗口打开（前台）。
3. 回复"继续"——将执行：真实 API 全链（search→confirm→落盘，限速）→ 真实图搜 smoke（1 张候选图）→ 全绿后 fast-forward 集成 main 并 push。
