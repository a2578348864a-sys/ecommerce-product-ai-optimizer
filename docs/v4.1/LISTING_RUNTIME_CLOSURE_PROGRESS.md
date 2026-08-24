# LISTING_RUNTIME_CLOSURE PROGRESS

## 任务 0（完成）
- HEAD a0bf847（与任务书一致）；staged 空；dirty 60（任务书参考 66——实测无路径丢失/新增，记录差异）。
- dev.db 开工 SHA = 53323df3807426c59764e7ae15fe8fcf876691919812559a90c16b0c7665e5f3（结束一致）。
- 缺陷复现：cmt0lmsqa safe_fact_draft（providerAttempted=true/Succeeded=false/fallbackApplied=true）；五点 2/1/2/2/5 碎片；标题/关键词双品牌；描述碎片拼接。
- 基线 8 文件 / 52 tests 全绿。

## 任务 1-2（完成：红灯→实现）
- 新增 listingRuntimeSkill（版本标记/ Prompt 规则/质量合同 3-5 条·8-30 词·完整句·逐条事实锚点·标题品牌单次·关键词保序去重·描述 2-4 句·多样性≤0.75·描述≤0.85 重叠；安全兜底模板句；RUNTIME_QUALITY_LIMITS）。
- taskLinkedAiListing 直接 import 并用 buildRuntimePromptRules 组装 Prompt（LISTING_RUNTIME_RULES_START/END + 版本标记），保留旧 JSON 合同规则。
- 新增行为测试 12 条（skill 9 + 链路/提示词 3），首批红灯 27+ 条（真实缺陷），逐步修绿。

## 任务 3（完成）
- 删除“原始事实值+句号”五点兜底：composeBullets/composeOptimizedBullets/composeDescription/composeOptimizedDescription 统一走 Skill 安全模板（值+允许连接词），碎片不再进入任何 draft。
- 兜底先过同一质量合同与 Claim Evidence；质量不达标 → safe_fact_draft + rejectedListingSentences（≤5，中文原因）+ listingUnqualified；draftSafeSummary 对历史/既有快照同样派生不合格态。
- UI：listingUnqualified → 「暂无合格草稿」+ 逐条被拒句子与中文原因（data-testid=unqualified-listing-draft），不渲染碎片正文。
- Claim Evidence / 事实门禁未放宽（验证器与 resolver 只读未改）。

## 任务 4（完成/如实分类）
- 定向套件 9 文件 / 64 tests / 0 failed / 0 skip（基线 52 + 12 新增）。
- tsc --noEmit --pretty false：0；eslint（11 改动文件）：0 problems；git diff --check：clean；npm run build：✓ Compiled 14.3s / TS 5.5s。
- npm run test（全量一次）：11 failed | 6180 passed | 89 skipped。分类：
  * 既有 R1-R4 6-7 项（native1688Bridge / phase3ResearchHistory / productUiPolish / WorkspaceSidebar×2 / navigationAudit / CreativeHandoffPanel）——非本候选；
  * 候选语义演进 5 项（englishOnlyContract EN-3、v2214Closure ×3、yetiGoldenCase ×1）——这些非白名单测试文件仍以旧格式 mock/旧碎片断言（如 description 含 convenient carry loop、draftKind=ai_optimized_listing 配旧碎片 fixture），属被本任务取代的旧行为；受白名单限制未改其断言（禁止删测/放宽/刷绿），需后续归口更新。
- 浏览器（新构建…listing-studio?taskId=cmt0lmsqa… 1440×900 & 390×844）：unqualified=true、5 条被拒原因、暂无合格草稿、碎片仅出现在被拒列表（未作正式 Listing）、无横向滚动（1425/390）、console 0 error/0 warning、WRITES=[]（零写请求）。
- 反向验证：①断开 Skill import → Prompt 测试红（1 failed）→ 恢复绿 ✓；②恢复碎片兜底 → C2/malformed/timeout/R1.9 4 项红 → 恢复绿 ✓；③放宽 Claim Evidence（仅消费者侧临时覆盖：tier/claimsAcceptable/合同绕过）→ 对应门禁测试未变红（多层门禁：filterListingClaims+Schema≥3 拦截），Claim Evidence 归因无法在不改只读 resolver 的前提下单独剥离——如实记录，未做白名单外修改。

## 遗留风险
- v2214/englishOnly/yeti 等非白名单测试的旧断言待尾随更新（旧 mock 输出格式）。
- 安全模板文案（“with X for everyday use”）自然度有限（Claim 词库限制）；AI 路径提供自然文案。