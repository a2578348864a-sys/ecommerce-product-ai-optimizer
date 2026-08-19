# Keyword TEMP Spike Harness（Reverse ASIN / Keyword Mining 面板提取 · 临时）

> **TEMP / SPIKE ONLY** —— 不接正式 Authority。
> 本目录只提供「提取 JSON 模板 + JSON Schema + 校验器」，**不执行浏览器**，
> 不写 `lib/server/keywordEvidence.ts` / `lib/upstream/sellersprite/keywordReports.ts`
> （正式关键词证据链只接受真实 XLSX 报表解析，见
> `docs/v3/changes/phase-3-4/proposal.md`）。
> Spike 由 Main（编排者）**串行执行**：打开面板 → 按模板记录 UI 观测与可见行 → 校验 → 汇总。

## 1. 目的

验证「SellerSprite 插件面板（Reverse ASIN / Keyword Mining）能否提供**关键词证据的临时输入**」：

- 记录面板可观测性：`uiSurface` / `visibleRows` / `visibleFields`（决定面板提取的可行性与稳定性）；
- 记录面板当前可见的关键词行（`keywords[]`），字段值与正式
  `KeywordReportFieldValue`（`raw/normalized/metricNature/applicability`）同构，便于日后对齐；
- **不写入正式 keywordEvidence 命名空间**；Spike 结论只进 `.tmp/` 结果与 READ-C 报告。

## 2. 输入

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `seed` | string | ✅ | 种子：关键词（Keyword Mining）或 ASIN（Reverse ASIN） |
| `seedType` | "keyword" \| "asin" | ✅ | 面板类型对应的种子语义 |
| `uiSurface` | "keyword-mining-panel" \| "reverse-asin-panel" | ✅ | 面板来源 |

## 3. 输出 JSON Schema

见 `extract-template.mjs` 导出的 `keywordSpikeSchema`。

顶层结构：

```jsonc
{
  "schema": "sellersprite-keyword-spike.v1",
  "capture": {
    "tool": "sellersprite-plugin",
    "uiSurface": "keyword-mining-panel",
    "seed": "insulated tumbler 40oz",
    "seedType": "keyword",
    "capturedAt": "2026-08-20T08:30:00.000Z",
    "visibleRows": 20,
    "visibleFields": ["关键词", "月搜索量", "ABA周排名", "购买率", "PPC价格"],
    "headerLabels": ["关键词", "关键词翻译", "月搜索量", "ABA周排名", "购买率", "PPC价格"]
  },
  "keywords": [
    {
      "rowNumber": 1,
      "keyword": "insulated tumbler 40oz",
      "keywordTranslation": null,
      "fields": {
        "monthlySearches": {
          "raw": "45,000",
          "normalized": 45000,
          "metricNature": "estimate",
          "applicability": "available"
        }
      }
    }
  ]
}
```

### 3.1 `keywords[]`（≤ `MAX_KEYWORDS` = 50）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rowNumber` | integer | ✅ | 面板行号（1-based，稳定跨次提取） |
| `keyword` | string | ✅ | 关键词文本 |
| `keywordTranslation` | string \| null | ❌ | 中文翻译（面板无则 null，不猜） |
| `fields` | object | ✅ | 字段名 → 值对象（见下） |

### 3.2 `fields.<name>` 值对象（与正式 KeywordReportFieldValue 同构）

| 字段 | 类型 | 说明 |
|---|---|---|
| `raw` | string \| null | 面板原样文本（"$3.22" / "1,778.8" / "-"） |
| `normalized` | number \| string \| boolean \| string[] \| object \| null | 确定性规范化值（不猜缺失字段） |
| `metricNature` | "snapshot" \| "estimate" \| "derived" \| "unknown" | 指标性质 |
| `applicability` | "available" \| "missing" \| "not_applicable" \| "invalid" | 面板可用性 |

> 与正式链对齐口径（真实样本核实，见 `lib/upstream/sellersprite/keywordReports.ts`）：
> 比例字段（流量占比/购买率等）原值为 0–1 存原值；需供比是比率不得 ×100；
> 空字符串 → `missing`；"0" → `available` 且值为 0；广告排名页码等不稳定字段 → `missing`，不强造值。

## 4. 用法（由 Main 串行执行）

```bash
# 1) 生成空模板
node scripts/spike/keyword-spike/extract-template.mjs --template \
  --seed "insulated tumbler 40oz" --seedType keyword --uiSurface keyword-mining-panel \
  > .tmp/keyword-spike-1.json

# 2) Main 打开面板后按模板记录 UI 观测与可见行

# 3) 校验输出
node scripts/spike/keyword-spike/extract-template.mjs --validate .tmp/keyword-spike-1.json
```

校验失败以非零退出码结束，并打印逐条错误（含 JSON Pointer 风格路径）。

## 5. 范围与禁忌

- ✅ 允许：新增/修改 `scripts/spike/keyword-spike/**`；按模板写 `.tmp/` 结果。
- ❌ 禁止：修改 `lib/server/keywordEvidence.ts`、`lib/upstream/sellersprite/keywordReports.ts`、
  `components/evidence/**`、`lib/server/taskResultJsonMutation.ts`；
  禁止把 Spike 输出直接写入正式 `keywordEvidence` 命名空间或 Task resultJson。
- ❌ 禁止：本 Harness 执行浏览器自动化（面板展开/点击时序不稳；只做面板打开后的确定性提取）。
