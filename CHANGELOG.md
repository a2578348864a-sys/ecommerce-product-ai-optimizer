# Changelog

本项目按语义化版本管理，版本标记见 Git tags 与 GitHub Releases。

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
