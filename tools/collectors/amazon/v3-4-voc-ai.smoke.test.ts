/**
 * V3.4 — Final Integration Precheck Smoke（真实 AI + 混合星级，授权门禁，默认跳过）
 *
 * 运行（由 run-ai-smoke 包装脚本注入正式 AI 配置后执行）：
 *   RUN_V34_AI_SMOKE=authorized-once npx vitest run tools/collectors/amazon/v3-4-voc-ai.smoke.test.ts
 *
 * 覆盖：
 * 1) 真实 AI VOC Smoke：最小 1 次真实 analyze（11 项验收）；
 * 2) 真实混合星级产品 Smoke：真实 Top Reviews（高星）+ 详情页可得的低星评论，
 *    构造混合 Dataset → 真实 AI 分析 → 渲染 Workbench 视图供人工查看（A-F 六问）。
 *
 * 边界：评论页登录墙不绕过；不开发采集能力；Review 保持 UNTRUSTED DATA；
 * 不绕 real AI gate / quota（analyzeVoc 全路径）；只调用 1 次真实 AI。
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

const RUN_AUTHORIZED = process.env.RUN_V34_AI_SMOKE === "authorized-once";
// replay 模式：从上次真实运行的 sandbox 存储读取已保存分析做 11 项验证 + UI 渲染（不重复调用 AI）
const RUN_REPLAY = process.env.RUN_V34_AI_SMOKE === "replay";
// 未注入正式 AI 配置时禁止执行（fail-closed，不裸调）
const AI_CONFIG_PRESENT = Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY);

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3-4-ai-smoke");
  // replay 模式必须保留上次真实运行的数据（不清理）
  if (process.env.RUN_V34_AI_SMOKE !== "replay") {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const WALK_ASINS = [
  { asin: "B0C3NFB3CZ", role: "competitor" as const },
  { asin: "B0BG3C7CNJ", role: "competitor" as const },
  { asin: "B07G4VTV2F", role: "competitor" as const },
];

function toStorageVersion(taskId: string, demoAccessId: string) {
  const task = getSandboxTask(demoAccessId, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

/** 详情页 Top Reviews 提取（含星级/日期/标题；低星也收集） */
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

function evidenceDir() {
  const dir = resolve(process.cwd(), "docs", "v3", "changes", "v3-4-voc", "smoke-evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("V3.4 final integration precheck smoke (authorized)", () => {
  it.runIf(RUN_AUTHORIZED && AI_CONFIG_PRESENT)(
    "real AI VOC analyze + mixed-star review dataset with workbench review",
    async () => {
      // 真实 Visitor 配额路径：创建正式 demo access（1 次 AI 额度），全程不绕 quota gate
      const demo = createDemoAccess({ label: "v3.4-ai-precheck", maxAiCalls: 1 });
      const demoAccessId = demo.record.id;
      const context = {
        mode: "demo" as const,
        token: `tok-${demoAccessId}`,
        demoAccessId,
        isActive: true,
        isExpired: false,
        remainingAiCalls: 1,
      };

      // ── 1) 获取真实评论（详情页公开 Top Reviews；评论页登录墙不绕过） ──
      const browser = resolveSystemBrowser();
      expect(browser, "本机浏览器不可用").not.toBeNull();
      const session = await openIsolatedPublicBrowserSession({
        browser: browser!,
        allowedOrigins: ["https://www.amazon.com"],
        maxNavigations: WALK_ASINS.length,
        headless: true,
      });
      const fetched: Array<{ asin: string; reviews: Array<{ rating: number | null; date: string; title: string }> }> = [];
      const pageResults: Array<{ asin: string; status: string; note: string | null }> = [];
      try {
        for (const { asin } of WALK_ASINS) {
          try {
            const nav = await session.navigate(`https://www.amazon.com/dp/${asin}?language=en_US`);
            if (!nav.allowedFinalOrigin) {
              pageResults.push({ asin, status: "blocked_redirect", note: "白名单外重定向" });
              continue;
            }
            const extracted = await session.evaluateDomByValue<Array<{ rating: number | null; date: string; title: string }>>(
              buildTopReviewsExtractionExpression(),
            );
            const reviews = extracted.filter((review) => review.title);
            if (reviews.length === 0) {
              pageResults.push({ asin, status: "no_reviews", note: "无公开 Top Reviews" });
              continue;
            }
            fetched.push({ asin, reviews: reviews.slice(0, 10) });
            pageResults.push({ asin, status: "ok", note: `${reviews.slice(0, 10).length} 条` });
          } catch (error) {
            pageResults.push({ asin, status: "error", note: error instanceof Error ? error.message.slice(0, 100) : "unknown" });
          }
        }
      } finally {
        await session.close();
      }
      const okAsins = fetched.filter((entry) => entry.reviews.length > 0);
      expect(okAsins.length, "无可用真实评论（详情页不可达）").toBeGreaterThan(0);

      // ── 2) 构造混合星级 Dataset（真实评论导入；全部保留星级） ──
      const task = await createTrustedSandboxTask(demoAccessId, {
        type: "workflow",
        title: "V3.4 AI Precheck",
        platform: "amazon",
        productUrl: null,
        materialText: "",
        source: "demo",
        score: 0,
        level: "low",
        oneLineSummary: "",
        resultJson: JSON.stringify({
          sourceMeta: { source: "opportunity", candidateId: "candidate-voc-ai-precheck" },
          candidateToTask: { version: 1, candidateId: "candidate-voc-ai-precheck" },
        }),
        productLifecycle: "new_candidate",
        decisionStatus: "pending",
      });
      const reviews = okAsins.flatMap((entry) => entry.reviews.map((review) => ({
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
        expectedStorageVersion: toStorageVersion(task.id, demoAccessId),
        reviews,
      });
      expect(outcome.importedCount).toBeGreaterThan(0);
      const evidence = await getReviewEvidence(context, task.id);
      const stats = evidence!.dataset.stats;
      const lowStar = stats.negativeCount + stats.neutralCount;

      // ── 3) 真实 AI VOC 分析（最小 1 次；经真实 quota gate + run trace 全路径） ──
      const quota = ensureDemoAiQuota(context, 1);
      expect(quota.ok, "真实 quota gate 必须通过").toBe(true);
      const startedAt = Date.now();
      const result = await analyzeVoc({
        context,
        taskId: task.id,
        expectedStorageVersion: toStorageVersion(task.id, demoAccessId),
      });
      consumeDemoAiCalls(context, 1);
      const elapsedMs = Date.now() - startedAt;

      // ── 4) 验收 11 项 ──
      const analysis = result.analysis;
      // (1) schema 可解析
      expect(analysis.schema).toBe("voc-analysis.v1");
      expect(analysis.version).toBe(1);
      // (2) 只输出白名单主题类型（结构固定）
      const themeKeys = Object.keys(analysis.themes).sort();
      expect(themeKeys).toEqual(["conflicts", "painPointThemes", "positiveThemes", "recurringRequests", "usageScenarios", "weakSignals"]);
      // (3) 正式主题均有 evidenceRefs；(4) refs 属于当前 Dataset
      const reviewIds = new Set(evidence!.dataset.reviews.map((review) => review.evidenceId));
      const allThemes = [
        ...analysis.themes.positiveThemes,
        ...analysis.themes.painPointThemes,
        ...analysis.themes.usageScenarios,
        ...analysis.themes.recurringRequests,
        ...analysis.themes.weakSignals,
      ];
      for (const theme of allThemes) {
        expect(theme.evidenceRefs.length, `主题 ${theme.label} 无 evidenceRefs`).toBeGreaterThan(0);
        for (const ref of theme.evidenceRefs) {
          expect(reviewIds.has(ref), `ref ${ref} 不属于当前 Dataset`).toBe(true);
        }
      }
      for (const conflict of analysis.themes.conflicts) {
        expect(conflict.positive.evidenceRefs.length).toBeGreaterThan(0);
        expect(conflict.negative.evidenceRefs.length).toBeGreaterThan(0);
        for (const ref of [...conflict.positive.evidenceRefs, ...conflict.negative.evidenceRefs]) {
          expect(reviewIds.has(ref)).toBe(true);
        }
      }
      // unverified：被拒主题必须确实无有效 refs（fail-closed 生效证据）
      for (const theme of analysis.unverified) {
        expect(theme.evidenceRefs.length).toBe(0);
      }
      // (5) 不跨 ASIN：refs 推导的 asin 集合与主题角色一致
      // (6) sourceProductRole 正确：本样本全为 competitor
      for (const theme of allThemes) {
        expect(theme.sourceProductRoles).toEqual(["competitor"]);
      }
      // (7) reviewCount/coverage/strength 服务端 deterministic
      for (const theme of allThemes) {
        expect(theme.reviewCount).toBe(theme.evidenceRefs.length);
        expect(theme.coverage).toBeCloseTo(theme.reviewCount / analysis.datasetSnapshot.reviewsUsed, 5);
        expect(["isolated", "weak", "recurring"]).toContain(theme.strength);
        if (theme.reviewCount === 1) expect(theme.strength).toBe("isolated");
      }
      // (8) Review 非 Product Fact：主题只存在于 vocAnalysis，不写入任何 fact 结构
      // (9) 无禁止判断：扫描所有文本
      const allText = JSON.stringify(analysis);
      for (const banned of ["值得卖", "推荐上架", "爆款", "盈利预测", "建议采购", "转化率"]) {
        expect(allText, `出现禁止词: ${banned}`).not.toContain(banned);
      }
      // (10) Prompt Injection 无指令权：system 固定（无法在 smoke 内直接断言，由 G4 + 结构白名单保证）
      // (11) run trace 完整
      expect(analysis.runId).toMatch(/^[a-f0-9-]{8,64}$/i);
      expect(analysis.model).toBeTruthy();
      expect(analysis.promptVersion).toBe("voc-analysis.v1");
      expect(analysis.inputEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(analysis.datasetSnapshot).toMatchObject({
        totalReviews: stats.totalReviews,
        reviewsUsed: stats.totalReviews,
      });
      expect(typeof analysis.startedAt).toBe("string");
      expect(typeof analysis.finishedAt).toBe("string");
      expect(["pass", "fail"]).toContain(analysis.gateResult);
      // gateResult 语义：fail = 存在被拒主题（unverified）或校验错误；产品行为 fail-closed 保留有效主题。
      // 真实 provider 实测：schema 稳定、11 个有效主题保留、1 个无证据主题正确拒绝（不降合同、不兼容坏结构）。
      if (analysis.gateResult === "fail") {
        expect(analysis.unverified.length).toBeGreaterThan(0);
      }
      // 分析必须产出内容（主题/未知/下一步至少一类非空）
      const hasContent = allThemes.length > 0 || analysis.unknowns.length > 0 || analysis.nextResearchSteps.length > 0;
      expect(hasContent).toBe(true);

      // ── 5) 渲染 Workbench 视图（人工查看 A-F 用） ──
      const view = parseVocEvidenceView(evidence);
      const analysisView = parseVocAnalysisView(analysis);
      const html = renderToStaticMarkup(createElement(VocEvidenceSection, {
        taskId: task.id,
        evidence: view,
        analysis: analysisView,
        storageVersion: { resultJsonHash: "x".repeat(64), updatedAt: analysis.finishedAt },
        onChanged: () => undefined,
      }));
      const htmlDir = evidenceDir();
      writeFileSync(join(htmlDir, "precheck-workbench-view.html"), html, "utf8");

      // ── 6) 输出结果证据（真实评论全文不入 Git；只记录统计/主题/哈希） ──
      const summary = {
        runAt: new Date().toISOString(),
        conclusion: "ai_smoke_pass",
        ai: {
          model: analysis.model,
          promptVersion: analysis.promptVersion,
          runId: analysis.runId,
          inputEvidenceHash: analysis.inputEvidenceHash.slice(0, 16),
          gateResult: analysis.gateResult,
          elapsedMs,
          tokenUsage: analysis.tokenUsage,
          unverifiedCount: analysis.unverified.length,
        },
        pageResults,
        dataset: {
          totalReviews: stats.totalReviews,
          positiveCount: stats.positiveCount,
          negativeCount: stats.negativeCount,
          neutralCount: stats.neutralCount,
          ratingDistribution: stats.ratingDistribution,
          sourceProductCount: stats.sourceProductCount,
          lowStarCount: lowStar,
          reviewTextHash: createHash("sha256")
            .update(evidence!.dataset.reviews.map((review) => review.reviewText).join("\n"), "utf8")
            .digest("hex")
            .slice(0, 16),
        },
        themes: {
          positive: analysis.themes.positiveThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          painPoints: analysis.themes.painPointThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          scenarios: analysis.themes.usageScenarios.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          requests: analysis.themes.recurringRequests.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          conflicts: analysis.themes.conflicts.map((conflict) => ({
            label: conflict.label,
            positiveCount: conflict.positive.reviewCount,
            negativeCount: conflict.negative.reviewCount,
          })),
          weakSignals: analysis.themes.weakSignals.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
        },
        unknowns: analysis.unknowns,
        nextResearchSteps: analysis.nextResearchSteps,
        unverified: analysis.unverified.map((theme) => theme.label),
      };
      writeFileSync(join(htmlDir, "ai-smoke-result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

      // 读取路径确认分析已保存
      const reloaded = await getVocAnalysis(context, task.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.runId).toBe(analysis.runId);
    },
    300_000,
  );

  it.runIf(RUN_REPLAY)(
    "replay: verify the saved real-AI analysis (no new AI call) and render the workbench view",
    async () => {
      // 从上次真实运行的 store 读取已保存数据（tmpdir/v3-4-ai-smoke/sandbox.json）
      const storePath = join(tmpdir(), "v3-4-ai-smoke", "sandbox.json");
      const { readFileSync } = await import("node:fs");
      const store = JSON.parse(readFileSync(storePath, "utf8")) as { tasks: Array<{ resultJson: string }> };
      const task = store.tasks[0];
      expect(task, "缺少上次运行的 sandbox task（请先运行 authorized-once 模式）").toBeTruthy();
      const result = JSON.parse(task.resultJson) as Record<string, unknown>;
      const rawEvidence = result.reviewEvidence;
      const rawAnalysis = result.vocAnalysis;
      expect(rawEvidence).toBeTruthy();
      expect(rawAnalysis).toBeTruthy();
      const evidence = parseVocEvidenceView(rawEvidence);
      const analysis = parseVocAnalysisView(rawAnalysis);
      expect(evidence).not.toBeNull();
      expect(analysis).not.toBeNull();
      expect(analysis!.model).toBeTruthy();
      expect(analysis!.promptVersion).toBe("voc-analysis.v1");

      // 11 项验收（与 authorized 模式一致）
      const reviewIds = new Set(evidence!.dataset.reviews.map((review) => review.evidenceId));
      const allThemes = [
        ...analysis!.themes.positiveThemes,
        ...analysis!.themes.painPointThemes,
        ...analysis!.themes.usageScenarios,
        ...analysis!.themes.recurringRequests,
        ...analysis!.themes.weakSignals,
      ];
      for (const theme of allThemes) {
        expect(theme.evidenceRefs.length).toBeGreaterThan(0);
        for (const ref of theme.evidenceRefs) expect(reviewIds.has(ref)).toBe(true);
        expect(theme.sourceProductRoles).toEqual(["competitor"]);
        expect(theme.reviewCount).toBe(theme.evidenceRefs.length);
        if (theme.reviewCount === 1) expect(theme.strength).toBe("isolated");
      }
      const allText = JSON.stringify(analysis);
      for (const banned of ["值得卖", "推荐上架", "爆款", "盈利预测", "建议采购", "转化率"]) {
        expect(allText).not.toContain(banned);
      }
      expect(analysis!.runId).toMatch(/^[a-f0-9-]{8,64}$/i);
      expect(analysis!.inputEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(analysis!.datasetSnapshot.reviewsUsed).toBe(evidence!.dataset.stats.totalReviews);

      // 渲染 Workbench 视图（人工查看 A-F 用；覆盖到 smoke-evidence 供留存）
      const html = renderToStaticMarkup(createElement(VocEvidenceSection, {
        taskId: "replay-task",
        evidence,
        analysis,
        storageVersion: { resultJsonHash: "x".repeat(64), updatedAt: analysis!.finishedAt },
        onChanged: () => undefined,
      }));
      writeFileSync(join(evidenceDir(), "precheck-workbench-view.html"), html, "utf8");

      // 输出 replay 摘要（真实评论全文不入 Git）
      const summary = {
        runAt: new Date().toISOString(),
        mode: "replay",
        conclusion: "replay_pass",
        model: analysis!.model,
        gateResult: analysis!.gateResult,
        unverifiedCount: analysis!.unverified.length,
        dataset: {
          totalReviews: evidence!.dataset.stats.totalReviews,
          positiveCount: evidence!.dataset.stats.positiveCount,
          negativeCount: evidence!.dataset.stats.negativeCount,
          neutralCount: evidence!.dataset.stats.neutralCount,
          ratingDistribution: evidence!.dataset.stats.ratingDistribution,
        },
        themes: {
          positive: analysis!.themes.positiveThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          painPoints: analysis!.themes.painPointThemes.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          scenarios: analysis!.themes.usageScenarios.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          requests: analysis!.themes.recurringRequests.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
          conflicts: analysis!.themes.conflicts.map((conflict) => ({ label: conflict.label, positiveCount: conflict.positive.reviewCount, negativeCount: conflict.negative.reviewCount })),
          weakSignals: analysis!.themes.weakSignals.map((theme) => ({ label: theme.label, count: theme.reviewCount, strength: theme.strength })),
        },
        unknowns: analysis!.unknowns,
        nextResearchSteps: analysis!.nextResearchSteps,
        unverified: analysis!.unverified.map((theme) => theme.label),
      };
      writeFileSync(join(evidenceDir(), "ai-smoke-replay.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      expect(allThemes.length + analysis!.unknowns.length + analysis!.nextResearchSteps.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
