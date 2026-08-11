# Changelog

本项目按语义化版本管理，版本标记见 Git tags 与 GitHub Releases。

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
