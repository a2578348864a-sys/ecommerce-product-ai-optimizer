# P5 Content Skills & Guards — 冻结契约（Wave 0）

- executionBatch：V4-FINAL-R2-P5-20260821-2300；authorityChecksum：`848bc4f0…`
- baseCommit：`a55c205`（P4 PASS 后 main）

## 0. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | ContentHandoff（Lead 冻结）：{runId, candidateId, variant, marketplace, category, locale, factRevision, policyPackVersion, keywordRefs[], vocRefs[], referenceImages[], brandStyle?, forbidden[], createdAt}；冻结 factRevision+policyPackVersion；fact/policy 变化→handoff stale | 07、P5 卡 |
| D2 | Policy pack：versioned JSON（marketplace/category/effectiveAt/reviewedAt/sourceUrl + 规则数组：字段白名单、长度/字符限制、禁词、商标词、绝对词）；规则非永久常量；pack 过期→阻断 content 或要求确认 | 07、P5 卡 |
| D3 | Listing Skill：仅从 confirmed facts 生成 claim；每 claim 绑 factRefs；每关键词绑 evidenceRefs；竞品功能/SupplierClaim 304 不得成为自有 claim | P5 卡 |
| D4 | Deterministic Guard：长度/字符/重复/禁词/商标/引用完整性/规则版本；模型只报语义风险（无 LLM 判定唯一权威） | P5 卡 |
| D5 | ImagePlan：先计划后生成；缺真实参考图→仅拍摄清单或 Concept/Mockup（不得 Final）；Visual Fact Check 检查 identity/结构/颜色/数量/配件/尺寸文字/视觉 claim/policy/rights | P5 卡 |
| D6 | 内容人工审核：approve_export / request_revision / reject_asset；不自动发布；用户锁定字段、revision compare、局部重检 | P5 卡 |
| D7 | 禁止：竞品/VOC/SupplierClaim 生成自有 claim；复制竞品文案/图/logo/水印/商标；视觉模型判断≠真实材质/尺寸证明；单一合规分数；新增 Listing/Image Agent | P5 卡 |

## 1. 文件所有权
| Owner | 路径 |
|---|---|
| Lead | docs/v4/P5_*、lib/v4/content/handoff.ts（ContentHandoff 契约+stale）、lib/v4/content/policyPack.ts（pack 校验/过期）、graph content_handoff/content_skills/content_review 接线、app/api/v4 内容端点、UI 收口、E2E |
| A（worktree codex/v4-p5-listing） | lib/v4/content/listingSkill.ts（claims 生成器+factRefs/keywordRefs 绑定）+ lib/v4/content/complianceGuard.ts（确定性检查）+ 测试 + skills/v4/amazon-listing.md、listing-compliance.md + policy fixtures |
| B（worktree codex/v4-p5-image） | lib/v4/content/imagePlan.ts（plan 生成/拍摄清单/Concept/Mockup/Final 分级）+ lib/v4/content/visualFactCheck.ts（9 项检查）+ 测试 + skills/v4/amazon-main-image-plan.md、amazon-secondary-image-plan.md、amazon-a-plus-plan.md、visual-fact-check.md + fixtures |
| C（只读） | policy/IP/injection/视觉错误 eval 案例评审 |

## 2. 必测（Gate）
1. 竞品功能/自有 facts 无→文案图片均阻断；2. SupplierClaim 304 不得写 304；3. 错颜色/数量/虚构配件/尺寸文字错/主图违规拦截；4. policy 过期、fact revision 更新→旧资产 stale；5. 缺参考图不得 Final；6. 商标/绝对词/injection fixtures；7. 真实浏览器 Gate B→Listing/Image/Guards/人工审核/刷新。
