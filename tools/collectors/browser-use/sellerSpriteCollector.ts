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
  failureHint: "login_required" | "captcha_required" | "panel_not_detected" | "seller_sprite_keyword_timeout" | null;
  keywords: { keyword: string; keywordTranslation: string | null; searchVolume: number | null; abaWeeklyRank: number | null; purchaseVolume: number | null; competition: number | null }[];
  competitors: { asin: string; title: string; price: number | null; rating: number | null; reviews: number | null }[];
};

export function amazonProductUrl(input: SellerSpriteCollectionInput): string {
  if (input.productUrl && /^https:\/\/(www\.)?amazon\./i.test(input.productUrl)) return input.productUrl;
  return `https://www.amazon.${input.marketplaceTld || "com"}/dp/${input.seedAsin}`;
}

const PHASE1_JS = "(() => { const root = document.querySelector('#main-sellersprite-extension'); const pageText = (document.body ? document.body.innerText : '') || ''; const rootText = root ? (root.innerText || '') : ''; const isLoginPage = /signin|sign-in/i.test(location.pathname) || (document.title && /sign[ -]?in/i.test(document.title)); const loginRe = /sign in|log in|signin|login|\\u767b\\u5f55|\\u5356\\u5bb6\\u7cbe\\u7075\\u7528\\u6237\\u767b\\u5f55/i; const isLogin = (root && loginRe.test(rootText)) || (isLoginPage && loginRe.test(pageText)); const captchaRe = /captcha|robot|\\u9a8c\\u8bc1\\u7801|characters you see below/i; const isCaptcha = captchaRe.test(document.title) || captchaRe.test(pageText.slice(0, 1000)) || (root && captchaRe.test(rootText)); if (root) { const rb = root.querySelector('.robot-dialog-box button.btn-ext-primary'); if (rb) rb.click(); } return JSON.stringify({ url: location.href, title: document.title, panelFound: !!root, isLogin: !!isLogin, isCaptcha: !!isCaptcha, text: (rootText || pageText).slice(0, 1200) }); })()";

const PHASE2_JS = "(() => { const root = document.querySelector('#main-sellersprite-extension'); if (!root) return JSON.stringify({ ready: false }); const rb = root.querySelector('.robot-dialog-box button.btn-ext-primary'); if (rb) rb.click(); const navs = Array.from(root.querySelectorAll('a.nav-web')); if (navs.length >= 2) { const kwNav = navs.find(n => /\\u5173\\u952e\\u8bcd\\u53cd\\u67e5|keyword/i.test(n.innerText || '')) || navs[1]; if (kwNav) { kwNav.click(); return JSON.stringify({ ready: true, clicked: true }); } } return JSON.stringify({ ready: false }); })()";

const PHASE3_JS = "(() => { const root = document.querySelector('#main-sellersprite-extension'); if (!root) return JSON.stringify({ ready: false, rows: [], text: '', empty: false, loading: false }); const body = (root.innerText || ''); const tables = root.querySelectorAll('table'); const rows = []; if (tables.length > 1) { const trs = tables[tables.length - 1].querySelectorAll('tr'); for (let i = 0; i < trs.length; i++) { const cells = Array.from(trs[i].querySelectorAll('td,th')).map(function(c){ return (c.innerText || '').trim(); }); if (cells.length >= 16 && /^\\d+$/.test(cells[1] || '')) rows.push(cells); } } const emptyMatch = /\\u6682\\u65e0\\u6570\\u636e|\\u672a\\u67e5\\u5230\\u76f8\\u5173\\u6570\\u636e|\\u65e0\\u76f8\\u5173\\u6570\\u636e|no data/i.test(body); const isLoading = /\\u67e5\\u8be2\\u4e2d|\\u8bf7\\u7a0d\\u5019|\\u52a0\\u8f7d\\u4e2d|loading/i.test(body); const isReady = rows.length > 0 || (emptyMatch && !isLoading); return JSON.stringify({ ready: isReady, loading: isLoading, empty: emptyMatch, rows: rows.slice(0, 100), text: body.slice(0, 1200) }); })()";

/** 确定性 browser-use 脚本（ASCII-only；stdin 喂入，stdout 输出观察 JSON）。 */
export function buildSellerSpriteCollectionScript(input: SellerSpriteCollectionInput): string {
  const url = amazonProductUrl(input);
  const lines = [
    "import os, json, re, time",
    "num = 0",
    "new_tab(" + JSON.stringify(url) + ")",
    "wait_for_load()",
    "def ev(expr):",
    "    return json.loads(js(expr))",
    "def raw(expr):",
    "    return js(expr)",
    "panel_found = False",
    "failure_hint = None",
    "last_obs = {'url': " + JSON.stringify(url) + ", 'title': '', 'text': ''}",
    "t_poll_start = time.time()",
    "while time.time() - t_poll_start < 20.0:",
    "    st = ev(" + JSON.stringify(PHASE1_JS) + ")",
    "    last_obs['url'] = st.get('url', last_obs['url'])",
    "    last_obs['title'] = st.get('title', last_obs['title'])",
    "    last_obs['text'] = st.get('text', last_obs['text'])",
    "    if st.get('isCaptcha'):",
    "        failure_hint = 'captcha_required'",
    "        break",
    "    if st.get('isLogin'):",
    "        failure_hint = 'login_required'",
    "        break",
    "    if st.get('panelFound'):",
    "        panel_found = True",
    "        break",
    "    wait(0.5)",
    "if not panel_found and not failure_hint:",
    "    failure_hint = 'panel_not_detected'",
    "if panel_found and not failure_hint:",
    "    t_nav_start = time.time()",
    "    while time.time() - t_nav_start < 5.0:",
    "        nst = ev(" + JSON.stringify(PHASE2_JS) + ")",
    "        if nst.get('ready'):",
    "            break",
    "        wait(0.5)",
    "raw_rows = []",
    "if panel_found and not failure_hint:",
    "    t_data_start = time.time()",
    "    data_ready = False",
    "    while time.time() - t_data_start < 15.0:",
    "        dst = ev(" + JSON.stringify(PHASE3_JS) + ")",
    "        last_obs['text'] = dst.get('text', last_obs['text'])",
    "        if dst.get('ready'):",
    "            raw_rows = dst.get('rows', [])",
    "            data_ready = True",
    "            break",
    "        wait(0.5)",
    "    if not data_ready and not failure_hint:",
    "        failure_hint = 'seller_sprite_keyword_timeout'",
    "kw = []",
    "for r in raw_rows:",
    "    def num(v):",
    "        m = re.match(r'^(\\d[\\d,]*\\.?\\d*)', v or '')",
    "        if not m: return None",
    "        try: return float(m.group(1).replace(',', ''))",
    "        except: return None",
    "    p = (r[2] or '').split(chr(10))",
    "    kw.append({ 'keyword': (p[0] if p else ''), 'keywordTranslation': (p[1] if len(p) > 1 else None), 'searchVolume': num(r[9]), 'abaWeeklyRank': num(r[8]), 'purchaseVolume': num(r[12]), 'adCompetitorCount': num(r[15]) })",
    "o = {}",
    "o['schema'] = 'browser-use-observation.v1'",
    "o['url'] = last_obs.get('url', " + JSON.stringify(url) + ")",
    "o['title'] = last_obs.get('title', '')",
    "o['bodyText'] = last_obs.get('text', '')",
    "o['panelMarker'] = bool(panel_found)",
    "o['observedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'",
    "o['failureHint'] = failure_hint",
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
    const hasCaptchaText = /captcha|robot|\u9a8c\u8bc1\u7801|characters you see below/i.test(value.bodyText);
    const hasLoginText = /sign in|log in|signin|login|\u767b\u5f55|\u5356\u5bb6\u7cbe\u7075\u7528\u6237\u767b\u5f55/i.test(value.bodyText);
    const hasTimeoutText = /\u67e5\u8be2\u4e2d|\u8bf7\u7a0d\u5019|\u52a0\u8f7d\u4e2d|loading/i.test(value.bodyText);
    const explicitHint = typeof value.failureHint === "string" ? value.failureHint : null;
    let failureHint: CollectorObservation["failureHint"] = null;
    if (hasCaptchaText || explicitHint === "captcha_required") {
      failureHint = "captcha_required";
    } else if (hasLoginText || explicitHint === "login_required") {
      failureHint = "login_required";
    } else if (explicitHint === "seller_sprite_keyword_timeout" || (value.panelMarker === true && hasTimeoutText && (!Array.isArray(value.keywords) || value.keywords.length === 0))) {
      failureHint = "seller_sprite_keyword_timeout";
    } else if (value.panelMarker === false || explicitHint === "panel_not_detected") {
      failureHint = "panel_not_detected";
    }
    const keywordItems = Array.isArray(value.keywords) ? value.keywords.map(function (item: unknown) { const r = isRecord2(item) ? item : {}; return { keyword: asStr(r.keyword) || "", keywordTranslation: asStr(r.keywordTranslation), searchVolume: asNum(r.searchVolume), abaWeeklyRank: asNum(r.abaWeeklyRank), purchaseVolume: asNum(r.purchaseVolume), competition: asNum(r.adCompetitorCount ?? r.competition) }; }).filter(function (item) { return item.keyword.length > 0; }).slice(0, 100) : [];
    return { schema: BROWSER_USE_OBSERVATION_SCHEMA, url: value.url, title: value.title, bodyText: value.bodyText, panelMarker: value.panelMarker, observedAt: value.observedAt, failureHint, keywords: keywordItems, competitors: [] };
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
  const failureReason = observation.failureHint !== null
    ? observation.failureHint
    : (!observation.panelMarker
      ? "panel_not_detected"
      : null);
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
    failureReason: failureReason as BrowserUseResearchPreview["failureReason"],
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
