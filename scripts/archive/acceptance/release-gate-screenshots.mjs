/**
 * Phase V2-Internal-Use.1-Release-Gate.1 — 任务中心验收 + 旧任务历史兼容
 *
 * Mock /api/tasks 和 /api/tasks/[id]，用 Playwright 拦截 API 响应。
 * 不读写数据库，不调用真实 AI。
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const SCREENSHOT_DIR = join(
  process.cwd().replace(/\\/g, "/"),
  "..",
  "06_测试与验证",
  "2026-07-06-Phase-V2-Internal-Use1-Release-Gate"
).replace(/\\/g, "/");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE = "http://localhost:3005";
const EXPIRES = Date.now() + 86400000;

// ── Mock data ────────────────────────────────────

/** Old task — created before decision evidence chain (no decisionEvidence in result) */
const OLD_TASK = {
  id: "old-legacy-001",
  createdAt: "2026-07-02T10:00:00.000Z",
  updatedAt: "2026-07-02T10:30:00.000Z",
  type: "workflow",
  decisionStatus: "continue",
  title: "桌面手机支架 一键分析",
  platform: "manual",
  productUrl: null,
  materialText: "桌面手机支架",
  source: "ai",
  score: 85,
  level: "green",
  oneLineSummary: "可以继续小单测试",
  result: {
    // Pre-V2-Internal-Use.1 structure: has agentOutputSnapshot but NO decisionEvidence
    type: "workflow",
    workflowId: "wf-old-legacy-001",
    productName: "桌面手机支架",
    status: "completed",
    finalReport: {
      finalVerdict: "可以继续小单测试",
      riskLevel: "green",
      beginnerFit: "适合新手",
      canTestSmallBatch: true,
      mustCheckBeforeListing: ["确认供应商资质", "核实外观设计专利", "准备产品实拍图"],
      nextSteps: ["联系1688供应商", "核算头程物流成本", "准备Listing素材"],
      manualReviewChecklist: ["货源判断", "风险排查", "小白结论", "Listing文案"],
    },
    steps: [
      { key: "normalize", label: "数据清洗", status: "completed", summary: "商品信息已清洗", warnings: [] },
      { key: "sourcing", label: "供货可行性", status: "completed", summary: "1688多家供应商", warnings: [] },
      { key: "risk", label: "合规/侵权", status: "completed", summary: "外观专利需确认", warnings: ["设计专利待查"] },
      { key: "summary", label: "总结评分", status: "completed", summary: "综合评分完成", warnings: [] },
      { key: "listing", label: "Listing准备", status: "completed", summary: "标题和关键词已生成", warnings: [] },
      { key: "report", label: "最终报告", status: "completed", summary: "报告已生成", warnings: [] },
    ],
    sourcing: { supplierCount: 5, moqSummary: "MOQ 50-100pcs", priceRange: "¥5-12" },
    risk: { summary: "外观设计专利风险中等，需确认供应商资质", overallLevel: "yellow" },
    summary: { decisionReason: "市场需求稳定，竞争适中，利润空间合理" },
    listing: { title: "桌面可调节手机支架 铝合金折叠便携", keywords: ["phone stand", "desk stand"] },
    costGuard: { aiStepsRequested: 6, aiStepsCompleted: 6, fallbackSteps: 0 },
    reviewState: {
      sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true,
      reviewedCount: 4, totalReviewSteps: 4, allReviewed: true,
      reviewedAt: "2026-07-02T10:25:00.000Z",
    },
    sourceMeta: {
      source: "opportunity",
      entry: "candidate_to_agent_run",
      opportunityTitle: "桌面手机支架",
      opportunitySource: "1688热销榜",
      opportunityScore: 82,
      candidateId: "cand-old-001",
      candidateType: "product_candidate",
      importedAt: "2026-07-02T09:55:00.000Z",
    },
    // B2 feature: agentOutputSnapshot exists
    agentOutputSnapshot: {
      version: "agent-output-snapshot-v1",
      generatedAt: "2026-07-02T10:00:00.000Z",
      sourcingSnapshot: { supplierCount: 5, moqSummary: "MOQ 50-100pcs" },
      summarySnapshot: { decisionReason: "市场需求稳定" },
      riskSnapshot: { overallLevel: "yellow" },
      listingSnapshot: { title: "桌面可调节手机支架" },
      nextActionSnapshot: { primaryAction: "continue" },
      humanReviewSnapshot: { allReviewed: true },
    },
    // Agent-Save-M.1: agentRunSnapshot exists
    agentRunSnapshot: {
      source: "agent_run",
      manualConfirmed: true,
      finalVerdict: "可以继续小单测试",
      riskLevel: "green",
      steps: [
        { key: "normalize", label: "数据清洗", status: "completed" },
        { key: "market", label: "市场机会判断", status: "completed" },
        { key: "sourcing", label: "供货可行性", status: "completed" },
        { key: "profit", label: "成本利润估算", status: "needs_manual_review" },
        { key: "risk", label: "合规/侵权AI预筛", status: "completed" },
        { key: "listing", label: "Listing/关键词准备", status: "completed" },
        { key: "report", label: "最终结论", status: "completed" },
        { key: "manual", label: "人工确认与任务沉淀", status: "completed" },
      ],
    },
    productLifecycle: { status: "ready_to_test", history: [] },
    // NOTE: NO decisionEvidence, NO humanDecision at this level
  },
};

/** New task — created after decision evidence chain (has decisionEvidence) */
const NEW_TASK = {
  id: "new-evidence-002",
  createdAt: "2026-07-05T14:00:00.000Z",
  updatedAt: "2026-07-05T14:30:00.000Z",
  type: "workflow",
  decisionStatus: "need_info",
  title: "宠物慢食碗 一键分析",
  platform: "manual",
  productUrl: null,
  materialText: "宠物慢食碗",
  source: "ai",
  score: 55,
  level: "yellow",
  oneLineSummary: "需补数据后再评估",
  result: {
    type: "workflow",
    workflowId: "wf-new-evidence-002",
    productName: "宠物慢食碗",
    status: "completed",
    finalReport: {
      finalVerdict: "需补数据后再评估",
      riskLevel: "yellow",
      beginnerFit: "有经验再做",
      canTestSmallBatch: false,
      nextSteps: ["补真实采购价和物流费", "调研竞品售价区间"],
    },
    steps: [
      { key: "normalize", label: "数据清洗", status: "completed", summary: "OK", warnings: [] },
      { key: "sourcing", label: "供货可行性", status: "completed", summary: "OK", warnings: [] },
      { key: "risk", label: "合规/侵权", status: "completed", summary: "OK", warnings: [] },
      { key: "summary", label: "总结评分", status: "completed", summary: "OK", warnings: [] },
      { key: "listing", label: "Listing准备", status: "completed", summary: "OK", warnings: [] },
      { key: "report", label: "最终报告", status: "completed", summary: "OK", warnings: [] },
    ],
    risk: { summary: "材质安全性和防滑设计需确认", overallLevel: "yellow" },
    summary: { decisionReason: "利润估算依赖多项用户假设" },
    listing: { title: "慢食碗 防噎宠物碗", keywords: ["slow feeder"] },
    costGuard: { aiStepsRequested: 6, aiStepsCompleted: 6, fallbackSteps: 0 },
    reviewState: {
      sourcingReviewed: true, riskReviewed: false, summaryReviewed: true, listingReviewed: false,
      reviewedCount: 2, totalReviewSteps: 4, allReviewed: false,
    },
    // HAS decisionEvidence
    decisionEvidence: {
      version: "decision-evidence-v1",
      generatedAt: "2026-07-05T14:00:00.000Z",
      items: [
        { id: "product-name", field: "productName", label: "商品名称", kind: "user_input", value: "宠物慢食碗", summary: "来自用户输入", sourceType: "user", sourceLabel: "用户输入", status: "unverified", confidence: "medium" },
        { id: "purchase-cost", field: "profitSnapshot.purchaseCost", label: "采购价", kind: "user_input", value: 5, summary: "人工填写，系统未验证成交价", sourceType: "user", sourceLabel: "成本利润估算卡", status: "estimated", confidence: "unknown" },
        { id: "sale-price", field: "profitSnapshot.salePrice", label: "目标售价", kind: "user_input", value: 18, summary: "人工填写，不代表平台真实成交价", sourceType: "user", sourceLabel: "成本利润估算卡", status: "estimated", confidence: "unknown" },
        { id: "ai-final-verdict", field: "finalReport.finalVerdict", label: "AI最终建议", kind: "ai_inference", value: "需补数据后再评估", summary: "AI辅助推断，不是真实市场结论", sourceType: "ai", sourceLabel: "Agent finalReport", status: "needs_review", confidence: "unknown" },
      ],
      missingData: [
        { id: "missing-logistics-cost", field: "profitSnapshot.logisticsCost", label: "真实物流成本", kind: "missing", summary: "当前利润结构没有保存真实物流成本", sourceType: "system_rule", sourceLabel: "成本利润估算卡", status: "missing", confidence: "high", missingPriority: "suggested" },
        { id: "missing-ad-cost", field: "profitSnapshot.adCost", label: "广告成本", kind: "missing", summary: "当前利润结构没有保存真实广告CPC/ACOS", sourceType: "system_rule", sourceLabel: "成本利润估算卡", status: "missing", confidence: "high", missingPriority: "suggested" },
      ],
      conflicts: [],
      humanDecision: {
        status: "need_info",
        statusLabel: "需要更多信息",
        reason: "采购价和物流费均为估算",
        nextAction: "补真实供应商报价和物流报价",
        decidedAt: "2026-07-05T14:30:00.000Z",
        confirmedItems: [],
        unconfirmedItems: ["风险复核", "Listing确认"],
        source: "user",
      },
      historicalFallback: false,
      warnings: ["2 项关键数据仍需补充"],
    },
  },
};

// ── Auth setup ───────────────────────────────────

async function setupAuth(page) {
  await page.goto(BASE);
  await page.evaluate((exp) => {
    window.sessionStorage.setItem("qx:access-password:session:v2", "test-release-gate-pwd");
    window.sessionStorage.setItem("qx:access-expires:session:v2", String(exp));
    // Set both v1 and v2 token keys
    window.sessionStorage.setItem("qx:access-token:session:v1", JSON.stringify({ token: "mock-gate-token", expiresAt: exp }));
    window.sessionStorage.setItem("qx:access-token:session:v2", JSON.stringify({ token: "mock-gate-token", expiresAt: exp }));
  }, EXPIRES);
}

// ── API Mock setup ───────────────────────────────

async function mockTasksApi(page, tasks) {
  await page.route("**/api/tasks**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Aggregate endpoint
    if (url.includes("/api/tasks/aggregate")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { total: tasks.length, byLevel: {} } }),
      });
    }

    // Task detail: /api/tasks/[id]
    const detailMatch = url.match(/\/api\/tasks\/([^/?]+)/);
    if (detailMatch && method === "GET") {
      const taskId = detailMatch[1];
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: task }),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "not_found", message: "任务不存在" } }),
      });
    }

    // PATCH /api/tasks/[id]
    if (detailMatch && method === "PATCH") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { id: detailMatch[1], decisionStatus: "continue" } }),
      });
    }

    // Default: task list GET
    const records = tasks.map((t) => {
      const { result, ...rest } = t;
      return rest;
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        records,
        totalRecords: records.length,
        page: { type: "all", q: "", page: 1, pageSize: 50, totalPages: 1 },
      }),
    });
  });
}

// ── Main ─────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── 1. Tasks list with 2 tasks ──────────────────
  console.log("📸 01-tasks-list-success...");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const tasks = [OLD_TASK, NEW_TASK];

    await mockTasksApi(page, tasks);
    await setupAuth(page);
    await page.goto(`${BASE}/tasks`);
    await page.waitForTimeout(3000);

    const bodyText = await page.locator("body").innerText().catch(() => "(error)");
    const hasError = bodyText.includes("任务记录读取失败") || bodyText.includes("请稍后重试");
    const hasOldTask = bodyText.includes("桌面手机支架");
    const hasNewTask = bodyText.includes("宠物慢食碗");

    console.log(`  body preview: ${bodyText.slice(0, 200).replace(/\n/g, " ")}`);
    console.log(`  hasError=${hasError} hasOldTask=${hasOldTask} hasNewTask=${hasNewTask}`);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, "01-tasks-list-success.png"),
      fullPage: true,
    });
    console.log("  ✅ 01-tasks-list-success.png");
    await ctx.close();
  }

  // ── 2. Old task detail (no decisionEvidence) ────
  console.log("📸 02-legacy-task-detail-full...");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await mockTasksApi(page, [OLD_TASK, NEW_TASK]);
    await setupAuth(page);
    await page.goto(`${BASE}/tasks/old-legacy-001`);
    await page.waitForTimeout(3000);

    const bodyText = await page.locator("body").innerText().catch(() => "(error)");
    const hasError = bodyText.includes("任务详情读取失败") || bodyText.includes("请稍后重试");
    const hasFallback = bodyText.includes("历史任务未保存完整证据元数据");
    const hasContent = bodyText.includes("桌面手机支架");
    const hasVerdict = bodyText.includes("可以继续小单测试");
    const hasEvidencePanel = bodyText.includes("决策证据链");

    console.log(`  body preview: ${bodyText.slice(0, 300).replace(/\n/g, " ")}`);
    console.log(`  hasError=${hasError} fallback=${hasFallback} content=${hasContent} verdict=${hasVerdict} evidencePanel=${hasEvidencePanel}`);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, "02-legacy-task-detail-full.png"),
      fullPage: true,
    });
    console.log("  ✅ 02-legacy-task-detail-full.png");
    await ctx.close();
  }

  // ── 3. Compatibility banner close-up ────────────
  console.log("📸 03-legacy-task-compatibility-banner...");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await mockTasksApi(page, [OLD_TASK, NEW_TASK]);
    await setupAuth(page);
    await page.goto(`${BASE}/tasks/old-legacy-001`);
    await page.waitForTimeout(3000);

    // Try to screenshot just the evidence panel area
    const evidencePanel = page.locator('[data-testid="decision-evidence-fallback"]');
    const panelCount = await evidencePanel.count();
    console.log(`  fallback panel count: ${panelCount}`);

    if (panelCount > 0) {
      await evidencePanel.first().screenshot({
        path: join(SCREENSHOT_DIR, "03-legacy-task-compatibility-banner.png"),
      });
      console.log("  ✅ 03-legacy-task-compatibility-banner.png");
    } else {
      // Fallback: take full page screenshot if panel not found
      console.log("  ⚠️ fallback panel not found by testid, taking full page screenshot");
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "03-legacy-task-compatibility-banner.png"),
        fullPage: true,
      });
    }
    await ctx.close();
  }

  await browser.close();
  console.log("\n✅ 全部截图完成");
}

main().catch((err) => { console.error("截图失败:", err); process.exit(1); });
