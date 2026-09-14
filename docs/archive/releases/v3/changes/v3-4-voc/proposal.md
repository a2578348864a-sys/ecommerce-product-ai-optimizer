# V3.4 — VOC / Review Evidence Proposal

> 状态：提案（contract 冻结前）；范围锁定：**真实 Amazon Review Evidence + VOC 聚类解释**。
> 第一性原理：VOC 的价值不是"多一块 AI 总结"，而是帮助不熟悉业务的用户理解"消费者到底在说什么"。

## 1. 范围（严格锁定）

**做**：
- 真实 Amazon Review Evidence（review-evidence.v1 namespace，复用 versioned resultJson）
- deterministic / structured normalization（去重、内容哈希、样本统计）
- AI 聚类与解释（现有 AI gate + run trace），每个主题回链真实评论
- 明确样本量与证据覆盖，人工理解

**不做**（任务书四节）：Reddit/TikTok/YouTube/Instagram/小红书/Facebook/论坛/Seller Feedback/Q&A/广告评论/VOC SaaS/社媒监听/自动舆情/大规模爬取/自动趋势预测/自动新品设计/自动产品路线图/1688/Supplier/成本/利润/Content Tools。

**不建**：复杂 sentiment 模型、多语言 ML、embedding/vector DB/RAG/topic modeling pipeline、专用训练模型（任务书九节）。

## 2. 数据来源策略（任务书五节）

优先级：
- **A. 人工导入结构化 Review 样本**（首选，稳定、人工可控、可追溯）
- **B. 浏览器 human-assisted 评论页证据**（评估后若评论页可稳定绑定 Review→ASIN 且无登录/CAPTCHA 障碍，作为辅助来源；否则不扩浏览器采集）
- C. 其他方式需独立验证

> 若 Amazon Review 页面需登录/CAPTCHA/风控 → **不绕过**，V3.4 以降级方案（人工导入）成立；
> 核心判定：**评论 Evidence 能否安全进入工作台并被正确解释**，而不是"能不能自动抓评论"。

## 3. 对抗式审查清单（设计期承诺）

| 失败方式 | 防制设计 |
|---|---|
| AI 编造不存在的评论 | AI 只允许引用 dataset 内的 evidenceRef；主题无有效 ref → 拒绝 |
| 一条评论说成普遍问题 | reviewCount 由服务端按 refs deterministic 计算；1 条 = isolated 展示 |
| competitor review 误认为 Candidate 评论 | sourceProductRole = current_candidate/competitor 强制字段 + UI 明确展示 + 自动测试 |
| 评论实体串 ASIN | 导入时实体绑定硬校验（asin + sourceProductRole + 来源证明）；无法证明 → 不保存 |
| 星级/评论文本错绑 | 导入校验 rating 0-5 与文本同时存在；contentHash 绑定 |
| 同一 Review 重复计数 | dedupe（reviewId 优先，否则 asin+normalized text hash+rating+date） |
| 翻译语义强化 | 保留原文+原语言；翻译 derived 非 source |
| AI 把主观意见变产品事实 | nature=review_observation；Review 永不进入 confirmedFacts |
| 样本太少却输出强结论 | 主题带 reviewCount + 占比；UI 用 isolated/weak 层级 |
| 正负主题比例 AI 凭感觉编 | 数量全部服务端按 refs 计算 |
| Review source 无法追溯 | 每条含 sourceType/sourceSite/sourceUrl/sourceRef/capturedAt |
| Prompt Injection | Review 文本全为 UNTRUSTED DATA；只放 user 数据字段；system 固定 |
| 评论里的 URL/命令获得执行权 | 无任何执行路径；仅文本展示 |
| AI 根据 VOC 自动决定"值得卖" | 输出白名单无推荐/评分；Skill 只读消费 |

## 4. 停止条件预判（任务书三十八节）

- 若必须大规模爬 Amazon Review 才能成立 → 不成立，降级 AUXILIARY_ONLY / NOT_ADOPTED
- 若必须绕 CAPTCHA/登录 → 不成立
- 若 Review 无法可靠绑定 ASIN → 不成立
- 若必须引入大型 Vector DB/RAG → 不成立
- 若 AI 无法稳定回链真实 Review → 不成立
- 若必须重构 V3 Core Evidence 架构 → 不成立

当前判断：人工导入 + namespace 复用 + 现有 AI gate 足以成立，**预计不触发停止条件**。

## 5. 交付物

- review-evidence.v1 合同（namespace `reviewEvidence` + `vocAnalysis`，writer `review-evidence`）
- Dataset 构建（导入/规范化/去重/bounded/统计）
- VOC AI 分析（白名单 8 类 + evidenceRefs 硬门禁 + run trace）
- API（import/analyze/read + clear）
- Evidence Workbench VOC 区域（新手可懂）
- V3.2 Skill 只读接入
- Golden VOC Eval（3 场景）+ 真实业务走查
- Change Package（proposal/contract/dataset-design/validation/learnings/final-report/golden-eval）
- 双重审查

## 6. 数据边界

- 每商品 ≤ 100 条 Review；总 dataset ≤ 300 条；单文本 ≤ 2000 字符；单条 payload ≤ 4KB；dataset JSON ≤ 128KB
- 超限：明确拒绝，不静默截断
- 真实 Review 不入 Git（fixture 脱敏/合成；真实走查记录摘要/统计/哈希）
