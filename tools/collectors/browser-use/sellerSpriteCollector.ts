/**
 * 轮 9：SellerSprite（Amazon 产品页）Browser Use 采集器——正式运行入口。
 *
 * 职责：把服务端解析出的权威种子（seed ASIN + marketplace tld）翻译为一个
 * 确定性、只读的 browser-use 脚本（打开 Amazon 产品页并做观察），并在观察结果
 * 的基础上产出严格 Preview（先预览、人工确认后经既有写入器保存）。
 *
 * 安全：输入只来自服务端（lib/server/browserUseResearch.resolveBrowserUseSeed），
 * 脚本不触碰 token/cookie；未登录/验证码/面板缺失 → fail-closed 明确失败原因；
 * 缺失字段一律 null，禁止猜测。
 */

import { BROWSER_USE_RESEARCH_SCHEMA, type BrowserUseResearchPreview, type BrowserUseResearchKind, type BrowserUseCollectorInfo } from "@/lib/server/browserUseResearch";

export const BROWSER_USE_OBSERVATION_SCHEMA = "browser-use-observation.v1" as const;

export type SellerSpriteCollectionInput = {
  kind: BrowserUseResearchKind;
  seedAsin: string;
  marketplaceTld: string;
  productUrl: string | null;
};

export type CollectorObservation = {
  schema: typeof BROWSER_USE_OBSERVATION_SCHEMA;
  url: string;
  title: string;
  bodyText: string;
  panelMarker: boolean;
  observedAt: string;
  failureHint: "login_required" | "captcha_required" | "panel_not_detected" | null;
  keywords: { keyword: string; keywordTranslation: string | null; searchVolume: number | null; abaWeeklyRank: number | null; purchaseVolume: number | null; competition: number | null }[];
  competitors: { asin: string; title: string; price: number | null; rating: number | null; reviews: number | null }[];
};

export function amazonProductUrl(input: SellerSpriteCollectionInput): string {
  if (input.productUrl && /^https:\/\/(www\.)?amazon\./i.test(input.productUrl)) return input.productUrl;
  return `https://www.amazon.${input.marketplaceTld || "com"}/dp/${input.seedAsin}`;
}

/** 确定性 browser-use 脚本（ASCII-only；stdin 喂入，stdout 输出观察 JSON）。 */
export function buildSellerSpriteCollectionScript(input: SellerSpriteCollectionInput): string {
  const url = amazonProductUrl(input);
  const KWTAB = String.fromCharCode(0x5173, 0x952e, 0x8bcd, 0x53cd, 0x67e5); // \u5173\u952e\u8bcd\u53cd\u67e5
  const ESCAPED_KW = KWTAB.charCodeAt(0).toString(16);
  // 脚本全 ASCII：导航+点击+提取；中文比较用 \\u 转义注入 python 字面量（运行时解析）
  const kwLiteral = String.fromCharCode(92) + String.fromCharCode(0x75) + KWTAB.split("").map(function (c) { var h = c.charCodeAt(0).toString(16); while (h.length < 4) h = "0" + h; return h; }).join(String.fromCharCode(92) + String.fromCharCode(0x75));
  const lines = [
    "import os, json, re",
    "num = 0",
    "new_tab(\"" + url + "\")",
    "wait_for_load()",
    "wait(5.0)",
    "def ev(expr):",
    "    return json.loads(js(expr))",
    "def raw(expr):",
    "    return js(expr)",
    "o = ev(\"(() => { const root = document.querySelector('#main-sellersprite-extension'); if (!root) return JSON.stringify({ found: false, url: location.href }); const rb = root.querySelector('.robot-dialog-box button.btn-ext-primary'); if (rb) rb.click(); const navs = Array.from(root.querySelectorAll('a.nav-web')); const kw = navs[1]; if (kw) kw.click(); return JSON.stringify({ found: true, clickVerify: !!rb, clickKw: !!kw, url: location.href, title: document.title, observedAt: new Date().toISOString() }); })()\")",
    "wait(5.0)",
    "d = ev(\"(() => { const root = document.querySelector('#main-sellersprite-extension'); if (!root) return JSON.stringify({ text: '', keywords: [] }); const body = (root.innerText || ''); const tables = root.querySelectorAll('table'); const rows = []; if (tables.length > 1) { const trs = tables[tables.length - 1].querySelectorAll('tr'); for (let i = 0; i < trs.length; i++) { const cells = Array.from(trs[i].querySelectorAll('td,th')).map(function(c){ return (c.innerText || '').trim(); }); if (cells.length >= 16 && /^\\d+$/.test(cells[1] || '')) rows.push(cells); } } return JSON.stringify({ text: body.slice(0, 1200), keywords: rows.slice(0, 100) }); })()\")",
    "kw = []",
    "for r in d.get('keywords', []):",
    "    def num(v):",
    "        m = re.match(r'^(\\d[\\d,]*\\.?\\d*)', v or '')",
    "        if not m: return None",
    "        try: return float(m.group(1).replace(',', ''))",
    "        except: return None",
    "    p = (r[2] or '').split(chr(10))",
    "    kw.append({ 'keyword': (p[0] if p else ''), 'keywordTranslation': (p[1] if len(p) > 1 else None), 'searchVolume': num(r[9]), 'abaWeeklyRank': num(r[8]), 'purchaseVolume': num(r[12]), 'adCompetitorCount': num(r[15]) })",
    "o['schema'] = 'browser-use-observation.v1'",
    "o['panelMarker'] = bool(o.get('found', False))",
    "o['bodyText'] = d.get('text', '')",
    "o['keywords'] = kw",
    "o['competitors'] = []",
    "out = json.dumps(o, ensure_ascii=False)",
    "print(out)",
    "open(os.environ['BU_COLLECT_OUTPUT'], 'w', encoding='utf-8').write(out)",
  ];
  return lines.join(String.fromCharCode(10));
}
function isRecord2(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function parseCollectorObservation(raw: string): CollectorObservation | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const maybeJson = trimmed.split(/\n/).reverse().find((line) => line.trim().startsWith("{"));
  if (!maybeJson) return null;
  try {
    const value = JSON.parse(maybeJson) as Record<string, unknown>;
    if (value.schema !== BROWSER_USE_OBSERVATION_SCHEMA) return null;
    if (typeof value.url !== "string" || typeof value.title !== "string" || typeof value.bodyText !== "string") return null;
    if (typeof value.panelMarker !== "boolean") return null;
    if (typeof value.observedAt !== "string" || Number.isNaN(new Date(value.observedAt).getTime())) return null;
    const lower = value.bodyText.toLowerCase();
    const hasCaptchaText = value.bodyText.indexOf(String.fromCharCode(0x9a8c, 0x8bc1, 0x7801)) >= 0;
    const failureHint = hasCaptchaText
      ? "captcha_required"
      : /sign in|log in|signin|login/i.test(value.bodyText)
      ? "login_required"
      : /captcha|characters you see below/i.test(lower)
        ? "captcha_required"
        : value.panelMarker === true
          ? null
          : "panel_not_detected";
    const keywordItems = Array.isArray(value.keywords) ? value.keywords.map(function (item: unknown) { const r = isRecord2(item) ? item : {}; return { keyword: asStr(r.keyword) || "", keywordTranslation: asStr(r.keywordTranslation), searchVolume: asNum(r.searchVolume), abaWeeklyRank: asNum(r.abaWeeklyRank), purchaseVolume: asNum(r.purchaseVolume), competition: asNum(r.adCompetitorCount) }; }).filter(function (item) { return item.keyword.length > 0; }).slice(0, 100) : [];
    return { schema: BROWSER_USE_OBSERVATION_SCHEMA, url: value.url, title: value.title, bodyText: value.bodyText, panelMarker: value.panelMarker, observedAt: value.observedAt, failureHint: failureHint as CollectorObservation["failureHint"], keywords: keywordItems, competitors: [] };
  } catch {
    return null;
  }
}

/** 观察 → 严格 Preview（结果为空 + 明确失败原因；不猜测字段值）。 */
export function collectorObservationToPreview(
  input: SellerSpriteCollectionInput,
  observation: CollectorObservation,
  collectorVersion: string,
): BrowserUseResearchPreview {
  const collector: BrowserUseCollectorInfo = { tool: "browser-use", version: collectorVersion || "unknown" };
  const failureReason = observation.failureHint;
  return {
    schema: BROWSER_USE_RESEARCH_SCHEMA,
    version: 1,
    kind: input.kind,
    seedAsin: input.seedAsin,
    marketplace: input.marketplaceTld === "com" ? "Amazon US" : input.marketplaceTld,
    seedProductUrl: input.productUrl,
    sourceUrl: observation.url,
    capturedAt: observation.observedAt,
    results: input.kind === "keyword"
      ? observation.keywords.map(function (item) { return { keyword: item.keyword, keywordTranslation: item.keywordTranslation === null ? null : item.keywordTranslation, searchVolume: item.searchVolume, abaWeeklyRank: item.abaWeeklyRank, purchaseVolume: item.purchaseVolume, competition: item.competition, capturedAt: observation.observedAt }; })
      : [],
    missing: failureReason === null && input.kind === "competitor" ? ["sellersprite_competitor_rows"] : (failureReason !== null ? ["sellersprite_panel_rows"] : []),
    failureReason: failureReason === null && input.kind === "keyword" && observation.keywords.length === 0 ? "panel_not_detected" : failureReason as BrowserUseResearchPreview["failureReason"],
    collector,
  } as BrowserUseResearchPreview;
}
export const BROWSER_USE_CLI_PATH = process.env.BROWSER_USE_CLI_PATH
  || "C:\\Users\\a2578\\.local\\bin\\browser-use.exe";

export type SpawnResult = { stdout: string; stderr: string; code: number | null };
export type SpawnLike = (script: string, timeoutMs?: number) => Promise<SpawnResult>;

export type SellerSpriteCollectionRun =
  | { ok: true; preview: BrowserUseResearchPreview; observation: CollectorObservation }
  | { ok: false; failureReason: "collector_unavailable" | "collect_failed"; detail: string };

/**
 * 无管道运行（受限/回环环境可用）：脚本与输出全走 OS 临时文件；
 * 子进程只使用 stdio ignore + shell 重定向（避免 named-pipes EPERM）。
 */
export async function defaultBrowserUseSpawn(script: string, timeoutMs = 90_000): Promise<SpawnResult> {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "bu-collect-"));
  const scriptPath = join(dir, "collect.py");
  const outPath = join(dir, "collect-out.json");
  writeFileSync(scriptPath, script, "utf8");
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(`${BROWSER_USE_CLI_PATH} < "${scriptPath}"`, { shell: true, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, BU_COLLECT_OUTPUT: outPath } });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already dead */ }
      reject(new Error("browser_use_timeout"));
    }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const output = readFileSync(outPath, "utf8");
        resolve({ stdout: output, stderr: "", code: 0 });
      } catch {
        resolve({ stdout: "", stderr: "collector produced no output file", code: 1 });
      }
    });
  });
}

export async function runSellerSpriteCollection(
  input: SellerSpriteCollectionInput,
  spawnImpl: SpawnLike = defaultBrowserUseSpawn,
): Promise<SellerSpriteCollectionRun> {
  let result: SpawnResult;
  try {
    result = await spawnImpl(buildSellerSpriteCollectionScript(input));
  } catch (error) {
    return { ok: false, failureReason: "collector_unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
  const observation = parseCollectorObservation(result.stdout);
  if (!observation) {
    return { ok: false, failureReason: "collect_failed", detail: "未获得有效浏览器观察（stdout=" + result.stdout.slice(0, 400) + "）" };
  }
  const version = /browser-use ([\d.]+)/.exec(result.stdout + result.stderr)?.[1] ?? "unknown";
  return { ok: true, preview: collectorObservationToPreview(input, observation, version), observation };
}
