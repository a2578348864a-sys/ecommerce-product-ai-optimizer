# Changelog

本项目按语义化版本管理，版本标记见 Git tags 与 GitHub Releases。

## Unreleased

### Research Stability

- Pending Preview 在持久化成功前不再提前消费。
- Keyword / Competitor Preview 增加 task 与 subject 隔离。
- Research Collection Orchestrator 避免重复 inspect 导致 revision feedback loop。
- Pending Amazon evidence 可以进入 Fact Candidate review。

### Research Lifecycle

- 新增统一 Research Lifecycle Reader。
- Task List、Task Detail 和 Evidence Workbench 使用同一生命周期快照。
- `completed`、`stale` 等状态采用 fail-closed 读取规则。

### Browser Use

- 移除开发者本机 Browser Use CLI 绝对路径。
- 支持 `BROWSER_USE_CLI_PATH` 与 PATH 查找。
- 使用 `shell: false` 与 stdin 传递参数。
- 缺少 CLI 时明确返回 `collector_unavailable`。

### V4 Experimental Workflow

- 修复 keyword / VOC 错误路由到 1688 adapter。
- `keyword` → `runKeywordAdapter`。
- `voc` → `runVocAdapter`。
- `supplier_1688` → `run1688Adapter`。
- SellerSprite recorded fixture 合同保持不变。

### Listing Presentation

- Listing 核心交付物优先展示。
- 策略 sidecar 下移或折叠展示。
- 不改变 Listing generation、Fact Authority 或 Quality Gate 的核心边界。

### Known Boundaries

- 1688 仍是参数化 sourcing 流程，需要关键词、URL 或图片等输入。
- Preview 是短时进程内状态，不是 durable storage。
- V4 LangGraph 是 feature-flagged secondary workflow，不是当前正式商品研究主链。
- Marketing Intelligence、Copy Strategy 和 Planner Strategy Preview 是 sidecar / reference-only，不直接进入 Listing renderer。

## [4.1.0] - 2026-09-07

### 新增
- **Evidence First 数据治理**：建立完整的多源客观数据摄取与清洗体系（SellerSprite 选品报表、Amazon CDP 美区 ZIP 90001 校准、买家真实 VOC 评论、1688 受控货源线索）；确立 `Evidence ≠ Fact` 隔离哲学，外部文本与主观评论绝不自动升格为商品事实；所有证据注入结构化指纹与去噪机制。
- **Human Confirmed Facts（人工事实确认门禁）**：引入人机协同确认节点（Human Gate），由运营人员逐项比对事实候选并打勾确认，沉淀为加盖 CAS 乐观并发锁版本印章的权威核准事实（`Confirmed Facts`）；未勾选项物理切断，绝不污染后续生成上下文。
- **Listing Studio（受控 Listing 创作工坊）**：提供面向 Amazon 运营的 Listing 创作与复核界面；采用双阶段流水线（阶段 A 事实语义等价渲染 + 阶段 B 运营自然润色），支持标题（Title）、五点（Bullets）、长描述（Description）与后台搜索词（Search Terms）受控生成与一键复制。
- **Image Studio（受控视觉策划工坊）**：基于人工批准的视觉参考图与确认事实，生成符合 Amazon 图片规范的契约级生图提示词与多尺寸分镜方案（白底主图、结构拆解、场景代入），规范拍摄与 3D 渲染交付标准。
- **Listing Quality Policy（代码级文案质量与事实门禁）**：
  - **Positive-Allow 溯源检查**：文案中出现的任何材质、容量、尺寸等属性声明必须在确认事实库中逐字可查，严禁无依据虚构认证或等级；
  - **Copy Quality 正则级语法引擎**：解决传统“词数达标即放行”带来的假通过问题，在代码层使用确定性模式匹配拦截 5 类机器容易出现的僵硬英文病句（动词机制套壳、搭配错位、场景口吃、主客体倒置、裸名词）；
  - **历史快照动态重判 (Historical Draft Read Guard)**：读取历史草稿时实时重跑最新质量门禁，阻断旧版本不合规草稿放行。
- **Marketing Intelligence（市场情报分析层）**：深度整合竞品差异化分析、买家高频吐槽点反转（Pain Point Reversal）与流量靶向词库，为 Listing 提供高转化维度的策略输入。
- **Copy Strategy Layer（文案策略分层体系）**：将 Listing 创作解耦为事实层、策略层与润色表达层，支持差异化卖点排序、受众心理锚定与不同商品形态（收纳件、吸管杯、车载杯等）的红绿测试泛化验收。

## [4.0.0] - 2026-08-22

### 新增
- **V4 商品研究图（Local Live）**：单一有状态 Research Workflow（LangGraph，`QX_V4_GRAPH_ENABLED` 特性开关；本地开启后 `/v4/runs` 全链运行）
- **Evidence 链**：报告事实性结论强制 evidenceRefs 引用（validateReportCitations），无证据断言不入报告
- **Product Fact Gate**：商业计算三情景（乐观/基线/悲观，合同版本固定）+ 商品事实门禁（SupplierClaim 不自动晋级；只读已确认事实；缺失 fail-closed）
- **Human Decision**：Gate A / Fact Gate / Gate B / Content Review 五个人工中断点，全部依据官方决策词表
- **Public Replay**：公网只读脱敏历史案例回放（/replay；bundle 内容哈希校验，篡改 → 409 bundle_tampered）
- **重放资产**：Replay 导出/审批/列表/详情（Owner 审批制；scanOk 门禁；allowlist 字段白名单）
- **V4 技能包**：机会优先级/竞品/关键词/VOC/供应商/Listing/合规/图片计划/视觉事实检查/产品策略（`skills/v4/`）

### 修复
- **B1**：image-handoff 路由对创作门禁空值 fail-closed（409 creative_gate_unavailable，不生成/不写数据/无 Provider 副作用）+ 回归测试
- **B3**：`/api/opportunities` 历史 A–E 批量分析根路由下线（410 legacy_endpoint；子路由保留）
- 脱敏模式扩展：JWT / AWS AKIA / PEM 私钥块 / Bearer token / client_secret·refresh_token 键（Replay 导出）
- 干净安装：`check:provider-config` 自动创建 `data/ai-image-drafts/`（与运行时一致）

### 已知限制
- Amazon/1688 真机 live 模式与真实图片生成需授权后启用（本机默认 Mock；公网不提供实时采集）
- 移动端 /v4/runs 导航未加（V3.1 常量冻结约束）；视觉检查无资产观测时保守 blocked
- 依赖：1 high（brace-expansion dev-only）；项目书 research-report.schema.json 未接线（in-code 校验强制）
- 发布记录：validatedCodeSha=`2feb848…`（全量 lint/test/tsc/build 与浏览器 E2E 基线），release SHA 见 Git tag `v4.0.0`
## [2.2.16] - 2026-08-12

### 变更
- **English-only Listing 合同（R3.1）**：最终用户可见 Listing 字段（Title/Bullets/Description/Keywords）强制自然英文，语言 Gate 拒绝中文与中文标点
- **中文事实英文渲染（R3.2）**：中文/混合语言 confirmed facts 经受控 English Rendering 转语义等价英文，保留 factRef 溯源；数字/单位 Integrity Gate；无法安全英文化时 fail-closed（拒绝生成，不静默丢事实）
- **Claim Evidence 校验覆盖渲染值**：`:rendering` 证据条目整体剥离、`approx.` 缩写句点保护，规格句（Capacity/Material/Dimensions/Weight）通过校验
- **组合输出质量**：功能事实独立成句、无逗号碎片、无双句号、无模板填充

### 已知限制
- AI optimized 草稿仍为 best-effort：被 Claim Evidence / 质量门拒绝时自动保留 safe structured fallback

## [2.2.16-r3] - 2026-08-12

### 修复
- **Claim Gate 关闭**：AI 成功路径补齐对最终保存对象的正式 Claim Evidence，消除绕过风险
- 标题组合不再并入无确认事实证据的 keyword，避免标题超长与未确认声明
- Listing 结构化降级链路的 keywords 按 Claim Evidence 过滤

### 新增
- 补充商品事实（Human Supplied Facts）：人工可补充事实并进入创作，与 Listing Brief 隔离

## [2.2.15] - 2026-08-11

### 变更
- 候选品池 / 发现商品体验与文案收口

## [2.2.14] - 2026-08-11

### 变更
- Listing 生成反馈与质量改进

## [2.2.13] - 2026-08-11

### 修复
- Creative Handoff 撤销时展示友好提示

## [2.2.12] - 2026-08-11

### 新增
- SellerSprite ProductBatch Listing 事实进入 Creative Handoff

## [2.2.11] - 2026-08-11

### 变更
- 商品体验文案与入口收口

## [2.2.10] - 2026-08-11

### 新增
- SellerSprite 商品主图按需安全导入（用户点击后受控下载单张）
- 视觉参考（approved visual reference）进入 Image Studio 生成输入

### 变更
- 商品主图不再于导入时自动下载，仅保留 URL 候选

## [2.2.9] - 2026-08-10

### 新增
- Task-linked AI Listing 生成链（三态草稿：安全事实 / 结构化 / AI 优化）
- Keyword Brief 与 Listing Readiness 门禁

## [2.2.8] - 2026-08-08

### 新增
- Creative Handoff（创作交接）：事实确认、视觉参考批准、幂等账本

> 历史版本详细日志见 `docs/archive/release-history/`。
