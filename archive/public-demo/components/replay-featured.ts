/**
 * V4.1 — Featured Replay 服务端只读 loader。
 *
 * 只读 data/replay-bundles/*.json，复用 lib/v4/replay/schema 的 parseBundle / verifyBundleHash；
 * 派生：bundleId、业务字段（候选名 / 关键词 / 市场 / 链接 / 报告结论摘要 / 风险等级 / 缩略图来源）、
 * capturedAt/exportedAt、scanOk、redactionEntries、filesCount、bundleSha256 前 12 位、
 * 时间线步数、human_decision 数、Content Guard 展示项数。
 *
 * 语义约束（硬门禁）：
 *   - 主标题禁用 bundleId(UUID)：候选名取 data.candidate.name 等业务名，缺失 → null（诚实空态）；
 *   - 业务字段缺失 → null；缩略图仅允许真实图片引用，无资产 → null；
 *   - 所有统计均由真实 bundle 动态派生，禁止硬编码 74/5/11。
 * 本文件为 server-only 模块（因 lib/v4 禁改，故置于 components/v4 下，仅服务端 page 使用）。
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseBundle, verifyBundleHash, type ReplayBundle } from "@/lib/v4/replay/schema";
import type { FeaturedReplay } from "@/components/v4/home/heroLogic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** 候选名：data.candidate.name / productName / title；缺失 → null（禁用 bundleId 作业务标题）。 */
function resolveCandidateName(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  if (candidate) {
    const name = asStringOrNull(candidate.name ?? candidate.productName ?? candidate.title);
    if (name) return name;
  }
  return null;
}

/** 关键词：data.candidate.keyword（文本）；缺失 → null。 */
function resolveKeyword(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  return asStringOrNull(candidate && candidate.keyword);
}

/** 市场：data.candidate.market / marketplace，或 report.marketplace / commercial.marketplace。 */
function resolveMarket(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  const report = asRecord(data.report);
  const commercial = asRecord(data.commercial);
  const value = asStringOrNull(
    (candidate && (candidate.market ?? candidate.marketplace)) ??
    (report && report.marketplace) ??
    (commercial && commercial.marketplace),
  );
  return value;
}

/** 候选链接：data.candidate.link（真实商品/资产 URL）；缺失 → null。 */
function resolveLink(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const candidate = asRecord(data.candidate);
  return asStringOrNull(candidate && (candidate.link ?? candidate.url));
}

/** 报告结论摘要：data.report.summary；缺失 → null（无来源不伪造）。 */
function resolveSummary(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const report = asRecord(data.report);
  return asStringOrNull(report && report.summary);
}

/** 风险等级：由报告 conflicts / unknowns / gaps 诚实派生；无该信息 → null。 */
function deriveRiskLevel(bundle: ReplayBundle): string | null {
  const data = asRecord(bundle.data) ?? {};
  const report = asRecord(data.report);
  if (!report) return null;
  const conflicts = Array.isArray(report.conflicts) ? report.conflicts : [];
  const unknowns = Array.isArray(report.unknowns) ? report.unknowns : [];
  const gaps = Array.isArray(report.gaps) ? report.gaps : [];
  const conflictCount = conflicts.length;
  const gapCount = unknowns.length + gaps.length;
  if (conflictCount > 0) return "存在信息冲突";
  if (gapCount > 0) return "存在信息缺口";
  return "未见明显风险";
}

/** 缩略图来源：仅当 bundle 内含真实图片引用（URL / 图片源）才返回；无资产 → null。 */
function resolveThumbnail(bundle: ReplayBundle): { src: string; alt: string } | null {
  const data = asRecord(bundle.data) ?? {};
  const content = asRecord(data.content);
  const images = asRecord(content && content.images);
  if (images) {
    const candidates = [
      images.mainImageUrl,
      images.primaryImageUrl,
      images.coverUrl,
      images.thumbnailUrl,
      images.imageUrl,
      images.src,
      images.url,
    ];
    for (const cand of candidates) {
      const src = asStringOrNull(cand);
      if (src) return { src, alt: "脱敏案例缩略图" };
    }
  }
  return null;
}

/** 时间线步数：优先 data.timeline，回退 data.events（与 ReplayView.resolveTimelineSteps 计数一致）。 */
function countTimelineSteps(bundle: ReplayBundle): number {
  const data = asRecord(bundle.data) ?? {};
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  if (timeline.length > 0) {
    return timeline.filter((raw) => typeof raw === "string" || asRecord(raw)).length;
  }
  const events = Array.isArray(data.events) ? data.events : [];
  return events.filter((raw) => asRecord(raw)).length;
}

/** human_decision 数：优先 data.gates 记录数，回退 events 中 type=human_decision 数量。 */
function countHumanDecisions(bundle: ReplayBundle): number {
  const data = asRecord(bundle.data) ?? {};
  const gates = Array.isArray(data.gates) ? data.gates : [];
  if (gates.length > 0) return gates.filter((g) => asRecord(g)).length;
  const events = Array.isArray(data.events) ? data.events : [];
  return events.filter((e) => {
    const r = asRecord(e);
    return !!r && asString(r.type) === "human_decision";
  }).length;
}

/** Content Guard 展示项数：与 ReplayView.resolveContentChecks 返回项数一致。 */
function countContentChecks(bundle: ReplayBundle): number {
  const data = asRecord(bundle.data) ?? {};
  const content = asRecord(data.content);
  if (!content) return 0;
  const candidates = Array.isArray(content.guards)
    ? content.guards
    : Array.isArray(content.checks)
      ? content.checks
      : Array.isArray(content.results)
        ? content.results
        : [];
  if (candidates.length > 0) {
    return candidates.filter((c) => typeof c === "string" || asRecord(c)).length;
  }
  let count = 0;
  if (asRecord(content.listing)) count += 1;
  const images = asRecord(content.images);
  const visual = asRecord(images && images.checks);
  if (visual) {
    count += 1;
    if (Array.isArray(visual.checks)) count += visual.checks.length;
  }
  return count;
}

/** 由单个合法 bundle 派生 FeaturedReplay 统计（纯函数，供 loader 与测试复用）。 */
export function resolveReplayMetrics(bundle: ReplayBundle): FeaturedReplay {
  return {
    bundleId: bundle.bundleId,
    candidateName: resolveCandidateName(bundle),
    keyword: resolveKeyword(bundle),
    market: resolveMarket(bundle),
    link: resolveLink(bundle),
    riskLevel: deriveRiskLevel(bundle),
    summary: resolveSummary(bundle),
    thumbnail: resolveThumbnail(bundle),
    capturedAt: bundle.capturedAt,
    exportedAt: bundle.exportedAt,
    scanOk: bundle.redactionReport.scanOk,
    redactionEntries: bundle.redactionReport.entries.length,
    filesCount: bundle.manifest.files.length,
    bundleSha256Short: bundle.manifest.bundleSha256.slice(0, 12),
    timelineSteps: countTimelineSteps(bundle),
    humanDecisions: countHumanDecisions(bundle),
    guardItems: countContentChecks(bundle),
  };
}

/** 读取 data/replay-bundles 中最新（按 capturedAt）合法的脱敏 bundle；无则返回 null。 */
export async function loadFeaturedReplay(): Promise<FeaturedReplay | null> {
  const dir = path.join(process.cwd(), "data", "replay-bundles");
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  let best: FeaturedReplay | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, entry.name), "utf8");
    } catch {
      continue;
    }
    const parsed = parseBundle(raw);
    if (!parsed.ok) continue;
    const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");
    if (!verifyBundleHash(parsed.bundle, sha256)) continue;
    const derived = resolveReplayMetrics(parsed.bundle);
    if (!best || (derived.capturedAt || "").localeCompare(best.capturedAt || "") > 0) best = derived;
  }
  return best;
}
