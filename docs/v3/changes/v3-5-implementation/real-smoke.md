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

## 3. 最终状态

```
REAL_CLI_SMOKE   = BLOCKED_BY_RISK_CONTROL（daemon 风控暂停；实现 fail-closed 正确；等暂停过期或人工处理风控后重试）
REAL_IMAGE_SMOKE = BLOCKED_BY_USER_ACTION（需：1688 登录 profile + 前台浏览器窗口 + 首次上传激活验证；overnight 无法完成）
REAL_CONFIRM_SMOKE（预览→确认→落盘） = 单测全链覆盖（假 CLI + demo sandbox）；真实数据版本待上述解锁后补跑
REAL_AI_SMOKE    = NOT_RUN（本轮 UI 不调用真实 AI）
```

## 4. Morning Action（用户醒来后，最多 3 个动作）

1. 在测试 Chrome（专用 profile `%USERPROFILE%/.qingxuan/1688-browser-profile`）正常登录 1688（扫码），并处理任何滑块/风控验证（daemon pause 若未过期可执行 `1688 daemon reload --profile default` 或等待）。
2. 回复"继续验收"——将执行：真实关键词 smoke（1-2 次，限速）→ 真实图搜 smoke（1 张候选图）→ 真实 Preview→Confirm→Evidence 落盘验证。
3. 无需重新解释上下文；验收脚本与检查点已就绪（见 test-plan 与 final-report）。
