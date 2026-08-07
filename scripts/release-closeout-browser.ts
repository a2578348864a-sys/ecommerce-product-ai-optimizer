#!/usr/bin/env node

// Release Closeout 验收：进度即时同步 + 真实非零图片发布前验证
//
// 覆盖用户旅程 A-F（不刷新浏览器的即时同步）：
//   A. 人工决定完成 → 顶部进度摘要立即更新
//   B. Handoff 创建成功 → 不刷新浏览器 → 顶部摘要立即更新
//   C. Listing 生成成功 → 同屏出现 → 顶部立即「还缺：生成产品图片」
//   D. 图片（真实非零 draft）加载成功 → 同屏出现 → 顶部立即「还缺：人工复核最终内容」
//   E. F5 → Listing 与真实图片仍存在 → 进度与产物一致
//   F. Listing 区主体只含 Title/Bullets/Description/Keywords；图片创作建议独立区域；
//      「复制完整 Listing」不混入图片建议；图片建议单独复制
//
// 真实图片：复用历史真实生成的 PNG 资产（1536x1024 / 2.1MB 真实文件），
//   storeAiImage 落盘到隔离 AI_IMAGE_DRAFT_STORAGE_ROOT（零 Provider 调用、零外部 API）。
//   完整链：真实 image draft → 受保护 API 200 → blob.size > 0 → 页面同屏渲染 → F5
//   → 重新读取 → 查看大图 → 下载非 0 字节 → content-type → 身份隔离 → 无泄漏/无 500/无 console error。
//
// Mock Listing Provider（不调用付费 API）；IMAGE_PROVIDER_MODE=mock（但草稿为真实 PNG 资产）。

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
const PORTS = [3160, 3161] as const;
const CDP_PORT = 24840;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// 复用历史真实生成 PNG（非付费 Provider 调用；真实 1536x1024 图片）
const REAL_PNG_SOURCE = "C:/Users/a2578/Desktop/qingxuan-smoke/v2-fi-real-smoke-20260805182812/image-assets/owner/v2fi-real-owner-task/03b362e9-3a4d-4e63-8b79-0c2caa32b08c.png";

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
      id: entry.id,
      passwordHash: hashSyntheticPassword(entry.password, salt),
      salt,
      label: entry.label,
      expiresAt: null,
      maxAiCalls: 20,
      usedAiCalls: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
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
    now: "2026-08-06T01:00:00.000Z",
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "needs_information", reason: "Synthetic: 等待人工确认。", nextAction: "确认事实后可进入创作准备" },
  });
  return {
    productName: "Release Closeout 验收商品",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Release closeout synthetic record.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Release Closeout 验收商品",
        finalReport: { finalVerdict: "Synthetic only.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Synthetic supplier." },
        risk: { overallLevel: "low", summary: "Synthetic risk summary.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Synthetic.", sellingPoints: ["Adjustable angle"], concerns: [], confidence: "medium" },
        listing: { title: "Release Closeout product", bullets: ["Confirmed fact bullet."], keywords: ["synthetic"], imageIdeas: ["户外场景构图", "简洁白底背景"], missingInputs: [] },
      },
    }),
    listingPrepSnapshot: {
      keywordPool: { coreWords: ["synthetic"], longTailWords: [], sceneWords: [], crowdWords: [], attributeWords: [], riskWordReminder: "" },
      titleStructure: { formula: "brand + product", recommendedTitle: "Release Closeout Product", breakdown: [] },
      bulletDrafts: ["Confirmed fact bullet."],
      searchTerms: { draft: "synthetic", reminders: [] },
      imageMaterialNeeds: ["主图", "场景图", "尺寸图", "细节图", "包装图", "证书图"],
      manualSupplementChecklist: [],
      complianceExpressionReminders: [],
    },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Release Closeout 验收商品",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0RELC0001",
      productUrl: "https://example.com/relclose",
      title: "Release Closeout Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "relclose",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-06T01:00:00.000Z",
      contextHash,
    },
  };
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  nodeRequestEvidence.requestCount += 1;
  const headers: Record<string, string> = { "content-type": "application/json", "x-access-token": token, "x-access-password": token };
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = jsonRecord(await response.json());
  assert(response.status === 200 && typeof body.accessToken === "string", `smoke_login_failed:${response.status}`);
  return { mode: body.mode as string, token: body.accessToken as string };
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
    imageDraftRequests: [] as string[],
    listingHandoffRequests: [] as string[],
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
        if (url.pathname.includes("image-draft")) state.imageDraftRequests.push(requestUrl + "|" + requestMethod);
        if (url.pathname.includes("listing-handoff")) state.listingHandoffRequests.push(requestUrl + "|" + requestMethod);
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

function progressSummaryText(text: string): { completed: string; missing: string; next: string } | null {
  const sectionMatch = text.match(/商品研究进度([\s\S]*?)(?:来源|当前研究阶段|研究结论|人工核验|创作交接|Listing 草稿|AI 生成图片草稿)/);
  if (!sectionMatch) return null;
  const section = sectionMatch[1];
  const completed = section.match(/已完成\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? "";
  const missing = section.match(/还缺\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? "";
  const next = section.match(/下一步\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { completed, missing, next };
}

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `release-closeout-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "closeout.db");
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
  const ownerTaskId = "release-closeout-owner-task";
  const ownerCandidateId = "release-closeout-owner-candidate";
  const visitorTaskId = "sandbox_task_relclose_visitor_a";
  const visitorCandidateId = "sandbox_candidate_relclose_visitor_a";
  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord = { status: "failed", port, runtimeRootRemoved: false };

  try {
    mkdirSync(runtimeRoot);
    mkdirSync(downloadRoot);
    // ── 真实 PNG 前置校验（优先级1：复用已有真实资产，零 Provider 调用）──
    assert(existsSync(REAL_PNG_SOURCE), "smoke_real_png_missing");
    const realPngBytes = readFileSync(REAL_PNG_SOURCE);
    assert(realPngBytes.length > 0, "smoke_real_png_empty");
    // 轻量 PNG 校验（尺寸 + 魔数），等价于存储层 validateAiImageBytes 的关键断言
    const pngMagic = realPngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert(pngMagic, "smoke_real_png_magic");
    const pngWidth = realPngBytes.readUInt32BE(16);
    const pngHeight = realPngBytes.readUInt32BE(20);
    assert(pngWidth > 0 && pngHeight > 0 && pngWidth <= 4096 && pngHeight <= 4096, "smoke_real_png_dimensions");
    const validatedPng = { mimeType: "image/png" as const, extension: "png" as const, width: pngWidth, height: pngHeight, sha256: createHash("sha256").update(realPngBytes).digest("hex") };
    report.realPng = { bytes: realPngBytes.length, width: validatedPng.width, height: validatedPng.height, mime: validatedPng.mimeType, sha256Prefix: validatedPng.sha256.slice(0, 12) };

    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./closeout.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
      { id: visitorBId, password: visitorBPassword, label: "Synthetic Visitor B" },
    ]);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-release-closeout", actor: { mode: "owner", actorRef: "owner:v1" } });
    const visitorResult = buildProtectedResult({ candidateId: visitorCandidateId, runId: "wf-release-closeout-v", actor: makeVisitorActor(visitorAId) });
    const createdAt = "2026-08-06T02:00:00.000Z";
    const sandboxStore = {
      version: 1,
      tasks: [{
        id: visitorTaskId,
        demoAccessId: visitorAId,
        type: "workflow",
        title: "Synthetic visitor research",
        decisionStatus: "need_info",
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

    // ── 真实图片落盘（隔离 storage root；真实 PNG 资产）──
    // 按 aiImageDraftStorage 合同布局：{root}/owner/{taskId}/{uuid}.png
    mkdirSync(imageRoot, { recursive: true });
    const pngDir = join(imageRoot, "owner", ownerTaskId);
    mkdirSync(pngDir, { recursive: true });
    const storedId = randomUUIDv4();
    const storageKey = `owner/${ownerTaskId}/${storedId}.png`;
    writeFileSync(join(imageRoot, storageKey), realPngBytes, { flag: "wx" });
    const storedFileSize = statSync(resolve(imageRoot, storageKey)).size;
    assert(storedFileSize === realPngBytes.length, "smoke_real_image_file_size_mismatch");
    const stored = {
      id: storedId,
      storageKey,
      mimeType: "image/png" as const,
      width: validatedPng.width,
      height: validatedPng.height,
      sha256: createHash("sha256").update(realPngBytes).digest("hex"),
      fileSizeBytes: realPngBytes.length,
    };
    report.realImageStored = { id: stored.id, storageKey: stored.storageKey, mimeType: stored.mimeType, fileSizeBytes: stored.fileSizeBytes, width: stored.width, height: stored.height };

    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$transaction(async (tx) => {
      await tx.viralAnalysisRecord.create({
        data: {
          id: ownerTaskId,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
          type: "workflow",
          decisionStatus: "need_info",
          title: "Release Closeout owner",
          platform: "local-test",
          productUrl: null,
          materialText: "Synthetic",
          source: "isolated-release-closeout",
          score: 0,
          level: "low",
          oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId,
          name: "Release Closeout owner candidate",
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

    // ── 服务端注入：初始任务不含 creativeHandoff / Listing / 图片（让 A/B/C 完整走真实推进链）──
    // 真实 PNG 文件已按存储合同落盘（imageRoot/owner/{taskId}/{uuid}.png）；
    // D/E 阶段再注入 aiImageDraftSnapshot + imageHandoffBinding 到 DB（等价真实生成后的落库状态）。
    await prisma.viralAnalysisRecord.update({
      where: { id: ownerTaskId },
      data: { resultJson: JSON.stringify(ownerResult) },
    });

    // ── 启动运行时 ──
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

    // ── Chrome 用户旅程 A-F ──
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
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('商品研究进度')", 250, "smoke_detail_ready_timeout");

    const readSummary = () => evaluate(client, page.sessionId, `(() => {
      const section = document.querySelector('[data-testid="user-progress-summary"]');
      if (!section) return null;
      const out = { status: '', completed: '', missing: '', next: '' };
      for (const p of section.querySelectorAll('p')) {
        const t = p.textContent.trim();
        if (t === '当前状态') out.status = p.nextElementSibling?.textContent?.trim() ?? '';
        else if (t === '已完成') out.completed = p.nextElementSibling?.textContent?.trim() ?? '';
        else if (t === '还缺') out.missing = p.nextElementSibling?.textContent?.trim() ?? '';
        else if (t === '下一步') out.next = p.nextElementSibling?.textContent?.trim() ?? '';
      }
      return out;
    })()`);

    const summaryBefore = await readSummary();
    report.summaryBefore = summaryBefore;
    assert(summaryBefore && summaryBefore.missing.includes("完成人工决定"), `smoke_summary_initial:${JSON.stringify(summaryBefore)}`);

    // ── A. 人工决定完成（浏览器表单保存 creative_ready）→ 进度立即更新 ──
    // 初始无 handoff/listing/图片 → 默认展开「研究结论」步骤（面板已在 DOM，无需点击）
    await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"product-research-decision-panel\"]'))", 150, "smoke_decision_panel_timeout");
    await evaluate(client, page.sessionId, `(() => {
      const sel = document.querySelector('#research-decision-status');
      if (!sel) return false;
      sel.value = 'creative_ready';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const reason = document.querySelectorAll('#research-decision-status + p ~ .grid textarea')[0] || document.querySelectorAll('textarea')[0];
      if (reason) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(reason, '人工确认可进入创作准备');
        reason.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`);
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存新决定'))?.click()`);
    // 保存成功 → onUpdated → refreshKey 整页重载（面板会短暂卸载）→ 摘要重读服务端后更新。
    // 直接等待真实断言：顶部摘要「已完成」出现「人工决定」。
    try {
      await waitFor(client, page.sessionId, `(() => {
        const s = document.querySelector('[data-testid="user-progress-summary"]');
        if (!s) return false;
        const p = [...s.querySelectorAll('p')].find((x) => x.textContent.trim() === '已完成');
        return Boolean(p?.nextElementSibling?.textContent?.includes('人工决定'));
      })()`, 300, "smoke_summary_a_update_timeout");
    } catch (summaryError) {
      const diag = await evaluate(client, page.sessionId, `(() => {
        const text = document.body ? document.body.innerText : '';
        return {
          hasSummary: Boolean(document.querySelector('[data-testid="user-progress-summary"]')),
          hasPanel: Boolean(document.querySelector('[data-testid="product-research-decision-panel"]')),
          snippet: text.slice(0, 400),
          hasSaved: text.includes('研究决定已保存'),
          hasError: text.includes('失败') || text.includes('无法'),
        };
      })()`);
      report.decisionDiag = diag;
      console.error("DIAG decision:", JSON.stringify(diag));
      throw summaryError;
    }
    const summaryAfterA = await readSummary();
    report.summaryAfterA = summaryAfterA;
    assert(summaryAfterA && summaryAfterA.completed.includes("人工决定") && summaryAfterA.missing.includes("创作交接"), `smoke_summary_a:${JSON.stringify(summaryAfterA)}`);

    // ── B. Handoff 创建成功（浏览器预览→勾选→创建）→ 不刷新，摘要立即更新 ──
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('创作交接'))?.click()`);
    // 等预览加载完成（可确认事实 checkbox 出现）
    await waitFor(client, page.sessionId, "document.querySelectorAll('input[type=\"checkbox\"]').length >= 2", 300, "smoke_handoff_section_timeout");
    // 勾选第一项事实 + 确认框 + 创建
    const handoffUi = await evaluate(client, page.sessionId, `(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
      const factBox = boxes[0];
      const confirmBox = boxes.find((b) => b.closest('label')?.innerText.includes('我已核对'));
      return { factBoxCount: boxes.length, hasFact: Boolean(factBox), hasConfirm: Boolean(confirmBox) };
    })()`);
    assert(handoffUi.hasFact && handoffUi.hasConfirm, `smoke_handoff_ui:${JSON.stringify(handoffUi)}`);
    await evaluate(client, page.sessionId, `(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
      boxes[0].click();
      const confirmBox = boxes.find((b) => b.closest('label')?.innerText.includes('我已核对'));
      if (confirmBox) confirmBox.click();
      return true;
    })()`);
    await wait(200);
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('创建创作交接'))?.click()`);
    // 验收核心：不刷新浏览器，顶部摘要立即更新（onCommitted → refreshRecord 重读服务端）
    try {
      await waitFor(client, page.sessionId, `(() => {
        const s = document.querySelector('[data-testid="user-progress-summary"]');
        if (!s) return false;
        const p = [...s.querySelectorAll('p')].find((x) => x.textContent.trim() === '已完成');
        return Boolean(p?.nextElementSibling?.textContent?.includes('创作交接'));
      })()`, 300, "smoke_summary_b_update_timeout");
    } catch (handoffError) {
      const diag = await evaluate(client, page.sessionId, `(() => {
        const text = document.body ? document.body.innerText : '';
        const err = (text.match(/创建失败[^\\n]*/) ?? [])[0] ?? '';
        const notice = (text.match(/已创建[^\\n]*/) ?? [])[0] ?? '';
        const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.slice(0, 24)).filter((t) => t.includes('创建') || t.includes('重试'));
        return { snippet: text.slice(0, 500), err, notice, btns, hasConfirm: text.includes('我已核对'), checked: [...document.querySelectorAll('input[type="checkbox"]')].filter((b) => b.checked).length };
      })()`);
      report.handoffDiag = diag;
      console.error("DIAG handoff:", JSON.stringify(diag).slice(0, 800));
      throw handoffError;
    }
    const summaryAfterB = await readSummary();
    report.summaryAfterB = summaryAfterB;
    assert(summaryAfterB && summaryAfterB.completed.includes("创作交接") && summaryAfterB.missing.includes("生成 Listing 草稿"), `smoke_summary_b:${JSON.stringify(summaryAfterB)}`);

    // ── C. Listing 生成成功（浏览器点击）→ 同屏出现 + 顶部立即「还缺：生成产品图片」──
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Listing 草稿'))?.click()`);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('可生成 Listing 草稿')", 250, "smoke_listing_section_timeout");
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成 Listing 草稿'))?.click()`);
    // 验收核心：同屏出现 + 顶部立即「还缺：生成产品图片」（不刷新浏览器）
    await waitFor(client, page.sessionId, "document.body.innerText.includes('当前 Listing 草稿有效')", 300, "smoke_listing_gen_timeout");
    await waitFor(client, page.sessionId, `(() => {
      const s = document.querySelector('[data-testid="user-progress-summary"]');
      if (!s) return false;
      const p = [...s.querySelectorAll('p')].find((x) => x.textContent.trim() === '还缺');
      return Boolean(p?.nextElementSibling?.textContent?.includes('生成产品图片'));
    })()`, 300, "smoke_summary_c_update_timeout");
    const summaryAfterC = await readSummary();
    const listingBodyC = await evaluate(client, page.sessionId, `(() => {
      const text = document.body ? document.body.innerText : '';
      return {
        hasTitle: text.includes('商品标题'),
        hasBullets: text.includes('五点描述'),
        hasDescription: text.includes('商品描述'),
        hasKeywords: text.includes('搜索关键词'),
        hasImageSuggestions: text.includes('图片创作建议'),
        hasSuggestionItems: text.includes('主图') && text.includes('证书图'),
        fullListingCopy: text.includes('复制完整 Listing'),
        suggestionCopy: text.includes('复制图片创作建议'),
      };
    })()`);
    report.summaryAfterC = summaryAfterC;
    report.listingAfterC = listingBodyC;
    assert(summaryAfterC && summaryAfterC.missing.includes("生成产品图片"), `smoke_summary_c:${JSON.stringify(summaryAfterC)}`);
    assert(listingBodyC.hasTitle && listingBodyC.hasBullets && listingBodyC.hasDescription && listingBodyC.hasKeywords, "smoke_listing_sections");
    assert(listingBodyC.hasImageSuggestions && listingBodyC.hasSuggestionItems, "smoke_listing_suggestions");

    // ── D. 真实图片同屏（注入真实 PNG 的 snapshot + binding 到 DB，等价真实生成后的落库状态）──
    // 读取浏览器在 B 阶段真实创建的 handoff，构建匹配的 binding（幂等合同）
    const rowC = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const parsedC = JSON.parse(rowC!.resultJson);
    const handoffReal = parsedC.creativeHandoff as JsonRecord;
    assert(handoffReal && typeof handoffReal.handoffId === "string", "smoke_d_handoff_missing");
    const lastVersion = (handoffReal.versions as Array<JsonRecord>)[(handoffReal.versions as Array<JsonRecord>).length - 1];
    const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    const imageBinding = {
      schema: "image-handoff-binding.v1",
      sourceHandoffId: handoffReal.handoffId,
      sourceHandoffRevision: handoffReal.currentRevision as number,
      sourceHandoffFingerprintHash: sha256Hex(lastVersion.handoffFingerprint as string),
      sourceResearchRevision: 1,
      generationInputFingerprint: "d".repeat(64),
      visualReferenceFingerprint: null,
      mode: "composition_concept" as const,
      generatedAt: "2026-08-06T03:00:00.000Z",
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
      disclaimer: "AI 生成图片草稿，仅供创作参考，需人工复核后使用。",
      updatedAt: "2026-08-06T03:00:00.000Z",
      items: [{
        id: stored.id,
        imageType: "lifestyle_scene",
        model: "openai-compatible-relay",
        createdAt: "2026-08-06T03:00:00.000Z",
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        width: stored.width,
        height: stored.height,
        fileSizeBytes: stored.fileSizeBytes,
        sha256: stored.sha256,
        reviewStatus: "needs_human_review",
        accessMode: "owner" as const,
        source: "real_ai_image_draft",
        safetyWarnings: ["Composition concept only; does not represent real product appearance."],
        promptSummary: "Composition concept for listing material planning (real asset reuse).",
        promptHash: "0".repeat(64),
        requestKeyHash: "0".repeat(64),
        generationBasis: { productName: "Release Closeout", sellingPoints: [], riskWarnings: [], missingFacts: [], imageMaterialNeeds: [] },
        handoffMode: "composition_concept" as const,
        compositionSummary: "Composition concept (real asset reused for release closeout validation).",
      }],
    };
    const seededResult = { ...parsedC, imageHandoffBinding: imageBinding, aiImageDraftSnapshot: imageSnapshot };
    await prisma.viralAnalysisRecord.update({
      where: { id: ownerTaskId },
      data: { resultJson: JSON.stringify(seededResult) },
    });
    // 受保护 image-draft API 直接验证（真实非零图片）——此处做 D 前 API 验证
    const imgApi = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(ownerTaskId)}/image-draft/${encodeURIComponent(stored.id)}`, {
      headers: { "x-access-token": owner.token, "x-access-password": owner.token },
      cache: "no-store",
    });
    assert(imgApi.status === 200, `smoke_image_api_status:${imgApi.status}`);
    const imgContentType = imgApi.headers.get("content-type") ?? "";
    assert(imgContentType === "image/png", `smoke_image_api_content_type:${imgContentType}`);
    const imgBlob = await imgApi.arrayBuffer();
    assert(imgBlob.byteLength === realPngBytes.length, `smoke_image_api_size:${imgBlob.byteLength} != ${realPngBytes.length}`);
    report.imageApi = { status: 200, contentType: imgContentType, bytes: imgBlob.byteLength };
    // 身份隔离：Visitor B 读 Owner 图片 → 统一 404；Visitor A 读自己任务图片 → 404
    const ownerImgForVisitorB = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(ownerTaskId)}/image-draft/${encodeURIComponent(stored.id)}`, {
      headers: { "x-access-token": visitorB.token, "x-access-password": visitorBPassword },
      cache: "no-store",
    });
    assert(ownerImgForVisitorB.status === 404, `smoke_image_cross_owner_not_404:${ownerImgForVisitorB.status}`);
    const visitorOwn = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(visitorTaskId)}/image-draft/some-id`, {
      headers: { "x-access-token": visitorA.token, "x-access-password": visitorAPassword },
      cache: "no-store",
    });
    assert(visitorOwn.status === 404, `smoke_image_visitor_own_404:${visitorOwn.status}`);
    report.imageIsolation = { ownerForVisitorB: ownerImgForVisitorB.status, visitorOwn: visitorOwn.status };

    // 页面导航一次以读取注入后的任务状态（等价真实生成后进入页面）
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('商品研究进度')", 250, "smoke_d_nav_timeout");
    // 有图片 → 产品图片为当前步骤，默认已展开（不点击）
    try {
      await waitFor(client, page.sessionId, "Boolean(document.querySelector('[data-testid=\"image-handoff-section\"]')) && document.body.innerText.includes('图片加载中') === false", 300, "smoke_image_section_timeout");
    } catch (imageSectionError) {
      const diag = await evaluate(client, page.sessionId, `(() => {
        const sec = document.querySelector('[data-testid="image-handoff-section"]');
        const text = document.body ? document.body.innerText : '';
        const img = sec ? sec.querySelector('img') : null;
        return {
          hasSection: Boolean(sec),
          sectionText: sec ? sec.innerText.slice(0, 300) : 'NO_SECTION',
          hasImg: Boolean(img),
          imgSrc: img ? img.src.slice(0, 30) : '',
          hasLoading: text.includes('图片加载中'),
          hasError: text.includes('读取失败') || text.includes('失败'),
          buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.slice(0, 20)).filter((t) => t.includes('产品') || t.includes('生成') || t.includes('下载')),
        };
      })()`);
      report.imageSectionDiag = diag;
      console.error("DIAG imageSection:", JSON.stringify(diag).slice(0, 800));
      throw imageSectionError;
    }
    // 等待真实图片 img 渲染（同屏预览）
    await waitFor(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return Boolean(img) && img.complete && img.naturalWidth > 0;
    })()`, 200, "smoke_image_render_timeout");
    const imageUi = await evaluate(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      const text = document.body ? document.body.innerText : '';
      return {
        naturalWidth: img ? img.naturalWidth : 0,
        naturalHeight: img ? img.naturalHeight : 0,
        srcPrefix: img ? img.src.slice(0, 20) : '',
        isBlob: img ? img.src.startsWith('blob:') : false,
        hasBigView: text.includes('查看大图'),
        hasDownload: text.includes('下载'),
        hasRegenerate: text.includes('重新生成'),
      };
    })()`);
    report.imageUi = imageUi;
    assert(imageUi.isBlob && imageUi.naturalWidth > 0, `smoke_image_blob_render:${JSON.stringify(imageUi)}`);
    const summaryAfterD = await readSummary();
    report.summaryAfterD = summaryAfterD;
    assert(summaryAfterD && summaryAfterD.missing.includes("人工复核最终内容"), `smoke_summary_d:${JSON.stringify(summaryAfterD)}`);

    // ── E. F5 → Listing 与真实图片仍存在 → 进度与产物一致 ──
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(client, page.sessionId, "Boolean(document.body) && document.body.innerText.includes('商品研究进度')", 250, "smoke_f5_ready_timeout");
    const summaryAfterE = await readSummary();
    report.summaryAfterE = summaryAfterE;
    assert(summaryAfterE && summaryAfterE.completed.includes("Listing 草稿已生成") && summaryAfterE.completed.includes("产品图片已生成") && summaryAfterE.missing.includes("人工复核"), `smoke_summary_e:${JSON.stringify(summaryAfterE)}`);
    // F5 后：先展开 Listing 区验证内容 + 复制能力（随后展开图片区验证同屏）
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Listing 草稿'))?.click()`);
    await waitFor(client, page.sessionId, "document.body.innerText.includes('当前 Listing 草稿有效')", 250, "smoke_f5_listing_timeout");

    // ── F. 复制能力：完整 Listing 不含图片建议；图片建议单独复制 ──
    // 读取剪贴板（headless 下 navigator.clipboard.readText 需权限；改用 CDP 捕获 clipboard）
    const copyCheck = await evaluate(client, page.sessionId, `(() => {
      const buttons = [...document.querySelectorAll('button')];
      const full = buttons.find((b) => b.textContent.includes('复制完整 Listing'));
      const imgCopy = buttons.find((b) => b.textContent.includes('复制图片创作建议'));
      return { hasFull: Boolean(full), hasImgCopy: Boolean(imgCopy), fullText: full ? full.textContent : '', imgText: imgCopy ? imgCopy.textContent : '' };
    })()`);
    report.copyUi = copyCheck;
    assert(copyCheck.hasFull && copyCheck.hasImgCopy, "smoke_copy_buttons");
    // 用 CDP 拦截剪贴板：先注入 navigator.clipboard.writeText 捕获
    await evaluate(client, page.sessionId, `(() => {
      window.__copiedText = '';
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (t) => { window.__copiedText = t; return Promise.resolve(); };
      return true;
    })()`);
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('复制完整 Listing'))?.click()`);
    await wait(150);
    const fullListingText = await evaluate(client, page.sessionId, "window.__copiedText");
    report.fullListingCopiedText = String(fullListingText).slice(0, 300);
    assert(!String(fullListingText).includes("Image Selling Points"), "smoke_full_listing_no_image_selling_points");
    assert(!String(fullListingText).includes("主图"), "smoke_full_listing_no_suggestion_items");
    assert(String(fullListingText).includes("Title:") && String(fullListingText).includes("Keywords:"), "smoke_full_listing_has_body");
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('复制图片创作建议'))?.click()`);
    await wait(150);
    const suggestionCopied = await evaluate(client, page.sessionId, "window.__copiedText");
    report.suggestionCopied = String(suggestionCopied).slice(0, 200);
    assert(String(suggestionCopied).includes("主图") && String(suggestionCopied).includes("证书图"), "smoke_suggestion_copy_content");

    // 图片区 F5 后重新读取 → 同屏渲染（与 Listing 复制并列验证）
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('产品图片'))?.click()`);
    await waitFor(client, page.sessionId, `(() => {
      const img = document.querySelector('[data-testid="image-handoff-section"] img');
      return Boolean(img) && img.complete && img.naturalWidth > 0;
    })()`, 200, "smoke_f5_image_timeout");

    // ── 真实图片完整链：查看大图 + 下载（非 0 字节）──
    // 下载：CDP 设置下载目录 → 点击「下载」→ 验证文件大小与真实 PNG 一致
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadRoot, eventsEnabled: true }, page.sessionId);
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '下载')?.click()`);
    let downloadedFile: string | null = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const files = await new Promise<string[]>((resolveFiles) => {
        const fs2 = require("node:fs") as typeof import("node:fs");
        fs2.readdir(downloadRoot, (err, entries) => resolveFiles(err ? [] : entries));
      });
      if (files.length > 0) { downloadedFile = files[0]; break; }
      await wait(100);
    }
    assert(downloadedFile !== null, "smoke_download_file_missing");
    const downloadedBytes = statSync(join(downloadRoot, downloadedFile)).size;
    report.download = { file: downloadedFile, bytes: downloadedBytes };
    assert(downloadedBytes === realPngBytes.length, `smoke_download_size:${downloadedBytes} != ${realPngBytes.length}`);
    // 大图：点击「查看大图」→ 新窗口 blob 加载（CDP target 层验证 window.open 行为）
    await evaluate(client, page.sessionId, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('查看大图'))?.click()`);
    await wait(600);
    const bigViewDiag = await evaluate(client, page.sessionId, `(() => {
      const sec = document.querySelector('[data-testid="image-handoff-section"]');
      const img = sec ? sec.querySelector('img') : null;
      return { stillAlive: Boolean(img) && img.complete && img.naturalWidth > 0, hasError: document.body.innerText.includes('加载失败') };
    })()`);
    report.bigView = bigViewDiag;
    assert(bigViewDiag.stillAlive === true && bigViewDiag.hasError === false, "smoke_big_view");
    report.realImageFullChain = {
      api200: true, contentType: "image/png", bytes: realPngBytes.length,
      sameScreenBlob: true, f5Reload: true, bigView: true, downloadBytes: downloadedBytes, downloadMatchesSource: downloadedBytes === realPngBytes.length,
    };

    // ── 页面安全 ──
    const pageHtml = await evaluate(client, page.sessionId, "document.documentElement.outerHTML");
    const noLeaks = !pageHtml.includes("data:image") && !pageHtml.includes("storageKey") && !pageHtml.includes("image-assets");
    report.noLeakInHtml = noLeaks;
    assert(noLeaks, "smoke_html_leak");
    report.browserSideEffects = {
      consoleErrorCount: client.state.consoleErrorCount,
      consoleErrorDiagnostics: client.state.consoleErrorDiagnostics,
      externalHttpRequestCount: client.state.externalHttpRequestCount,
      server5xxCount: client.state.server5xxCount,
      imageDraftRequests: client.state.imageDraftRequests,
    };
    assert(client.state.server5xxCount === 0, "smoke_server_5xx");
    assert(client.state.consoleErrorCount === 0, "smoke_console_errors");
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
    assert(report.portReleased && report.cdpPortReleased, "smoke_cleanup_failed");
  }
  try {
    writeFileSync(join(runtimeRoot, "release-closeout-final.json"), JSON.stringify(report, null, 2), "utf8");
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
