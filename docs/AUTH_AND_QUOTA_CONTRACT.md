# 认证、权限与 Visitor 商品体验合同

> 本文是 Owner / Visitor 隔离、会话寿命、商品名额和历史数据访问的按需契约。实现与本文不一致时，必须先区分代码缺陷、文档漂移或待批准的合同变更，不得自动放宽鉴权或配额。

## 1. 权限和数据隔离

- 内部身份仅为 `owner / demo`；对外称 Owner / Visitor。
- Owner 使用 Prisma 正式业务数据，不受 Visitor 商品名额限制。
- Visitor 仅能访问其 `demoAccessId` 对应的 sandbox 和私有资产。
- Visitor 不得读写 Owner 正式数据，也不得访问其他 Visitor 的 sandbox。
- 所有身份、主体和写权限必须在服务端校验；前端隐藏按钮、URL 参数、客户端缓存或 ID 前缀不是鉴权。
- Visitor 记录缺失、被管理员停用或主体不匹配时必须 fail-closed。

权威实现：

- 身份解析：`lib/server/accessPassword.ts`
- 短期 Session：`lib/server/accessSession.ts`
- 签名 Token：`lib/server/signedToken.ts`
- Visitor 记录：`lib/server/demoAccess.ts`
- 商品名额：`lib/server/demoProductJourneyQuota.ts`
- Visitor sandbox：`lib/server/demoSandbox.ts`
- 登录：`app/api/auth/login/route.ts`
- 商品研究：`app/api/workflows/product-analysis/route.ts`

## 2. Visitor 码寿命与登录会话

- Visitor 码不再有24小时或其他时间性过期规则。
- Visitor 码在管理员主动停用前保持可用；商品名额耗尽不等于身份失效。
- 旧记录中的 `expiresAt` 不再参与 Visitor 码鉴权，成功登录时清理为 `null`。
- 签名访问 Token 仍使用 `lib/server/signedToken.ts` 的 `ACCESS_TOKEN_TTL_MS`，当前为12小时。
- 短期内存 Session 仍保留合理 TTL；Session/Token 过期后，用户需重新输入同一 Visitor 码登录。
- 重新登录不会重置商品名额，也不得把 Token 改为永久有效。
- 代理结果缓存、run proof 或页面投影中的2小时是业务结果/凭证时长，不是 Visitor 码或登录 Token 寿命。

## 3. 五个商品完整体验名额

- 用户可见的唯一配额单位是“一个新的商品研究链”。
- 固定上限：`MAX_PRODUCT_CHAINS = 5`。
- 指标：`quotaMetric=product_journeys_v1`。
- 每个 `demoAccessId` 独立计算，不得在 Visitor 之间共享或串用。
- 稳定身份优先绑定 `candidateId`；没有 Candidate 时使用规范化商品名的哈希，不存储密码或 Token。
- 同一商品的刷新、重试、继续研究、人工决策、Creative Handoff、Listing、Image 和历史查看不得再占商品名额。
- 第6个不同商品必须在任何 Provider 启动前拒绝，中文提示为：“该访客码的 5 个商品体验名额已全部使用。”
- 名额耗尽后，已有研究、Listing、图片和历史仍可读。

## 4. reserve / commit / release

1. 新商品进入正式研究前，在同一次受控存储更新中检查容量并写入 `reserved`。
2. 研究链成功建立后转为 `committed`，永久计入已用商品。
3. Provider 未能建立研究链、run proof 失败或系统异常时转为 `released`，恢复名额。
4. 同一身份的已提交请求返回幂等重放，不再启动 Provider。
5. 同一商品不同请求在一个有效 reservation 中并发时显式冲突，不得建立第二个 slot。
6. 未完成的 reservation 有短期 lease，超时后只能恢复为 `released`；已 `committed` 的名额不会自动释放。
7. 存储缺失、损坏、状态矛盾或结算请求不匹配时 fail-closed，不猜测修复真实名额。

## 5. Listing、Image 与 Provider 成本边界

- 商品 slot 只在新研究链建立时占用。
- Creative Handoff 后的 Listing 和 Image 不调用 `reserveDemoProductJourney`，不增加 `usedProducts`。
- 已有有效 Listing/Image 默认按各自的指纹和幂等合同读取或复用。
- 商品名额不是 Provider 请求次数，不得按底层 Provider call 扣商品名额。
- `demoAccess.ts` 中的 `ai_jobs_v1 / usedAiCalls` 仅作为旧版独立 Listing Studio / Image 路径的兼容性 Provider 成本台账；它不得显示为 Visitor 商品配额，也不得换算为已用商品。
- 新创建的 Visitor 码默认不分配旧 `ai_jobs_v1` 数量。如旧路径存在无限付费重生成风险，必须单独报告和立项，不得在本合同中临时造第二套商品计费系统。

## 6. 旧 Visitor 兼容

- 迁移来源是当前 Visitor sandbox 中的不同 Candidate/Workflow Task 研究链，不是历史 Provider 请求数。
- Candidate 和 Task 有稳定绑定时按 Candidate 去重；早期 Task 没有 Candidate 绑定时，一个已持久化 workflow Task 视为一个可信商品链。
- 例：旧 Visitor 研究过2个商品、产生4次 Provider 调用，迁移后为 `usedProducts=2, remainingProducts=3`。
- 迁移是每个 `demoAccessId` 独立、幂等的。现有 sandbox 文件损坏或无法可靠读取时 fail-closed，不清零、不判定全部耗尽、不猜数。
- 迁移不删除 Visitor 原有数据。

## 7. 必须维持的测试边界

- 新 Visitor 初始5个商品，第1至5个成功，第6个在 Provider 前拒绝。
- 同商品重试/F5/继续链路不重复占位。
- 建立前系统失败 release，建立后重试复用 committed slot。
- Listing 和 Image 不增加商品名额。
- Token 仍是短期，重新登录不重置配额。
- 耗尽后历史仍可读。
- Owner 完全绕过 Visitor reservation。
- 并发请求最多只能占五个不同商品，不同 Visitor 互相隔离。
- 不得用 `skip/todo/only` 或放宽主体隔离测试使门禁通过。

真实 Provider 调用、运行数据写入、生产部署和公网验收只能在当前用户明确授权和发布门禁通过后执行。
