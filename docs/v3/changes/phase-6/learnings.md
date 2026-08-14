# Phase 6 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目。

1. **原假设**：Phase 6 旧链收口需要删除旧 API。
   **实测**：Phase 0 裁定「停止新入口 + 退役候选」在 Phase 0 盘点时已全部生效（孤儿组件 10/11 无页面 import）；API 保留兼容不扩展是既有外部契约（AGENTS.md Route 契约不批量改写）。
   **最终规则**：旧链收口 = 审计确认裁定已生效 + 文档化 + 风险关闭，不删除 API（避免破坏契约与旧调用方）。
   **证据**：Phase 6 收口审计表（grep 页面 import 计数）。
   **失效条件**：用户明确要求下线旧 API。
   **下一阶段加载**：V3.x 或运维专项。

2. **原假设**：风险 #4（category_current 硬编码）需要改 lib/server 修复。
   **实测**：主链（批次链）的候选源是 product-batch-candidate-source.v1（**动态 reportType，无硬编码**）——CC 走批次链的裁定在 Phase 1 已落实；硬编码只存在于旧 sellersprite-import 链（已停新入口）。
   **最终规则**：风险关闭以「主链正确 + 旧链停用」为裁定依据，不修无生产调用的旧路径。
   **证据**：productBatchCandidateSource.ts（动态 reportType）；sellerSpriteImportContract.ts:201（旧链硬编码）。
   **失效条件**：旧链被重新启用。
   **下一阶段加载**：无需。

3. **原假设**：Studio 的 real AI gate 需要重新验证才能确认有效。
   **实测**：listing-studio route 有 confirmRealAi + isRealAiListingEnabled 双重检查（:102-106）、image-studio 有 isRealAiImageEnabled（:87）；Listing claims 有保守正向放行 + prohibitedClaims 排除；Image 有 needs_human_review/approved/rejected 复核态。
   **最终规则**：Studio「不重建只验证」= 核对代码证据 + 测试覆盖确认，无需改动。
   **证据**：route/gate/claimEvidenceResolver/aiImageDraft.ts 行号。
   **失效条件**：—。
   **下一阶段加载**：无需。

4. **原假设**：9 步 Core Smoke 必须全部在页面人工执行。
   **实测**：每步都有既有/新增自动化测试覆盖（Product Search 导入 16 用例、Workbench 8、Keyword 9、AI Summary 6、Handoff 404 等）；页面人工 smoke 需要访问密码（用户执行），步骤已文档化。
   **最终规则**：Smoke = 自动化矩阵（回归证据）+ 人工页面步骤（门禁时执行）；两者互补，不互相替代。
   **证据**：validation.md §3 矩阵。
   **失效条件**：—。
   **下一阶段加载**：Release R1 前全量人工 smoke。

5. **原假设**：V3_CORE = DONE 后可以顺手处理残留风险（#7/#8/#14）。
   **实测**：00_MASTER_EXECUTION.md §7 要求 Core 完成即强制暂停（V3X_AUTHORIZATION_REQUIRED），残留风险属于 Studio 专项/产品决策（#8 owner-only 需产品确认）——Core 暂停点前不得继续扩大范围。
   **最终规则**：残留风险保留登记（CURRENT_WORK），暂停点后由用户授权处理；不因"顺手"扩大 Core 范围。
   **证据**：validation.md §4 风险表（保留登记项）。
   **失效条件**：用户授权 V3.x 或专项。
   **下一阶段加载**：V3.x / 专项。

## 下一阶段是否需要加载

V3_CORE = DONE 强制暂停；后续 V3.x（若授权）加载 1/5（旧链与暂停纪律）；2/3 无需。
