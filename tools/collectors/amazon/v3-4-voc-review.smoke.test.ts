/**
 * V3.4 — 真实业务走查（授权门禁，默认跳过）
 *
 * 运行：RUN_V34_REVIEW_SMOKE=authorized-once npx vitest run tools/collectors/amazon/v3-4-voc-review.smoke.test.ts
 *
 * 数据来源（任务书五节降级路径）：
 * - 评论页 /product-reviews/{ASIN} 在当前环境重定向到 Amazon 登录墙（诊断证据见
 *   smoke-evidence/review-page-diag.txt）→ **不绕过**。
 * - 改用**商品详情页公开可见的 "Top reviews" 片段**（真实星级/日期/标题，可绑定 ASIN，
 *   sourceUrl 可人工核验）。正文在详情页折叠不可见 → 如实记录为已知限制。
 *
 * 流程：human-assisted 浏览器获取 3 个真实 ASIN 的 Top Reviews → 经真实导入链路进入
 * sandbox Dataset → 验证实体绑定 / 去重 / 样本统计 / 有界存储。
 *
 * 说明：本 walkthrough 环境无 AI 密钥（功能 worktree 不复制 .env*），
 * AI 分析部分由 Golden Eval（mock AI 全链路）与 route 测试覆盖；
 * 真实 AI Smoke 留待集成树密钥环境执行（最终报告记录）。
 *
 * 安全：不保存完整 HTML；真实评论只写入临时 sandbox（不入 Git）；
 * 走查后输出统计摘要到 docs/v3/changes/v3-4-voc/smoke-evidence/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveSystemBrowser, openIsolatedPublicBrowserSession } from "@/tools/collectors/amazon/browser-control";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { getReviewEvidence, importReviews } from "@/lib/server/reviewEvidence";

const RUN_AUTHORIZED = process.env.RUN_V34_REVIEW_SMOKE === "authorized-once";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3-4-voc-smoke");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const DEMO = "smoke-voc-visitor";
// V3.1/V3.3 已确认真实存在的 Amazon 商品（杯具/午餐盒类，跨价格带与评论量）
const WALK_ASINS = [
  { asin: "B0C3NFB3CZ", role: "competitor" as const },
  { asin: "B0BG3C7CNJ", role: "competitor" as const },
  { asin: "B07G4VTV2F", role: "competitor" as const },
];

function visitorContext() {
  return {
    mode: "demo" as const,
    token: `tok-${DEMO}`,
    demoAccessId: DEMO,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function toStorageVersion(taskId: string) {
  const task = getSandboxTask(DEMO, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

/** 详情页 Top Reviews 提取表达式（只读 DOM；星级/日期/标题真实公开字段） */
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
      // 用户名 = rating 之前的文本（img 无 alt，从文本节点推断：删掉 rating 前非标题杂质）
      const username = ratingMatch ? raw.slice(0, ratingMatch.index).replace(/<[^>]+>/g, '').trim() : '';
      if (username) title = title.replace(username, ' ').trim();
      if (!title) continue;
      out.push({ rating, date, title });
    }
    return out;
  })()`;
}

function evidenceDir() {
  const dir = resolve(process.cwd(), "docs", "v3", "changes", "v3-4-voc", "smoke-evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("V3.4 real review business walkthrough (authorized)", () => {
  it.runIf(RUN_AUTHORIZED)(
    "fetches real Top Reviews via human-assisted browser, imports them through the real pipeline, and verifies dataset integrity",
    async () => {
      const context = visitorContext();
      const browser = resolveSystemBrowser();
      expect(browser, "本机浏览器不可用").not.toBeNull();
      const session = await openIsolatedPublicBrowserSession({
        browser: browser!,
        allowedOrigins: ["https://www.amazon.com"],
        maxNavigations: WALK_ASINS.length,
        headless: true,
      });

      const fetched: Array<{ asin: string; role: string; reviews: Array<{ rating: number | null; date: string; title: string }> }> = [];
      const pageResults: Array<{ asin: string; status: string; note: string | null }> = [];
      try {
        for (const { asin, role } of WALK_ASINS) {
          try {
            const nav = await session.navigate(`https://www.amazon.com/dp/${asin}?language=en_US`);
            if (!nav.allowedFinalOrigin) {
              pageResults.push({ asin, status: "blocked_redirect", note: "重定向到白名单外（可能验证码/登录墙）" });
              continue;
            }
            const extracted = await session.evaluateDomByValue<Array<{ rating: number | null; date: string; title: string }>>(
              buildTopReviewsExtractionExpression(),
            );
            const reviews = extracted.filter((review) => review.title);
            if (reviews.length === 0) {
              pageResults.push({ asin, status: "no_reviews_extracted", note: "详情页无公开 Top Reviews 片段" });
              continue;
            }
            fetched.push({ asin, role, reviews: reviews.slice(0, 10) });
            pageResults.push({ asin, status: "ok", note: `提取 ${reviews.slice(0, 10).length} 条 Top Reviews` });
          } catch (error) {
            pageResults.push({ asin, status: "error", note: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
          }
        }
      } finally {
        await session.close();
      }

      const okAsins = fetched.filter((entry) => entry.reviews.length > 0);
      if (okAsins.length === 0) {
        writeFileSync(
          join(evidenceDir(), "walkthrough-result.json"),
          `${JSON.stringify({ runAt: new Date().toISOString(), conclusion: "review_page_unavailable", pageResults }, null, 2)}\n`,
          "utf8",
        );
        throw new Error(`公开评论片段不可获取（${pageResults.map((p) => `${p.asin}:${p.status}`).join("、")}）——如实降级，不绕过。`);
      }

      // 通过真实导入链路进入 sandbox Dataset
      const task = await createTrustedSandboxTask(DEMO, {
        type: "workflow",
        title: "V3.4 VOC Walkthrough",
        platform: "amazon",
        productUrl: null,
        materialText: "",
        source: "demo",
        score: 0,
        level: "low",
        oneLineSummary: "",
        resultJson: JSON.stringify({
          sourceMeta: { source: "opportunity", candidateId: "candidate-voc-walkthrough" },
          candidateToTask: { version: 1, candidateId: "candidate-voc-walkthrough" },
        }),
        productLifecycle: "new_candidate",
        decisionStatus: "pending",
      });
      const reviews = okAsins.flatMap((entry) => entry.reviews.map((review) => ({
        asin: entry.asin,
        sourceProductRole: entry.role as "current_candidate" | "competitor",
        reviewText: review.title,
        rating: review.rating,
        reviewDate: review.date || undefined,
        sourceUrl: `https://www.amazon.com/dp/${entry.asin}`,
        bindingNote: "详情页公开 Top Reviews 片段（评论页需登录，未绕过）",
      })));
      const outcome = await importReviews({
        context,
        taskId: task.id,
        expectedStorageVersion: toStorageVersion(task.id),
        reviews,
      });
      expect(outcome.importedCount).toBeGreaterThan(0);
      expect(outcome.duplicateCount).toBe(0);

      const evidence = await getReviewEvidence(context, task.id);
      expect(evidence).not.toBeNull();
      const stats = evidence!.dataset.stats;
      // 实体绑定：每条都有 ASIN + 角色
      expect(evidence!.dataset.reviews.every((review) => /^[A-Z0-9]{10}$/.test(review.productAsin))).toBe(true);
      expect(evidence!.dataset.reviews.every((review) => review.sourceProductRole === "competitor")).toBe(true);
      // 样本统计 deterministic
      expect(stats.totalReviews).toBe(outcome.importedCount);
      expect(stats.sourceProductCount).toBe(okAsins.length);
      expect(stats.competitorCount).toBe(stats.totalReviews);
      // 去重验证：同文本重复导入 → duplicate
      const dup = await importReviews({
        context,
        taskId: task.id,
        expectedStorageVersion: toStorageVersion(task.id),
        reviews: [reviews[0]],
      });
      expect(dup.duplicateCount).toBe(1);

      const summary = {
        runAt: new Date().toISOString(),
        conclusion: "walkthrough_pass",
        sourceNote: "评论页登录墙未绕过；使用详情页公开 Top Reviews 片段（真实星级/日期/标题；正文折叠不可见为已知限制）",
        pageResults,
        asinsFetched: okAsins.map((entry) => entry.asin),
        reviewsFetched: okAsins.reduce((sum, entry) => sum + entry.reviews.length, 0),
        importedCount: outcome.importedCount,
        duplicateOnReimport: dup.duplicateCount,
        stats: {
          totalReviews: stats.totalReviews,
          positiveCount: stats.positiveCount,
          negativeCount: stats.negativeCount,
          neutralCount: stats.neutralCount,
          ratingDistribution: stats.ratingDistribution,
          sourceProductCount: stats.sourceProductCount,
          competitorCount: stats.competitorCount,
        },
        // 真实评论全文不入 Git：只记录哈希级摘要
        reviewTextHash: createHash("sha256")
          .update(evidence!.dataset.reviews.map((review) => review.reviewText).join("\n"), "utf8")
          .digest("hex")
          .slice(0, 16),
      };
      writeFileSync(
        join(evidenceDir(), "walkthrough-result.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        "utf8",
      );
      expect(outcome.importedCount).toBeGreaterThan(0);
    },
    300_000,
  );
});
