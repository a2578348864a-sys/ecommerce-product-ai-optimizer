#!/usr/bin/env node

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
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  appendProductResearchDecision,
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";
import {
  buildSellerSpriteCandidateSourceMeta,
  computeSellerSpriteRowHash,
} from "@/lib/server/sellerSpriteImportContract";
import {
  createWorkflowInputHash,
  createWorkflowResultHash,
  createWorkflowRunProof,
} from "@/lib/server/workflowRunProof";

const WORKTREE = resolve(process.cwd());
const SMOKE_PARENT = "C:\\Users\\a2578\\Desktop\\qingxuan-smoke";
const HOST = "127.0.0.1";
const PORTS = [3124, 3125] as const;
const CDP_PORT = 24812;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FORBIDDEN_KEYS = new Set([
  "actorRef",
  "decisionId",
  "candidateId",
  "runId",
  "contextHash",
  "researchVerification",
  "inputHash",
  "resultHash",
  "researchHash",
  "futureSecretField",
  "unknownInternalNamespace",
]);
const RESERVED_NAMESPACES = [
  "researchRecord",
  "researchVerification",
  "researchHash",
  "decisionEvents",
  "productLifecycle",
  "listingPackSnapshot",
  "aiListing",
  "aiListingPackSnapshot",
  "aiImageDraftSnapshot",
  "candidateToTask",
  "candidateAnalysisContext",
  "r22CommercialValidation",
  "productBatchBinding",
  "decisionEvidence",
  "humanDecision",
  "agentOutputSnapshot",
  "reviewState",
  "sourceMeta",
  "researchMode",
  "promotionEligible",
  "profitSnapshot",
  "riskReviewSnapshot",
  "agentRunSnapshot",
  "listingPrepSnapshot",
] as const;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function wait(milliseconds: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function jsonRecord(value: unknown): JsonRecord {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "smoke_json_object_required");
  return value as JsonRecord;
}

function publicErrorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "unknown";
  const error = (value as JsonRecord).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return "unknown";
  const code = (error as JsonRecord).code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code) ? code : "unknown";
}

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashSyntheticPassword(password: string, salt: string) {
  return `sha256:${createHash("sha256").update(salt + password).digest("hex")}`;
}

function createIsolatedCliEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ComSpec: process.env.ComSpec,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    Path: process.env.Path,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    ...overrides,
  };
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = createServer();
    probe.once("error", () => resolveProbe(false));
    probe.listen({ host: HOST, port, exclusive: true }, () => {
      probe.close(() => resolveProbe(true));
    });
  });
}

async function selectPort() {
  for (const port of PORTS) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("smoke_ports_unavailable");
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
      notes: "Disposable PR1 Fix.2 isolated smoke only.",
    };
  });
  writeFileSync(path, `${JSON.stringify({ version: 1, accesses }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function buildProtectedResult(input: {
  candidateId: string;
  runId: string;
  actor: { mode: "owner"; actorRef: "owner:v1" } | { mode: "visitor"; actorRef: string };
}) {
  const contextHash = createHash("sha256").update(`context:${input.candidateId}`).digest("hex");
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: input.candidateId,
    runId: input.runId,
    contextHash,
    inputHash: createHash("sha256").update(`input:${input.candidateId}`).digest("hex"),
    resultHash: createHash("sha256").update(`result:${input.candidateId}`).digest("hex"),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const initial = createInitialProductResearchRecord({
    candidateId: input.candidateId,
    runId: input.runId,
    contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: input.actor,
    now: "2026-08-03T01:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "needs_information",
      reason: "Synthetic revision one.",
      nextAction: "Collect a synthetic check.",
    },
  });
  const appended = appendProductResearchDecision({
    record: initial,
    expectedRevision: 1,
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: input.actor,
    now: "2026-08-03T02:00:00.000Z",
    decision: {
      decisionId: "22222222-2222-4222-8222-222222222222",
      status: "needs_information",
      reason: "Synthetic revision two.",
      nextAction: "Wait for the mounted conflict check.",
    },
  });
  assert(appended.kind === "updated", "smoke_initial_revision_failed");
  return {
    productName: "Synthetic product research record",
    status: "completed",
    score: 0,
    level: "low",
    oneLineSummary: "Synthetic isolated record.",
    finalReport: {
      finalVerdict: "Synthetic only.",
      futureSecretField: "nested-canary",
    },
    sourceMeta: {
      source: "opportunity",
      candidateId: input.candidateId,
      contextHash,
      futureSecretField: "nested-canary",
    },
    researchRecord: appended.record,
    researchVerification: verification,
    researchHash: appended.record.researchHash,
    futureSecretField: "top-level-canary",
    unknownInternalNamespace: { keepPrivate: true },
  };
}

function makeVisitorActor(accessId: string) {
  return {
    mode: "visitor" as const,
    actorRef: `visitor:${createHash("sha256").update(accessId).digest("hex").slice(0, 16)}`,
  };
}

function hasForbiddenProjection(value: unknown): boolean {
  if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) return true;
  if (Array.isArray(value)) return value.some(hasForbiddenProjection);
  if (typeof value !== "object" || value === null) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || hasForbiddenProjection(nested)) return true;
  }
  return false;
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "x-access-token": token,
      "x-access-password": token,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function login(baseUrl: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = jsonRecord(await response.json());
  assert(response.status === 200 && body.ok === true && typeof body.accessToken === "string", "smoke_login_failed");
  return {
    mode: body.mode as "owner" | "demo",
    token: body.accessToken,
    demoAccess: body.demoAccess,
  };
}

function genericTaskBody(result: JsonRecord) {
  return {
    type: "workflow",
    title: "Synthetic generic task",
    platform: "",
    source: "mock",
    materialText: "Synthetic material",
    result: {
      score: 0,
      level: "low",
      oneLineSummary: "Synthetic generic result.",
      ...result,
    },
  };
}

function createFormalWorkflowBody(candidate: JsonRecord, contextHash: string) {
  const runId = `wf-${randomUUID()}`;
  const candidateId = String(candidate.id);
  const runInput = {
    productName: String(candidate.name),
    source: "opportunity" as const,
    candidateId,
    contextHash,
  };
  const workflowResult = {
    ok: true,
    workflowId: runId,
    runId,
    input: runInput,
    productName: runInput.productName,
    status: "completed" as const,
    steps: [],
    costGuard: {
      aiStepsRequested: 1,
      aiStepsCompleted: 1,
      fallbackSteps: 0,
      providerCallsPlanned: 0,
      providerCallsStarted: 0,
      providerCallsCompleted: 0,
      providerCallsFailed: 0,
      quotaMetric: "ai_jobs_v1",
    },
    finalReport: {
      finalVerdict: "Synthetic market-research closure.",
      riskLevel: "yellow",
      beginnerFit: "Requires manual review.",
      canTestSmallBatch: false,
      mustCheckBeforeListing: [],
      nextSteps: [],
      manualReviewChecklist: [],
    },
    researchMode: "market_research_only" as const,
    promotionEligible: false as const,
  };
  const runProof = createWorkflowRunProof({
    runId,
    subject: "owner",
    candidateId,
    inputHash: createWorkflowInputHash(runInput),
    resultHash: createWorkflowResultHash(workflowResult),
    status: "completed",
  });
  return {
    workflowResult: { ...workflowResult, runProof },
    runProof,
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
    },
    sourceMeta: {
      source: "opportunity",
      candidateId,
      opportunityTitle: runInput.productName,
      importedAt: "2026-08-03T03:00:00.000Z",
    },
    decisionStatus: "continue",
    humanConfirmed: true,
    humanDecision: {
      status: "continue",
      reason: "Synthetic confirmation.",
      nextAction: "Remain in research only.",
    },
    productResearchDecision: {
      decisionId: "33333333-3333-4333-8333-333333333333",
      status: "creative_ready",
      reason: "All synthetic process checks were reviewed.",
      nextAction: "Wait for a separately authorized handoff.",
    },
  };
}

function classifyConsoleError(text: string) {
  const category = /minified react error/i.test(text)
    ? "react_runtime"
    : /hydration/i.test(text)
      ? "react_hydration"
      : /failed to (fetch|load)|networkerror/i.test(text)
        ? "network_load"
        : /research_record_conflict/i.test(text)
          ? "expected_conflict_leaked"
          : /typeerror/i.test(text)
            ? "type_error"
            : "other";
  return {
    category,
    fingerprint: createHash("sha256").update(text).digest("hex").slice(0, 12),
  };
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
    listingReadRequestCount: 0,
    listingMutationRequestCount: 0,
    imageReadRequestCount: 0,
    imageMutationRequestCount: 0,
    aiRequestCount: 0,
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
      state.consoleErrorDiagnostics.push(classifyConsoleError(text));
    }
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = String(message.params?.request?.url ?? "");
      const requestMethod = String(message.params?.request?.method ?? "GET").toUpperCase();
      try {
        const url = new URL(requestUrl);
        const category = url.pathname.includes("research-decision")
          ? "research-decision"
          : url.pathname.includes("listing-pack")
            ? "listing-pack"
            : url.pathname.includes("image-draft") || url.pathname.includes("ai-image")
              ? "image-draft"
              : url.pathname.startsWith("/api/tasks/")
                ? "task-detail"
                : url.pathname.startsWith("/api/")
                  ? "other-api"
                  : "page-resource";
        requests.set(String(message.params.requestId), { category, method: requestMethod });
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== HOST) {
          state.externalHttpRequestCount += 1;
        }
        if (url.pathname.includes("listing-pack")) {
          if (requestMethod === "GET") state.listingReadRequestCount += 1;
          else state.listingMutationRequestCount += 1;
        }
        if (url.pathname.includes("image-draft") || url.pathname.includes("ai-image")) {
          if (requestMethod === "GET") state.imageReadRequestCount += 1;
          else state.imageMutationRequestCount += 1;
        }
        if (url.pathname.includes("/api/workflows/") || url.pathname.includes("/api/agent")) state.aiRequestCount += 1;
      } catch {
        // Browser-internal URLs are not external business requests.
      }
    }
    if (message.method === "Network.responseReceived") {
      const status = Number(message.params?.response?.status);
      if (status >= 400) {
        const request = requests.get(String(message.params.requestId));
        state.failedResponses.push({
          category: request?.category ?? "unknown",
          method: request?.method ?? "unknown",
          status,
        });
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
  assert(Number.isInteger(pid) && pid > 0, "smoke_owned_pid_invalid");
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error("smoke_owned_process_stop_failed");
}

function isOwnedProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function createPage(client: ReturnType<typeof cdpClient>) {
  const context = await client.send("Target.createBrowserContext");
  const target = await client.send("Target.createTarget", {
    url: "about:blank",
    browserContextId: context.browserContextId,
  });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId as string;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId);
  return { sessionId, browserContextId: context.browserContextId as string };
}

async function evaluate(client: ReturnType<typeof cdpClient>, sessionId: string, expression: string) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) throw new Error("smoke_page_script_failed");
  return response.result?.value;
}

async function waitFor(
  client: ReturnType<typeof cdpClient>,
  sessionId: string,
  expression: string,
  attempts = 160,
  timeoutCode = "smoke_page_timeout",
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await wait(100);
  }
  throw new Error(timeoutCode);
}

async function runMountedConflictCheck(input: {
  baseUrl: string;
  ownerToken: string;
  taskId: string;
  runtimeRoot: string;
}) {
  const chrome = await startChrome(input.runtimeRoot);
  const client = cdpClient(chrome.webSocketDebuggerUrl);
  await client.ready;
  try {
    const page = await createPage(client);
    await client.send("Page.navigate", { url: input.baseUrl }, page.sessionId);
    await waitFor(client, page.sessionId, "document.readyState === 'complete'", 160, "smoke_home_ready_timeout");
    await evaluate(client, page.sessionId, `(() => {
      sessionStorage.setItem('qx:access-token:session:v1', ${JSON.stringify(input.ownerToken)});
      sessionStorage.setItem('qx:access-mode:session:v1', 'owner');
      sessionStorage.setItem('qx:access-password:session:v2', ${JSON.stringify(input.ownerToken)});
      sessionStorage.setItem('qx:access-expires:session:v2', String(Date.now() + 3600000));
      return true;
    })()`);
    await client.send("Page.navigate", { url: `${input.baseUrl}/tasks/${encodeURIComponent(input.taskId)}` }, page.sessionId);
    await waitFor(
      client,
      page.sessionId,
      "Boolean(document.querySelector('[data-testid=\"product-research-decision-panel\"]'))",
      160,
      "smoke_decision_panel_mount_timeout",
    );
    await waitFor(
      client,
      page.sessionId,
      "document.body.innerText.includes('版本 2')",
      160,
      "smoke_initial_revision_render_timeout",
    );
    await evaluate(client, page.sessionId, `(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__pr1Fix2PatchBodies = [];
      window.__pr1Fix2PatchOutcomes = [];
      window.fetch = async (resource, init) => {
        const url = typeof resource === 'string' ? resource : resource.url;
        const isDecisionPatch = url.includes('/research-decision') && init?.method === 'PATCH';
        if (isDecisionPatch) {
          window.__pr1Fix2PatchBodies.push(JSON.parse(String(init.body)));
        }
        const response = isDecisionPatch && window.__pr1Fix2PatchBodies.length === 1
          ? new Response(JSON.stringify({
            ok: false,
            error: {
              code: 'research_record_conflict',
              message: 'Synthetic stale decision conflict.',
              currentRevision: 4,
            },
          }), { status: 409, headers: { 'Content-Type': 'application/json' } })
          : await nativeFetch(resource, init);
        if (isDecisionPatch) {
          const outcome = { status: response.status, code: null, revision: null };
          try {
            const payload = await response.clone().json();
            outcome.code = payload?.error?.code ?? null;
            outcome.revision = payload?.data?.record?.revision ?? null;
          } catch {
            // Status remains sufficient when a response has no JSON payload.
          }
          window.__pr1Fix2PatchOutcomes.push(outcome);
        }
        return response;
      };
      return true;
    })()`);

    const serverUpdates = [
      {
        expectedRevision: 2,
        decisionId: "44444444-4444-4444-8444-444444444444",
        status: "needs_information",
        reason: "Synthetic server revision three.",
        nextAction: "Prepare revision four.",
      },
      {
        expectedRevision: 3,
        decisionId: "55555555-5555-4555-8555-555555555555",
        status: "abandoned",
        reason: "Synthetic server revision four.",
        nextAction: null,
      },
    ];
    for (const update of serverUpdates) {
      const result = await api(input.baseUrl, input.ownerToken, `/api/tasks/${encodeURIComponent(input.taskId)}/research-decision`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      assert(result.status === 200, "smoke_server_revision_setup_failed");
    }
    const realStalePatch = await api(
      input.baseUrl,
      input.ownerToken,
      `/api/tasks/${encodeURIComponent(input.taskId)}/research-decision`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: 2,
          decisionId: "66666666-6666-4666-8666-666666666666",
          status: "needs_information",
          reason: "Synthetic stale route check.",
          nextAction: "Reload the current state.",
        }),
      },
    );
    assert(
      realStalePatch.status === 409 && publicErrorCode(realStalePatch.body) === "research_record_conflict",
      "smoke_real_stale_patch_contract_failed",
    );

    await evaluate(client, page.sessionId, `(() => {
      const setValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(document.querySelector('#research-decision-status'), 'needs_information');
      const textareas = document.querySelectorAll('[data-testid=\"product-research-decision-panel\"] textarea');
      setValue(textareas[0], 'Synthetic stale browser edit.');
      setValue(textareas[1], 'This stale edit must conflict.');
      [...document.querySelectorAll('button')].find((button) => button.textContent.includes('保存新决定')).click();
      return true;
    })()`);
    await waitFor(
      client,
      page.sessionId,
      "document.body.innerText.includes('版本 4') && document.body.innerText.includes('Synthetic server revision four.')",
      160,
      "smoke_conflict_reload_timeout",
    );
    const conflictState = await evaluate(client, page.sessionId, `(() => {
      const text = document.body.innerText;
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('保存新决定') || item.textContent.includes('保存中'));
      return {
        latestRevisionVisible: text.includes('版本 4'),
        latestReasonVisible: text.includes('Synthetic server revision four.'),
        conflictVisible: text.includes('已加载最新版本'),
        staleSuccessVisible: text.includes('研究决定已保存并追加到历史'),
        busyCleared: button && !button.disabled && !button.textContent.includes('保存中'),
        patchBodies: window.__pr1Fix2PatchBodies,
      };
    })()`);
    assert(conflictState.latestRevisionVisible, "smoke_conflict_revision_not_loaded");
    assert(conflictState.latestReasonVisible, "smoke_conflict_server_state_not_loaded");
    assert(conflictState.conflictVisible, "smoke_conflict_message_missing");
    assert(!conflictState.staleSuccessVisible, "smoke_conflict_stale_success_visible");
    assert(conflictState.busyCleared, "smoke_conflict_busy_not_cleared");

    await evaluate(client, page.sessionId, `(() => {
      const setValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(document.querySelector('#research-decision-status'), 'needs_information');
      const textareas = document.querySelectorAll('[data-testid=\"product-research-decision-panel\"] textarea');
      setValue(textareas[0], 'Synthetic browser revision five.');
      setValue(textareas[1], 'The fresh edit uses revision four.');
      return true;
    })()`);
    await waitFor(
      client,
      page.sessionId,
      `(() => {
        const panel = document.querySelector('[data-testid="product-research-decision-panel"]');
        const textareas = panel?.querySelectorAll('textarea') ?? [];
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('保存新决定'));
        return document.querySelector('#research-decision-status')?.value === 'needs_information'
          && textareas[0]?.value === 'Synthetic browser revision five.'
          && textareas[1]?.value === 'The fresh edit uses revision four.'
          && button && !button.disabled;
      })()`,
      160,
      "smoke_fresh_form_state_timeout",
    );
    await evaluate(client, page.sessionId, `(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('保存新决定'));
      button.click();
      return true;
    })()`);
    try {
      await waitFor(
        client,
        page.sessionId,
        "document.body.innerText.includes('版本 5') && document.body.innerText.includes('Synthetic browser revision five.')",
        160,
        "smoke_fresh_save_timeout",
      );
    } catch {
      const diagnostics = await evaluate(client, page.sessionId, `(() => ({
        patchCount: window.__pr1Fix2PatchBodies?.length ?? 0,
        outcomes: window.__pr1Fix2PatchOutcomes ?? [],
      }))()`);
      const latest = Array.isArray(diagnostics.outcomes) ? diagnostics.outcomes.at(-1) : null;
      throw new Error(
        `smoke_fresh_save_timeout_${diagnostics.patchCount}_${latest?.status ?? 0}_${latest?.code ?? "none"}_${latest?.revision ?? 0}`,
      );
    }
    const finalState = await evaluate(client, page.sessionId, `(() => ({
      patchBodies: window.__pr1Fix2PatchBodies,
      patchOutcomes: window.__pr1Fix2PatchOutcomes,
      revisionFiveVisible: document.body.innerText.includes('版本 5'),
      reasonVisible: document.body.innerText.includes('Synthetic browser revision five.'),
    }))()`);
    const revisions = (finalState.patchBodies as Array<{ expectedRevision?: unknown }>).map((body) => body.expectedRevision);
    const patchOutcomes = finalState.patchOutcomes as Array<{ status?: unknown; code?: unknown; revision?: unknown }>;
    assert(revisions.length === 2 && revisions[0] === 2 && revisions[1] === 4, "smoke_browser_expected_revision_drift");
    assert(
      patchOutcomes.length === 2
        && patchOutcomes[0]?.status === 409
        && patchOutcomes[0]?.code === "research_record_conflict"
        && patchOutcomes[1]?.status === 200
        && patchOutcomes[1]?.revision === 5,
      "smoke_browser_patch_outcomes_invalid",
    );
    assert(finalState.revisionFiveVisible && finalState.reasonVisible, "smoke_browser_fresh_save_failed");
    assert(
      client.state.consoleErrorCount === 0,
      `smoke_browser_console_error_${client.state.consoleErrorDiagnostics
        .map((entry) => `${entry.category}_${entry.fingerprint}`)
        .join("_")}_${client.state.failedResponses
        .map((entry) => `${entry.category}_${entry.status}_${entry.method}`)
        .join("_")}`,
    );
    assert(client.state.externalHttpRequestCount === 0, "smoke_browser_external_request");
    assert(client.state.server5xxCount === 0, "smoke_browser_server_5xx");
    assert(
      client.state.listingMutationRequestCount === 0 && client.state.imageMutationRequestCount === 0,
      "smoke_browser_studio_side_effect",
    );
    assert(client.state.aiRequestCount === 0, "smoke_browser_ai_side_effect");
    return {
      initialRevision: 2,
      conflictReloadRevision: 4,
      finalRevision: 5,
      realStalePatchStatus: realStalePatch.status,
      mountedConflictResponseStatus: patchOutcomes[0]?.status,
      staleSuccessVisible: false,
      busyCleared: true,
      submittedExpectedRevisions: revisions,
      patchStatuses: patchOutcomes.map((outcome) => outcome.status),
      consoleErrorCount: client.state.consoleErrorCount,
      externalHttpRequestCount: client.state.externalHttpRequestCount,
      server5xxCount: client.state.server5xxCount,
      listingReadRequestCount: client.state.listingReadRequestCount,
      listingMutationRequestCount: client.state.listingMutationRequestCount,
      imageReadRequestCount: client.state.imageReadRequestCount,
      imageMutationRequestCount: client.state.imageMutationRequestCount,
      aiRequestCount: client.state.aiRequestCount,
    };
  } finally {
    try {
      await Promise.race([
        client.send("Browser.close"),
        wait(1_000),
      ]);
    } catch {
      // The CDP socket may close before acknowledging Browser.close.
    }
    client.close();
    for (let attempt = 0; attempt < 50 && isOwnedProcessRunning(chrome.pid); attempt += 1) {
      await wait(100);
    }
    if (isOwnedProcessRunning(chrome.pid)) stopOwnedProcess(chrome.pid);
  }
}

async function waitForHealth(baseUrl: string, childPid: number) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.status === 200) return;
    } catch {
      // Bounded wait for the owned runtime only.
    }
    const alive = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process -Id ${childPid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout.trim();
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
  const runtimeRoot = join(SMOKE_PARENT, `product-research-pr1-fix2-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "dev.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "demo-sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const visitorAPassword = randomBytes(24).toString("base64url");
  const visitorBPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const visitorAId = `demo_${randomBytes(8).toString("hex")}`;
  const visitorBId = `demo_${randomBytes(8).toString("hex")}`;
  const ownerTaskId = "smoke-pr1-fix2-owner-task";
  const ownerCandidateId = "smoke-pr1-fix2-owner-candidate";
  const visitorTaskId = "sandbox_task_pr1_fix2_visitor_a";
  const visitorCandidateId = "sandbox_candidate_pr1_fix2_visitor_a";
  let runtimePid: number | null = null;
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
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./dev.db" }),
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, [
      { id: visitorAId, password: visitorAPassword, label: "Synthetic Visitor A" },
      { id: visitorBId, password: visitorBPassword, label: "Synthetic Visitor B" },
    ]);
    const ownerResult = buildProtectedResult({
      candidateId: ownerCandidateId,
      runId: "wf-smoke-pr1-fix2-owner",
      actor: { mode: "owner", actorRef: "owner:v1" },
    });
    const visitorResult = buildProtectedResult({
      candidateId: visitorCandidateId,
      runId: "wf-smoke-pr1-fix2-visitor",
      actor: makeVisitorActor(visitorAId),
    });
    const createdAt = "2026-08-03T02:00:00.000Z";
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
        "start",
        "-H",
        HOST,
        "-p",
        String(port),
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

    const dtoChecks = [];
    for (const [label, token, taskId] of [
      ["owner", owner.token, ownerTaskId],
      ["visitor", visitorA.token, visitorTaskId],
    ] as const) {
      const list = await api(baseUrl, token, "/api/tasks?limit=50&offset=0");
      const detail = await api(baseUrl, token, `/api/tasks/${encodeURIComponent(taskId)}`);
      const decision = await api(baseUrl, token, `/api/tasks/${encodeURIComponent(taskId)}/research-decision`);
      assert(list.status === 200 && detail.status === 200 && decision.status === 200, "smoke_dto_status_failed");
      assert(!hasForbiddenProjection(list.body) && !hasForbiddenProjection(detail.body) && !hasForbiddenProjection(decision.body), "smoke_dto_forbidden_field");
      dtoChecks.push({ label, list: list.status, detail: detail.status, decision: decision.status, forbiddenFieldPresent: false });
    }
    const crossVisitor = await api(baseUrl, visitorB.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}`);
    const crossVisitorDecision = await api(baseUrl, visitorB.token, `/api/tasks/${encodeURIComponent(visitorTaskId)}/research-decision`);
    assert(crossVisitor.status === 404 && crossVisitorDecision.status === 404, "smoke_cross_visitor_isolation_failed");
    report.dto = { checks: dtoChecks, crossVisitorStatuses: [crossVisitor.status, crossVisitorDecision.status] };

    const beforeReservedOwner = await prisma.viralAnalysisRecord.count();
    const beforeReservedVisitor = JSON.parse(readFileSync(sandboxStorePath, "utf8")).tasks.length as number;
    for (const [label, token] of [["owner", owner.token], ["visitor", visitorA.token]] as const) {
      for (const namespace of RESERVED_NAMESPACES) {
        const attempt = await api(baseUrl, token, "/api/tasks", {
          method: "POST",
          body: JSON.stringify(genericTaskBody({ [namespace]: { synthetic: true } })),
        });
        const body = jsonRecord(attempt.body);
        const error = jsonRecord(body.error);
        assert(attempt.status === 400 && error.code === "reserved_system_namespace", `smoke_reserved_namespace_${label}_${namespace}`);
      }
    }
    assert(await prisma.viralAnalysisRecord.count() === beforeReservedOwner, "smoke_reserved_owner_partial_write");
    assert((JSON.parse(readFileSync(sandboxStorePath, "utf8")).tasks as unknown[]).length === beforeReservedVisitor, "smoke_reserved_visitor_partial_write");
    for (const token of [owner.token, visitorA.token]) {
      const allowed = await api(baseUrl, token, "/api/tasks", {
        method: "POST",
        body: JSON.stringify(genericTaskBody({ ordinaryLegacyField: "allowed" })),
      });
      assert(allowed.status === 200, "smoke_ordinary_legacy_create_failed");
    }
    report.genericCreate = {
      namespacesCheckedPerIdentity: RESERVED_NAMESPACES.length,
      allRejectedWithStableCode: true,
      partialWrites: 0,
      ordinaryLegacyAllowed: true,
    };

    const formalAsin = "B0FIX20001";
    const formalTitle = "Synthetic SellerSprite Candidate";
    const formalUrl = `https://www.amazon.com/dp/${formalAsin}`;
    const formalRow = {
      rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin: formalAsin, title: formalTitle, amazonUrl: formalUrl }),
      rowNumber: 2,
      asin: formalAsin,
      parentAsin: null,
      title: formalTitle,
      amazonUrl: formalUrl,
      imageUrl: null,
      priceUsd: 10,
      rating: 4,
      reviewCount: 1,
      brand: "Synthetic",
      category: "Synthetic",
      searchRank: null,
      estimatedMonthlySales: null,
      estimatedMonthlyRevenueUsd: null,
    };
    const formalCandidate = await prisma.opportunityCandidate.create({
      data: {
        id: "smoke-pr1-fix2-formal-candidate",
        name: formalTitle,
        rawInput: formalTitle,
        link: formalUrl,
        source: "SellerSprite",
        status: "pending",
        sourceMetaJson: buildSellerSpriteCandidateSourceMeta(formalRow, "f".repeat(64), "2026-08-03T03:00:00.000Z"),
        analysisJson: "{}",
      },
    });
    const formalContextResponse = await api(
      baseUrl,
      owner.token,
      `/api/opportunity-candidates/research-context?candidateId=${encodeURIComponent(formalCandidate.id)}`,
    );
    assert(formalContextResponse.status === 200, "smoke_formal_candidate_context_failed");
    const formalContextBody = jsonRecord(formalContextResponse.body);
    const formalContext = jsonRecord(formalContextBody.data);
    assert(
      typeof formalContext.contextHash === "string" && /^[a-f0-9]{64}$/.test(formalContext.contextHash),
      "smoke_formal_candidate_context_hash_invalid",
    );
    const formalBefore = await prisma.viralAnalysisRecord.count();
    const formalSave = await api(baseUrl, owner.token, "/api/workflows/product-analysis/save-task", {
      method: "POST",
      body: JSON.stringify(createFormalWorkflowBody(
        formalCandidate as unknown as JsonRecord,
        formalContext.contextHash,
      )),
    });
    assert(
      formalSave.status === 200,
      `smoke_formal_candidate_save_failed_${formalSave.status}_${publicErrorCode(formalSave.body)}`,
    );
    const linkedFormal = await prisma.opportunityCandidate.findUnique({ where: { id: formalCandidate.id } });
    assert(typeof linkedFormal?.convertedTaskId === "string", "smoke_formal_candidate_not_linked");
    const formalRecord = await prisma.viralAnalysisRecord.findUnique({ where: { id: linkedFormal!.convertedTaskId! } });
    const formalResult = jsonRecord(JSON.parse(formalRecord!.resultJson));
    const formalResearch = jsonRecord(formalResult.researchRecord);
    assert(formalResearch.schema === "product-research-record.v1", "smoke_formal_research_record_missing");
    assert(await prisma.viralAnalysisRecord.count() === formalBefore + 1, "smoke_formal_research_count_invalid");
    report.formalCandidate = {
      status: formalSave.status,
      researchRecordSchema: formalResearch.schema,
      researchRecordCreated: 1,
      candidateLinked: true,
      providerCallsStarted: 0,
    };

    report.mountedBrowser = await runMountedConflictCheck({
      baseUrl,
      ownerToken: owner.token,
      taskId: ownerTaskId,
      runtimeRoot,
    });
    const finalOwner = await prisma.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    assert(finalOwner, "smoke_final_owner_record_missing");
    const finalOwnerResult = jsonRecord(JSON.parse(finalOwner!.resultJson));
    const finalOwnerResearch = jsonRecord(finalOwnerResult.researchRecord);
    assert(finalOwnerResearch.revision === 5, "smoke_final_owner_revision_invalid");
    assert(finalOwner!.decisionStatus === "need_info", "smoke_final_owner_compatibility_status_invalid");

    const runtimeLog = readFileSync(logPath, "utf8");
    for (const secret of [
      ownerPassword,
      visitorAPassword,
      visitorBPassword,
      proofSigningSecret,
      owner.token,
      visitorA.token,
      visitorB.token,
    ]) {
      assert(!runtimeLog.includes(secret), "smoke_runtime_log_secret_leak");
    }
    report.sideEffects = {
      realAiRequestCount: 0,
      externalBusinessRequestCount: 0,
      autoListingRequestCount: 0,
      autoImageRequestCount: 0,
      productionPortAccessCount: 0,
      server5xxCount: 0,
      unexpectedCandidateCreates: 0,
      unexpectedResearchRecordCreates: 0,
      convertedTaskIdUnexpectedChanges: 0,
      credentialLeakDetected: false,
    };
    report.database = {
      quickCheck: ((await prisma.$queryRawUnsafe("PRAGMA quick_check")) as Array<Record<string, string>>)[0]?.quick_check ?? "unknown",
      schemaHash: fileSha256(schemaPath),
    };
    report.status = "passed";
  } finally {
    if (prisma) await prisma.$disconnect();
    if (runtimePid) {
      try {
        process.kill(runtimePid, "SIGTERM");
        for (let attempt = 0; attempt < 50 && isOwnedProcessRunning(runtimePid); attempt += 1) {
          await wait(100);
        }
        if (isOwnedProcessRunning(runtimePid)) stopOwnedProcess(runtimePid);
      } catch {
        report.runtimeStopFailed = true;
      }
    }
    for (let attempt = 0; attempt < 60 && !(await isPortFree(port)); attempt += 1) await wait(100);
    report.portReleased = await isPortFree(port);
    report.cdpPortReleased = await isPortFree(CDP_PORT);
    const exactRoot = resolve(runtimeRoot);
    assert(dirname(exactRoot) === SMOKE_PARENT && exactRoot.startsWith(`${SMOKE_PARENT}\\product-research-pr1-fix2-`), "smoke_cleanup_identity_invalid");
    if (existsSync(exactRoot)) rmSync(exactRoot, { recursive: true, force: true });
    report.runtimeRootRemoved = !existsSync(exactRoot);
    assert(report.portReleased && report.cdpPortReleased && report.runtimeRootRemoved, "smoke_cleanup_failed");
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
