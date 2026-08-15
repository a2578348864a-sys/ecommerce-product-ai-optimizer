# V3.5 — 1688 Sourcing Evidence Value Assessment 最终报告

> **Historical（2026-08-15 初始价值评估阶段）**：本文件为 V3.5 早期评估证据；与后续 Acquisition Spike 及最终结论如有出入，以 `docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md` 为准（Supersession 规则见 Contract §41）。
>
> 状态：**V3_5_VALUE = NARROW_APPROVAL**（评估结论；待用户独立审查）｜ **V3_5_ASSESSMENT = DONE**

## 第一句话（大白话回答）

**1688 这一块值得做，但只值得做"供应线索整理"，不值得做"供应商推荐/自动找货/利润计算"**——因为当前环境下 1688 页面强制登录墙（自动抓不了），且页面上的价格、MOQ、材质、认证都不能当事实；能安全做的是：用户把 1688 页面信息贴进来，系统帮他整理成"页面显示什么、哪里像、哪里不确定、下一步问供应商什么"。

## 36 项报告

| # | 项目 | 结论 |
|---|---|---|
| 1 | 1688 应该解决什么问题 | 供应线索整理：候选页面快照 + 匹配证据 + unknowns + 询盘问题清单 |
| 2 | 不应该解决什么 | 自动找货/供应商推荐/利润/合规/采购判断 |
| 3 | 3-5 个真实案例结果 | 3 案例工作流演练（Case A 高度相似→likely_similar；B 图片相似容量不同→partial_match；C 信息不足→likely_similar）；1688 侧为人工导入演练（登录墙无法自动实测，如实标注） |
| 4 | 真实页面可稳定取得哪些字段 | URL/offerId/店铺名/标题/价格展示/区间/阶梯价/MOQ 展示/SKU/尺寸/重量/包装/颜色/发货地/销量展示（CONDITIONAL，展示层可靠） |
| 5 | 哪些字段只能做 Seller Claim | 材质/定制/代发/供应商类型/认证 |
| 6 | 哪些字段无法可靠取得 | 页面更新时间（常缺）；真实采购成交价/国际物流/出口适用性（本质不可得） |
| 7 | 页面价格到底能不能当成本 | **不能**（"¥x 起"/区间/促销/登录价并存；displayedPrice 三态保存，禁止当采购成本） |
| 8 | MOQ 能否可靠理解 | **不能安全归一化**（单 SKU/混批/定制口径不明）；保留 displayedMOQ 原文 + 语义标注 |
| 9 | 规格匹配能做到什么程度 | 只到"证据清单 + 五态结论"（exact/likely_similar/partial/different/unknown）；关键规格缺失→unknown |
| 10 | 图片相似的风险 | 高（≠同款）；图片仅作展示参考 |
| 11 | 同款判断边界 | 形态+功能一致且关键规格确认才可能 exact；否则降级；无 AI 概率 |
| 12 | 供应商信息有什么价值 | 仅"平台显示 XXX 标记"（Platform Metadata 展示） |
| 13 | 哪些供应商指标不能证明可靠性 | 评分/店铺年限/销量/认证图片/厂家标签（badge→可靠推导禁止） |
| 14 | 登录/CAPTCHA 情况 | **实测：1688 搜索页强制登录墙**（login.taobao.com 重定向，5 跳）；不绕过 |
| 15 | Browser 自动化是否值得 | **不值得当前做**（登录墙）；人工粘贴为首选 |
| 16 | 是否需要 Extension | **否** |
| 17 | 是否需要 API | 官方 API 门槛高（企业资质）；第三方商业服务成本/合规待评估 → LATER |
| 18 | 是否需要图片搜同款 | **否**（任务书二十六节禁止实施） |
| 19 | 是否需要 AI | 可选（解释/差异提取/询盘问题生成），非必需 |
| 20 | AI 应该做什么 | 中文页面解释/多候选差异/unknown 解释/待确认问题/已有证据总结（白名单） |
| 21 | AI 不应该做什么 | 宣称可靠/同款/成本/利润/出口/合规/推荐采购 |
| 22 | 用户下一步询盘问题是否有价值 | **有价值**（Question Generation，非自动联系；案例自然产出） |
| 23 | 是否能算真实采购成本 | **否**（页面价≠成本；需询盘+物流+税+损耗等） |
| 24 | 是否能算真实利润 | **否** |
| 25 | PROFIT_MODULE 结论 | **ASSUMPTION_ONLY（Calculator）**：仅用户手工输入假设的计算器，标注非真实数据；禁止 AI 利润预测 |
| 26 | 小白是否能看懂 | **能（设计验证）**：匹配证据 ✓/✗/?、页面价原文、Seller Claim 角标、unknowns、询问清单；无"评分 89"形态 |
| 27 | 推荐 UI 形态 | Evidence Workbench「供应线索」区：候选卡片（页面价/起批/规格/相似点/不同点/未确认）+ "为什么不能算利润"说明 + 下一步询问清单；Evidence Matrix 对比（标注非推荐） |
| 28 | 推荐 Evidence Contract | sourcing-evidence.v1（recommended-contract.md：五态匹配、三态价格、MOQ 原文、Seller Claim/Platform Metadata 分类、有界上限；**不实现**） |
| 29 | 与当前 V3 主链怎么接 | Evidence Workbench 货源区（无数据保持 unknown）；Skill 只读识别 available；不重建 Agent 链 |
| 30 | 不应复活哪些旧 Agent 能力 | 旧 AI 货源分析（feasibility/priceBand/moqEstimate/complianceBarrier）、旧 AI 利润判断（decision=testable/caution）、旧合规判断 |
| 31 | DO_NOW | 人工导入供应线索（URL/粘贴）+ 页面快照保存 + 匹配证据 + unknowns + 询盘问题 |
| 32 | LATER | Evidence Matrix 展示层；中文关键词转换工具；官方 API（若资质获得）；Human-assisted 当前页（用户已登录时） |
| 33 | DO_NOT_BUILD | 自动搜索/翻页、图片搜同款、自动匹配评分、自动询盘、真实利润、自动采购判断、Supplier Score、AI 供应商推荐 |
| 34 | 实现复杂度 | 低（人工导入 + 结构化保存 + 展示；复用 V3.4 namespace/writer/有界模式） |
| 35 | 最大风险 | 同款/相似款误判（防制：无概率+五态+规格缺失降级）；价格/MOQ 语义误导（防制：三态+原文）；供应商指标误读（防制：仅展示） |
| 36 | 是否值得正式进入 V3.5 开发 | **值得（窄范围）**：NARROW_APPROVAL——仅 Sourcing Evidence/供应线索；正式开发前需用户独立审查本评估 + 授权 |

## 证据

- 登录墙实测：probe-evidence/probe-result.json（1688 搜索页 → login.taobao.com，5 次重定向）
- 外部资料：[1688 客服中心](https://114.1688.com/kb/detail/20732087.html)、[1688 商品详情 API 文档](https://developer.aliyun.com/article/1676157)、[item_get 解析](https://blog.itpub.net/70047598/viewspace-3096606/)（2026-08-15 检索）
- 遗产审计：current-state-audit.md

## 结论输出

```
V3_5_VALUE = NARROW_APPROVAL
V3_5_ASSESSMENT = DONE
V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED = TRUE
V3_6_AUTHORIZATION_REQUIRED = TRUE
PUBLIC_DEPLOY = FORBIDDEN
```

**即使 NARROW_APPROVAL，不得自动开始 V3.5 实现。** 等待用户独立审查与授权。

