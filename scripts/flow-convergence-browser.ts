#!/usr/bin/env node

// V2 用户流程收口验收（隔离环境 + 真实 Chrome）
// 1. 发现商品页：上传→最近导入→商品选择 清晰路径；无 ProductBatch 术语暴露
// 2. 研究结果页：商品决策报告 5 秒内回答 商品怎么样/下一步/已生成什么；五步骤降为导航

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, writeFileSync,
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
const PORTS = [3180, 3181] as const;
const CDP_PORT = 24880;
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
  throw new Error("smoke_port_both_in_use");
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
function makeVisitorActor(accessId: string) {
  return { mode: "visitor" as const, actorRef: `visitor:${createHash("sha256").update(accessId).digest("hex").slice(0, 16)}` } as const;
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
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "Synthetic.", nextAction: null },
  });
  return {
    productName: "Flow 收口验收商品",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Flow convergence acceptance.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Flow 收口验收商品",
        finalReport: { finalVerdict: "Synthetic only.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Synthetic supplier." },
        risk: { overallLevel: "low", summary: "Synthetic risk summary.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Synthetic.", sellingPoints: ["Adjustable"], concerns: [], confidence: "medium" },
        listing: { title: "Flow product", bullets: ["Confirmed bullet."], keywords: ["synthetic"], imageIdeas: ["户外场景构图"], missingInputs: [] },
      },
    }),
    listingPrepSnapshot: {
      keywordPool: { coreWords: ["synthetic"], longTailWords: [], sceneWords: [], crowdWords: [], attributeWords: [], riskWordReminder: "" },
      titleStructure: { formula: "brand + product", recommendedTitle: "Flow Product", breakdown: [] },
      bulletDrafts: ["Confirmed bullet."],
      searchTerms: { draft: "synthetic", reminders: [] },
      imageMaterialNeeds: ["主图", "场景图"],
      manualSupplementChecklist: [],
      complianceExpressionReminders: [],
    },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Flow 收口验收商品",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0FLOW0001",
      productUrl: "https://example.com/flow",
      title: "Flow Product",
      brand: "SyntheticBrand",
      category: "Home",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 100,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "flow",
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
    consoleErrorCount: 0, consoleErrorDiagnostics: [] as string[],
    externalHttpRequestCount: 0, server5xxCount: 0,
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
      if (message.error) entry.reject(new Error("cdp_command_failed"));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      state.consoleErrorCount += 1;
      state.consoleErrorDiagnostics.push(String(message.params.args?.[0]?.value ?? message.params.args?.[0]?.description ?? "unknown").slice(0, 150));
    }
    if (message.method === "Network.requestWillBeSent") {
      const url = String(message.params?.request?.url ?? "");
      try {
        const u = new URL(url);
        if (u.hostname !== "127.0.0.1" && u.protocol.startsWith("http")) state.externalHttpRequestCount += 1;
      } catch { /* ignore */ }
    }
    if (message.method === "Network.responseReceived") {
      const status = Number(message.params?.response?.status);
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
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) throw new Error("smoke_owned_process_stop_failed");
}
function isOwnedProcessRunning(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
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
async function waitFor(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string, attempts = 200, code = "wait_timeout") {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await wait(100);
  }
  throw new Error(code);
}
async function waitForHealth(baseUrl: string, childPid: number) {
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

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `flow-convergence-${timestamp}`);
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "flow.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const visitorAPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const visitorAId = `demo_${randomBytes(8).toString("hex")}`;
  const ownerTaskId = "flow-convergence-owner-task";
  const ownerCandidateId = "flow-convergence-owner-candidate";
  const visitorTaskId = "sandbox_task_flowconv_visitor_a";
  const visitorCandidateId = "sandbox_candidate_flowconv_visitor_a";
  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord = { status: "failed", port };

  try {
    mkdirSync(runtimeRoot);
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./flow.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
    ]);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-flow", actor: { mode: "owner", actorRef: "owner:v1" } });
    const visitorResult = buildProtectedResult({ candidateId: visitorCandidateId, runId: "wf-flow-v", actor: makeVisitorActor(visitorAId) });
    const createdAt = "2026-08-07T02:00:00.000Z";
    const sandboxStore = {
      version: 1,
      tasks: [{
        id: visitorTaskId, demoAccessId: visitorAId, type: "workflow",
        title: "Synthetic visitor research", decisionStatus: "continue",
        platform: "local-test", productUrl: null, materialText: "Synthetic",
        source: "agent_run", score: 0, level: "low", oneLineSummary: "Synthetic",
        resultJson: JSON.stringify(visitorResult), productLifecycle: "{}",
        createdAt, updatedAt: createdAt,
      }],
      candidates: [{
        id: visitorCandidateId, demoAccessId: visitorAId,
        name: "Synthetic visitor candidate", rawInput: "Synthetic", link: null,
        score: 0, source: "SellerSprite", keyword: "", riskLevel: "",
        riskLabel: "", summaryLabel: "", status: "pending",
        sourceMetaJson: "{}", analysisJson: "{}", createdAt,
        convertedTaskId: visitorTaskId, originProductBatchItemId: null, lastActionAt: createdAt,
      }],
    };
    writeFileSync(sandboxStorePath, `${JSON.stringify(sandboxStore, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.create({
        data: {
          id: ownerTaskId, createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
          type: "workflow", decisionStatus: "continue",
          title: "Flow owner", platform: "local-test",
          productUrl: null, materialText: "Synthetic", source: "isolated-flow",
          score: 0, level: "low", oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId, name: "Flow owner candidate", rawInput: "Synthetic",
          source: "SellerSprite", status: "pending", sourceMetaJson: "{}", analysisJson: "{}",
          convertedTaskId: ownerTaskId, lastActionAt: new Date(createdAt),
        },
      });
    });

    // 启动运行时
    const sanitizedEnv: Record<string, string | undefined> = {};
    for (const key of ["APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR"]) {
      if (process.env[key]) sanitizedEnv[key] = process.env[key];
    }
    Object.assign(sanitizedEnv, {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      ACCESS_PASSWORD: ownerPassword,
      PROOF_SIGNING_SECRET: proofSigningSecret,
      DATABASE_URL: databaseUrl,
      DEMO_ACCESS_STORE_PATH: accessStorePath,
      DEMO_SANDBOX_STORE_PATH: sandboxStorePath,
      LISTING_PROVIDER_MODE: "mock",
      IMAGE_PROVIDER_MODE: "mock",
      AI_IMAGE_DRAFT_STORAGE_ROOT: join(runtimeRoot, "image-assets"),
    });
    process.env.ACCESS_PASSWORD = ownerPassword;
    process.env.PROOF_SIGNING_SECRET = proofSigningSecret;
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
    await waitForHealth(baseUrl, runtimePid!);

    const owner = await login(baseUrl, ownerPassword);
    const chrome = await startChrome(runtimeRoot);
    chromePid = chrome.pid;
    const client = cdpClient(chrome.ws);
    const page = await createPage(client);
    await client.send("Page.navigate", { url: baseUrl }, page.sessionId);
    await waitFor(client, page.sessionId, "document.readyState === 'complete'", 160, "home_ready_timeout");
    await evaluate(client, page.sessionId, `(() => {
      sessionStorage.setItem('qx:access-token:session:v1', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-mode:session:v1', 'owner');
      sessionStorage.setItem('qx:access-password:session:v2', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-expires:session:v2', String(Date.now() + 3600000));
      return true;
    })()`);

    // ── 1. 发现商品页：用户流程 + 无内部术语 ──
    await client.send("Page.navigate", { url: `${baseUrl}/opportunities` }, page.sessionId);
    // 等数据加载完成（上传入口或空状态出现，而非仅标题）
    await waitFor(client, page.sessionId, "document.body.innerText.includes('上传 SellerSprite 报表') || document.body.innerText.includes('还没有导入商品') || document.body.innerText.includes('登录后查看和选择商品')", 250, "opp_ready_timeout");
    const opp = await evaluate(client, page.sessionId, `(() => {
      const text = document.body.innerText;
      return {
        hasUpload: text.includes('上传 SellerSprite 报表'),
        hasUploadBtn: text.includes('上传并预览报表'),
        hasRecentImport: text.includes('最近一次导入') || text.includes('最近导入'),
        hasHistory: text.includes('历史导入'),
        hasSelection: text.includes('选择商品') || text.includes('第三步'),
        hasStep1: text.includes('第一步'),
        hasStep2: text.includes('第二步'),
        // 内部术语不得暴露
        hasProductBatch: text.includes('商品批次'),
        hasBatchHistory: text.includes('批次历史'),
        hasCurrentBatch: text.includes('当前批次'),
        hasEmptyHint: text.includes('还没有导入商品'),
      };
    })()`);
    report.opportunities = opp;
    assert(opp.hasUpload && opp.hasUploadBtn, `smoke_opp_upload:${JSON.stringify(opp)}`);
    assert(opp.hasRecentImport && opp.hasHistory && opp.hasStep1 && opp.hasStep2, `smoke_opp_structure:${JSON.stringify(opp)}`);
    assert(!opp.hasProductBatch && !opp.hasBatchHistory && !opp.hasCurrentBatch, `smoke_opp_internal_terms:${JSON.stringify(opp)}`);
    assert(opp.hasEmptyHint, "smoke_opp_empty_hint");
    // 上传入口链接指向预览页
    const uploadLink = await evaluate(client, page.sessionId, `(() => {
      const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('上传并预览报表'));
      return a ? a.getAttribute('href') : '';
    })()`);
    report.uploadLink = uploadLink;
    assert(uploadLink === "/opportunities/sellersprite-preview", `smoke_upload_link:${uploadLink}`);

    // ── 2. 研究结果页：商品决策报告 5 秒内回答三问 ──
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"product-decision-report\"]'))", 200, "report_timeout");
    const detail = await evaluate(client, page.sessionId, `(() => {
      const report = document.querySelector('[data-testid="product-decision-report"]');
      const text = report ? report.innerText : '';
      const body = document.body.innerText;
      return {
        reportPresent: Boolean(report),
        // 1. 商品怎么样（AI 判断）
        hasAiJudgment: text.includes('AI 判断'),
        hasConclusion: text.includes('尚未保存可确认的市场研究结论') || text.includes('Synthetic'),
        // 2. 下一步做什么
        hasNext: text.includes('下一步'),
        hasMissing: text.includes('还缺'),
        // 3. 已经生成什么
        hasGenerated: text.includes('已生成内容'),
        hasManualConfirm: text.includes('需要人工确认'),
        // 五步骤降为导航
        hasStepsSection: body.includes('推进步骤'),
        hasStepNote: body.includes('按需展开步骤操作'),
        hasWorkflow: body.includes('创作交接') && body.includes('Listing 草稿') && body.includes('产品图片'),
        // 5 秒内可理解：决策报告在进度摘要之前（DOM 顺序 + 视觉位置）
        reportBeforeSummary: Boolean(document.querySelector('[data-testid="product-decision-report"]'))
          && Boolean(document.querySelector('[data-testid="user-progress-summary"]'))
          && (() => {
            const r = document.querySelector('[data-testid="product-decision-report"]');
            const s = document.querySelector('[data-testid="user-progress-summary"]');
            return r.getBoundingClientRect().top < s.getBoundingClientRect().top;
          })(),
      };
    })()`);
    report.detail = detail;
    assert(detail.reportPresent && detail.hasAiJudgment && detail.hasConclusion, `smoke_report_judgment:${JSON.stringify(detail)}`);
    assert(detail.hasNext && detail.hasMissing && detail.hasGenerated && detail.hasManualConfirm, `smoke_report_sections:${JSON.stringify(detail)}`);
    assert(detail.hasStepsSection && detail.hasStepNote && detail.hasWorkflow, `smoke_steps_nav:${JSON.stringify(detail)}`);
    assert(detail.reportBeforeSummary === true, "smoke_report_position");

    // ── 3. 页面稳定 ──
    report.sideEffects = {
      consoleErrorCount: client.state.consoleErrorCount,
      consoleErrorDiagnostics: client.state.consoleErrorDiagnostics.slice(0, 3),
      server5xxCount: client.state.server5xxCount,
      externalHttpRequestCount: client.state.externalHttpRequestCount,
    };
    assert(client.state.server5xxCount === 0, "smoke_server_5xx");
    assert(client.state.consoleErrorCount === 0, `smoke_console_errors:${JSON.stringify(client.state.consoleErrorDiagnostics.slice(0, 3))}`);
    client.close();
    report.status = "passed";
  } finally {
    if (prisma) await prisma.$disconnect();
    if (chromePid) {
      try { stopOwnedProcess(chromePid); } catch { report.chromeStopFailed = true; }
    }
    for (let attempt = 0; attempt < 60 && !(await isPortFree(CDP_PORT)); attempt += 1) await wait(100);
    if (runtimePid) {
      try {
        process.kill(runtimePid, "SIGTERM");
        for (let attempt = 0; attempt < 50 && isOwnedProcessRunning(runtimePid); attempt += 1) await wait(100);
        if (isOwnedProcessRunning(runtimePid)) stopOwnedProcess(runtimePid);
      } catch { report.runtimeStopFailed = true; }
    }
    for (let attempt = 0; attempt < 60 && !(await isPortFree(port)); attempt += 1) await wait(100);
    report.portReleased = await isPortFree(port);
    assert(report.portReleased, "smoke_cleanup_failed");
  }
  try {
    writeFileSync(join(runtimeRoot, "flow-convergence-final.json"), JSON.stringify(report, null, 2), "utf8");
  } catch { report.reportWriteFailed = true; }
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`smoke_fatal:${String(error instanceof Error ? error.message : error).slice(0, 500)}`);
  process.exitCode = 1;
});
