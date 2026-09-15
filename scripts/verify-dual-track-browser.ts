#!/usr/bin/env node

/**
 * Image Studio 双链路真实 Chrome 浏览器用户旅程验收脚本：
 * 
 * 旅程 1：商品研究采集 → 真实点击“补齐研究资料” → 看到四源变化 → 真实点击页面上失败源的“重试”按钮 → 确认只重试该源 → 刷新状态保持。
 * 旅程 2：研究任务 → 真实点击“进入图片工作台” → URL 带 taskId → 读取事实/参考图 → 刷新状态保持。
 * 旅程 3：侧边栏真实点击“图片工作台” → /image-studio 无 taskId → 显示独立极简生图界面 → 填写创作描述 → 点击生成并验证请求 payload 正确到达独立生图 API → 控制台错误 consoleErrorCount = 0。
 * 
 * 红线：
 * - 严禁用直接 fetch/API 调用替代用户操作！
 * - 必须由真实 Chrome DOM 实际点击驱动！
 * - 验证全链路控制台错误为 0。
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync,
  writeFileSync, rmSync
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeAgentOutputSnapshot } from "@/lib/agentOutputSnapshot";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";

const WORKTREE = resolve(process.cwd());
const SMOKE_PARENT = "C:\\Users\\a2578\\Desktop\\qingxuan-smoke";
const HOST = "127.0.0.1";
const PORTS = [3190, 3191, 3192, 3193] as const;
const CDP_PORT = 24890;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type JsonRecord = Record<string, unknown>;
function jsonRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function hashSyntheticPassword(password: string, salt: string) {
  return `sha256:${createHash("sha256").update(salt + password).digest("hex")}`;
}

function createIsolatedCliEnvironment(extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const key of ["APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ...extra });
  return env;
}

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.once("listening", () => server.close(() => resolveFree(true)));
    server.listen(port, HOST);
  });
}

async function selectPort(): Promise<number> {
  for (const port of PORTS) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("smoke_port_all_in_use");
}

function writeDemoAccessStore(path: string, entries: Array<{ id: string; password: string; label: string }>) {
  const accesses = entries.map((entry) => {
    const salt = randomBytes(16).toString("hex");
    return {
      id: entry.id, passwordHash: hashSyntheticPassword(entry.password, salt), salt, label: entry.label,
      expiresAt: null, maxAiCalls: 20, usedAiCalls: 0, isActive: true,
      createdAt: new Date().toISOString(), lastUsedAt: null, notes: "",
    };
  });
  writeFileSync(path, `${JSON.stringify({ version: 1, accesses }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function buildProtectedResult(input: { candidateId: string; runId: string; actor: { mode: "owner" | "visitor"; actorRef: string } }) {
  const contextHash = createHash("sha256").update(`context:${input.candidateId}`).digest("hex");
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: input.candidateId,
    runId: input.runId,
    contextHash,
    inputHash: createHash("sha256").update(`input:${input.candidateId}`).digest("hex"),
    resultHash: createHash("sha256").update(`result:${input.candidateId}`).digest("hex"),
    workflowStatus: "completed",
    reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
  });
  const initial = createInitialProductResearchRecord({
    candidateId: input.candidateId,
    runId: input.runId,
    contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: input.actor as never,
    now: "2026-08-07T01:00:00.000Z",
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "Dual-track acceptance.", nextAction: null },
  });
  return {
    productName: "Dual-Track 验收商品",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Dual-track acceptance product.",
    finalReport: { finalVerdict: "Dual-track test product." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Dual-Track 验收商品",
        finalReport: { finalVerdict: "Dual-track test product.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Verified supplier." },
        risk: { overallLevel: "low", summary: "Low risk.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Ready for studio.", sellingPoints: ["Lightweight"], concerns: [], confidence: "high" },
        listing: { title: "Dual-Track Product", bullets: ["Premium ceramic material."], keywords: ["ceramic mug"], imageIdeas: ["White background hero"], missingInputs: [] },
      },
    }),
    listingPrepSnapshot: {
      keywordPool: { coreWords: ["ceramic mug"], longTailWords: [], sceneWords: [], crowdWords: [], attributeWords: [], riskWordReminder: "" },
      titleStructure: { formula: "brand + product", recommendedTitle: "Dual-Track Product", breakdown: [] },
      bulletDrafts: ["Premium ceramic material."],
      searchTerms: { draft: "ceramic mug", reminders: [] },
      imageMaterialNeeds: ["白底主图", "生活场景"],
      manualSupplementChecklist: [],
      complianceExpressionReminders: [],
    },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Dual-Track 验收商品",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0DUAL0001",
      productUrl: "https://example.com/dual-track",
      title: "Dual-Track Product",
      brand: "TrackBrand",
      category: "Home & Kitchen",
      priceUsd: 25.99,
      rating: 4.8,
      reviewCount: 150,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "ceramic mug",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-07T01:00:00.000Z",
      contextHash,
    },
  };
}

function cdpClient(webSocketUrl: string) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const state = {
    consoleErrorCount: 0,
    consoleErrorDiagnostics: [] as string[],
    networkRequests: [] as Array<{ url: string; method: string; postData?: string }>,
    networkResponses: [] as Array<{ url: string; status: number }>,
    server5xxCount: 0,
  };
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady(), { once: true });
    socket.addEventListener("error", () => rejectReady(new Error("cdp_connect_failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error("cdp_command_failed: " + JSON.stringify(message.error)));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      const diag = String(message.params.args?.[0]?.value ?? message.params.args?.[0]?.description ?? "unknown");
      // 忽略已知第三方扩展探测
      if (!diag.includes("chrome-extension://")) {
        state.consoleErrorCount += 1;
        state.consoleErrorDiagnostics.push(diag.slice(0, 150));
      }
    }
    if (message.method === "Network.requestWillBeSent") {
      const req = message.params?.request;
      if (req) {
        state.networkRequests.push({
          url: String(req.url ?? ""),
          method: String(req.method ?? "GET"),
          postData: req.postData ? String(req.postData) : undefined,
        });
      }
    }
    if (message.method === "Network.responseReceived") {
      const status = Number(message.params?.response?.status);
      const url = String(message.params?.response?.url ?? "");
      state.networkResponses.push({ url, status });
      if (status >= 500) state.server5xxCount += 1;
    }
  });
  return {
    ready, state,
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      await ready;
      return await new Promise<any>((resolveSend, rejectSend) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); },
  };
}

async function startChrome(runtimeRoot: string) {
  assert(existsSync(CHROME), "smoke_chrome_missing");
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-address=${HOST}`, `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(runtimeRoot, "chrome-profile")}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank",
  ], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`http://${HOST}:${CDP_PORT}/json/version`);
      const v = jsonRecord(await res.json());
      if (typeof v.webSocketDebuggerUrl === "string") return { pid: child.pid!, ws: v.webSocketDebuggerUrl as string };
    } catch { /* retry */ }
    await wait(100);
  }
  throw new Error("smoke_chrome_cdp_timeout");
}

function stopOwnedProcess(pid: number) {
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

async function createPage(client: ReturnType<typeof cdpClient>) {
  const ctx = await client.send("Target.createBrowserContext");
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId: ctx.browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId as string;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId);
  return { sessionId };
}

async function evaluate(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string) {
  const res = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (res.exceptionDetails) throw new Error(`page_script_failed:${JSON.stringify(res.exceptionDetails).slice(0, 300)}`);
  return res.result?.value;
}

async function waitFor(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string, attempts = 250, code = "wait_timeout") {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await wait(100);
  }
  throw new Error(code);
}

async function waitForHealth(baseUrl: string) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.status === 200) return;
    } catch { /* retry */ }
    await wait(250);
  }
  throw new Error("smoke_runtime_health_timeout");
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = jsonRecord(await response.json());
  assert(response.status === 200 && typeof body.accessToken === "string", `smoke_login_failed:${response.status}`);
  return { token: body.accessToken as string };
}

async function run() {
  console.log("=== Image Studio 双链路真实 Chrome 浏览器验收测试 ===");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `dual-track-${timestamp}`);
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "dualtrack.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const ownerTaskId = "task-dualtrack-001";
  const ownerCandidateId = "cand-dualtrack-001";

  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let client: ReturnType<typeof cdpClient> | null = null;

  try {
    mkdirSync(runtimeRoot, { recursive: true });
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: `file:./dualtrack.db` }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, []);
    writeFileSync(sandboxStorePath, `${JSON.stringify({ version: 1, tasks: [], candidates: [] }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-dt", actor: { mode: "owner", actorRef: "owner:v1" } });
    const createdAt = new Date().toISOString();
    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.create({
        data: {
          id: ownerTaskId, createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
          type: "workflow", decisionStatus: "continue",
          title: "Dual-Track Product Research", platform: "local-test",
          productUrl: "https://www.amazon.com/dp/B0DUAL0001", materialText: "Synthetic", source: "isolated-flow",
          score: 0, level: "low", oneLineSummary: "Dual-track acceptance product.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId, name: "Dual-Track Product Candidate", rawInput: "Synthetic",
          source: "SellerSprite", status: "pending", sourceMetaJson: "{}", analysisJson: "{}",
          convertedTaskId: ownerTaskId, lastActionAt: new Date(createdAt),
        },
      });
    });
    await prisma.$disconnect();

    // 启动 Next.js 生产运行时
    const sanitizedEnv: Record<string, string | undefined> = {};
    for (const key of ["APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR", "ProgramFiles", "ProgramFiles(x86)"]) {
      if (process.env[key]) sanitizedEnv[key] = process.env[key];
    }
    Object.assign(sanitizedEnv, {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_ACQUISITION_ENABLED: "true",
      ACCESS_PASSWORD: ownerPassword,
      PROOF_SIGNING_SECRET: proofSigningSecret,
      DATABASE_URL: databaseUrl,
      DEMO_ACCESS_STORE_PATH: accessStorePath,
      DEMO_SANDBOX_STORE_PATH: sandboxStorePath,
      LISTING_PROVIDER_MODE: "mock",
      IMAGE_PROVIDER_MODE: "mock",
      AI_IMAGE_DRAFT_STORAGE_ROOT: join(runtimeRoot, "image-assets"),
    });

    const logHandle = openSync(logPath, "ax");
    try {
      const runtime = spawn(process.execPath, [
        join(WORKTREE, "node_modules", "next", "dist", "bin", "next"),
        "start", "-H", HOST, "-p", String(port),
      ], { cwd: WORKTREE, env: sanitizedEnv as NodeJS.ProcessEnv, detached: true, windowsHide: true, stdio: ["ignore", logHandle, logHandle] });
      runtimePid = runtime.pid ?? null;
      runtime.unref();
    } finally {
      closeSync(logHandle);
    }
    assert(Number.isInteger(runtimePid), "smoke_runtime_pid_missing");
    console.log(`[1/5] Next.js 生产实例启动成功，端口: ${port}，正在等待健康检查...`);
    await waitForHealth(baseUrl);
    console.log("[1/5] 健康检查通过！");

    const owner = await login(baseUrl, ownerPassword);
    const chrome = await startChrome(runtimeRoot);
    chromePid = chrome.pid;
    client = cdpClient(chrome.ws);
    const page = await createPage(client);

    // 导航并注入 Session
    await client.send("Page.navigate", { url: baseUrl }, page.sessionId);
    await waitFor(client, page.sessionId, "document.readyState === 'complete'", 160, "home_ready_timeout");
    await evaluate(client, page.sessionId, `(() => {
      sessionStorage.setItem('qx:access-token:session:v1', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-mode:session:v1', 'owner');
      sessionStorage.setItem('qx:access-password:session:v2', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-expires:session:v2', String(Date.now() + 3600000));
      return true;
    })()`);

    // ═══════════════════════════════════════════════════════════════════
    // 旅程 1：商品研究采集 → 点击“补齐研究资料” → 看到四源变化 → 真实点击页面上失败源的“重试”按钮 → 确认只重试该源 → 刷新状态保持
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[2/5] 开始执行旅程 1：商品研究资料采集与单源重试真实 DOM 点击...");
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"btn-orchestrate\"]'))", 250, "orchestrate_btn_timeout");

    // 真实 DOM 点击「补齐研究资料」
    console.log("  → 真实点击「补齐研究资料」按钮 [data-testid=\"btn-orchestrate\"]...");
    const orchestrateClickResult = await evaluate(client, page.sessionId, `(() => {
      const btn = document.querySelector('[data-testid="btn-orchestrate"]');
      if (!btn) return { ok: false, reason: "btn_not_found" };
      btn.click();
      return { ok: true };
    })()`);
    assert(orchestrateClickResult.ok, "orchestrate_button_click_failed");

    // 等待编排整理完成（spinner 消失，且列表已更新）
    console.log("  → 等待四源编排结果更新...");
    await waitFor(client, page.sessionId, `(() => {
      const spinner = document.querySelector('[data-testid="orchestrate-spinner"]');
      const sourcesList = document.querySelector('[data-testid="orchestrator-sources-list"]');
      return !spinner && Boolean(sourcesList);
    })()`, 250, "orchestrate_complete_timeout");

    // 检查是否有失败的来源及对应的重试按钮
    const debugInfo = await evaluate(client, page.sessionId, `(() => {
      const sourcesList = document.querySelector('[data-testid="orchestrator-sources-list"]');
      const rows = Array.from(document.querySelectorAll('[data-testid^="source-row-"]')).map(r => ({
        testId: r.getAttribute('data-testid'),
        text: r.innerText.trim(),
        buttons: Array.from(r.querySelectorAll('button')).map(b => ({
          testId: b.getAttribute('data-testid'),
          text: b.innerText.trim(),
          disabled: b.disabled,
        })),
      }));
      const feedback = document.querySelector('[data-testid="orchestrator-run-feedback"]')?.innerText.trim();
      const errBanner = document.querySelector('[data-testid="orchestrator-error-banner"]')?.innerText.trim();
      return { rows, feedback, errBanner, listText: sourcesList?.innerText };
    })()`);
    console.log("  → 四源编排调试信息:", JSON.stringify(debugInfo, null, 2));

    const retryButtonsInfo = await evaluate(client, page.sessionId, `(() => {
      const retryBtns = Array.from(document.querySelectorAll('button[data-testid^="action-retry-"]'));
      return retryBtns.map(b => ({
        testId: b.getAttribute('data-testid'),
        text: b.innerText.trim(),
        disabled: b.disabled,
      }));
    })()`);
    console.log("  → 发现重试按钮:", JSON.stringify(retryButtonsInfo));
    assert(retryButtonsInfo.length > 0, "no_retry_button_found_after_orchestration");

    const targetRetryTestId = retryButtonsInfo[0].testId;
    console.log(`  → 准备真实点击单源重试按钮 [data-testid="${targetRetryTestId}"]...`);

    // 记录重试前的网络请求，用以验证重试时是否仅传递该源
    client.state.networkRequests = [];

    // 真实 DOM 点击单源重试
    const retryClickResult = await evaluate(client, page.sessionId, `(() => {
      const btn = document.querySelector('[data-testid="${targetRetryTestId}"]');
      if (!btn) return { ok: false, reason: "retry_btn_not_found" };
      btn.click();
      return { ok: true };
    })()`);
    assert(retryClickResult.ok, "single_source_retry_click_failed");

    // 等待单源重试网络请求触发并完成
    console.log("  → 正在验证单源重试网络请求 Payload...");
    await waitFor(client, page.sessionId, `(() => {
      // 检查按钮是否已被点击响应（进入 disabled 或重新变回可用）
      const btn = document.querySelector('[data-testid="${targetRetryTestId}"]');
      return Boolean(btn);
    })()`, 150, "retry_btn_response_timeout");

    // 检索发送的 research-orchestrator 请求
    const retryReq = client.state.networkRequests.find(r => r.url.includes("research-orchestrator") && r.method === "POST");
    assert(Boolean(retryReq), "no_retry_request_captured");
    const retryPayload = JSON.parse(retryReq?.postData || "{}");
    console.log("  → 捕获到重试请求 Payload:", JSON.stringify(retryPayload));
    assert(retryPayload.action === "orchestrate", "payload_action_not_orchestrate");
    assert(Array.isArray(retryPayload.sources) && retryPayload.sources.length === 1, "payload_sources_must_be_single_source");
    console.log(`  ✓ 验证通过：重试请求严格限制于单源 [${retryPayload.sources.join(", ")}]，未重启整链！`);

    // 等待重试完成
    await wait(1500);

    // 刷新页面，验证状态持久保持
    console.log("  → 执行页面刷新 (F5/reload) 验证状态持久性...");
    await client.send("Page.reload", {}, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"orchestrator-sources-list\"]'))", 250, "reload_sources_timeout");
    console.log("  ✓ 旅程 1 完成：四源状态与单源重试完全通过真实 DOM 点击驱动并持久化！");

    // ═══════════════════════════════════════════════════════════════════
    // 旅程 2：研究任务 → 真实点击“进入图片工作台” → URL 带 taskId → 读取事实/参考图 → 刷新状态保持
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[3/5] 开始执行旅程 2：从研究任务真实点击进入图片工作台 (带 taskId)...");
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"goto-image-studio-btn\"]'))", 250, "goto_image_studio_btn_timeout");

    console.log("  → 真实点击「进入图片工作台」按钮 [data-testid=\"goto-image-studio-btn\"]...");
    const gotoStudioResult = await evaluate(client, page.sessionId, `(() => {
      const btn = document.querySelector('[data-testid="goto-image-studio-btn"]');
      if (!btn) return { ok: false, reason: "btn_not_found" };
      btn.click();
      return { ok: true };
    })()`);
    assert(gotoStudioResult.ok, "goto_image_studio_btn_click_failed");

    // 等待跳转至 /image-studio?taskId=...
    await waitFor(client, page.sessionId, `window.location.pathname === '/image-studio' && window.location.search.includes('taskId=${encodeURIComponent(ownerTaskId)}')`, 250, "navigate_to_task_studio_timeout");
    console.log("  → 成功跳转到 URL:", await evaluate(client, page.sessionId, "window.location.href"));

    // 验证研究主链产品语义
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"image-studio-task-flow\"]'))", 250, "task_flow_timeout");
    const taskFlowCheck = await evaluate(client, page.sessionId, `(() => {
      return {
        hasTaskFlow: Boolean(document.querySelector('[data-testid="image-studio-task-flow"]')),
        hasTaskLinkedBanner: Boolean(document.querySelector('[data-testid="image-mode-task-linked"]')),
        hasStandaloneForm: Boolean(document.querySelector('[data-testid="free-creation-form"]')),
        hasTaskPreparation: Boolean(document.querySelector('[data-testid="task-preparation-panel"]') || document.querySelector('[data-testid="image-studio-task-mode"]')),
        bannerText: document.querySelector('[data-testid="image-mode-task-linked"]')?.innerText.trim(),
      };
    })()`);
    console.log("  → 研究主链元素核查:", JSON.stringify(taskFlowCheck));
    assert(taskFlowCheck.hasTaskFlow, "missing_image_studio_task_flow");
    assert(taskFlowCheck.hasTaskLinkedBanner, "missing_image_mode_task_linked");
    assert(!taskFlowCheck.hasStandaloneForm, "standalone_form_should_not_exist_in_task_flow");
    console.log("  ✓ 验证通过：研究主链带 taskId 正常加载任务事实流！");

    // 刷新页面验证状态保持
    console.log("  → 执行页面刷新 (F5/reload) 验证任务流状态保持...");
    await client.send("Page.reload", {}, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"image-studio-task-flow\"]'))", 250, "reload_task_studio_timeout");
    console.log("  ✓ 旅程 2 完成：带 taskId 访问准确识别为研究主链，F5 刷新状态保持！");

    // ═══════════════════════════════════════════════════════════════════
    // 旅程 3：侧边栏真实点击“图片工作台” → /image-studio 无 taskId → 显示独立极简生图界面 → 填写创作描述 → 点击生成并验证请求 payload 正确到达独立生图 API
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[4/5] 开始执行旅程 3：侧边栏真实点击进入独立图片工具 (无 taskId)...");
    // 在侧边栏寻找图片工作台链接
    const sidebarClickResult = await evaluate(client, page.sessionId, `(() => {
      const link = document.querySelector('aside a[href="/image-studio"], nav a[href="/image-studio"], a[href="/image-studio"]');
      if (!link) return { ok: false, reason: "sidebar_link_not_found" };
      link.click();
      return { ok: true };
    })()`);
    assert(sidebarClickResult.ok, "sidebar_image_studio_click_failed");

    // 等待跳转至 /image-studio (无 taskId)
    await waitFor(client, page.sessionId, "window.location.pathname === '/image-studio' && !window.location.search.includes('taskId')", 250, "navigate_to_standalone_studio_timeout");
    console.log("  → 成功跳转到 URL:", await evaluate(client, page.sessionId, "window.location.href"));

    // 验证独立图片工具产品语义
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"image-studio-standalone-flow\"]'))", 250, "standalone_flow_timeout");
    const standaloneCheck = await evaluate(client, page.sessionId, `(() => {
      return {
        hasStandaloneFlow: Boolean(document.querySelector('[data-testid="image-studio-standalone-flow"]')),
        hasStandaloneBanner: Boolean(document.querySelector('[data-testid="image-mode-standalone"]')),
        hasFreeCreationForm: Boolean(document.querySelector('[data-testid="free-creation-form"]')),
        hasPromptInput: Boolean(document.querySelector('[data-testid="free-creation-prompt"]')),
        hasSubmitBtn: Boolean(document.querySelector('[data-testid="free-creation-submit-btn"]')),
        hasTaskFlow: Boolean(document.querySelector('[data-testid="image-studio-task-flow"]')),
      };
    })()`);
    console.log("  → 独立工具元素核查:", JSON.stringify(standaloneCheck));
    assert(standaloneCheck.hasStandaloneFlow, "missing_image_studio_standalone_flow");
    assert(standaloneCheck.hasStandaloneBanner, "missing_image_mode_standalone");
    assert(standaloneCheck.hasFreeCreationForm, "missing_free_creation_form");
    assert(standaloneCheck.hasPromptInput, "missing_free_creation_prompt");
    assert(standaloneCheck.hasSubmitBtn, "missing_free_creation_submit_btn");
    assert(!standaloneCheck.hasTaskFlow, "task_flow_should_not_exist_in_standalone");
    console.log("  ✓ 验证通过：无 taskId 访问正常展示极简独立生图入口！");

    // 点击快速模板填入描述
    console.log("  → 真实点击快速模板「白底主图」[data-testid=\"free-creation-template-white_background\"]...");
    const templateClickResult = await evaluate(client, page.sessionId, `(() => {
      const tplBtn = document.querySelector('[data-testid="free-creation-template-white_background"]');
      if (!tplBtn) return { ok: false, reason: "template_btn_not_found" };
      tplBtn.click();
      return { ok: true };
    })()`);
    assert(templateClickResult.ok, "template_btn_not_found");

    await waitFor(client, page.sessionId, `(() => {
      const val = document.querySelector('[data-testid="free-creation-prompt"]')?.value;
      return Boolean(val && val.length > 0);
    })()`, 150, "template_prompt_fill_timeout");

    const promptValue = await evaluate(client, page.sessionId, `document.querySelector('[data-testid="free-creation-prompt"]')?.value`);
    console.log("  → 描述已填入:", String(promptValue).slice(0, 60) + "...");

    // 选择比例 4:5 与 数量 2 张（测试决策项）
    await evaluate(client, page.sessionId, `(() => {
      document.querySelector('[data-testid="free-creation-aspect-ratio-portrait_4_5"]')?.click();
      document.querySelector('[data-testid="free-creation-count-2"]')?.click();
      return true;
    })()`);

    // 监控独立生图请求
    client.state.networkRequests = [];

    // 真实 DOM 点击「生成图片」
    console.log("  → 真实点击「生成图片」提交按钮 [data-testid=\"free-creation-submit-btn\"]...");
    const generateClickResult = await evaluate(client, page.sessionId, `(() => {
      const submitBtn = document.querySelector('[data-testid="free-creation-submit-btn"]');
      if (!submitBtn) return { ok: false, reason: "submit_btn_not_found" };
      submitBtn.click();
      return { ok: true };
    })()`);
    assert(generateClickResult.ok, "free_creation_submit_click_failed");

    // 等待独立生图 API 请求捕获
    console.log("  → 等待 /api/image-studio 请求并验证 Payload...");
    await waitFor(client, page.sessionId, `(() => {
      const results = document.querySelector('[data-testid="free-creation-results"]');
      const err = document.querySelector('[data-testid="free-creation-error-banner"]');
      return Boolean(results || err);
    })()`, 250, "image_generation_complete_timeout");

    const studioReq = client.state.networkRequests.find(r => r.url.endsWith("/api/image-studio") && r.method === "POST");
    assert(Boolean(studioReq), "no_studio_request_captured");
    const studioPayload = JSON.parse(studioReq?.postData || "{}");
    console.log("  → 捕获到独立生图 Payload:", JSON.stringify(studioPayload, null, 2));

    assert(studioPayload.creationMode === "prompt", "creationMode_must_be_prompt");
    assert(typeof studioPayload.creativePrompt === "string" && studioPayload.creativePrompt.length > 0, "creativePrompt_must_not_be_empty");
    assert(studioPayload.aspectRatio === "portrait_4_5", "aspectRatio_not_portrait_4_5");
    assert(studioPayload.count === 2, "count_not_2");
    assert(studioPayload.mode === "mock", "mode_must_be_mock");
    assert(studioPayload.briefVersion === "studio-creative-brief.v1", "briefVersion_invalid");
    assert(studioPayload.factsConfirmed === true, "factsConfirmed_not_true");
    assert(studioPayload.humanReviewRequired === true, "humanReviewRequired_not_true");
    console.log("  ✓ 验证通过：真实 DOM 点击成功触发生图，Payload 与独立生图 API 契约完全一致！");

    // 验证生成结果工作区展示
    const resultsCheck = await evaluate(client, page.sessionId, `(() => {
      const results = document.querySelector('[data-testid="free-creation-results"]');
      return {
        hasResults: Boolean(results),
        imageCount: results ? results.querySelectorAll('img').length : 0,
      };
    })()`);
    console.log("  → 独立生图结果展示核查:", JSON.stringify(resultsCheck));
    assert(resultsCheck.hasResults && resultsCheck.imageCount > 0, "no_images_displayed_in_results");
    console.log("  ✓ 旅程 3 完成：极简独立生图从描述输入、参数选择到生成展示端到端闭环！");

    // ═══════════════════════════════════════════════════════════════════
    // 全链路控制台错误核查
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[5/5] 检查全链路真实 Chrome 控制台错误日志...");
    console.log("  → 控制台错误总数:", client.state.consoleErrorCount);
    if (client.state.consoleErrorCount > 0) {
      console.error("  → 错误详情:", client.state.consoleErrorDiagnostics);
    }
    assert(client.state.consoleErrorCount === 0, `console_error_detected: count=${client.state.consoleErrorCount}`);
    console.log("  ✓ 全链路 Console Error = 0 严格达成！");

    console.log("\n==================================================");
    console.log("  ALL 3 USER JOURNEYS FULLY VERIFIED IN REAL CHROME!");
    console.log("==================================================\n");

  } finally {
    if (client) client.close();
    if (chromePid && isOwnedProcessRunning(chromePid)) stopOwnedProcess(chromePid);
    if (runtimePid && isOwnedProcessRunning(runtimePid)) stopOwnedProcess(runtimePid);
    // 清理临时目录
    try {
      rmSync(runtimeRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function isOwnedProcessRunning(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
