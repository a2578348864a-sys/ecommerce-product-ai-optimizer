# Phase 1D — Alpha 前删除 Viral Mock 记录

## 元数据

- **日期**：2026-06-21
- **执行人**：Claude
- **生产服务器**：112.124.54.81
- **生产代码 HEAD**：`7b83cdfc07dc14bb2e3f0b363f41bf575507cdc9`
- **origin/main HEAD**：`f469beb`（执行前）
- **数据库路径**：`/www/alibaba-ai-assistant/prisma/prod.db`

## 删除原因

Alpha 发出前最终复核（`f469beb`）发现 C 类 2 条 viral mock 记录在 /tasks 任务列表显示「mock 模拟拆解」标签（`source=mock`），且详情页 raw JSON 折叠区含 `"mode":"mock"`。判定 P2，建议删除后再发给 Alpha 测试用户。

## 删除对象

| # | 完整 ID | 类型 | 标题 | source | mode |
|---|---------|------|------|--------|------|
| 1 | `cmqhtmlvp00001ck3flb52rgt` | viral | 露营神器！这个折叠水杯太方便了 | mock | mock |
| 2 | `cmqiiaosb0000slv47f6qdi24` | viral | TikTok viral kitchen gadget - portable mini blender | mock | mock |

## 操作摘要

### 备份

```
路径：/www/server-backups/alibaba-ai-assistant/2026-06-21-before-alpha-delete-viral-mock/
文件：prod.db.before-delete-viral-mock.bak
大小：352KB
quick_check：ok
记录数：82
```

### 删除 SQL

```sql
BEGIN TRANSACTION;
DELETE FROM ViralAnalysisRecord WHERE id IN (
  'cmqhtmlvp00001ck3flb52rgt',
  'cmqiiaosb0000slv47f6qdi24'
);
-- rowcount: 2
COMMIT;
```

## 结果验证

### 记录数变化

| 表 | 删除前 | 删除后 |
|----|--------|--------|
| ViralAnalysisRecord | 82 | **80** |
| ListingCopyHistory | 2 | 2（不变） |

### 问题指标

| 检查项 | 删除前 | 删除后 |
|--------|--------|--------|
| mode:mock 记录 | 2 | **0** |
| test 标题 | 0 | 0 |
| 乱码 | 0 | 0 |
| NULL 标题 | 0 | 0 |
| 未命名商品 | 0 | 0 |
| quick_check | ok | **ok** |

### 页面复查

| 页面 | HTTP | 结果 |
|------|------|------|
| `/api/health` | `{"ok":true}` | ✅ |
| `/` | 200 | ✅ |
| `/tasks` | 200 | ✅ |
| `/sourcing` | 200 | ✅ |
| `/risk` | 200 | ✅ |
| `/summary` | 200 | ✅ |
| `/viral` | 200 | ✅ |
| `/products/new` | 200 | ✅ |
| `/materials` | 200 | ✅ |
| `/opportunities` | 200 | ✅ |

### 类型分布（最终）

| 类型 | 数量 |
|------|------|
| risk | 30 |
| sourcing | 25 |
| product | 9 |
| summary | 8 |
| material | 3 |
| viral | 3 |
| opportunities | 2 |

## 合规确认

| 项目 | 状态 |
|------|------|
| 是否修改业务代码 | **否** ✅ |
| 是否部署 | **否** ✅ |
| 是否调用真实 AI | **否** ✅ |
| 是否重启 PM2 | **否** ✅ |
| 是否读取/打印 .env.local | **否** ✅ |
| 是否删除真实分析记录 | **否** ✅ — 仅删除 mock 标记记录 |
| 是否扩大删除范围 | **否** ✅ — 仅 2 条精确 ID |
| 是否使用 git add . | **否** ✅ |

## 结论

✅ 2 条 C 类 viral mock 记录已删除。数据库健康，页面正常。生产库现有 80 条记录全部为真实 AI 分析结果，无 mock/test/乱码/占位。

**建议可以发给 1-3 个 Alpha 熟人测试。**
