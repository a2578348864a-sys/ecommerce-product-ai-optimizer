/**
 * Competitor TEMP Spike Harness — extract-template（纯合同模块，不执行浏览器）。
 *
 * 提供：
 * - `competitorSpikeSchema`：输出 JSON Schema（draft-07 风格，自包含无依赖）；
 * - `makeTemplate(input)`：按输入（targetAsin/targetTitle/keyword）生成空模板；
 * - `validateCompetitorSpikeOutput(value)`：手写校验器（无外部依赖），
 *   返回 { ok, errors: [{ path, message }] }；
 * - `--template` / `--validate <file>` 两个 CLI 入口（供 Main 串行执行 Spike 时使用）。
 *
 * 约束：输出 ≤ MAX_CANDIDATES(5) 条 COMPETITOR_CANDIDATE；每条必须带
 * asin/title/source/capturedAt/reasonCodes[]。不写正式 Authority
 * （competitorEvidence / taskResultJsonMutation 禁止触碰）。
 */

export const SCHEMA_ID = "sellersprite-competitor-spike.v1";
export const MAX_CANDIDATES = 5;
export const TOOL = "sellersprite-plugin";

export const UI_SURFACES = Object.freeze(["reverse-asin-panel", "search-results-panel"]);
export const CANDIDATE_SOURCES = Object.freeze([
  "sellersprite-plugin-reverse-asin",
  "sellersprite-plugin-search-results",
]);

/** reasonCodes 语义见 README §3.2：观测记录，不自动评分。 */
export const REASON_CODES = Object.freeze([
  "reverse_asin_top10",
  "same_search_panel",
  "title_keyword_overlap",
  "price_band_overlap",
  "category_match",
  "rating_range_overlap",
  "review_volume_overlap",
  "buybox_competitor",
  "manual_review",
]);

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export const competitorSpikeSchema = Object.freeze({
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: `https://qingxuan.local/schemas/${SCHEMA_ID}`,
  title: SCHEMA_ID,
  type: "object",
  additionalProperties: false,
  required: ["schema", "capture", "candidates"],
  properties: {
    schema: { const: SCHEMA_ID },
    capture: {
      type: "object",
      additionalProperties: false,
      required: ["tool", "uiSurface", "targetAsin", "targetTitle", "capturedAt", "visibleRows", "visibleFields"],
      properties: {
        tool: { const: TOOL },
        uiSurface: { enum: [...UI_SURFACES] },
        targetAsin: { type: "string", pattern: "^[A-Z0-9]{10}$" },
        targetTitle: { type: "string", minLength: 1 },
        keyword: { type: ["string", "null"] },
        capturedAt: { type: "string", format: "date-time" },
        visibleRows: { type: "integer", minimum: 0 },
        visibleFields: { type: "array", items: { type: "string" } },
      },
    },
    candidates: {
      type: "array",
      maxItems: MAX_CANDIDATES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asin", "title", "source", "capturedAt", "reasonCodes"],
        properties: {
          asin: { type: "string", pattern: "^[A-Z0-9]{10}$" },
          title: { type: "string", minLength: 1 },
          source: { enum: [...CANDIDATE_SOURCES] },
          capturedAt: { type: "string", format: "date-time" },
          reasonCodes: {
            type: "array",
            items: { type: "string", enum: [...REASON_CODES] },
            uniqueItems: true,
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
    if (!UI_SURFACES.includes(c.uiSurface)) push("$.capture.uiSurface", "必须是 reverse-asin-panel 或 search-results-panel");
    if (!ASIN_PATTERN.test(String(c.targetAsin ?? ""))) push("$.capture.targetAsin", "目标 ASIN 无效");
    if (typeof c.targetTitle !== "string" || c.targetTitle.trim().length === 0) push("$.capture.targetTitle", "目标标题不能为空");
    if (c.keyword !== undefined && c.keyword !== null && typeof c.keyword !== "string") push("$.capture.keyword", "keyword 必须是字符串或 null");
    if (!isIsoDate(c.capturedAt)) push("$.capture.capturedAt", "capturedAt 必须是 ISO 日期");
    if (!Number.isInteger(c.visibleRows) || c.visibleRows < 0) push("$.capture.visibleRows", "visibleRows 必须是非负整数");
    if (!Array.isArray(c.visibleFields) || c.visibleFields.some((f) => typeof f !== "string")) push("$.capture.visibleFields", "visibleFields 必须是字符串数组");
  }

  if (!Array.isArray(value.candidates)) {
    push("$.candidates", "candidates 必须是数组");
    return errors;
  }
  if (value.candidates.length > MAX_CANDIDATES) {
    push("$.candidates", `最多 ${MAX_CANDIDATES} 条候选`);
  }
  const seenAsins = new Set();
  value.candidates.forEach((candidate, index) => {
    const base = `$.candidates[${index}]`;
    if (!isRecord(candidate)) {
      push(base, "候选必须是对象");
      return;
    }
    if (!ASIN_PATTERN.test(String(candidate.asin ?? ""))) push(`${base}.asin`, "竞品 ASIN 无效");
    if (seenAsins.has(candidate.asin)) push(`${base}.asin`, "竞品 ASIN 重复");
    seenAsins.add(candidate.asin);
    if (typeof candidate.title !== "string" || candidate.title.trim().length === 0) push(`${base}.title`, "标题不能为空");
    if (!CANDIDATE_SOURCES.includes(candidate.source)) push(`${base}.source`, "source 不在允许集合内");
    if (!isIsoDate(candidate.capturedAt)) push(`${base}.capturedAt`, "capturedAt 必须是 ISO 日期");
    if (!Array.isArray(candidate.reasonCodes)) {
      push(`${base}.reasonCodes`, "reasonCodes 必须是数组");
    } else {
      candidate.reasonCodes.forEach((code, codeIndex) => {
        if (!REASON_CODES.includes(code)) push(`${base}.reasonCodes[${codeIndex}]`, `未知 reasonCode: ${code}`);
      });
      if (new Set(candidate.reasonCodes).size !== candidate.reasonCodes.length) {
        push(`${base}.reasonCodes`, "reasonCodes 不能重复");
      }
    }
  });
  return errors;
}

export function validateCompetitorSpikeOutput(value) {
  const errors = collectErrors(value);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * 按输入生成空模板（值占位为 null，Main 逐项填写）。
 */
export function makeTemplate(input = {}) {
  const targetAsin = String(input.targetAsin ?? "").toUpperCase();
  const targetTitle = String(input.targetTitle ?? "");
  const keyword = input.keyword === undefined || input.keyword === null ? null : String(input.keyword);
  const capturedAt = new Date().toISOString();
  return {
    schema: SCHEMA_ID,
    capture: {
      tool: TOOL,
      uiSurface: "reverse-asin-panel",
      targetAsin,
      targetTitle,
      keyword,
      capturedAt,
      visibleRows: null,
      visibleFields: [],
    },
    candidates: [],
  };
}

// ── CLI（供 Main 串行执行 Spike 时使用；不执行浏览器）─────────────────────

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/spike/competitor-spike/extract-template.mjs --template [--targetAsin X] [--targetTitle Y] [--keyword Z]
  node scripts/spike/competitor-spike/extract-template.mjs --validate <output.json>
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
      targetAsin: read("--targetAsin"),
      targetTitle: read("--targetTitle"),
      keyword: read("--keyword"),
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
    const result = validateCompetitorSpikeOutput(parsed);
    if (result.ok) {
      process.stdout.write("OK: competitor spike output valid\n");
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
