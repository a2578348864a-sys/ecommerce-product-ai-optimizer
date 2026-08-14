# Phase 2 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目。

1. **原假设**：candidateAnalysisContext.facts 是商品指标（价格/BSR/销量）的事实源。
   **实测**：facts 是 `CandidateEvidenceReviewFactsV1` 的 pick——来源页面证据（title/priceText/hasImage 等网页语义），**不含** SellerSprite 商品指标；指标在 `sourceMeta.productBatchSnapshot.productFacts`（ProductBatchCandidateSourceV1）。
   **最终规则**：商品概览读取源 = sourceMeta.productBatchSnapshot（evidence-read-model §1 已修正）；candidateAnalysisContext 只用于研究上下文绑定。
   **证据**：lib/candidateEvidenceReview.ts（facts 类型）；save-task/route.ts:888-906（resultJson 键）。
   **失效条件**：—。
   **下一阶段加载**：Phase 5（AI Summary 输入组装）。

2. **原假设**：竞品 Evidence 需要新的 Prisma 模型。
   **实测**：任务书要求 resultJson/versioned namespace；`taskResultJsonMutation` 的 writer→namespace 所有权契约扩展只需 2 处增量（writer 类型 + OWNED_NAMESPACES），写入经 mutate 回调原子完成，天然获得乐观并发与主体分流。
   **最终规则**：任何新的小体积业务数据（< 10KB、按 task 绑定）优先走 versioned namespace 扩展，不建表（05 门槛）。
   **证据**：taskResultJsonMutation.ts:20-41（扩展点）；competitorEvidence.ts。
   **失效条件**：数据规模/查询模式超过 JSON 承载（05 合同门槛）。
   **下一阶段加载**：Phase 3/4（Reverse ASIN/Keyword Mining Evidence 存储同法）。

3. **原假设**：写入方 actor 用内部主体名（owner/demo）记录即可。
   **实测**：竞品合同要求 `mode: "owner" | "visitor"`；直接写 `context.mode`（"demo"）导致 parse 失败 → 读取侧 fail-soft 返回空列表 → 测试暴露（重复添加"成功"、上限失效）。
   **最终规则**：对外 schema 的 actor 枚举必须显式映射内部主体（demo→visitor）；fail-soft 读取会掩盖写入错误——写入路径必须被测试覆盖（去重/上限断言捕获）。
   **证据**：competitorEvidence.ts:226-236（映射）；competitorEvidence.test.ts（duplicate/cap 用例）。
   **失效条件**：—。
   **下一阶段加载**：Phase 3/4 写入合同。

4. **原假设**：component 测试需要 jsdom/testing-library。
   **实测**：项目无 testing-library 依赖（受控不允许安装）；将展示逻辑抽为**纯提取函数**（export），在 node 环境单测，组件渲染由 tsc/build/既有套件兜底。
   **最终规则**：无 UI 预览入口的项目中，展示组件 = 纯函数提取层（可测）+ 薄渲染层（tsc/build 验证）。
   **证据**：components/evidence/EvidenceWorkbench.tsx（extract* 导出）；EvidenceWorkbench.test.ts（8 用例）。
   **失效条件**：引入 testing-library 或浏览器预览入口。
   **下一阶段加载**：Phase 5/6 UI 改动沿用。

5. **原假设**：`storageVersion` 并发保护只对后端有意义。
   **实测**：竞品 UI 每次 GET 拿到 `{resultJsonHash, updatedAt}`，写入时回传；后端 `storageVersionMatches` 校验 hash+时间，过期 → 409 task_result_conflict（前端提示刷新）。测试用 stale hash 断言 409。
   **最终规则**：浏览器可提交的并发凭证 = resultJsonHash（不泄露完整 resultJson，符合既有 TaskResultJsonStorageVersionHash 契约）。
   **证据**：competitor-evidence route（storageVersion 契约）；taskResultJsonMutation.ts:163-175。
   **失效条件**：—。
   **下一阶段加载**：Phase 3/4 写入 API 沿用。

6. **原假设**：测试文件用 PowerShell 批量替换安全。
   **实测**：`Set-Content -Encoding UTF8` 写入 BOM（EF BB BF），vitest transform 直接失败（"no tests"）；write 工具重写后恢复。
   **最终规则**：测试/源文件修改一律用 write/edit 工具（UTF-8 无 BOM）；禁止 PowerShell 文本替换写代码文件。
   **证据**：competitorEvidence.test.ts BOM 事故；修复前后对比。
   **失效条件**：—。
   **下一阶段加载**：持续。

## 下一阶段是否需要加载

1/3/5 对 Phase 3/4 必载（新报告 Evidence 合同与写入链）；2 对 Phase 3/4 存储设计必载；4 对 Phase 5/6 UI 必载；6 持续。
