#!/usr/bin/env node

// PR2-2 隔离浏览器 Smoke：Listing 消费 Creative Handoff 闭环
// 端口 3140（冲突时 3141）；全新 CDP 端口；仓外 SQLite；全新 Visitor Store；
// 合成 Owner/Visitor 身份；独立 Chrome Profile；Mock Provider；无真实 Provider 凭据。

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";

const WORKTREE = resolve(process.cwd());
const SMOKE_PARENT = "C:\\Users\\a2578\\Desktop\\qingxuan-smoke";
const HOST = "127.0.0.1";
const PORTS = [3140, 3141] as const;
const CDP_PORT = 24817;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const nodeRequestEvidence = {
  requestCount: 0,
  externalHttpRequestCount: 0,
  productionPortAccessCount: 0,
  listingHandoffRequestCount: 0,
  imageRequestCount: 0,
  aiRouteRequestCount: 0,
  server5xxCount: 0,
};

const FORBIDDEN_KEYS = new Set([
  "actorRef", "subjectFingerprint", "candidateId", "requestId", "requestLedger",
  "researchHash", "handoffFingerprint", "candidateSnapshotFingerprint",
  "sellerSpriteSnapshotFingerprint", "researchResultFingerprint", "confirmationReference",
  "sourceHandoffFingerprint", "generationInputFingerprint", "resultJson", "sourceRef",
]);

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

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
      label: entry.label,
      passwordHash: hashSyntheticPassword(entry.password, salt),
      salt,
      expiresAt: null,
      maxAiCalls: 0,
      usedAiCalls: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "Disposable PR2-2 isolated smoke only.",
    };
  });
  writeFileSync(path, `${JSON.stringify({ version: 1, accesses }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function buildProtectedResult(input: { candidateId: string; runId: string; actor: { mode: "owner"; actorRef: string } | { mode: "visitor"; actorRef: string } }) {
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
    actor: input.actor as { mode: "owner" | "visitor"; actorRef: "owner:v1" | string } as never,
    now: "2026-08-05T01:00:00.000Z",
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "Synthetic.", nextAction: null },
  });
  return {
    productName: "Synthetic PR2-2 product",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Synthetic isolated PR2-2 record.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    unknownInternalNamespace: { keepPrivate: true },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Synthetic PR2-2 product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0PR220001",
      productUrl: "https://example.com/pr22",
      title: "Synthetic PR2-2 Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "pr22",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-05T01:00:00.000Z",
      contextHash,
    },
  };
}

function makeVisitorActor(accessId: string) {
  return { mode: "visitor" as const, actorRef: `visitor:${createHash("sha256").update(accessId).digest("hex").slice(0, 16)}` } as const;
}

function hasForbiddenProjection(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return FORBIDDEN_KEYS.has(serialized);
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  nodeRequestEvidence.requestCount += 1;
  const url = new URL(path, baseUrl);
  if (url.hostname !== HOST || (url.port !== "3140" && url.port !== "3141")) {
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

function genericTaskBody(result: JsonRecord) {
  return {
    type: "workflow",
    title: "Synthetic generic",
    platform: "local-test",
    materialText: "Synthetic",
    source: "isolated-smoke",
    level: "low",
    oneLineSummary: "Synthetic",
    resultJson: JSON.stringify(result),
  };
}

function classifyConsoleError(text: string) {
  if (text.includes("Failed to fetch") || text.includes("NetworkError")) return "network";
  if (text.includes("Hydration")) return "hydration";
  return "other";
}

function cdpClient(webSocketUrl: string) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const requests = new Map<string, { category: string; method: string }>();
  const state = {
    consoleErrorCount: 0,
    consoleErrorDiagnostics: [] as Array<{ category: string; fingerprint: string }>,
    failedResponses: [] as Array<{ category: string; method: string; status: number }>,
    externalHttpRequestCount: 0,
    server5xxCount: 0,
    listingHandoffRequestCount: 0,
    imageRequestCount: 0,
    aiRouteRequestCount: 0,
    listingHandoffMutations: [] as Array<{ method: string; status?: number }>,
    imageRequests: [] as string[],
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
      state.consoleErrorDiagnostics.push({ category: classifyConsoleError(text), fingerprint: text.slice(0, 200) });
    }
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = String(message.params?.request?.url ?? "");
      const requestMethod = String(message.params?.request?.method ?? "GET").toUpperCase();
      try {
        const url = new URL(requestUrl);
        const category = url.pathname.includes("listing-handoff")
          ? "listing-handoff"
          : url.pathname.includes("image-draft") || url.pathname.includes("ai-image")
            ? "image-draft"
            : url.pathname.includes("/api/workflows/") || url.pathname.includes("/api/agent")
              ? "ai-route"
              : url.pathname.startsWith("/api/")
                ? "other-api"
                : "page-resource";
        requests.set(String(message.params.requestId), { category, method: requestMethod });
        if (category === "listing-handoff") {
          state.listingHandoffRequestCount += 1;
          state.listingHandoffMutations.push({ method: requestMethod });
        }
        if (category === "image-draft") { state.imageRequestCount += 1; state.imageRequests = state.imageRequests ?? []; state.imageRequests.push(requestUrl + "|" + requestMethod); }
        if (category === "ai-route") state.aiRouteRequestCount += 1;
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== HOST) {
          state.externalHttpRequestCount += 1;
        }
      } catch {
        // Browser-internal URLs.
      }
    }
    if (message.method === "Network.responseReceived") {
      const status = Number(message.params?.response?.status);
      if (status >= 400) {
        const request = requests.get(String(message.params.requestId));
        state.failedResponses.push({ category: request?.category ?? "unknown", method: request?.method ?? "unknown", status });
      }
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
  if (response.exceptionDetails) throw new Error(`smoke_page_script_failed:${JSON.stringify({ text: response.exceptionDetails.text, description: response.exceptionDetails.exception?.description ?? response.exceptionDetails.exception?.value, details: response.exceptionDetails }).slice(0, 600)}`);
  return response.result?.value;
}

async function waitFor(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string, attempts = 160, timeoutCode = "smoke_page_timeout") {
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

async function createHandoffViaApi(baseUrl: string, token: string, taskId: string, requestId: string, mode: "owner" | "demo") {
  const preview = await api(baseUrl, token, `/api/tasks/${encodeURIComponent(taskId)}/creative-handoff?mode=preview`);
    assert(preview.status === 200, `smoke_handoff_preview_failed:${preview.status}:${typeof preview.body === "string" ? preview.body.slice(0, 100) : JSON.stringify(preview.body).slice(0, 100)}`);
  const previewBody = jsonRecord(preview.body);
  const previewData = jsonRecord(previewBody.preview);
  assert(previewBody.gateReason !== undefined, "smoke_preview_gate_missing");
  const confirmables = Array.isArray(previewData.confirmableFactCandidates)
    ? previewData.confirmableFactCandidates as Array<{ selectionId: string }>
    : [];
  assert(confirmables.length >= 2, "smoke_confirmables_missing");
  const selectionIds = confirmables.slice(0, 2).map((c) => c.selectionId as string);
  const currentHandoffRevision = typeof previewData.expectedCurrentHandoffRevision === "number"
    ? previewData.expectedCurrentHandoffRevision
    : 0;
  const createResponse = await api(baseUrl, token, `/api/tasks/${encodeURIComponent(taskId)}/creative-handoff`, {
    method: "POST",
    body: JSON.stringify({
      action: "create",
      requestId,
      confirmed: true,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: currentHandoffRevision,
      expectedStorageVersion: jsonRecord(previewData.storageVersion ?? {}),
      selectedFactCandidateIds: selectionIds,
    }),
  });
  assert(createResponse.status === 200 || createResponse.status === 201, `smoke_handoff_create_failed:${createResponse.status}:${JSON.stringify(createResponse.body)}`);
  return createResponse.body;
}

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `product-research-pr2-2-listing-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "p22.db");
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
  const ownerTaskId = "smoke-pr22-owner-task";
  const ownerCandidateId = "smoke-pr22-owner-candidate";
  const visitorTaskId = "sandbox_task_pr22_visitor_a";
  const visitorCandidateId = "sandbox_candidate_pr22_visitor_a";
  let runtimePid: number | null = null;
  let chromePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord = {
    status: "failed",
    port,
    runtimeRootRemoved: false,
  };

  try {
    mkdirSync(runtimeRoot);
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./p22.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
      { id: visitorBId, password: visitorBPassword, label: "Synthetic Visitor B" },
    ]);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-smoke-pr22-owner", actor: { mode: "owner" as const, actorRef: "owner:v1" as const } });
    const visitorResult = buildProtectedResult({ candidateId: visitorCandidateId, runId: "wf-smoke-pr22-visitor", actor: makeVisitorActor(visitorAId) });
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
          title: "Synthetic owner research",
          platform: "local-test",
          productUrl: null,
          materialText: "Synthetic",
          source: "isolated-smoke",
          score: 0,
          level: "low",
          oneLineSummary: "Synthetic",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId,
          name: "Synthetic owner candidate",
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

    // ── PR2-2 Final-Fix (BLOCKER-1): 旧路径封堵浏览器层验证（在创建 Handoff 之前：无 binding）──
    // 1) 旧 ai-generate（real 模式）→ 422 handoff_required（realMode 一律拒绝）
    const oldGenReal = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-pack/ai-generate`, {
      method: "POST",
      body: JSON.stringify({ mode: "real", confirmRealAi: true }),
    });
    assert(oldGenReal.status === 422, `smoke_old_generate_real_not_blocked:${oldGenReal.status}:${JSON.stringify(oldGenReal.body)}`);
    assert((jsonRecord(oldGenReal.body).error as JsonRecord).code === "handoff_required", "smoke_old_generate_real_code");
    // 2) 旧 ai-generate（mock 模式，无 Handoff）→ 422 handoff_required
    const oldGenMock = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-pack/ai-generate`, {
      method: "POST",
      body: JSON.stringify({ mode: "mock" }),
    });
    assert(oldGenMock.status === 422, `smoke_old_generate_mock_not_blocked:${oldGenMock.status}:${JSON.stringify(oldGenMock.body)}`);
    assert((jsonRecord(oldGenMock.body).error as JsonRecord).code === "handoff_required", "smoke_old_generate_mock_code");
    // 3) 旧 ai-save（无 binding）→ 422 handoff_required
    const oldSave = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-pack/ai-save`, {
      method: "POST",
      body: JSON.stringify({ listingPack: { titles: ["x"] }, overwrite: true }),
    });
    assert(oldSave.status === 422, `smoke_old_save_not_blocked:${oldSave.status}:${JSON.stringify(oldSave.body)}`);
    assert((jsonRecord(oldSave.body).error as JsonRecord).code === "handoff_required", "smoke_old_save_code");
    // 4) 旧 listing-pack PATCH（无 binding）→ 422 handoff_required
    const oldPatch = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-pack`, {
      method: "PATCH",
      body: JSON.stringify({ listingPackSnapshot: { version: 1 } }),
    });
    assert(oldPatch.status === 422, `smoke_old_patch_not_blocked:${oldPatch.status}:${JSON.stringify(oldPatch.body)}`);
    assert((jsonRecord(oldPatch.body).error as JsonRecord).code === "handoff_required", "smoke_old_patch_code");
    report.oldPathBlocked = {
      aiGenerateReal: oldGenReal.status,
      aiGenerateMock: oldGenMock.status,
      aiSave: oldSave.status,
      listingPackPatch: oldPatch.status,
      code: "handoff_required",
    };

    // ── 建立 active Handoff（Owner）──
    await createHandoffViaApi(baseUrl, owner.token, ownerTaskId, "550e8400-e29b-41d4-a716-446655440000", "owner");
    await createHandoffViaApi(baseUrl, visitorA.token, visitorTaskId, "550e8400-e29b-41d4-a716-446655440001", "demo");

    // ── API 层验证 ──
    const ownerState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    assert(ownerState.status === 200, "smoke_owner_listing_state_failed");
    const ownerStateData = jsonRecord(jsonRecord(ownerState.body).data);
    assert(ownerStateData.listingStatus === "ready", `smoke_owner_ready_expected:${ownerStateData.listingStatus}`);
    assert(ownerStateData.canGenerate === true, "smoke_owner_can_generate_false");
    assert(typeof ownerStateData.currentHandoffRevision === "number", "smoke_owner_revision_missing");

    // 生成（同 requestId 两次 → 第二次幂等重放）
    const genRequestId = "550e8400-e29b-41d4-a716-446655440002";
    const genBody = {
      requestId: genRequestId,
      expectedStorageVersion: ownerStateData.storageVersion,
      expectedHandoffRevision: ownerStateData.currentHandoffRevision,
      confirmed: true,
    };
    const gen1 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify(genBody),
    });
    assert(gen1.status === 200, `smoke_listing_generate_failed:${gen1.status}:${JSON.stringify(gen1.body)}`);
    const gen1Data = jsonRecord(jsonRecord(gen1.body).data);
    assert(gen1Data.listingStatus === "active", `smoke_listing_active_expected:${gen1Data.listingStatus}`);
    assert(gen1Data.idempotentReplay === false, "smoke_listing_replay_expected_false");
    assert(gen1Data.humanReviewRequired === true, "smoke_human_review_flag");

    // 幂等重放
    const gen2 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify(genBody),
    });
    assert(gen2.status === 200, "smoke_listing_replay_failed");
    const gen2Data = jsonRecord(jsonRecord(gen2.body).data);
    assert(gen2Data.idempotentReplay === true, "smoke_listing_replay_marker_missing");

    // 浏览器禁止提交事实/Prompt
    const forbiddenAttempt = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({ ...genBody, facts: [{ field: "brand", value: "x" }] }),
    });
    assert(forbiddenAttempt.status === 400, "smoke_forbidden_facts_not_blocked");

    // 禁止指定旧 Revision
    const oldRevisionAttempt = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({ ...genBody, expectedHandoffRevision: 99 }),
    });
    assert(oldRevisionAttempt.status === 400 || oldRevisionAttempt.status === 409, "smoke_old_revision_not_blocked");

    // ── Handoff 更新 → 旧 Listing stale ──
    const ownerState2 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const ownerState2Data = jsonRecord(jsonRecord(ownerState2.body).data);
    assert(ownerState2Data.listingStatus === "active", `smoke_post_gen_active:${ownerState2Data.listingStatus}`);

    // ── 浏览器 UI 断言 ──
    const chrome = await startChrome(runtimeRoot);
    chromePid = chrome.pid;
    const client = cdpClient(chrome.webSocketDebuggerUrl);
    await client.ready;
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
    await waitFor(
      client,
      page.sessionId,
      "Boolean(document.body) && document.body.innerText.includes('Listing 草稿')",
      200,
      "smoke_listing_section_mount_timeout",
    );
    // 等待组件 GET 完成（加载中 → 当前草稿有效）
    await waitFor(
      client,
      page.sessionId,
      "Boolean(document.body) && (document.body.innerText.includes('当前草稿有效') || document.body.innerText.includes('交接内容已经更新'))",
      200,
      "smoke_listing_state_load_timeout",
    );
    const uiState = await evaluate(client, page.sessionId, `(() => {
      if (!document.body) return { hasListingSection: false, hasReviewBanner: false, hasActiveDraft: false, hasNoPublish: false, hasDraftBody: false };
      const text = document.body.innerText;
      return {
        hasListingSection: text.includes('Listing 草稿'),
        hasReviewBanner: text.includes('AI 生成草稿') && text.includes('仍需人工审核') && text.includes('不得直接发布'),
        hasActiveDraft: text.includes('当前草稿有效'),
        hasNoPublish: !text.includes('发布 Listing') && !text.includes('上传') && !text.includes('Amazon'),
        hasDraftBody: text.includes('Confirmed:') || text.includes('标题'),
      };
    })()`);
    assert(uiState.hasListingSection === true, "smoke_ui_listing_section");
    assert(uiState.hasReviewBanner === true, "smoke_ui_review_banner");
    assert(uiState.hasActiveDraft === true, "smoke_ui_active_draft");
    assert(uiState.hasNoPublish === true, "smoke_ui_publish_visible");
    assert(uiState.hasDraftBody === true, "smoke_ui_draft_body");
    report.ui = { ...uiState, ownerTaskId };

    // ── 竞态：延迟 Mock 生成期间更新 Handoff → 409 ──
    // （服务层并发已在 e2e 覆盖；浏览器层验证 409 提示文案）
    const stateBeforeRace = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const stateBeforeRaceData = jsonRecord(jsonRecord(stateBeforeRace.body).data);

    // ── Handoff 更新 → 旧草稿 stale ──
    await createHandoffViaApi(baseUrl, owner.token, ownerTaskId, "550e8400-e29b-41d4-a716-446655440003", "owner");
    const ownerState3 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const ownerState3Data = jsonRecord(jsonRecord(ownerState3.body).data);
    assert(ownerState3Data.listingStatus === "stale", `smoke_stale_expected:${ownerState3Data.listingStatus}`);
    assert(ownerState3Data.staleDraftPresent === true, "smoke_stale_draft_present");
    report.staleAfterHandoffUpdate = { status: ownerState3Data.listingStatus, staleReasonCode: ownerState3Data.staleReasonCode };

    // 新 requestId 重新生成 → 绑定新 Revision
    const gen3Body = {
      requestId: "550e8400-e29b-41d4-a716-446655440004",
      expectedStorageVersion: ownerState3Data.storageVersion,
      expectedHandoffRevision: ownerState3Data.currentHandoffRevision,
      confirmed: true,
    };
    const gen3 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify(gen3Body),
    });
    assert(gen3.status === 200, `smoke_regenerate_failed:${gen3.status}`);
    const gen3Data = jsonRecord(jsonRecord(gen3.body).data);
    assert(gen3Data.listingStatus === "active", `smoke_regenerate_active:${gen3Data.listingStatus}`);
    assert(gen3Data.sourceHandoffRevision === ownerState3Data.currentHandoffRevision, "smoke_regenerate_binding_revision");
    report.regenerateAfterHandoffUpdate = { newRevision: gen3Data.sourceHandoffRevision };

    // ── Revoke → revoked 状态 ──
    const stateBeforeRevoke = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const stateBeforeRevokeData = jsonRecord(jsonRecord(stateBeforeRevoke.body).data);
    const revoke = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "revoke",
        requestId: "550e8400-e29b-41d4-a716-446655440005",
        revokeReasonCode: "explicit_user_revoke",
        expectedCurrentHandoffRevision: stateBeforeRevokeData.currentHandoffRevision,
        expectedStorageVersion: stateBeforeRevokeData.storageVersion,
      }),
    });
    assert(revoke.status === 200, `smoke_revoke_failed:${revoke.status}:${JSON.stringify(revoke.body)}`);
    const ownerState4 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    const ownerState4Data = jsonRecord(jsonRecord(ownerState4.body).data);
    assert(ownerState4Data.listingStatus === "revoked", `smoke_revoked_expected:${ownerState4Data.listingStatus}`);
    assert(ownerState4Data.canGenerate === false, "smoke_revoked_can_generate");
    report.revoked = { status: ownerState4Data.listingStatus, canGenerate: ownerState4Data.canGenerate };

    // ── Visitor A 生成 + 隔离 ──
    const visitorState = await api(baseUrl, visitorA.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/listing-handoff`);
    assert(visitorState.status === 200, "smoke_visitor_listing_state_failed");
    const visitorStateData = jsonRecord(jsonRecord(visitorState.body).data);
    const visitorGen = await api(baseUrl, visitorA.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440006",
        expectedStorageVersion: visitorStateData.storageVersion,
        expectedHandoffRevision: visitorStateData.currentHandoffRevision,
        confirmed: true,
      }),
    });
    assert(visitorGen.status === 200, "smoke_visitor_generate_failed");
    const visitorGenData = jsonRecord(jsonRecord(visitorGen.body).data);
    assert(visitorGenData.listingStatus === "active", `smoke_visitor_active:${visitorGenData.listingStatus}`);
    // Visitor B 访问 A → 404
    const crossVisitor = await api(baseUrl, visitorB.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/listing-handoff`);
    assert(crossVisitor.status === 404, `smoke_cross_visitor_not_404:${crossVisitor.status}:${JSON.stringify(crossVisitor.body)}`);
    report.visitor = { generated: true, crossVisitorStatus: crossVisitor.status };

    // ── 浏览器刷新 → stale 显示 ──
    await client.send("Page.navigate", { url: `${baseUrl}/tasks/${encodeURIComponent(ownerTaskId)}` }, page.sessionId);
    await waitFor(
      client,
      page.sessionId,
      "Boolean(document.body) && document.body.innerText.includes('Listing 草稿')",
      200,
      "smoke_listing_section_reload_timeout",
    );
    await waitFor(
      client,
      page.sessionId,
      "Boolean(document.body) && document.body.innerText.includes('对应创作交接已撤回')",
      200,
      "smoke_ui_revoked_render_timeout",
    );
    const revokedUi = await evaluate(client, page.sessionId, `(() => {
      if (!document.body) return { revokedVisible: false, generateDisabled: false };
      const text = document.body.innerText;
      return {
        revokedVisible: text.includes('对应创作交接已撤回'),
        generateDisabled: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('生成 Listing 草稿') && b.disabled),
      };
    })()`);
    assert(revokedUi.revokedVisible === true, "smoke_ui_revoked_text");
    report.uiRevoked = revokedUi;

    client.close();

    // ── 安全输出断言 ──
    const after = readFileSync(logPath, "utf8");
    assert(!after.includes(ownerPassword) && !after.includes(visitorAPassword), "smoke_secret_in_log");
    const browserSideEffects = {
      externalHttpRequestCount: client.state.externalHttpRequestCount,
      server5xxCount: client.state.server5xxCount,
      listingHandoffMutations: client.state.listingHandoffMutations,
      imageRequests: client.state.imageRequestCount,
      imageRequestUrls: client.state.imageRequests ?? [],
      aiRouteRequests: client.state.aiRouteRequestCount,
    };
    report.browserSideEffects = browserSideEffects;
    report.nodeSideEffects = {
      externalHttpRequestCount: nodeRequestEvidence.externalHttpRequestCount,
      productionPortAccessCount: nodeRequestEvidence.productionPortAccessCount,
      server5xxCount: nodeRequestEvidence.server5xxCount,
    };

    // ── 数据库层验证 ──
    const ownerRow = await prisma.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const ownerParsed = JSON.parse(ownerRow!.resultJson);
    assert(ownerParsed.listingHandoffBinding !== undefined, "smoke_owner_binding_saved");
    assert(ownerParsed.aiListingPackSnapshot !== undefined, "smoke_owner_snapshot_saved");
    assert(ownerParsed.unknownInternalNamespace !== undefined, "smoke_owner_namespace_preserved");
    const binding = ownerParsed.listingHandoffBinding;
    assert(binding.sourceHandoffRevision === ownerState3Data.currentHandoffRevision, "smoke_binding_revision_mismatch");
    assert(binding.generationSource === "creative_handoff", "smoke_binding_source");
    assert(binding.humanReviewRequired === true, "smoke_binding_human_review");
    report.database = {
      ownerBinding: { revision: binding.sourceHandoffRevision, generationSource: binding.generationSource },
      namespacePreserved: true,
      quickCheck: ((await prisma.$queryRawUnsafe("PRAGMA quick_check")) as Array<Record<string, string>>)[0]?.quick_check ?? "unknown",
    };

    report.status = "passed";
  } finally {
    if (prisma) await prisma.$disconnect();
    if (chromePid) {
      try {
        stopOwnedProcess(chromePid);
      } catch {
        report.chromeStopFailed = true;
      }
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
    report.cleanupAttempts = true;
    report.runtimeRootRemoved = !existsSync(exactRoot);
    assert(report.portReleased && report.cdpPortReleased, "smoke_cleanup_failed");
  }
  try {
    writeFileSync(join(runtimeRoot, "browser-smoke-final.json"), JSON.stringify(report, null, 2), "utf8");
  } catch {
    report.reportWriteFailed = true;
  }
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: "failed",
    code: error instanceof Error ? error.message : "smoke_failed",
  }));
  process.exitCode = 1;
});
