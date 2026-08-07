#!/usr/bin/env node

// 真实图片合同修复验收：历史 promptHash="real" item 读取全链（隔离环境）
// seed 用真实 1,742,759-byte PNG + 真实 Provider 占位符 item（promptHash/requestKeyHash="real"）
// 验证修复后：/image-draft API 200 → image/png → 字节一致 → 同屏 → F5 → 大图 → 下载同字节
// → Owner/Visitor 隔离 → 无泄漏 → 无 500/请求循环

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID as randomUUIDv4 } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, rmSync, statSync, writeFileSync,
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
const PORTS = [3170, 3171] as const;
const CDP_PORT = 24870;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// 任务指定的现有历史真实 PNG（1,742,759 字节，生产台灯任务资产）——复用，不重新生成
const REAL_PNG_SOURCE = "D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/data/ai-image-drafts/owner/cmsiopk1v000btfoc9y6zu1s5/7b7dc697-f74e-4420-94ec-342d74d8ffba.png";

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
    productName: "Contract Fix 验收商品",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Contract fix acceptance.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Contract Fix 验收商品",
        finalReport: { finalVerdict: "Synthetic only.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Synthetic supplier." },
        risk: { overallLevel: "low", summary: "Synthetic risk summary.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Synthetic.", sellingPoints: ["Adjustable"], concerns: [], confidence: "medium" },
        listing: { title: "Contract Fix product", bullets: ["Confirmed bullet."], keywords: ["synthetic"], imageIdeas: ["户外场景构图"], missingInputs: [] },
      },
    }),
    listingPrepSnapshot: {
      keywordPool: { coreWords: ["synthetic"], longTailWords: [], sceneWords: [], crowdWords: [], attributeWords: [], riskWordReminder: "" },
      titleStructure: { formula: "brand + product", recommendedTitle: "Contract Fix Product", breakdown: [] },
      bulletDrafts: ["Confirmed bullet."],
      searchTerms: { draft: "synthetic", reminders: [] },
      imageMaterialNeeds: ["主图", "场景图", "尺寸图", "细节图", "包装图", "证书 / 资质 / 警示图"],
      manualSupplementChecklist: [],
      complianceExpressionReminders: [],
    },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Contract Fix 验收商品",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0CTRFIX01",
      productUrl: "https://example.com/contractfix",
      title: "Contract Fix Product",
      brand: "SyntheticBrand",
      category: "Home",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 100,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "contractfix",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-07T01:00:00.000Z",
      contextHash,
    },
  };
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-access-token": token, "x-access-password": token };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = jsonRecord(await response.json());
  assert(response.status === 200 && typeof body.accessToken === "string", `smoke_login_failed:${response.status}`);
  return { mode: body.mode as string, token: body.accessToken as string };
}

function cdpClient(webSocketUrl: string) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const state = {
    consoleErrorCount: 0, consoleErrorDiagnostics: [] as string[],
    externalHttpRequestCount: 0, server5xxCount: 0, imageDraftRequests: 0,
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
        if (u.pathname.includes("image-draft")) state.imageDraftRequests += 1;
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
  assert(await isPortFree(CDP_PORT), "smoke_cdp_port_in_use");
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
      if (typeof v.webSocketDebuggerUrl === "string") {
        return { pid: child.pid!, ws: v.webSocketDebuggerUrl as string };
      }
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

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `contract-fix-${timestamp}`);
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "contract.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const imageRoot = join(runtimeRoot, "image-assets");
  const downloadRoot = join(runtimeRoot, "downloads");
  const ownerPassword = randomBytes(24).toString("base64url");
  const visitorAPassword = randomBytes(24).toString("base64url");
  const visitorBPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const visitorAId = `demo_${randomBytes(8).toString("hex")}`;
  const visitorBId = `demo_${randomBytes(8).toString("hex")}`;
  const ownerTaskId = "contract-fix-owner-task";
  const ownerCandidateId = "contract-fix-owner-candidate";
  const visitorTaskId = "sandbox_task_contractfix_visitor_a";
  const visitorCandidateId = "sandbox_candidate_contractfix_visitor_a";
  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord = { status: "failed", port };

  try {
    mkdirSync(runtimeRoot);
    mkdirSync(downloadRoot);
    // 真实 PNG 前置校验
    assert(existsSync(REAL_PNG_SOURCE), "smoke_real_png_missing");
    const realPngBytes = readFileSync(REAL_PNG_SOURCE);
    assert(realPngBytes.length > 0, "smoke_real_png_empty");
    assert(realPngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "smoke_real_png_magic");
    const pngWidth = realPngBytes.readUInt32BE(16);
    const pngHeight = realPngBytes.readUInt32BE(20);
    report.realPng = { bytes: realPngBytes.length, width: pngWidth, height: pngHeight, sha256Prefix: createHash("sha256").update(realPngBytes).digest("hex").slice(0, 12) };

    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./contract.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
      { id: visitorBId, password: visitorBPassword, label: "Synthetic Visitor B" },
    ]);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-contract-fix", actor: { mode: "owner", actorRef: "owner:v1" } });
    const visitorResult = buildProtectedResult({ candidateId: visitorCandidateId, runId: "wf-contract-fix-v", actor: makeVisitorActor(visitorAId) });
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

    // 真实图片落盘（隔离 storage）
    mkdirSync(imageRoot, { recursive: true });
    const storedId = randomUUIDv4();
    const storageKey = `owner/${ownerTaskId}/${storedId}.png`;
    const pngDir = join(imageRoot, "owner", ownerTaskId);
    mkdirSync(pngDir, { recursive: true });
    writeFileSync(join(imageRoot, storageKey), realPngBytes, { flag: "wx" });
    const storedFileSize = statSync(resolve(imageRoot, storageKey)).size;
    assert(storedFileSize === realPngBytes.length, "smoke_real_image_file_size_mismatch");

    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.create({
        data: {
          id: ownerTaskId, createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
          type: "workflow", decisionStatus: "continue",
          title: "Contract Fix owner", platform: "local-test",
          productUrl: null, materialText: "Synthetic", source: "isolated-contract-fix",
          score: 0, level: "low", oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId, name: "Contract Fix owner candidate", rawInput: "Synthetic",
          source: "SellerSprite", status: "pending", sourceMetaJson: "{}", analysisJson: "{}",
          convertedTaskId: ownerTaskId, lastActionAt: new Date(createdAt),
        },
      });
    });

    // 注入历史真实 Provider 合同数据：handoff + imageHandoffBinding + aiImageDraftSnapshot
    // item 的 promptHash/requestKeyHash = "real"（历史真实 Provider 占位符）
    const handoffSeed = {
      schema: "product-creative-handoff.v1",
      handoffId: "33333333-3333-4333-8333-333333333333",
      taskId: ownerTaskId,
      candidateId: ownerCandidateId,
      currentRevision: 1,
      controlState: "active",
      createdAt,
      createdBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
      researchMode: "market_research_only",
      promotionEligible: false,
      versions: [{
        revision: 1, createdAt,
        createdBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" },
        sourceResearch: { recordSchema: "product-research-record.v1", candidateId: ownerCandidateId, researchRevision: 1, researchHash: "a".repeat(64), workflowStatus: "completed", decisionStatus: "creative_ready", candidateSourceFingerprint: "b".repeat(64) },
        productIdentity: { displayName: "Contract Fix", identityConfirmedAt: createdAt },
        confirmedFacts: [{ factId: "00000000-0000-4000-8000-000000000001", field: "brand", label: "品牌", value: "SyntheticBrand", evidenceTier: "human_confirmed", usageScopes: ["listing", "internal"], sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" }, confirmedAt: createdAt, confirmationReference: "confirm:fix" }, confirmedAt: createdAt, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } }],
        stableSourceFacts: [], aiCreativeReferences: [], issues: [],
        prohibitedClaims: [{ claimId: "00000000-0000-4000-8000-000000000005", category: "absolute_claim", summary: "不得使用绝对化表述", appliesTo: ["both"], source: "system_rule" }],
        creativePreferences: { evidenceTier: "creative_preference", tone: "professional" },
        visualReferences: [],
        humanReviewRequired: true,
        confirmation: { confirmed: true, confirmedAt: createdAt, confirmedBy: { mode: "owner", subjectFingerprint: "a1b2c3d4e5f6a7b8" } },
        handoffFingerprint: "c".repeat(64),
      }],
    };
    const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    const imageBinding = {
      schema: "image-handoff-binding.v1",
      sourceHandoffId: handoffSeed.handoffId,
      sourceHandoffRevision: 1,
      sourceHandoffFingerprintHash: sha256Hex("c".repeat(64)),
      sourceResearchRevision: 1,
      generationInputFingerprint: "d".repeat(64),
      visualReferenceFingerprint: null,
      mode: "composition_concept" as const,
      generatedAt: "2026-08-07T03:00:00.000Z",
      model: "openai-compatible-relay",
      generationSource: "creative_handoff" as const,
      humanReviewRequired: true as const,
      requestIdHash: sha256Hex("seed-real-image-0001"),
    };
    const imageSnapshot = {
      version: 1,
      snapshotType: "ai_image_draft",
      provider: "openai_compatible_relay",
      accessMode: "owner" as const,
      humanReviewRequired: true,
      disclaimer: "AI 生成图片仅供 Listing 素材方向参考，不代表真实商品实拍，不可直接作为商品事实、认证或平台上架依据。",
      updatedAt: "2026-08-07T03:00:00.000Z",
      items: [{
        id: storedId,
        imageType: "lifestyle_scene",
        model: "openai-compatible-relay",
        createdAt: "2026-08-07T03:00:00.000Z",
        storageKey,
        mimeType: "image/png",
        width: pngWidth,
        height: pngHeight,
        fileSizeBytes: realPngBytes.length,
        sha256: createHash("sha256").update(realPngBytes).digest("hex"),
        reviewStatus: "needs_human_review",
        accessMode: "owner" as const,
        source: "real_ai_image_draft",
        safetyWarnings: ["Composition concept only; does not represent real product appearance."],
        promptSummary: "Composition concept (real asset).",
        // 历史真实 Provider 占位符（修复对象）
        promptHash: "real",
        requestKeyHash: "real",
        generationBasis: { productName: "Contract Fix", sellingPoints: [], riskWarnings: [], missingFacts: [], imageMaterialNeeds: [] },
        handoffMode: "composition_concept" as const,
        compositionSummary: "Composition concept (real asset reuse).",
      }],
    };
    const seededResult = { ...ownerResult, creativeHandoff: handoffSeed, imageHandoffBinding: imageBinding, aiImageDraftSnapshot: imageSnapshot };
    await prisma.viralAnalysisRecord.update({
      where: { id: ownerTaskId },
      data: { resultJson: JSON.stringify(seededResult) },
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
      AI_IMAGE_DRAFT_STORAGE_ROOT: imageRoot,
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
    const visitorA = await login(baseUrl, visitorAPassword);
    const visitorB = await login(baseUrl, visitorBPassword);

    // ── 1. 受保护 image-draft API：修复后应 200 ──
    const imgApi = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(ownerTaskId)}/image-draft/${encodeURIComponent(storedId)}`, {
      headers: { "x-access-token": owner.token, "x-access-password": owner.token },
      cache: "no-store",
    });
    assert(imgApi.status === 200, `smoke_image_api_status:${imgApi.status}`);
    const imgContentType = imgApi.headers.get("content-type") ?? "";
    assert(imgContentType === "image/png", `smoke_image_api_content_type:${imgContentType}`);
    const imgBlob = await imgApi.arrayBuffer();
    assert(imgBlob.byteLength === realPngBytes.length, `smoke_image_api_size:${imgBlob.byteLength} != ${realPngBytes.length}`);
    const imgHash = createHash("sha256").update(Buffer.from(imgBlob)).digest("hex");
    assert(imgHash === createHash("sha256").update(realPngBytes).digest("hex"), "smoke_image_api_sha256_match");
    report.imageApi = { status: 200, contentType: imgContentType, bytes: imgBlob.byteLength, sha256Match: true };

    // ── 2. 身份隔离：Visitor B 读 Owner 图片 → 404；Visitor A 读自己任务 → 404 ──
    const ownerForVisitorB = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(ownerTaskId)}/image-draft/${encodeURIComponent(storedId)}`, {
      headers: { "x-access-token": visitorB.token, "x-access-password": visitorBPassword },
      cache: "no-store",
    });
    assert(ownerForVisitorB.status === 404, `smoke_image_cross_owner_not_404:${ownerForVisitorB.status}`);
    const visitorOwn = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(visitorTaskId)}/image-draft/some-id`, {
      headers: { "x-access-token": visitorA.token, "x-access-password": visitorAPassword },
      cache: "no-store",
    });
    assert(visitorOwn.status === 404, `smoke_image_visitor_own_404:${visitorOwn.status}`);
    report.imageIsolation = { ownerForVisitorB: 404, visitorOwn: 404 };

    // ── 3. Chrome：页面同屏预览 → F5 → 大图 → 下载同字节 ──
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
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('商品研究进度')", 250, "detail_ready_timeout");
    // 有图片 → 产品图片为当前步骤（默认展开）
    await waitFor(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return Boolean(img) && img.complete && img.naturalWidth > 0;
    })()`, 250, "image_render_timeout");
    const imageUi = await evaluate(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      const text = document.body.innerText;
      return {
        isBlob: img.src.startsWith('blob:'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        hasReadError: text.includes('图片读取失败'),
        hasBigView: text.includes('查看大图'), hasDownload: text.includes('下载'), hasRegenerate: text.includes('重新生成'),
      };
    })()`);
    report.imageUi = imageUi;
    assert(imageUi.isBlob && imageUi.naturalWidth === pngWidth && !imageUi.hasReadError, `smoke_image_ui:${JSON.stringify(imageUi)}`);

    // F5 → 仍显示
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('商品研究进度')", 250, "f5_ready_timeout");
    await waitFor(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return Boolean(img) && img.complete && img.naturalWidth > 0;
    })()`, 250, "f5_image_timeout");
    const f5 = await evaluate(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return { isBlob: img.src.startsWith('blob:'), w: img.naturalWidth, readError: document.body.innerText.includes('图片读取失败') };
    })()`);
    report.f5 = f5;
    assert(f5.isBlob && f5.w === pngWidth && !f5.readError, `smoke_f5:${JSON.stringify(f5)}`);

    // 大图
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('查看大图'))?.click()`);
    await wait(600);
    const bigView = await evaluate(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return { alive: Boolean(img) && img.complete && img.naturalWidth > 0, hasError: document.body.innerText.includes('加载失败') };
    })()`);
    report.bigView = bigView;
    assert(bigView.alive && !bigView.hasError, "smoke_big_view");

    // 下载同字节
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadRoot, eventsEnabled: true }, page.sessionId);
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '下载')?.click()`);
    let dlFile: string | null = null;
    for (let i = 0; i < 60; i += 1) {
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(downloadRoot).filter((f) => !f.endsWith(".crdownload"));
      if (files.length > 0) { dlFile = files[0]; break; }
      await wait(100);
    }
    assert(dlFile !== null, "smoke_download_missing");
    const dlBytes = (await import("node:fs")).statSync(join(downloadRoot, dlFile)).size;
    report.download = { file: dlFile, bytes: dlBytes };
    assert(dlBytes === realPngBytes.length, `smoke_download_size:${dlBytes} != ${realPngBytes.length}`);

    // 页面无泄漏 + 无 500 + 无 console error + 无请求循环
    const pageHtml = await evaluate(client, page.sessionId, "document.documentElement.outerHTML");
    const noLeaks = !pageHtml.includes("data:image") && !pageHtml.includes("storageKey") && !pageHtml.includes("image-assets") && !pageHtml.includes("promptHash");
    report.noLeakInHtml = noLeaks;
    assert(noLeaks, "smoke_html_leak");
    report.sideEffects = {
      consoleErrorCount: client.state.consoleErrorCount,
      consoleErrorDiagnostics: client.state.consoleErrorDiagnostics.slice(0, 3),
      server5xxCount: client.state.server5xxCount,
      externalHttpRequestCount: client.state.externalHttpRequestCount,
      imageDraftRequests: client.state.imageDraftRequests,
    };
    assert(client.state.server5xxCount === 0, "smoke_server_5xx");
    assert(client.state.consoleErrorCount === 0, `smoke_console_errors:${JSON.stringify(client.state.consoleErrorDiagnostics.slice(0, 3))}`);
    assert(client.state.imageDraftRequests <= 6, "smoke_request_storm");
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
    writeFileSync(join(runtimeRoot, "contract-fix-final.json"), JSON.stringify(report, null, 2), "utf8");
  } catch { report.reportWriteFailed = true; }
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`smoke_fatal:${String(error instanceof Error ? error.message : error).slice(0, 500)}`);
  process.exitCode = 1;
});
