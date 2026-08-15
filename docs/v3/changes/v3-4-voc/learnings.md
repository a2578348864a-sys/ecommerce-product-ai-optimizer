# V3.4 — Learnings

> 每条可被代码/测试/样本证明；禁止泛泛而谈。

1. **原假设**：Amazon 评论页（/product-reviews/）可公开访问。
   **实测**：当前环境重定向到登录墙（`/ap/signin`，诊断文件 review-page-diag.txt）。
   **最终规则**：评论页需登录 → 不绕过；VOC 数据来源降级为「人工导入 + 详情页公开 Top Reviews 片段」。
   **证据**：诊断测试输出 + walkthrough-result.json。
   **失效条件**：Amazon 改变评论页访问策略（如公开）。
   **下一阶段**：V3.4 保持此降级；若未来需要完整正文，单独评估 human-assisted 评论页采集授权。

2. **原假设**：详情页 Top Reviews 的正文可通过 DOM 提取。
   **实测**：正文折叠为 "Brief content visible, double tap to read full content"（懒加载/交互展开），DOM 不可直接读取。
   **最终规则**：详情页片段只取真实可见字段（星级/日期/标题）；正文不可得时如实记录为已知限制，不猜不补。
   **证据**：v3-4-diag 探测（review-page-diag.txt）。
   **失效条件**：Amazon 渲染完整正文或提供公开 API。
   **下一阶段**：若正文成为硬需求，需登录态或官方 API 评估（本 Phase 不做）。

3. **原假设**：AI 输出的 reviewCount 可以直接信任。
   **实测**：LLM 数量会漂移（Golden 设计中已预判）。
   **最终规则**：LLM 只输出 evidenceRefs；reviewCount/coverage/strength/sourceProductRoles 全部服务端按 refs 计算（vocAnalysis.finalizeTheme）。
   **证据**：vocAnalysis.test.ts（finalizeTheme deterministic 断言）。
   **失效条件**：refs 与评论一对多/多对一语义改变。
   **下一阶段**：保持。

4. **原假设**：无证据主题可以"删掉坏引用后继续输出"。
   **实测**：validateVocOutput 中无效引用被过滤后，若 refs 为空 → 主题整体拒绝（进 unverified），不降级输出。
   **最终规则**：evidenceRefs 硬门禁（contract §4.2）。
   **证据**：vocAnalysis.test.ts "drops refs... allBad → theme rejected"。
   **失效条件**：产品要求"软提示"模式（需重新设计合同）。
   **下一阶段**：保持。

5. **原假设**：功能 worktree 可执行真实 AI Smoke。
   **实测**：worktree 不复制 .env*（AGENTS.md），无 AI 密钥；callAiJson 无法真实调用。
   **最终规则**：AI 链路由 mock callAiJson 的 route 测试 + Golden Eval 覆盖；真实 AI Smoke 必须在集成树（有密钥）执行。
   **证据**：route.test.ts（mock aiClient.callAiJson 走真实 analyzeVoc 保存链路）。
   **失效条件**：集成树密钥环境不可用。
   **下一阶段**：集成前在集成树跑一次真实 analyze 验证（任务书三十一节"一次真实 AI Smoke 证明合同"）。

6. **原假设**：VOC 主题文本中出现注入内容 = 失败。
   **实测**：AI 可能把评论中的 "ignore previous instructions" 原样写入主题 label（文本），但无任何执行路径（无 tool/浏览器/文件/secret）；React 默认转义展示。
   **最终规则**：隔离目标是"无执行权 + 结构白名单不变"，不是"文本不含注入串"。
   **证据**：Golden G4 测试（结构无 executeCommand/sendSecret 字段；注入文本仅作纯文本）。
   **失效条件**：未来引入执行性渲染（iframe/HTML 渲染）需重新评估。
   **下一阶段**：保持纯文本渲染。

7. **原假设**：Top Reviews 样本天然均衡（有高星有低星）。
   **实测**：走查 29 条中 28 条 5 星（Top Reviews 机制偏向高星）——单边样本风险真实存在。
   **最终规则**：UI 对 positive-only / negative-only 样本显式提示（positiveBiased / negativeBiased）；不做"假装均衡"。
   **证据**：VocEvidenceSection 单边提示 + 组件测试。
   **失效条件**：无。
   **下一阶段**：保持；若用户需要低星样本，人工导入低星评论即可（UI 会如实标注）。

8. **原假设**：Set-Content 修复文本文件是安全的。
   **实测**：PowerShell `Set-Content -NoNewline` 用默认编码写坏 UTF-8 文件（VocEvidenceSection.tsx 被写成 UTF-16 半损坏），tsc 报 "File appears to be binary"。
   **最终规则**：文件写入一律用 write 工具（UTF-8 明确）；PowerShell 只读操作文件内容。
   **证据**：本阶段事故与重建（文件恢复自 write 全量重建）。
   **失效条件**：无。
   **下一阶段**：保持（避免 PowerShell 写代码文件）。
