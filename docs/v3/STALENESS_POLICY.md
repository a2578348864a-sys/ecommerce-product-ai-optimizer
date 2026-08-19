# STALENESS_POLICY — V3 Research Staleness 触发规则

版本：v1（V3 Research Staleness UX Closure）
范围：`lib/productResearchRecord.ts`（computeResearchEvidenceHash / getResearchStaleState）

## 目标
完成研究（Research Completion Version N）后，研究资料再次变化时判定是否
`RESEARCH_STALE`。**只阻止新的 Creative Generation**；历史 Listing / Image /
Completion 全部保留可查看。判定必须避免两类误判：
1. **过度敏感**：正常市场波动 / 重复采集导致 Listing / Image 永久反复失效；
2. **漏判**：真实新证据（身份 / 规格 / 新命名空间内容）被忽略。

## 证据指纹构成
`computeResearchEvidenceHash` 对 9 个证据命名空间做 canonical hash：
`browserEvidence / reviewEvidence / vocAnalysis / sourcingEvidence / keywordEvidence /
competitorEvidence / aiEvidenceSummary / candidateAnalysisContext / factCandidates`。

## 触发规则（STALE = completion 记录指纹 ≠ 当前指纹）

### 1. DUPLICATE_EVIDENCE → NO_STALE
- `browserEvidence` 快照指纹**剥离采集元数据**：evidenceId / capturedAt / collectorVersion。
- 快照按语义归一化后**去重**（同语义快照只计一次）。
- 因此：完全相同字段值的重复保存 / 重复采集（仅元数据不同）→ 归一化数组不变 → **不触发 Stale**。
- save 层另有三键幂等（capturedAt+pageUrl+asin）保证重复保存不 append。

### 2. MARKET_OBSERVATION_VOLATILITY → NO_STALE
- `browserEvidence` 快照中的 Market Observation 字段（price / rating / reviewCount / bsr / reviews）
  在指纹中**只保留字段存在性**（值打平为 `__market_observation__`）。
- 因此：仅市场观察数值波动（如 BSR 5→4、价格小幅变化、评论数增减）→ **不触发 Stale**。
- 判定标准：只有当快照的**商品身份 / 规格证据**（asin / title / productInfo 规格行）或
  **其他命名空间**（review/voc/sourcing/keyword/competitor/aiSummary/context/factCandidates）
  的语义内容变化时，才是 MEANINGFUL_RESEARCH_CHANGE → **STALE**。

### 3. MEANINGFUL_RESEARCH_CHANGE → STALE
以下任一发生 → 指纹失配 → RESEARCH_STALE = TRUE（需重新确认研究）：
- 新增/变更商品身份或规格证据（asin / title / productInfo 规格行变化）；
- reviewEvidence / vocAnalysis / sourcingEvidence / keywordEvidence / competitorEvidence /
  aiEvidenceSummary / candidateAnalysisContext / factCandidates 任一语义内容变化；
- 新证据命名空间出现或既有命名空间消失。

## Reconfirmation（Version N+1）
用户确认「研究结论仍然有效」→ `POST /api/tasks/[id]/complete`（reconfirm 分支）：
- completion.revision N → N+1（不修改历史 Version N；旧版本快照保留在 `reconfirmedFrom`）；
- completedAt 更新为确认时间；evidenceHash 更新为当前指纹；
- 随后 RESEARCH_STALE = FALSE，CREATIVE_HANDOFF_READY = TRUE，Listing / Image 恢复可用。
- 不删除 Evidence / Fact / Human Decision；不重跑 Research Flow。

## 边界
- 旧 completion（无 evidenceHash 或旧算法 hash）：首次 reconfirm 后按新算法重算；
  当前算法变更导致的失配在 reconfirm 时收敛。
- 未完成研究（无 completion）：无 stale 语义（completed=false）。
- Gate 保留：即使前端 CTA 有 bug / 用户手输 URL，服务端 Studio Gate
  （research_stale_requires_reconfirmation）仍 fail-closed 阻止 Stale Research 生成新内容。
