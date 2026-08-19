# Competitor TEMP Spike Harness（竞品候选提取 · 临时）

> **TEMP / SPIKE ONLY** —— 不接正式 Authority。
> 本目录只提供「提取 JSON 模板 + JSON Schema + 校验器」，**不执行浏览器**，
> 不写 `lib/server/competitorEvidence.ts`（正式竞品 Evidence 仍只允许人工维护，见
> `docs/v3/changes/phase-2/competitor-evidence-contract.md`）。
> Spike 由 Main（编排者）**串行执行**：打开 SellerSprite 面板 → 按本模板记录提取结果 → 校验 → 汇总。

## 1. 目的

验证「SellerSprite 插件面板（Reverse ASIN / 搜索结果面板）能否作为**竞品候选发现**的临时来源」：

- 面板已打开后，确定性提取当前可见行中的**竞品候选**（≤ 5 个）；
- 每条候选记录 `asin / title / source / capturedAt / reasonCodes[]`（为什么认为它是竞品）；
- `capture` 块记录 UI 观测（`uiSurface` / `visibleRows` / `visibleFields`），用于评估面板可提取性。

**与正式链的关系（不得混用）**：
- 本 Spike 输出**只作研究输入素材**，不得直接写入 `competitorEvidence` 命名空间；
- 正式竞品证据仍由用户在 Workbench 人工维护（上限 5、`sourceKind=manual`）；
- Spike 结论（面板时序不稳 → 只做面板打开后的确定性提取）已在 READ-C 记录，本 Harness 只是执行载体。

## 2. 输入

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `targetAsin` | string | ✅ | 目标商品 ASIN（10 位大写） |
| `targetTitle` | string | ✅ | 目标商品标题（用于关键词重叠/标题匹配判断） |
| `keyword` | string | ❌ | 触发面板的搜索关键词（Reverse ASIN 时可为 null） |

## 3. 输出 JSON Schema

见 `extract-template.mjs` 导出的 `competitorSpikeSchema`（draft-07 风格）。

顶层结构：

```jsonc
{
  "schema": "sellersprite-competitor-spike.v1",
  "capture": {
    "tool": "sellersprite-plugin",
    "uiSurface": "reverse-asin-panel | search-results-panel",
    "targetAsin": "B0TEST0001",
    "targetTitle": "HydroJug Travel Tumbler 40oz",
    "keyword": null,
    "capturedAt": "2026-08-20T08:30:00.000Z",
    "visibleRows": 12,
    "visibleFields": ["ASIN", "商品标题", "价格", "评分", "评分数"]
  },
  "candidates": [
    {
      "asin": "B0COMP0002",
      "title": "ThermoFlask 40oz Tumbler",
      "source": "sellersprite-plugin-reverse-asin",
      "capturedAt": "2026-08-20T08:30:01.000Z",
      "reasonCodes": ["reverse_asin_top10", "price_band_overlap", "category_match"]
    }
  ]
}
```

### 3.1 `candidates[]`（≤ 5，`MAX_CANDIDATES`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `asin` | string | ✅ | 竞品 ASIN，`/^[A-Z0-9]{10}$/` |
| `title` | string | ✅ | 面板可见标题（去空白） |
| `source` | string | ✅ | `sellersprite-plugin-reverse-asin` 或 `sellersprite-plugin-search-results` |
| `capturedAt` | string | ✅ | 该候选的提取时刻（ISO 8601） |
| `reasonCodes` | string[] | ✅ | 见下表；可为空数组（= 仅人工标记，禁止空理由冒充自动结论） |

### 3.2 `reasonCodes` 语义（不自动评分，只记录「为什么值得人工看」）

| code | 含义 |
|---|---|
| `reverse_asin_top10` | 出现在 Reverse ASIN 报表/面板的「前十 ASIN」中 |
| `same_search_panel` | 与目标同屏出现于同一搜索结果面板 |
| `title_keyword_overlap` | 标题与目标/触发关键词存在明显重叠词 |
| `price_band_overlap` | 价格与目标价格带重叠（±30% 或人工判定） |
| `category_match` | 同属目标类目 |
| `rating_range_overlap` | 评分与目标同区间 |
| `review_volume_overlap` | 评论量与目标同量级 |
| `buybox_competitor` | 与目标争夺 Buy Box |
| `manual_review` | 人工观察标记（必须伴随至少一个客观 code 或显式说明） |

> 约束：`reasonCodes` 是**观测记录**，不是评分；Spike 不得据此自动写入正式竞品 Evidence。

## 4. 用法（由 Main 串行执行）

```bash
# 1) 生成空模板（可手填）
node scripts/spike/competitor-spike/extract-template.mjs --template \
  --targetAsin B0TEST0001 --targetTitle "HydroJug Travel Tumbler 40oz" \
  > .tmp/competitor-spike-1.json

# 2) Main 打开面板后按模板记录提取结果（人工/半自动填写）

# 3) 校验输出
node scripts/spike/competitor-spike/extract-template.mjs --validate .tmp/competitor-spike-1.json
```

校验失败以非零退出码结束，并打印逐条错误（含 JSON Pointer 风格路径）。

## 5. 范围与禁忌

- ✅ 允许：新增/修改 `scripts/spike/competitor-spike/**`；按模板写 `.tmp/` 结果。
- ❌ 禁止：修改 `lib/server/competitorEvidence.ts`、`components/evidence/**`、`lib/server/taskResultJsonMutation.ts`；
  禁止把 Spike 输出直接写入正式 `competitorEvidence` 命名空间或 Task resultJson。
- ❌ 禁止：本 Harness 执行浏览器自动化（面板展开/点击时序不稳；只做面板打开后的确定性提取）。
