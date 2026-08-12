# Changelog

本项目按语义化版本管理，版本标记见 Git tags 与 GitHub Releases。

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
