# V3.5-R1 Formal Replacement — Test Plan

> §35 清单映射；自动化状态截至 2026-08-16。

## 自动化测试（37 个，全部 PASS）

### Bridge 安全集成（`lib/server/native1688Bridge.integration.test.ts`，真实 spawn）
- Manifest permission audit → 见 manifest.security.test.ts
- Bridge bind：127.0.0.1（代码级；集成测试连接 127.0.0.1）
- Token reject（无 token / wrong token → 401）✅
- Expired token：token 进程级（无 TTL；偏差文档化）✅（设计确认）
- Wrong jobId → 404 ✅
- Replay message（同 nonce → duplicate）✅
- Oversized payload → 400 ✅
- Invalid MIME → 400 ✅
- Arbitrary path attempt（无路径参数；job 绑定强校验）✅
- Unknown action → 400 ✅
- Wrong origin（客户端 token 校验）✅
- Duplicate submit → duplicate_submit（No Double Submit）✅
- 结果一次性消费 ✅

### 驱动编排错误映射（`lib/server/sourcingImageAcquisition.test.ts`，fake bridge）
- Extension disconnected（extensionSeen=false）→ EXTENSION_NOT_INSTALLED ✅
- Auth required（login_wall）✅
- Risk control（risk_control）✅
- Page identity unknown ✅
- Upload target missing（page 状态）✅
- Wrong Candidate image（Identity Proof 不匹配 → UPLOAD_NOT_CONFIRMED）✅
- Search target missing / submit fail → SEARCH_TRIGGER_NOT_CONFIRMED ✅
- Results insufficient（<3）✅
- 正常全链（候选 + trace）✅
- 错误归一化 ✅

### Manifest / 源码审计
- 无 debugger/cookies/all_urls/history/downloads/scripting ✅
- host_permissions 白名单锁定 ✅
- 正式驱动 ZERO CDP ✅
- composed:true / openOrClosedShadowRoot / data-renderkey / §38 守卫 / action allowlist / 零 eval ✅

## 真实 Smoke（待用户就绪；脚本 `lib/server/v35FormalSmoke.tmp.ts`）

1. **T-Acquire**：正式驱动图搜 → ≥3 候选（生产扩展 + 生产 bridge）
2. **T-Detail**：1688-cli 详情交叉验证（offerId/title/价格语义）
3. **T-Evidence**：route 全链 action=image → Preview → Human Confirm（save）→ sourcing-evidence.v1 → GET 读回
4. **T-Restart**：Chrome 完全重启 → 会话保持 → 再跑一张（§41）
5. **T-AB**：无扩展 / 装 idle / active 三态（§42）

## 回归

- 全量 `npm test`：4779 passed / 0 failed（release-package 环境失败与基线一致：Windows tar 中文路径，非本任务）
- tsc / lint / build：PASS
