# Listing 最终文案质量收口（factSafe & copyQuality 双门禁）— PROGRESS

## 第1轮（规则与主链）完成 2026-08-26T14:21:09.664Z

### 完成内容
1. **唯一 Claim Policy**（lib/listingHandoff/listingClaimPolicy.ts 新建）
   - 规范化：leakproof = leak-proof = leak proof；dishwasher-safe = dishwasher safe
   - 三档裁决：verified / review / prohibited + 中文原因
   - 优先级：prohibitedClaims/cannotSay 命中 → prohibited；高风险硬属性缺 explicit_high_risk 元数据 → review；其余 → verified
   - 历史 Leak Proof → prohibited（同义命中 cannotSay）或 review（缺确认元数据）
   - 读取边界 fail-closed：confirmedFacts evidenceTier=human_confirmed + sourceKind=user_confirmation → explicitHighRiskConfirmed

2. **Copy Quality 独立合同**（listingRuntimeSkill.ts validateCopyQualityContract）
   - cannot_say / self_reference / subject_object_duplicate / template_jargon / redundant_fact / role_mismatch / duplicate_shopper_need

3. **修计划与回退文案**
   - listingPlan.ts /s+/g → /[\s]+/g（真实空白折叠）
   - shopperNeed 按角色差分（ROLE_NEED_HINTS），同需求不复制多卡
   - 删除 option fits / pairs with / Available construction 模板 → 事实前置 + 多样句法（Claim Evidence 允许词）
   - 禁止 X pairs with X（copy quality self_reference 拦截）

4. **主链接线（listingGenerationService.ts）**
   - AI / structured fallback / safe fallback 三条路径全部先过 Claim Policy（factSafe）再过 Copy Quality
   - listingUnqualified 三路径设置；factSafe/copyQuality 字段透传 DraftSafeSummary
   - 事实不足 → safe_fact_draft + unqualified=true + 正式五点空（诚实"暂无合格草稿"）

5. **UI 状态收口（ListingHandoffSection.tsx）**
   - unqualified → 不显示"当前有效 Listing"（展示"暂无合格草稿"badge）
   - 三态：事实安全：通过/未通过；文案质量：通过/未通过；草稿类型：AI运营优化稿/安全事实提纲/暂无合格草稿

### 红→绿证据
- 坏稿拦截红测（integration）：Leak Proof 泄漏拦截✓、模板句拦截✓、cannotSay 同义拦截✓（3/3）
- Copy Quality 红测：好稿 ok + 坏稿全拦截（8/8 含反向3项）
- Claim Policy 红测：同义规范化/cannotSay 优先/历史高风险 review（8/8）
- listingPlan：shopperNeed 去重/同事实单卖点/needs_facts/空白修复（11/11）
- listingComposition：Schema+Claim Evidence+Runtime 合同（17/17）

### 已有数据影响
- YETI Golden Case 更新：真实功能事实仅 care → 无法组3条合格 → safe_fact_draft + unqualified（诚实行为），测试断言更新
- C2/Owala 断言更新为新自然输出

## 第2轮（浏览器闭环与收口）— 待


## 第2轮（浏览器闭环与收口）完成 2026-08-26T14:27:33.853Z

### 隔离3029浏览器验收（复制库 dev-lfc.db + Provider空key + 死端口，0付费调用）
- 重新生成 HydroJug 草稿（点击"生成 AI 优化草稿"）：Provider 失败 → 确定性回退
- 结果：**暂无合格草稿** badge（status-badge）✓；事实安全：通过 ✓；文案质量：未通过 ✓；草稿类型：暂无合格草稿 ✓
- 正式字段：无"复制完整 Listing"/"复制标题"按钮（unqualified 不渲染草稿正文）✓
- Leak Proof 只出现在事实确认区（历史值展示），未进入正式草稿字段 ✓
- pairs with / option fits / Available construction：**clean** ✓
- 1440×900：无横向溢出（sw=cw=1425）✓；390×844：无溢出（390=390）✓；暂无合格草稿显示 ✓
- console 0 error/0 warning；外部请求 0（仅 127.0.0.1:3029）✓
- 截图：3029-unqualified-1440.png / 3029-unqualified-390.png（辅证，DOM 为准）

### 质量门（最终）
- tsc：0 errors ✓
- ESLint（14 修改文件）：0 errors ✓
- git diff --check：clean ✓
- 白名单测试：**114/114 全绿（0 failed / 0 skip / 0 todo / 0 only）**；比开工基线（约 88-92）只增不减
- npm run build：exit 0 ✓（新 BUILD_ID YXWJyarXSxipzPMZZY6Vp）

### 反向验证（≥3 项，逐项通过）
1. leakproof ↔ Leak Proof 同义（claim policy hitsProhibited 拦截）✓
2. 临时恢复 pairs with 模板 → Copy Quality 红（subject_object_duplicate/template_jargon）✓
3. 复制同一 shopperNeed 到两角色 → 计划红（duplicate_shopper_need）✓
4. structured 绕过 claim policy → 主链红测（模板句拦截）✓

### 边界核验
- HEAD=40f43dca 未变；staged=0；未 push/commit/deploy
- 白名单外 68 项既有 dirty：双向相等（missing=0 extra=0）未动
- 原始 prisma/dev.db 未写（复制库 dev-lfc.db 隔离）；3005 未改（只读记录）；3029 隔离实例运行中（验证后可停）
- 未调用真实 Provider（空 key + 死端口）；0 公网请求
