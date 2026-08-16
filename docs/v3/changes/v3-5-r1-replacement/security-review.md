# V3.5-R1 Formal Replacement — Security Review

> §47 清单逐项；状态：代码审计完成，真实 A/B 验证待用户就绪后执行。

## 1. Extension 权限（§9/§36）

- `permissions: []`（空）；`host_permissions`: 仅 `s.1688.com/*`、`air.1688.com/*`。
- 无 debugger / cookies / history / downloads / scripting / `<all_urls>`（`manifest.security.test.ts` 自动锁定）。
- content_scripts 静态声明（无需 scripting 权限）；background 仅 service-worker.js。

## 2. Localhost 暴露（§76/§12）

- Bridge 仅 `127.0.0.1:53318` 监听（代码硬编码 HOST；无 0.0.0.0 路径）。
- 轻选↔bridge：256bit `--token`（x-bridge-token header；启动参数，内存持有）。
- SW 通道（pending-command/results）：无 token（loopback + 128bit jobId + 一次性消费 + TTL 10min）。
  **已知偏差（文档化）**：本机进程可轮询 SW 通道；威胁与"本机进程可读用户文件"等价；正式升级路径 = Native Messaging（DEFERRED，Contract §11）。

## 3. Replay / 幂等（§31/§32）

- command nonce 去重（`cmd:{nonce}`）；结果回报 nonce 去重（`result:{nonce}`）。
- submit phase 门禁：每 job 只执行一次（duplicate_submit fail-closed，绝不二次点击）。
- 集成测试覆盖：duplicate submit / duplicate nonce / 结果一次性消费。

## 4. 任意文件读取 / 任意脚本 / 任意 URL / 任意命令

- 图片仅来自轻选注册 job（base64 内联命令；MIME 允许集 + ≤30MB；taskId/candidateId/sha256 imageHash 绑定）——无任意路径参数（§13）。
- 命令 action allowlist（getState/upload/submit/collect）；未知 action → 400 invalid_command（测试覆盖）。
- 扩展无 eval/无任意 selector/无任意 URL（invariants 测试锁定）。
- 服务端 acquireByImage 图片来源仅 imageUrl（SSRF 守卫）或 localImagePath（用户明确选择）。

## 5. XSS / 消息注入（§29）

- typed message + version + jobId + action allowlist；未知 → reject。
- 1688 页面文本（title/price 等）作为数据传给服务端 → 仅进入 AcquisitionCandidate 字段；不进 HTML（UI 组件 React 转义）不进 AI prompt（无 AI 路径）。

## 6. PII / Secrets

- 日志不落 cookie/token/QR/路径；仅 jobId/status/timing/error code（§34）。
- 不读取 chrome.cookies；登录态只属于 Chrome（§10）。
- secret scan：origin/main..HEAD 零匹配。

## 7. Stale Job / Wrong Actor（§48）

- job 绑定 taskId/candidateId（route 层由当前认证主体派生）；bridge job TTL 10min。
- Preview Store 沿用 subjectKey+taskId 绑定（V3.5 既有）；image 结果只回到创建 job 的 actor 会话。

## 8. Tab 绑定 / 恶意页面文本

- SW 按 URL 匹配 s.1688.com/air.1688.com tab（host permission 限定）；不向其他页面注入。
- 页面内容仅作候选数据；collect 仅 result_page + resultsReady 才执行（§38 守卫，推荐流拒绝）。

## 9. 真实 A/B 验证（§42/§42.7，待执行）

```
A. 普通 Chrome 无扩展：登录/刷新正常（R1 已证）
B. 装扩展、idle（不触发）：登录/刷新正常（R1 已证 T1-B）
C. 扩展正式工作（图搜执行）：无风控（R1 FULL PASS；正式版 smoke 待跑）
若正式版 active 后稳定无限风控 → NOT_ADOPTED（不修改反检测，直接降级）
```

## 10. 结论

代码层安全审计：**PASS**（自动化测试锁定 + 手工逐项核对）。
真实 A/B 与全链 smoke：**待用户就绪后执行**（PENDING_USER_ACTION）。
