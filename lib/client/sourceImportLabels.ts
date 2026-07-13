/**
 * Phase 4-D.8 — Source Import Labels & Explainability Helpers
 *
 * Pure functions — no side effects, no API calls, no DB, no AI.
 * Maps machine-readable candidateType/failureReason to user-facing Chinese labels.
 */

// ── candidateType ──

export type CandidateType = "product_candidate" | "category_hint" | "trend_signal" | "rejected";

export interface CandidateTypeLabel {
  type: CandidateType | "unknown";
  label: string;
  description: string;
  tone: "green" | "amber" | "blue" | "slate" | "gray";
  /** Should this be counted as a valid product candidate? */
  isEffectiveCandidate: boolean;
}

const CANDIDATE_TYPE_MAP: Record<string, CandidateTypeLabel> = {
  product_candidate: {
    type: "product_candidate",
    label: "商品候选",
    description: "可进入人工复核，确认后可导入候选池",
    tone: "green",
    isEffectiveCandidate: true,
  },
  category_hint: {
    type: "category_hint",
    label: "类目提示",
    description: "不是具体商品，适合参考品类方向",
    tone: "amber",
    isEffectiveCandidate: false,
  },
  trend_signal: {
    type: "trend_signal",
    label: "趋势信号",
    description: "只代表话题或趋势线索，不等于商品候选",
    tone: "blue",
    isEffectiveCandidate: false,
  },
  rejected: {
    type: "rejected",
    label: "已过滤",
    description: "低质或非商品内容，不建议导入",
    tone: "slate",
    isEffectiveCandidate: false,
  },
};

const FALLBACK_LABEL: CandidateTypeLabel = {
  type: "unknown",
  label: "待复核",
  description: "系统未分类，请人工判断是否为商品候选",
  tone: "gray",
  isEffectiveCandidate: false,
};

export function getCandidateTypeLabel(raw: unknown): CandidateTypeLabel {
  if (typeof raw === "string" && raw in CANDIDATE_TYPE_MAP) {
    return CANDIDATE_TYPE_MAP[raw];
  }
  return FALLBACK_LABEL;
}

// ── candidateType tone → Tailwind classes ──

const TONE_CLASSES: Record<string, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  slate: "border-slate-200 bg-slate-50 text-slate-500",
  gray: "border-slate-200 bg-slate-50 text-slate-400",
};

export function getCandidateTypeBadgeClass(tone: string): string {
  return TONE_CLASSES[tone] || TONE_CLASSES.gray;
}

// ── failureReason ──

export interface FailureReasonLabel {
  reason: string;
  title: string;
  description: string;
  recommendation: string;
}

const FAILURE_REASON_MAP: Record<string, FailureReasonLabel> = {
  timeout: {
    reason: "timeout",
    title: "请求超时",
    description: "来源响应过慢，超过当前等待限制。",
    recommendation: "建议换用响应更快的来源，或稍后重试。",
  },
  batch_timeout: {
    reason: "batch_timeout",
    title: "批次超时",
    description: "本批公开 URL 的总抓取时间已达到安全上限。",
    recommendation: "请减少本次 URL 数量，或分批重试。",
  },
  response_too_large: {
    reason: "response_too_large",
    title: "页面内容过大",
    description: "该页面内容超过当前安全限制，暂时无法完整抓取。",
    recommendation: "建议使用内容更精简的页面（如博客列表、RSS）。",
  },
  fetch_failed: {
    reason: "fetch_failed",
    title: "请求失败",
    description: "可能被来源阻断，或当前网络环境不稳定。",
    recommendation: "该来源可能限制自动访问，建议换用其他公开可访问来源。",
  },
  http_error: {
    reason: "http_error",
    title: "来源返回错误",
    description: "公开来源返回了 4xx、429 或 5xx 状态，未将错误页当作证据。",
    recommendation: "请确认页面可公开访问，或稍后换用其他来源。",
  },
  unsupported_content_type: {
    reason: "unsupported_content_type",
    title: "内容类型不支持",
    description: "该地址返回的不是受支持的 HTML、文本、XML、RSS 或 JSON。",
    recommendation: "请改用具体的公开网页、RSS 或 sitemap 地址。",
  },
  unsupported_content_encoding: {
    reason: "unsupported_content_encoding",
    title: "压缩格式不支持",
    description: "来源未按安全请求返回可直接检查的文本内容。",
    recommendation: "请换用无需特殊压缩处理的公开来源。",
  },
  js_rendered_source_not_supported: {
    reason: "js_rendered_source_not_supported",
    title: "依赖浏览器渲染",
    description: "该页面必须加载 JavaScript 才能显示内容，当前 Alpha 暂不支持。",
    recommendation: "建议使用提供 RSS 或纯 HTML 版本的来源。",
  },
  anti_bot_challenge: {
    reason: "anti_bot_challenge",
    title: "检测到验证挑战",
    description: "该来源要求浏览器验证或人机检查，当前不会绕过。",
    recommendation: "建议换用 Shopify Blog 或其他公开可访问来源。",
  },
  robots_disallowed: {
    reason: "robots_disallowed",
    title: "robots.txt 受限",
    description: "该来源的 robots.txt 不允许自动抓取当前路径。",
    recommendation: "当前遵守 robots 协议，不会强行抓取。",
  },
  robots_unavailable: {
    reason: "robots_unavailable",
    title: "robots.txt 无法确认",
    description: "系统无法可靠读取或判断该来源的抓取规则，因此已停止访问正文。",
    recommendation: "请稍后重试，或换用抓取规则明确的公开来源。",
  },
  ssrf_blocked: {
    reason: "ssrf_blocked",
    title: "安全限制",
    description: "该地址被安全策略阻止（内网地址或禁止目标）。",
    recommendation: "请确认输入的是公开 URL（http/https）。",
  },
  invalid_url: {
    reason: "invalid_url",
    title: "URL 无效",
    description: "无法解析该地址，请检查格式。",
    recommendation: "URL 应以 http:// 或 https:// 开头。",
  },
  redirect_invalid: {
    reason: "redirect_invalid",
    title: "重定向被阻止",
    description: "来源跳转次数过多、目标无效或目标未通过安全检查。",
    recommendation: "请直接提交最终公开页面地址。",
  },
};

const FALLBACK_FAILURE_LABEL: FailureReasonLabel = {
  reason: "unknown",
  title: "未知原因",
  description: "该来源暂时无法导入，原因未明确识别。",
  recommendation: "建议换一个更稳定的公开来源尝试。",
};

export function getFailureReasonLabel(raw: unknown): FailureReasonLabel {
  if (typeof raw === "string" && raw in FAILURE_REASON_MAP) {
    return FAILURE_REASON_MAP[raw];
  }
  return { ...FALLBACK_FAILURE_LABEL, reason: typeof raw === "string" ? raw : "unknown" };
}

/**
 * Extract machine-readable failureReason from a warning string.
 * Warnings may contain `[failure_reason]` tags appended by the API.
 */
export function extractFailureReason(warning: string): string | null {
  const match = warning.match(/\[([a-z_]+)\]\s*$/);
  return match ? match[1] : null;
}

// ── Source Tiers ──

export interface SourceTier {
  key: string;
  name: string;
  description: string;
  tone: string; // visual tone key
  examples: { label: string; url: string }[];
  recommendation: string;
}

export const SOURCE_IMPORT_TIERS: SourceTier[] = [
  {
    key: "recommended",
    name: "推荐来源",
    description: "当前最稳定，可直接获取产品相关候选",
    tone: "green",
    examples: [
      { label: "Shopify Blog", url: "https://www.shopify.com/blog" },
    ],
    recommendation: "优先使用，候选质量稳定，适合日常找品参考。",
  },
  {
    key: "partial",
    name: "半可用来源",
    description: "可提供榜单/类目/商品线索，可能含噪音需人工复核",
    tone: "amber",
    examples: [
      { label: "Amazon Best Sellers", url: "https://www.amazon.com/Best-Sellers/zgbs" },
    ],
    recommendation: "可用，但部分结果为类目名而非具体商品，需区分 category_hint。",
  },
  {
    key: "trend",
    name: "趋势参考来源",
    description: "可作为趋势或话题信号，不是商品候选",
    tone: "blue",
    examples: [
      { label: "GitHub Trending", url: "https://github.com/trending" },
      { label: "Hacker News（未来可评估公开 API）", url: "https://news.ycombinator.com" },
    ],
    recommendation: "仅适合了解趋势话题，不能直接生成商品候选。",
  },
  {
    key: "unsupported",
    name: "暂不支持来源",
    description: "当前 Alpha 不处理，不建议继续尝试",
    tone: "slate",
    examples: [
      { label: "Product Hunt", url: "https://www.producthunt.com" },
      { label: "AliExpress", url: "https://www.aliexpress.com" },
      { label: "Reddit", url: "https://www.reddit.com/r/dropship/" },
      { label: "CNN / Wikipedia", url: "https://edition.cnn.com/business" },
    ],
    recommendation: "这些来源依赖 JS 渲染、反爬验证或需要 API 授权，当前 Alpha 不会绕过。",
  },
];

/**
 * Pre-import hint shown near the URL input area.
 */
export const SOURCE_IMPORT_HINT =
  "建议优先使用 Shopify Blog 或产品榜单类页面；新闻、百科、社交平台、JS 渲染页面可能无法生成有效商品候选。";
