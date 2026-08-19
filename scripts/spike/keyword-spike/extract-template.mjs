/**
 * Keyword TEMP Spike Harness — extract-template（纯合同模块，不执行浏览器）。
 *
 * 提供：
 * - `keywordSpikeSchema`：输出 JSON Schema（draft-07 风格，自包含无依赖）；
 * - `makeTemplate(input)`：按输入（seed/seedType/uiSurface）生成空模板；
 * - `validateKeywordSpikeOutput(value)`：手写校验器（无外部依赖），
 *   返回 { ok, errors: [{ path, message }] }；
 * - `--template` / `--validate <file>` 两个 CLI 入口（供 Main 串行执行 Spike 时使用）。
 *
 * 记录字段：UI_SURFACE / VISIBLE_ROWS / VISIBLE_FIELDS / HEADER_LABELS 面板观测，
 * 以及关键词行（fields 值对象与正式 KeywordReportFieldValue 同构）。
 * 不写正式 Authority（keywordEvidence / taskResultJsonMutation 禁止触碰）。
 */

export const SCHEMA_ID = "sellersprite-keyword-spike.v1";
export const MAX_KEYWORDS = 50;
export const TOOL = "sellersprite-plugin";

export const UI_SURFACES = Object.freeze(["keyword-mining-panel", "reverse-asin-panel"]);
export const SEED_TYPES = Object.freeze(["keyword", "asin"]);

export const METRIC_NATURES = Object.freeze(["snapshot", "estimate", "derived", "unknown"]);
export const APPLICABILITIES = Object.freeze(["available", "missing", "not_applicable", "invalid"]);

export const keywordSpikeSchema = Object.freeze({
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: `https://qingxuan.local/schemas/${SCHEMA_ID}`,
  title: SCHEMA_ID,
  type: "object",
  additionalProperties: false,
  required: ["schema", "capture", "keywords"],
  properties: {
    schema: { const: SCHEMA_ID },
    capture: {
      type: "object",
      additionalProperties: false,
      required: ["tool", "uiSurface", "seed", "seedType", "capturedAt", "visibleRows", "visibleFields", "headerLabels"],
      properties: {
        tool: { const: TOOL },
        uiSurface: { enum: [...UI_SURFACES] },
        seed: { type: "string", minLength: 1 },
        seedType: { enum: [...SEED_TYPES] },
        capturedAt: { type: "string", format: "date-time" },
        visibleRows: { type: "integer", minimum: 0 },
        visibleFields: { type: "array", items: { type: "string" } },
        headerLabels: { type: "array", items: { type: "string" } },
      },
    },
    keywords: {
      type: "array",
      maxItems: MAX_KEYWORDS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rowNumber", "keyword", "fields"],
        properties: {
          rowNumber: { type: "integer", minimum: 1 },
          keyword: { type: "string", minLength: 1 },
          keywordTranslation: { type: ["string", "null"] },
          fields: {
            type: "object",
            additionalProperties: {
              type: "object",
              required: ["raw", "normalized", "metricNature", "applicability"],
              properties: {
                raw: { type: ["string", "null"] },
                normalized: {},
                metricNature: { enum: [...METRIC_NATURES] },
                applicability: { enum: [...APPLICABILITIES] },
              },
            },
          },
        },
      },
    },
  },
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function collectErrors(value) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });

  if (!isRecord(value)) {
    push("$", "输出必须是对象");
    return errors;
  }
  if (value.schema !== SCHEMA_ID) push("$.schema", `必须是 ${SCHEMA_ID}`);
  if (!isRecord(value.capture)) {
    push("$.capture", "capture 缺失或不是对象");
  } else {
    const c = value.capture;
    if (c.tool !== TOOL) push("$.capture.tool", `必须是 ${TOOL}`);
    if (!UI_SURFACES.includes(c.uiSurface)) push("$.capture.uiSurface", "必须是 keyword-mining-panel 或 reverse-asin-panel");
    if (typeof c.seed !== "string" || c.seed.trim().length === 0) push("$.capture.seed", "seed 不能为空");
    if (!SEED_TYPES.includes(c.seedType)) push("$.capture.seedType", "seedType 必须是 keyword 或 asin");
    if (!isIsoDate(c.capturedAt)) push("$.capture.capturedAt", "capturedAt 必须是 ISO 日期");
    if (!Number.isInteger(c.visibleRows) || c.visibleRows < 0) push("$.capture.visibleRows", "visibleRows 必须是非负整数");
    if (!Array.isArray(c.visibleFields) || c.visibleFields.some((f) => typeof f !== "string")) push("$.capture.visibleFields", "visibleFields 必须是字符串数组");
    if (!Array.isArray(c.headerLabels) || c.headerLabels.some((f) => typeof f !== "string")) push("$.capture.headerLabels", "headerLabels 必须是字符串数组");
  }

  if (!Array.isArray(value.keywords)) {
    push("$.keywords", "keywords 必须是数组");
    return errors;
  }
  if (value.keywords.length > MAX_KEYWORDS) {
    push("$.keywords", `最多 ${MAX_KEYWORDS} 行`);
  }
  const seenRows = new Set();
  value.keywords.forEach((row, index) => {
    const base = `$.keywords[${index}]`;
    if (!isRecord(row)) {
      push(base, "行必须是对象");
      return;
    }
    if (!Number.isInteger(row.rowNumber) || row.rowNumber < 1) push(`${base}.rowNumber`, "rowNumber 必须是 ≥1 的整数");
    if (seenRows.has(row.rowNumber)) push(`${base}.rowNumber`, "rowNumber 重复");
    seenRows.add(row.rowNumber);
    if (typeof row.keyword !== "string" || row.keyword.trim().length === 0) push(`${base}.keyword`, "keyword 不能为空");
    if (row.keywordTranslation !== undefined && row.keywordTranslation !== null && typeof row.keywordTranslation !== "string") {
      push(`${base}.keywordTranslation`, "keywordTranslation 必须是字符串或 null");
    }
    if (!isRecord(row.fields)) {
      push(`${base}.fields`, "fields 必须是对象");
      return;
    }
    for (const [fieldName, fieldValue] of Object.entries(row.fields)) {
      const fieldPath = `${base}.fields.${fieldName}`;
      if (!isRecord(fieldValue)) {
        push(fieldPath, "字段值必须是对象");
        continue;
      }
      if (fieldValue.raw !== null && typeof fieldValue.raw !== "string") push(`${fieldPath}.raw`, "raw 必须是字符串或 null");
      if (!METRIC_NATURES.includes(fieldValue.metricNature)) push(`${fieldPath}.metricNature`, "metricNature 不在允许集合内");
      if (!APPLICABILITIES.includes(fieldValue.applicability)) push(`${fieldPath}.applicability`, "applicability 不在允许集合内");
      if (fieldValue.applicability === "available" && fieldValue.normalized === null) {
        push(`${fieldPath}.normalized`, "applicability=available 时 normalized 不能为 null");
      }
      if (fieldValue.applicability === "missing" && fieldValue.normalized !== null) {
        push(`${fieldPath}.normalized`, "applicability=missing 时 normalized 应为 null");
      }
    }
  });
  return errors;
}

export function validateKeywordSpikeOutput(value) {
  const errors = collectErrors(value);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * 按输入生成空模板（UI 观测占位 null，Main 打开面板后填写）。
 */
export function makeTemplate(input = {}) {
  const seed = String(input.seed ?? "");
  const seedType = input.seedType === "asin" ? "asin" : "keyword";
  const uiSurface = UI_SURFACES.includes(input.uiSurface) ? input.uiSurface : "keyword-mining-panel";
  return {
    schema: SCHEMA_ID,
    capture: {
      tool: TOOL,
      uiSurface,
      seed,
      seedType,
      capturedAt: new Date().toISOString(),
      visibleRows: null,
      visibleFields: [],
      headerLabels: [],
    },
    keywords: [],
  };
}

// ── CLI（供 Main 串行执行 Spike 时使用；不执行浏览器）─────────────────────

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/spike/keyword-spike/extract-template.mjs --template [--seed S] [--seedType keyword|asin] [--uiSurface keyword-mining-panel|reverse-asin-panel]
  node scripts/spike/keyword-spike/extract-template.mjs --validate <output.json>
`);
}

async function runCli(argv) {
  const args = argv.slice(2);
  if (args.includes("--template")) {
    const read = (name) => {
      const index = args.indexOf(name);
      return index === -1 ? undefined : args[index + 1];
    };
    const template = makeTemplate({
      seed: read("--seed"),
      seedType: read("--seedType"),
      uiSurface: read("--uiSurface"),
    });
    process.stdout.write(`${JSON.stringify(template, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--validate")) {
    const filePath = args[args.indexOf("--validate") + 1];
    if (!filePath) {
      printUsage();
      return 2;
    }
    let parsed;
    try {
      const { readFileSync } = await import("node:fs");
      const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
      parsed = JSON.parse(text);
    } catch (error) {
      process.stderr.write(`无法读取/解析 ${filePath}: ${error.message}\n`);
      return 2;
    }
    const result = validateKeywordSpikeOutput(parsed);
    if (result.ok) {
      process.stdout.write("OK: keyword spike output valid\n");
      return 0;
    }
    for (const entry of result.errors) {
      process.stderr.write(`${entry.path}: ${entry.message}\n`);
    }
    return 1;
  }
  printUsage();
  return 2;
}

if (process.argv[1]?.endsWith("extract-template.mjs")) {
  process.exitCode = await runCli(process.argv);
}
