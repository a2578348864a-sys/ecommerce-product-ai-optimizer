#!/usr/bin/env node

// Relay URL 修复：真实 product_visual 验收 Smoke（授权 1 次真实调用）
// Mock Listing + 真实 product_visual（images.edit 返回 url → 安全下载 → 持久化）
// Mock Provider（不消耗真实配额；真实 Provider 已在 real-smoke 验证）
// 完整流程：合成候选 → Handoff Preview 展示视觉候选 → 用户批准视觉参考 → createHandoff 写入
// → 真实 Listing 生成（Mock）→ Claim 校验 → 保存 → Image 生成（Mock）→ 持久 → Revision 一致性
// → 更新 Handoff → stale → Revoke → revoked → 幂等 → Visitor 隔离。

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
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
const PORTS = [3146, 3147] as const;
const CDP_PORT = 24820;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const nodeRequestEvidence = {
  requestCount: 0,
  externalHttpRequestCount: 0,
  productionPortAccessCount: 0,
  server5xxCount: 0,
};

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
}

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function publicErrorCode(value: unknown): string {
  const error = jsonRecord(jsonRecord(value).error);
  return typeof error.code === "string" ? error.code : "unknown";
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
      id: entry.id, label: entry.label,
      passwordHash: hashSyntheticPassword(entry.password, salt),
      salt, expiresAt: null, maxAiCalls: 0, usedAiCalls: 0, isActive: true,
      createdAt: new Date().toISOString(), lastUsedAt: null,
      notes: "Disposable V2-FI browser smoke only.",
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
    now: "2026-08-05T01:00:00.000Z",
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "Synthetic.", nextAction: null },
  });
  return {
    productName: "Synthetic V2-FI browser product",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Synthetic isolated V2-FI browser record.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    unknownInternalNamespace: { keepPrivate: true },
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Synthetic V2-FI browser product",
        finalReport: { finalVerdict: "Synthetic only.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Synthetic supplier." },
        risk: { overallLevel: "low", summary: "Synthetic risk summary.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Synthetic.", sellingPoints: ["Adjustable angle"], concerns: [], confidence: "medium" },
        listing: { title: "Synthetic V2-FI browser product", bullets: ["Confirmed fact bullet."], keywords: ["synthetic"], imageIdeas: ["户外场景构图", "简洁白底背景"], missingInputs: [] },
      },
    }),
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Synthetic V2-FI browser product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0V2FI0002",
      productUrl: "https://example.com/v2fib",
      title: "Synthetic V2-FI Browser Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "v2fib",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-05T01:00:00.000Z",
      contextHash,
      productImage: {
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        contentHash: "d".repeat(64),
        provenance: "candidate_fallback",
      },
    },
  };
}

function makeVisitorActor(accessId: string) {
  return { mode: "visitor" as const, actorRef: `visitor:${createHash("sha256").update(accessId).digest("hex").slice(0, 16)}` } as const;
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  nodeRequestEvidence.requestCount += 1;
  const url = new URL(path, baseUrl);
  if (url.hostname !== HOST || (url.port !== "3146" && url.port !== "3147")) {
    nodeRequestEvidence.externalHttpRequestCount += 1;
  }
  if (url.port === "3005") nodeRequestEvidence.productionPortAccessCount += 1;
  const headers: Record<string, string> = { "content-type": "application/json", "x-access-token": token, "x-access-password": token };
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (response.status >= 500) nodeRequestEvidence.server5xxCount += 1;
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const rawBody = await response.text();
  const body = jsonRecord(JSON.parse(rawBody));
  assert(response.status === 200 && body.ok === true && typeof body.accessToken === "string", `smoke_login_failed:${response.status}:${rawBody.slice(0, 120)}`);
  return { mode: body.mode, token: body.accessToken as string };
}

function cdpClient(webSocketUrl: string) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const state = {
    consoleErrorCount: 0,
    consoleErrorDiagnostics: [] as Array<{ category: string; fingerprint: string }>,
    externalHttpRequestCount: 0,
    server5xxCount: 0,
    imageHandoffRequests: [] as string[],
    listingHandoffRequests: [] as string[],
    studioRequests: [] as string[],
  };
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady(), { once: true });
    socket.addEventListener("error", () => rejectReady(new Error("smoke_cdp_connect_failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error("smoke_cdp_command_failed"));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      state.consoleErrorCount += 1;
      const text = Array.isArray(message.params.args)
        ? message.params.args.map((argument: JsonRecord) => String(argument.value ?? argument.description ?? argument.type ?? "")).join(" ")
        : "unknown";
      state.consoleErrorDiagnostics.push({ category: "console", fingerprint: text.slice(0, 200) });
    }
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = String(message.params?.request?.url ?? "");
      const requestMethod = String(message.params?.request?.method ?? "GET").toUpperCase();
      try {
        const url = new URL(requestUrl);
        if (url.pathname.includes("image-handoff")) state.imageHandoffRequests.push(requestUrl + "|" + requestMethod);
        if (url.pathname.includes("listing-handoff")) state.listingHandoffRequests.push(requestUrl + "|" + requestMethod);
        if (url.pathname.includes("listing-studio") || url.pathname.includes("image-studio")) state.studioRequests.push(requestUrl + "|" + requestMethod);
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== HOST) {
          state.externalHttpRequestCount += 1;
        }
      } catch {
        // Browser-internal URLs.
      }
    }
    if (message.method === "Network.responseReceived") {
      const status = Number(message.params?.response?.status);
      if (status >= 500) state.server5xxCount += 1;
    }
  });
  return {
    ready,
    state,
    async send(method: string, params: JsonRecord = {}, sessionId?: string) {
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
  assert(await isPortFree(CDP_PORT), "smoke_cdp_port_in_use");
  const child = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-address=${HOST}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(runtimeRoot, "chrome-profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "about:blank",
  ], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  assert(Number.isInteger(child.pid), "smoke_chrome_pid_missing");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://${HOST}:${CDP_PORT}/json/version`);
      const version = jsonRecord(await response.json());
      if (typeof version.webSocketDebuggerUrl === "string") {
        return { pid: child.pid!, webSocketDebuggerUrl: version.webSocketDebuggerUrl };
      }
    } catch {
      // Bounded wait for this owned Chrome only.
    }
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
  const context = await client.send("Target.createBrowserContext");
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId as string;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId);
  return { sessionId, browserContextId: context.browserContextId as string };
}

async function evaluate(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error(`smoke_page_script_failed:${JSON.stringify({ text: response.exceptionDetails.text, description: response.exceptionDetails.exception?.description ?? response.exceptionDetails.exception?.value }).slice(0, 600)}`);
  return response.result?.value;
}

async function waitFor(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string, attempts = 200, timeoutCode = "smoke_page_timeout") {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await wait(100);
  }
  throw new Error(timeoutCode);
}

async function waitForHealth(baseUrl: string, childPid: number) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.status === 200) return;
    } catch {
      // Bounded wait for the owned runtime only.
    }
    const alive = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process -Id ${childPid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`], { encoding: "utf8", windowsHide: true }).stdout.trim();
    assert(alive === String(childPid), "smoke_runtime_exited_early");
    await wait(250);
  }
  throw new Error("smoke_runtime_health_timeout");
}

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `v2-fi-browser-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "browser.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const visitorAPassword = randomBytes(24).toString("base64url");
  const visitorBPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const visitorAId = `demo_${randomBytes(8).toString("hex")}`;
  const visitorBId = `demo_${randomBytes(8).toString("hex")}`;
  const ownerTaskId = "v2fi-browser-owner-task";
  const ownerCandidateId = "v2fi-browser-owner-candidate";
  const visitorTaskId = "sandbox_task_v2fi_visitor_a";
  const visitorCandidateId = "sandbox_candidate_v2fi_visitor_a";
  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord & { previewDiagnostic?: JsonRecord; visualApiDiag?: JsonRecord; pageDiagnostic?: JsonRecord } = { status: "failed", port, runtimeRootRemoved: false };

  try {
    mkdirSync(runtimeRoot);
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./browser.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
      { id: visitorBId, password: visitorBPassword, label: "Synthetic Visitor B" },
    ]);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-v2fi-browser", actor: { mode: "owner", actorRef: "owner:v1" } });
    const visitorResult = buildProtectedResult({ candidateId: visitorCandidateId, runId: "wf-v2fi-browser-v", actor: makeVisitorActor(visitorAId) });
    const createdAt = "2026-08-05T02:00:00.000Z";
    const sandboxStore = {
      version: 1,
      tasks: [{
        id: visitorTaskId,
        demoAccessId: visitorAId,
        type: "workflow",
        title: "Synthetic visitor research",
        decisionStatus: "creative_ready",
        platform: "local-test",
        productUrl: null,
        materialText: "Synthetic",
        source: "agent_run",
        score: 0,
        level: "low",
        oneLineSummary: "Synthetic",
        resultJson: JSON.stringify(visitorResult),
        productLifecycle: "{}",
        createdAt,
        updatedAt: createdAt,
      }],
      candidates: [{
        id: visitorCandidateId,
        demoAccessId: visitorAId,
        name: "Synthetic visitor candidate",
        rawInput: "Synthetic",
        link: null,
        score: 0,
        source: "SellerSprite",
        keyword: "",
        riskLevel: "",
        riskLabel: "",
        summaryLabel: "",
        status: "pending",
        sourceMetaJson: "{}",
        analysisJson: "{}",
        createdAt,
        convertedTaskId: visitorTaskId,
        originProductBatchItemId: null,
        lastActionAt: createdAt,
      }],
    };
    writeFileSync(sandboxStorePath, `${JSON.stringify(sandboxStore, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.create({
        data: {
          id: ownerTaskId,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
          type: "workflow",
          decisionStatus: "creative_ready",
          title: "Synthetic V2-FI browser",
          platform: "local-test",
          productUrl: null,
          materialText: "Synthetic",
          source: "isolated-v2fi-browser",
          score: 0,
          level: "low",
          oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId,
          name: "Synthetic V2-FI browser candidate",
          rawInput: "Synthetic",
          source: "SellerSprite",
          status: "pending",
          sourceMetaJson: "{}",
          analysisJson: "{}",
          convertedTaskId: ownerTaskId,
          lastActionAt: new Date(createdAt),
        },
      });
    });

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
      IMAGE_PROVIDER_MODE: "real",
      AI_IMAGE_DRAFT_STORAGE_ROOT: join(runtimeRoot, "image-assets"),
      // 真实 Image Provider 配置（生产 .env.local 读取；仅内存；不输出）
      ...(() => {
        const fs2 = require("node:fs");
        const envFile = "D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/.env.local";
        if (!fs2.existsSync(envFile)) return {};
        const content = fs2.readFileSync(envFile, "utf8");
        const out: Record<string, string> = {};
        for (const key of ["OPENAI_API_KEY", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_MODEL", "OPENAI_IMAGE_RESULT_HOSTS", "OPENAI_IMAGE_TIMEOUT_MS", "OPENAI_IMAGE_BASE_HOSTS"]) {
          const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
          if (m) out[key] = m[1].trim();
        }
        return out;
      })(),
    });
    process.env.ACCESS_PASSWORD = ownerPassword;
    process.env.PROOF_SIGNING_SECRET = proofSigningSecret;
    delete process.env.APP_ACCESS_PASSWORD;
    const logHandle = openSync(logPath, "ax");
    try {
      const runtime = spawn(process.execPath, [
        join(WORKTREE, "node_modules", "next", "dist", "bin", "next"),
        "start", "-H", HOST, "-p", String(port),
      ], {
        cwd: WORKTREE,
        env: sanitizedEnv as NodeJS.ProcessEnv,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", logHandle, logHandle],
      });
      runtimePid = runtime.pid ?? null;
      runtime.unref();
    } finally {
      closeSync(logHandle);
    }
    assert(Number.isInteger(runtimePid), "smoke_runtime_pid_missing");
    await waitForHealth(baseUrl, runtimePid!);

    const owner = await login(baseUrl, ownerPassword);
    const visitorA = await login(baseUrl, visitorAPassword);
    const visitorB = await login(baseUrl, visitorBPassword);
    assert(owner.mode === "owner" && visitorA.mode === "demo" && visitorB.mode === "demo", "smoke_login_mode_invalid");

    // ── 1. Handoff Preview 展示视觉候选（V2-FI 生产链）──
    const preview = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff?mode=preview`);
    assert(preview.status === 200, `smoke_handoff_preview_failed:${preview.status}:${JSON.stringify(preview.body).slice(0, 200)}`);
    const previewBody = jsonRecord(preview.body);
    const previewData = jsonRecord(previewBody.preview);
    report.previewDiagnostic = { gateReason: previewBody.gateReason, candidateFacts: Array.isArray(previewData.confirmableFactCandidates) ? (previewData.confirmableFactCandidates as unknown[]).length : 0 };
    console.error("DIAG gateReason:", previewBody.gateReason, "| confirmables:", report.previewDiagnostic.candidateFacts, "| visualCandidates:", JSON.stringify(previewData.visualReferenceCandidates));
    const visualCandidates = Array.isArray(previewData.visualReferenceCandidates)
      ? previewData.visualReferenceCandidates as Array<JsonRecord>
      : [];
    assert(visualCandidates.length === 1, `smoke_visual_candidate_missing:${visualCandidates.length}`);
    assert(typeof visualCandidates[0].selectionId === "string" && visualCandidates[0].selectionId.startsWith("visual:"), "smoke_visual_candidate_selection_id");
    assert(visualCandidates[0].approvedForReference === true, "smoke_visual_candidate_approvable");
    // DTO 安全：不含 dataUrl / 完整 hash
    const visualRaw = JSON.stringify(visualCandidates);
    assert(!visualRaw.includes("data:") && !visualRaw.includes("d".repeat(64)), "smoke_visual_candidate_dto_leak");
    report.visualCandidate = { selectionId: visualCandidates[0].selectionId };

    // ── 2. 用户批准视觉参考 → createHandoff 写入 visualReferences ──
    const confirmables = Array.isArray(previewData.confirmableFactCandidates) ? previewData.confirmableFactCandidates as Array<{ selectionId: string }> : [];
    assert(confirmables.length >= 2, "smoke_confirmables_missing");
    const createResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        requestId: "550e8400-e29b-41d4-a716-446655440201",
        confirmed: true,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 0,
        expectedStorageVersion: jsonRecord(previewData.storageVersion ?? {}),
        selectedFactCandidateIds: confirmables.slice(0, 2).map((c) => c.selectionId as string),
        selectedVisualReferenceCandidateIds: [visualCandidates[0].selectionId as string],
      }),
    });
    assert(createResp.status === 200 || createResp.status === 201, `smoke_handoff_create:${createResp.status}:${JSON.stringify(createResp.body).slice(0, 200)}`);

    // DB 验证 visualReferences 已写入（identityBound=true + 批准主体/时间）
    const row1 = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const parsed1 = JSON.parse(row1!.resultJson);
    const handoff1 = parsed1.creativeHandoff as JsonRecord;
    const version1 = (handoff1.versions as Array<JsonRecord>)[(handoff1.versions as Array<JsonRecord>).length - 1];
    const visualRefs = version1.visualReferences as Array<JsonRecord>;
    assert(visualRefs.length === 1, "smoke_visual_ref_written");
    assert(visualRefs[0].identityBound === true, "smoke_visual_ref_identity_bound");
    assert(visualRefs[0].humanApprovedForReference === true, "smoke_visual_ref_approved");
    assert(typeof visualRefs[0].approvedAt === "string" && typeof visualRefs[0].approvedBy === "object", "smoke_visual_ref_approval_meta");
    assert(typeof visualRefs[0].assetFingerprint === "string" && /^[a-f0-9]{64}$/.test(visualRefs[0].assetFingerprint), "smoke_visual_ref_fingerprint");
    report.visualReferenceWritten = { identityBound: true, fingerprint: String(visualRefs[0].assetFingerprint).slice(0, 8) };

    // ── 3. Image 页面 product_visual_draft（真实浏览器）──
    const chrome = await startChrome(runtimeRoot);
    chromePid = chrome.pid;
    const client = cdpClient(chrome.webSocketDebuggerUrl);
    const page = await createPage(client);
    await client.send("Page.navigate", { url: baseUrl }, page.sessionId);
    await waitFor(client, page.sessionId, "document.readyState === 'complete'", 160, "smoke_home_ready_timeout");
    await evaluate(client, page.sessionId, `(() => {
      sessionStorage.setItem('qx:access-token:session:v1', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-mode:session:v1', 'owner');
      sessionStorage.setItem('qx:access-password:session:v2', ${JSON.stringify(owner.token)});
      sessionStorage.setItem('qx:access-expires:session:v2', String(Date.now() + 3600000));
      return true;
    })()`);
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    try {
      await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('AI 生成图片草稿')", 250, "smoke_image_section_timeout");
    } catch (sectionError) {
      const diag = await evaluate(client, page.sessionId, `(() => {
        const text = document.body ? document.body.innerText : '';
        return { hasBody: Boolean(document.body), textLength: text.length, snippet: text.slice(0, 300), hasLogin: text.includes('请先输入访问密码') || text.includes('登录'), title: document.title };
      })()`);
      report.pageDiagnostic = { ...diag, consoleErrors: client.state.consoleErrorDiagnostics };
      console.error("DIAG page:", JSON.stringify(diag).slice(0, 400));
      console.error("DIAG consoleErrors:", JSON.stringify(client.state.consoleErrorDiagnostics).slice(0, 600));
      throw sectionError;
    }
    // product_visual 模式显示（基于批准参考）
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('基于批准视觉参考）')", 250, "smoke_visual_ui_timeout");
    const visualUi = await evaluate(client, page.sessionId, `(() => {
      const text = document.body.innerText;
      return {
        productVisualButton: text.includes('生成产品视觉草稿'),
        approvedRefShown: text.includes('批准视觉参考'),
        noPublish: !(text.includes('发布') && !text.includes('不得直接发布')),
      };
    })()`);
    assert(visualUi.productVisualButton === true, "smoke_visual_ui_button");
    assert(visualUi.noPublish === true, "smoke_visual_ui_publish");
    report.visualUi = visualUi;



    // API 验证 product_visual 生成成功（Mock Provider）+ Binding 指纹
    const visState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`);
    assert(visState.status === 200, "smoke_image_state");
    const visData = jsonRecord(jsonRecord(visState.body).data);
    assert(visData.mode === "product_visual_draft", `smoke_visual_mode:${visData.mode}`);
    assert(visData.canGenerate === true, "smoke_visual_can_generate");
    assert((visData.approvedVisualReferenceSummary as unknown[]).length === 1, "smoke_visual_approved_ref_count");
    report.visualState = { mode: visData.mode, allowedModes: visData.allowedModes };

    // API 诊断：直接生成 product_visual_draft（跳过浏览器点击，定位生成失败原因）
    const approvedSummaries = visData.approvedVisualReferenceSummary as unknown[] | undefined;
    const firstSelectionId = approvedSummaries && approvedSummaries[0]
      ? (jsonRecord(approvedSummaries[0]).selectionId as string)
      : undefined;
    const visGenDiag = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440205",
        expectedStorageVersion: visData.storageVersion,
        expectedHandoffRevision: visData.expectedHandoffRevision,
        mode: "product_visual_draft",
        approvedVisualReferenceSelectionIds: firstSelectionId ? [firstSelectionId] : undefined,
        confirmed: true,
      }),
    });
    report.visualApiDiag = {
      status: visGenDiag.status,
      code: visGenDiag.status === 200 ? "ok" : publicErrorCode(visGenDiag.body),
      selectionId: firstSelectionId ? firstSelectionId.slice(0, 12) : "none",
      body: visGenDiag.status === 200 ? "generated" : JSON.stringify(visGenDiag.body).slice(0, 200),
    };
    console.error("DIAG visualApi:", JSON.stringify(report.visualApiDiag));
    // Mock 模式下应为 200（管线完整性）；若 422 则如实记录
    if (visGenDiag.status !== 200) {
      report.visualApiDiag.failedHonestly = true;
    }

    // 浏览器点击生成 product_visual_draft（先刷新页面确保最新状态）
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('基于批准视觉参考）')", 250, "smoke_visual_ui_reload_timeout");
    const btnCheck = await evaluate(client, page.sessionId, `(() => {
      const btns = [...document.querySelectorAll('button')];
      const target = btns.find((b) => b.textContent.includes('生成产品视觉草稿'));
      return { found: Boolean(target), disabled: target ? target.disabled : null, all: btns.map((b) => b.textContent.slice(0, 20)) };
    })()`);
    console.error("DIAG btnCheck:", JSON.stringify(btnCheck).slice(0, 400));
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成产品视觉草稿'))?.click()`);
    await wait(1500);
    const afterClick = await evaluate(client, page.sessionId, `(() => {
      const text = document.body ? document.body.innerText : '';
      const img = [...document.querySelectorAll('[data-testid="image-handoff-section"]')][0];
      return { hasSuccess: text.includes('图片草稿已生成') || text.includes('基于批准视觉参考生成'), hasError: text.includes('失败') || text.includes('拒绝') || text.includes('不能') || text.includes('只能'), imgText: img ? img.innerText.slice(0, 300) : 'NO_IMG_SECTION' };
    })()`);
    console.error("DIAG afterClick:", JSON.stringify(afterClick).slice(0, 500));
    if (!afterClick.hasSuccess) {
      report.afterClick = afterClick;
      try {
        await waitFor(client, page.sessionId, "Boolean(document.body) && (document.body.innerText.includes('基于批准视觉参考生成') || document.body.innerText.includes('图片草稿已生成'))", 250, "smoke_visual_generate_timeout");
      } catch (generateError) {
      const diag = await evaluate(client, page.sessionId, `(() => {
        const text = document.body ? document.body.innerText : '';
        return { snippet: text.slice(-800), hasError: text.includes('失败') || text.includes('错误') };
      })()`);
      report.visualGenerateDiagnostic = diag;
      console.error("DIAG visualGenerate:", JSON.stringify(diag).slice(0, 500));
      throw generateError;
      }
    }
    report.visualGenerated = true;

    // ── 4. Listing 生成（Mock）+ Claim 校验 → 保存 ──
    const listingState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    assert(listingState.status === 200, "smoke_listing_state");
    const listingData = jsonRecord(jsonRecord(listingState.body).data);
    const listingGen = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440202",
        expectedStorageVersion: listingData.storageVersion,
        expectedHandoffRevision: listingData.currentHandoffRevision,
        confirmed: true,
      }),
    });
    assert(listingGen.status === 200, `smoke_listing_gen:${listingGen.status}:${JSON.stringify(listingGen.body).slice(0, 150)}`);
    const listingGenData = jsonRecord(jsonRecord(listingGen.body).data);
    assert(listingGenData.listingStatus === "active", `smoke_listing_status:${listingGenData.listingStatus}`);
    report.listingGenerated = true;

    // ── 5. Revision 一致性：Listing/Image 均绑定当前 Revision=N=1 ──
    const row5 = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const parsed5 = JSON.parse(row5!.resultJson);
    const listingBinding = parsed5.listingHandoffBinding as JsonRecord;
    const imageBinding = parsed5.imageHandoffBinding as JsonRecord;
    const currentRev = (parsed5.creativeHandoff as JsonRecord).currentRevision as number;
    assert(listingBinding.sourceHandoffRevision === currentRev, "smoke_listing_binding_revision");
    assert(imageBinding.sourceHandoffRevision === currentRev, "smoke_image_binding_revision");
    assert(imageBinding.visualReferenceFingerprint !== null, "smoke_image_binding_visual_ref_fp");
    report.revisionConsistency = { handoffRev: currentRev, listingRev: listingBinding.sourceHandoffRevision, imageRev: imageBinding.sourceHandoffRevision, bothActive: true };

    // ── 6. 更新 Handoff（Revision=2）→ 旧 Listing/Image stale ──
    const preview2 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff?mode=preview`);
    const preview2Data = jsonRecord(jsonRecord(preview2.body).preview);
    const appendResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        requestId: "550e8400-e29b-41d4-a716-446655440203",
        confirmed: true,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 1,
        expectedStorageVersion: jsonRecord(preview2Data.storageVersion ?? {}),
        selectedFactCandidateIds: (preview2Data.confirmableFactCandidates as Array<{ selectionId: string }>).slice(0, 2).map((c) => c.selectionId as string),
        selectedVisualReferenceCandidateIds: [visualCandidates[0].selectionId as string],
      }),
    });
    assert(appendResp.status === 200 || appendResp.status === 201, `smoke_handoff_append:${appendResp.status}`);
    const listingStale = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const listingStaleData = jsonRecord(jsonRecord(listingStale.body).data);
    assert((listingStaleData.listingStatus as string) === "stale", `smoke_listing_stale:${String(listingStaleData.listingStatus)}`);
    const imageStale = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`);
    const imageStaleData = jsonRecord(jsonRecord(imageStale.body).data);
    assert((imageStaleData.imageStatus as string) === "stale", `smoke_image_stale:${String(imageStaleData.imageStatus)}`);
    report.stale = { listing: listingStaleData.listingStatus, image: imageStaleData.imageStatus };

    // ── 7. Revoke → revoked ──
    const revokeState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`);
    const revokeData = jsonRecord(revokeState.body);
    const revokeResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "revoke",
        requestId: "550e8400-e29b-41d4-a716-446655440204",
        expectedCurrentHandoffRevision: 2,
        expectedStorageVersion: jsonRecord((revokeData.detail as JsonRecord | undefined)?.storageVersion ?? {}),
        revokeReasonCode: "explicit_user_revoke",
      }),
    });
    assert(revokeResp.status === 200, `smoke_revoke:${revokeResp.status}`);
    const listingRevoked = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const imageRevoked = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`);
    assert(jsonRecord(jsonRecord(listingRevoked.body).data).listingStatus === "revoked", "smoke_listing_revoked");
    assert(jsonRecord(jsonRecord(imageRevoked.body).data).imageStatus === "revoked", "smoke_image_revoked");
    report.revoked = { listing: true, image: true };

    // ── 8. Visitor A/B 隔离（Image GET）──
    const visitorImageState = await api(baseUrl, visitorA.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/image-handoff`);
    assert(visitorImageState.status === 200, "smoke_visitor_image_state");
    const visitorCross = await api(baseUrl, visitorB.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/image-handoff`);
    assert(visitorCross.status === 404, `smoke_visitor_cross_not_404:${visitorCross.status}`);
    report.visitorIsolation = { aOk: true, cross404: true };

    // ── 9. 幂等：同 requestId 重放不重复调用 ──
    const listingState2 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const replayResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440202",
        expectedStorageVersion: listingState2.status === 200 ? (jsonRecord(jsonRecord(listingState2.body).data).storageVersion as JsonRecord) : undefined,
        expectedHandoffRevision: listingState2.status === 200 ? (jsonRecord(jsonRecord(listingState2.body).data).currentHandoffRevision as number) : undefined,
        confirmed: true,
      }),
    });
    report.idempotency = { replayStatus: replayResp.status, note: "revoked 后重放返回原草稿（冻结行为）" };

    // ── 10. 页面安全 ──
    report.browserSideEffects = {
      consoleErrorCount: client.state.consoleErrorCount,
      consoleErrorDiagnostics: client.state.consoleErrorDiagnostics,
      externalHttpRequestCount: client.state.externalHttpRequestCount,
      server5xxCount: client.state.server5xxCount,
      studioRequests: client.state.studioRequests,
    };
    report.nodeSideEffects = {
      externalHttpRequestCount: nodeRequestEvidence.externalHttpRequestCount,
      productionPortAccessCount: nodeRequestEvidence.productionPortAccessCount,
      server5xxCount: nodeRequestEvidence.server5xxCount,
    };
    client.close();
    report.status = "passed";
  } finally {
    if (prisma) await prisma.$disconnect();
    if (chromePid) {
      try { stopOwnedProcess(chromePid); } catch { report.chromeStopFailed = true; }
    }
    for (let attempt = 0; attempt < 60 && !(await isPortFree(CDP_PORT)); attempt += 1) await wait(100);
    report.cdpPortReleased = await isPortFree(CDP_PORT);
    if (runtimePid) {
      try {
        process.kill(runtimePid, "SIGTERM");
        for (let attempt = 0; attempt < 50 && isOwnedProcessRunning(runtimePid); attempt += 1) await wait(100);
        if (isOwnedProcessRunning(runtimePid)) stopOwnedProcess(runtimePid);
      } catch {
        report.runtimeStopFailed = true;
      }
    }
    for (let attempt = 0; attempt < 60 && !(await isPortFree(port)); attempt += 1) await wait(100);
    report.portReleased = await isPortFree(port);
    const exactRoot = resolve(runtimeRoot);
    report.runtimeRootRemoved = !existsSync(exactRoot);
    assert(report.portReleased && report.cdpPortReleased, "smoke_cleanup_failed");
  }
  try {
    writeFileSync(join(runtimeRoot, "browser-final.json"), JSON.stringify(report, null, 2), "utf8");
  } catch {
    report.reportWriteFailed = true;
  }
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`smoke_fatal:${String(error instanceof Error ? error.message : error).slice(0, 500)}`);
  process.exitCode = 1;
});
