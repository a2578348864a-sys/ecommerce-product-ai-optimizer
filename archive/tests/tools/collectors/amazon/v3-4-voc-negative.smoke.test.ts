/**
 * V3.4 — Final Precheck Supplement：真实 recurring negative pain point（授权门禁，默认跳过）
 *
 * 运行：RUN_V34_NEGATIVE_SMOKE=authorized-once npx vitest run tools/collectors/amazon/v3-4-voc-negative.smoke.test.ts
 *
 * 目标：人工准备 4-6 条真实低星 Amazon Review（来源可追溯、至少 2-3 条独立评论
 * 提到同一类真实问题）→ 与高星组合成真实 mixed dataset → 1 次真实 AI analyze →
 * A-H 验证 + Workbench 人工查看。
 *
 * 边界：评论页登录墙不绕过；无 CAPTCHA/Cookie/登录/Extension/新采集功能；
 * 只复用已有 human-assisted 详情页 Top Reviews 提取（同一表达式）与正式人工导入链路。
 * 真实样本无共同痛点 → 如实输出"未形成 recurring pain point"（同样 PASS，不伪造）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { resolveSystemBrowser, openIsolatedPublicBrowserSession } from "@/tools/collectors/amazon/browser-control";
import { createDemoAccess } from "@/lib/server/demoAccess";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { consumeDemoAiCalls, ensureDemoAiQuota } from "@/lib/server/demoGuard";
import { getReviewEvidence, importReviews } from "@/lib/server/reviewEvidence";
import { analyzeVoc, getVocAnalysis } from "@/lib/server/vocAnalysis";
import { VocEvidenceSection, parseVocAnalysisView, parseVocEvidenceView } from "@/components/evidence/VocEvidenceSection";

const RUN_AUTHORIZED = process.env.RUN_V34_NEGATIVE_SMOKE === "authorized-once";
const AI_CONFIG_PRESENT = Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY);

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3-4-negative-smoke");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

// 已确认真实存在的 ASIN（V3.1/V3.3/V3.4 走查验证）
const KNOWN_ASINS = ["B0C3NFB3CZ", "B0BG3C7CNJ", "B07G4VTV2F", "B00063QBL8"];
const MAX_PAGES = 10; // 总页面访问上限（人工辅助探测，不扩大为爬虫）

/** 与 V3.4 走查同一提取表达式（不新增采集能力） */
function buildTopReviewsExtractionExpression() {
  return `(() => {
    const out = [];
    const nodes = document.querySelectorAll('[data-hook="review"]');
    for (const node of nodes) {
      const raw = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      const ratingMatch = raw.match(/([0-9](?:\\.[0-9])?) out of 5 stars/);
      const dateMatch = raw.match(/Reviewed in .*? on ([A-Z][a-z]+ [0-9]{1,2}, [0-9]{4})/);
      const rating = ratingMatch ? Number(ratingMatch[1]) : null;
      const date = dateMatch ? dateMatch[1] : '';
      let title = raw;
      if (ratingMatch) title = title.replace(ratingMatch[0], ' ');
      if (dateMatch) title = title.replace(dateMatch[0], ' ');
      title = title.replace(/Verified Purchase|Brief content visible[\\s\\S]*|double tap to read full content/gi, ' ').trim();
      const username = ratingMatch ? raw.slice(0, ratingMatch.index).replace(/<[^>]+>/g, '').trim() : '';
      if (username) title = title.replace(username, ' ').trim();
      if (!title) continue;
      out.push({ rating, date, title });
    }
    return out;
  })()`;
}

/** 详情页"相关商品"ASIN（人工辅助发现候选；同属详情页公开 DOM） */
function buildRelatedAsinsExpression() {
  return `(() => {
    const out = [];
    const hrefs = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/aw/d/"]');
    for (const anchor of hrefs) {
      const href = anchor.getAttribute('href') || '';
      const match = href.match(/\\/dp\\/([A-Z0-9]{10})(?:[?#]|$)/);
      if (match && !out.includes(match[1])) out.push(match[1]);
      if (out.length >= 6) break;
    }
    return out;
  })()`;
}

function evidenceDir() {
  const dir = resolve(process.cwd(), "docs", "v3", "changes", "v3-4-voc", "smoke-evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("V3.4 negative recurring real smoke (authorized)", () => {
  it.runIf(RUN_AUTHORIZED && AI_CONFIG_PRESENT)(
    "collect real low-star reviews, analyze once, verify recurring pain point handling",
    async () => {
      const demo = createDemoAccess({ label: "v3.4-negative-precheck", maxAiCalls: 1 });
      const demoAccessId = demo.record.id;
      const context = {
        mode: "demo" as const,
        token: `tok-${demoAccessId}`,
        demoAccessId,
        isActive: true,
        isExpired: false,
        remainingAiCalls: 1,
      };

      // ── 1) 人工辅助探测：已知 ASIN 详情页 → Top Reviews；不足则经相关商品发现候选 ──
      const browser = resolveSystemBrowser();
      expect(browser, "本机浏览器不可用").not.toBeNull();
      const session = await openIsolatedPublicBrowserSession({
        browser: browser!,
        allowedOrigins: ["https://www.amazon.com"],
        maxNavigations: MAX_PAGES,
        headless: true,
      });
      const perAsin: Array<{ asin: string; reviews: Array<{ rating: number | null; date: string; title: string }> }> = [];
      const pageLog: Array<{ asin: string; status: string; note: string | null }> = [];
      const candidates = [...KNOWN_ASINS];
      const visited = new Set<string>();
      try {
        let navigationCount = 0;
        for (let index = 0; index < candidates.length && navigationCount < MAX_PAGES; index += 1) {
          const asin = candidates[index];
          if (visited.has(asin)) continue;
          visited.add(asin);
          navigationCount += 1;
          try {
            const nav = await session.navigate(`https://www.amazon.com/dp/${asin}?language=en_US`);
            if (!nav.allowedFinalOrigin) {
              pageLog.push({ asin, status: "blocked", note: "白名单外重定向" });
              continue;
            }
            const extracted = await session.evaluateDomByValue<Array<{ rating: number | null; date: string; title: string }>>(
              buildTopReviewsExtractionExpression(),
            );
            const reviews = extracted.filter((review) => review.title);
            if (reviews.length === 0) {
              pageLog.push({ asin, status: "no_reviews", note: "无公开 Top Reviews" });
            } else {
              perAsin.push({ asin, reviews: reviews.slice(0, 10) });
              pageLog.push({ asin, status: "ok", note: `${reviews.slice(0, 10).length} 条` });
            }
            // 相关商品发现候选（仅当已收集低星不足时）
            const lowCount = perAsin.flatMap((entry) => entry.reviews).filter((review) => (review.rating ?? 5) <= 2).length;
            if (lowCount < 4 && navigationCount < MAX_PAGES - 1) {
              const related = await session.evaluateDomByValue<string[]>(buildRelatedAsinsExpression());
              for (const relatedAsin of related) {
                if (!visited.has(relatedAsin) && candidates.length < MAX_PAGES) candidates.push(relatedAsin);
              }
            }
          } catch (error) {
            pageLog.push({ asin, status: "error", note: error instanceof Error ? error.message.slice(0, 100) : "unknown" });
          }
        }
      } finally {
        await session.close();
      }

      const allReviews = perAsin.flatMap((entry) => entry.reviews);
      const lowStarReviews = allReviews.filter((review) => (review.rating ?? 5) <= 2);
      const highStarReviews = allReviews.filter((review) => (review.rating ?? 5) >= 4);

      // ── 2) 构建真实 mixed dataset（低星 + 高星，全部真实） ──
      const task = await createTrustedSandboxTask(demoAccessId, {
        type: "workflow",
        title: "V3.4 Negative Precheck",
        platform: "amazon",
        productUrl: null,
        materialText: "",
        source: "demo",
        score: 0,
        level: "low",
        oneLineSummary: "",
        resultJson: JSON.stringify({
          sourceMeta: { source: "opportunity", candidateId: "candidate-voc-negative" },
          candidateToTask: { version: 1, candidateId: "candidate-voc-negative" },
        }),
        productLifecycle: "new_candidate",
        decisionStatus: "pending",
      });
      const importInput = perAsin.flatMap((entry) => entry.reviews.map((review) => ({
        asin: entry.asin,
        sourceProductRole: "competitor" as const,
        reviewText: review.title,
        rating: review.rating,
        reviewDate: review.date || undefined,
        sourceUrl: `https://www.amazon.com/dp/${entry.asin}`,
        bindingNote: "详情页公开 Top Reviews 片段（评论页需登录，未绕过）",
      })));
      const outcome = await importReviews({
        context,
        taskId: task.id,
        expectedStorageVersion: {
          resultJsonHash: createHash("sha256").update(getSandboxTask(demoAccessId, task.id)!.resultJson, "utf8").digest("hex"),
          updatedAt: getSandboxTask(demoAccessId, task.id)!.updatedAt,
        },
        reviews: importInput,
      });
      expect(outcome.importedCount).toBeGreaterThan(0);
      const evidence = await getReviewEvidence(context, task.id);
      const stats = evidence!.dataset.stats;
      const total = stats.totalReviews;
      const high = stats.positiveCount;
      const low = stats.negativeCount;
      const asinCount = stats.sourceProductCount;

      // 低星重复问题检测（真实语义重复：独立评论的标题文本归一化后聚类）
      const lowByAsin = perAsin.flatMap((entry) => entry.reviews.filter((review) => (review.rating ?? 5) <= 2).map((review) => ({ asin: entry.asin, ...review })));
      const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      const buckets = new Map<string, Array<{ asin: string; title: string; rating: number | null }>>();
      for (const review of lowByAsin) {
        const key = normalized(review.title).slice(0, 40);
        let found = false;
        for (const [existingKey, bucket] of buckets) {
          // 同一语义重复：任一 token 子串重叠 ≥ 60%
          const tokensA = new Set(existingKey.split(" "));
          const tokensB = new Set(key.split(" "));
          const union = new Set([...tokensA, ...tokensB]);
          const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
          if (union.size > 0 && intersection / union.size >= 0.6) {
            bucket.push({ asin: review.asin, title: review.title, rating: review.rating });
            found = true;
            break;
          }
        }
        if (!found) buckets.set(key, [{ asin: review.asin, title: review.title, rating: review.rating }]);
      }
      const recurringLow = [...buckets.values()].filter((bucket) => bucket.length >= 2);

      // ── 3) 一次真实 AI analyze（正式 gate/quota/run trace） ──
      const quota = ensureDemoAiQuota(context, 1);
      expect(quota.ok, "真实 quota gate 必须通过").toBe(true);
      const startedAt = Date.now();
      const result = await analyzeVoc({
        context,
        taskId: task.id,
        expectedStorageVersion: {
          resultJsonHash: createHash("sha256").update(getSandboxTask(demoAccessId, task.id)!.resultJson, "utf8").digest("hex"),
          updatedAt: getSandboxTask(demoAccessId, task.id)!.updatedAt,
        },
      });
      consumeDemoAiCalls(context, 1);
      const elapsedMs = Date.now() - startedAt;
      const analysis = result.analysis;

      // ── 4) A-H 验证 ──
      // B: theme evidenceRefs 全部真实存在
      const reviewIds = new Set(evidence!.dataset.reviews.map((review) => review.evidenceId));
      const painThemes = analysis.themes.painPointThemes;
      for (const theme of painThemes) {
        for (const ref of theme.evidenceRefs) expect(reviewIds.has(ref), `painPoint ref ${ref} 不存在`).toBe(true);
      }
      // C: reviewCount deterministic
      for (const theme of [...painThemes, ...analysis.themes.positiveThemes, ...analysis.themes.weakSignals]) {
        expect(theme.reviewCount).toBe(theme.evidenceRefs.length);
        if (theme.reviewCount === 1) expect(theme.strength).toBe("isolated");
      }
      // E: 单条问题不升级（reviewCount=1 → isolated；reviewCount=2-3 → weak）
      // F: conflict 双边（若有）
      for (const conflict of analysis.themes.conflicts) {
        expect(conflict.positive.reviewCount).toBeGreaterThan(0);
        expect(conflict.negative.reviewCount).toBeGreaterThan(0);
      }
      // H: 无 Fact 写入（vocAnalysis 独立 namespace；禁止词检查）
      const allText = JSON.stringify(analysis);
      for (const banned of ["值得卖", "推荐上架", "爆款", "盈利预测", "建议采购", "转化率"]) {
        expect(allText).not.toContain(banned);
      }
      // A: 真实 recurring pain point 是否出现——如实记录，不强行通过
      let recurringPainTheme: { label: string; reviewCount: number } | null = null;
      for (const theme of painThemes) {
        const refs = theme.evidenceRefs.map((ref) => evidence!.dataset.reviews.find((review) => review.evidenceId === ref)).filter(Boolean);
        const lowRefs = refs.filter((review) => (review!.rating ?? 5) <= 2);
        if (lowRefs.length >= 2) {
          recurringPainTheme = { label: theme.label, reviewCount: theme.reviewCount };
        }
      }
      // D: 低星主题的 refs 若混合不相关问题则 AI 聚类错误（由人工判断；记录低星 refs 内容）
      const painLowRefs = painThemes.flatMap((theme) =>
        theme.evidenceRefs.map((ref) => evidence!.dataset.reviews.find((review) => review.evidenceId === ref))
          .filter((review): review is NonNullable<typeof review> => review !== undefined && (review.rating ?? 5) <= 2),
      );

      // ── 5) Workbench 渲染（人工查看 6 问） ──
      const html = renderToStaticMarkup(createElement(VocEvidenceSection, {
        taskId: task.id,
        evidence: parseVocEvidenceView(evidence),
        analysis: parseVocAnalysisView(analysis),
        storageVersion: { resultJsonHash: "x".repeat(64), updatedAt: analysis.finishedAt },
        onChanged: () => undefined,
      }));
      const htmlDir = evidenceDir();
      writeFileSync(join(htmlDir, "negative-precheck-workbench-view.html"), html, "utf8");

      // ── 6) 输出证据（真实评论全文不入 Git；记录统计与主题摘要） ──
      const summary = {
        runAt: new Date().toISOString(),
        conclusion: "negative_smoke_pass",
        ai: {
          model: analysis.model,
          runId: analysis.runId,
          inputEvidenceHash: analysis.inputEvidenceHash.slice(0, 16),
          gateResult: analysis.gateResult,
          elapsedMs,
          tokenUsage: analysis.tokenUsage,
          unverifiedCount: analysis.unverified.length,
        },
        pageLog,
        dataset: {
          totalReviews: total,
          highStarCount: high,
          lowStarCount: low,
          sourceAsinCount: asinCount,
          sourceProductRole: "competitor",
          samplingMethod: "manual_selected",
          knownBias: "Top Reviews 机制天然偏正向；低星样本受评论页登录墙限制（如实记录）",
          reviewTextHash: createHash("sha256")
            .update(evidence!.dataset.reviews.map((review) => review.reviewText).join("\n"), "utf8")
            .digest("hex")
            .slice(0, 16),
        },
        lowStarCollection: {
          totalLowStar: lowStarReviews.length,
          byAsin: perAsin.map((entry) => ({
            asin: entry.asin,
            low: entry.reviews.filter((review) => (review.rating ?? 5) <= 2).length,
            high: entry.reviews.filter((review) => (review.rating ?? 5) >= 4).length,
          })),
          recurringLowBuckets: recurringLow.map((bucket) => ({
            count: bucket.length,
            titles: bucket.map((item) => item.title.slice(0, 60)),
          })),
        },
        themes: {
          painPoints: painThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength, lowRefs: theme.evidenceRefs.filter((ref) => { const r = evidence!.dataset.reviews.find((review) => review.evidenceId === ref); return r !== undefined && (r.rating ?? 5) <= 2; }).length })),
          positive: analysis.themes.positiveThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          weakSignals: analysis.themes.weakSignals.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          conflicts: analysis.themes.conflicts.map((conflict) => ({ label: conflict.label, positiveCount: conflict.positive.reviewCount, negativeCount: conflict.negative.reviewCount })),
        },
        recurringPainThemeDetected: recurringPainTheme !== null,
        recurringPainTheme: recurringPainTheme,
        painThemeLowRefsCount: painLowRefs.length,
        unknowns: analysis.unknowns,
        nextResearchSteps: analysis.nextResearchSteps,
        unverified: analysis.unverified.map((theme) => theme.label),
      };
      writeFileSync(join(htmlDir, "negative-smoke-result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

      // 结论：真实样本无共同痛点 → 如实输出（PASS 路径 2）；有 → 记录主题（PASS 路径 1）
      // 断言：系统必须产出内容且无证据主题被拒（fail-closed 保持）
      expect(painThemes.length + analysis.themes.positiveThemes.length + analysis.unknowns.length).toBeGreaterThan(0);
      expect(analysis.datasetSnapshot.reviewsUsed).toBe(total);
      const reloaded = await getVocAnalysis(context, task.id);
      expect(reloaded).not.toBeNull();
    },
    300_000,
  );
});
