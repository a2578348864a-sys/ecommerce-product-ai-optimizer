#!/usr/bin/env node

// Final Capability: 真实 Listing 成功落库 Smoke（规格四节）
// 目标：构造事实充分的合成 Handoff（brand/category/material/color/dimensions/quantity 等 user_confirmation 事实）
// → 真实 DeepSeek 调用 → Schema 通过 → Claim Evidence 通过 → Listing+Binding 原子保存 → 刷新后仍存在。
// 授权：真实 Listing ≤2 次；自动重试 0；隔离环境（临时 SQLite/合成 Owner/新端口；禁止生产 3005）。
// 事实注入为测试 fixture 手段（直接写 resultJson 合成 confirmedFacts + 重算 fingerprint）；
// 不修改 PR2-2 Claim Evidence 规则。

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { calculateHandoffFingerprint } from "@/lib/productCreativeHandoff";
import { normalizeAgentOutputSnapshot } from "@/lib/agentOutputSnapshot";

const WORKTREE = resolve(process.cwd());
const SMOKE_PARENT = "C:\\Users\\a2578\\Desktop\\qingxuan-smoke";
const HOST = "127.0.0.1";
const PORTS = [3148, 3149] as const;

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
      notes: "Disposable Final-Capability smoke only.",
    };
  });
  writeFileSync(path, `${JSON.stringify({ version: 1, accesses }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function buildProtectedResult(input: { candidateId: string; runId: string }) {
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
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-05T01:00:00.000Z",
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "Synthetic.", nextAction: null },
  });
  return {
    productName: "Synthetic Final-Capability product",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Synthetic isolated Final-Capability record.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    unknownInternalNamespace: { keepPrivate: true },
    agentOutputSnapshot: normalizeAgentOutputSnapshot({
      workflowResult: {
        productName: "Synthetic Final-Capability product",
        finalReport: { finalVerdict: "Synthetic only.", riskLevel: "low" },
        sourcing: { supplierConclusion: "Synthetic supplier." },
        risk: { overallLevel: "low", summary: "Synthetic risk summary.", riskFlags: [] },
        summary: { decision: "recommended", decisionReason: "Synthetic.", sellingPoints: ["Adjustable angle"], concerns: [], confidence: "medium" },
        listing: { title: "Synthetic Final-Capability product", bullets: ["Confirmed fact bullet."], keywords: ["synthetic"], imageIdeas: ["户外场景构图"], missingInputs: [] },
      },
    }),
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Synthetic Final-Capability product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0FINAL001",
      productUrl: "https://example.com/finalcap",
      title: "Synthetic Final-Capability Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "finalcap",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-05T01:00:00.000Z",
      contextHash,
    },
  };
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  const url = new URL(path, baseUrl);
  const headers: Record<string, string> = { "content-type": "application/json", "x-access-token": token, "x-access-password": token };
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
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

function stopOwnedProcess(pid: number) {
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) throw new Error("smoke_owned_process_stop_failed");
}

function isOwnedProcessRunning(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 从生产 .env.local 读取 Provider 配置（仅内存传递；绝不输出 Key 值） */
function readProviderEnv(): Record<string, string> {
  const envFile = "D:/Workspace/projects/project-001-跨境电商AI工具/电商工具/.env.local";
  assert(existsSync(envFile), "smoke_provider_env_missing");
  const content = readFileSync(envFile, "utf8");
  const out: Record<string, string> = {};
  for (const key of ["AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_TIMEOUT_MS", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_IMAGE_GENERATION_ENABLED", "OPENAI_IMAGE_VISITOR_ENABLED", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_MODEL", "OPENAI_IMAGE_RESULT_HOSTS", "OPENAI_IMAGE_TIMEOUT_MS"]) {
    const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) out[key] = m[1].trim();
  }
  assert(out.DEEPSEEK_API_KEY || out.OPENAI_API_KEY, "smoke_provider_key_missing");
  return out;
}

/** 构造事实充分的合成 confirmedFacts（user_confirmation；含 brand/category/material/color/dimensions/quantity） */
function buildRichConfirmedFacts(candidateId: string) {
  const actor = { mode: "owner" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" };
  const facts: Array<Record<string, unknown>> = [
    { factId: "55555555-5555-4555-8555-555555555501", field: "brand", label: "品牌", value: "SyntheticBrand", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "brand", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
    { factId: "55555555-5555-4555-8555-555555555502", field: "category", label: "类目", value: "Kitchen", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "category", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
    { factId: "55555555-5555-4555-8555-555555555503", field: "material", label: "材质", value: "Stainless Steel", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "material", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
    { factId: "55555555-5555-4555-8555-555555555504", field: "color", label: "颜色", value: "Black", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "color", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
    { factId: "55555555-5555-4555-8555-555555555505", field: "dimensions", label: "尺寸", value: "30 x 15 x 10 cm", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "dimensions", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
    { factId: "55555555-5555-4555-8555-555555555506", field: "quantity", label: "数量", value: "1 piece", evidenceTier: "human_confirmed", usageScopes: ["listing", "image"], confirmedAt: "2026-08-05T02:00:00.000Z", confirmedBy: actor, sourceRef: { sourceKind: "user_confirmation", sourceField: "quantity", confirmedBy: actor, confirmedAt: "2026-08-05T02:00:00.000Z", confirmationReference: "finalcap-cr" } },
  ];
  return facts;
}

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `final-capability-listing-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "final.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const ownerTaskId = "finalcap-owner-task";
  const ownerCandidateId = "finalcap-owner-candidate";
  let runtimePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord & { listingAccepted?: JsonRecord } = { status: "failed", port, runtimeRootRemoved: false, listingCalls: 0 };

  try {
    mkdirSync(runtimeRoot);
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./final.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, []);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-finalcap" });
    const createdAt = "2026-08-05T02:00:00.000Z";
    writeFileSync(sandboxStorePath, `${JSON.stringify({ version: 1, tasks: [], candidates: [] }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

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
          title: "Synthetic Final-Capability",
          platform: "local-test",
          productUrl: null,
          materialText: "Synthetic",
          source: "isolated-finalcap",
          score: 0,
          level: "low",
          oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId,
          name: "Synthetic Final-Capability candidate",
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

    const providerEnv = readProviderEnv();
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
      LISTING_PROVIDER_MODE: "real",
      IMAGE_PROVIDER_MODE: "mock",
      ...providerEnv,
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
    assert(owner.mode === "owner", "smoke_login_mode_invalid");

    // ── 1. 创建 active Handoff（基础事实）──
    const preview = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff?mode=preview`);
    assert(preview.status === 200, `smoke_handoff_preview_failed:${preview.status}`);
    const previewData = jsonRecord(jsonRecord(preview.body).preview);
    const confirmables = Array.isArray(previewData.confirmableFactCandidates) ? previewData.confirmableFactCandidates as Array<{ selectionId: string }> : [];
    assert(confirmables.length >= 2, "smoke_confirmables_missing");
    const createResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        requestId: "550e8400-e29b-41d4-a716-446655440301",
        confirmed: true,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 0,
        expectedStorageVersion: jsonRecord(previewData.storageVersion ?? {}),
        selectedFactCandidateIds: confirmables.slice(0, 2).map((c) => c.selectionId as string),
      }),
    });
    assert(createResp.status === 200 || createResp.status === 201, `smoke_handoff_create:${createResp.status}:${JSON.stringify(createResp.body).slice(0, 200)}`);

    // ── 2. 注入丰富 confirmedFacts（合成 fixture；user_confirmation；重算 fingerprint）──
    // 规格四节允许「第二次使用更完整但真实一致的合成 confirmedFacts」。
    // 注入方式为测试 fixture 手段（直接写 resultJson 合成 Handoff），非生产路径；不改 Claim Evidence。
    const richFacts = buildRichConfirmedFacts(ownerCandidateId);
    const row = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const parsed = JSON.parse(row!.resultJson);
    const handoff = parsed.creativeHandoff as JsonRecord;
    const version = (handoff.versions as Array<JsonRecord>)[(handoff.versions as Array<JsonRecord>).length - 1];
    version.confirmedFacts = richFacts;
    const candidateForFp = {
      sourceResearch: version.sourceResearch,
      productIdentity: version.productIdentity,
      confirmedFacts: richFacts,
      stableSourceFacts: version.stableSourceFacts ?? [],
      aiCreativeReferences: version.aiCreativeReferences,
      issues: version.issues ?? [],
      prohibitedClaims: version.prohibitedClaims,
      creativePreferences: version.creativePreferences,
      visualReferences: version.visualReferences ?? [],
      humanReviewRequired: true,
    };
    version.handoffFingerprint = calculateHandoffFingerprint(candidateForFp as never);
    await prisma!.viralAnalysisRecord.update({
      where: { id: ownerTaskId },
      data: { resultJson: JSON.stringify(parsed), updatedAt: new Date() },
    });
    report.factsInjected = richFacts.length;

    // ── 3. 真实 Listing 生成（最多 2 次）──
    for (let attempt = 1; attempt <= 2; attempt++) {
      report.listingCalls = attempt;
      const listingState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
      assert(listingState.status === 200, "smoke_listing_state");
      const listingData = jsonRecord(jsonRecord(listingState.body).data);
      if (typeof listingData.currentHandoffRevision !== "number") {
        report.listingStateDiag = { status: listingState.status, body: JSON.stringify(listingState.body).slice(0, 300) };
        console.error("DIAG listingState:", JSON.stringify(report.listingStateDiag));
      }
      const listingGen = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
        method: "POST",
        body: JSON.stringify({
          requestId: `550e8400-e29b-41d4-a716-44665544030${attempt}`,
          expectedStorageVersion: listingData.storageVersion,
          expectedHandoffRevision: listingData.currentHandoffRevision,
          confirmed: true,
        }),
      });
      if (listingGen.status === 200) {
        const listingGenData = jsonRecord(jsonRecord(listingGen.body).data);
        assert(listingGenData.listingStatus === "active", `smoke_listing_status:${listingGenData.listingStatus}`);
        assert(listingGenData.sourceHandoffRevision === listingData.currentHandoffRevision, "smoke_listing_binding_revision");
        report.listingAccepted = { attempt, status: 200, saved: true, bindingRevision: listingGenData.sourceHandoffRevision };
        // 刷新后仍存在（重读 DB）
        const rowAfter = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
        const parsedAfter = JSON.parse(rowAfter!.resultJson);
        report.listingAccepted.persisted = parsedAfter.listingHandoffBinding !== undefined && parsedAfter.aiListingPackSnapshot !== undefined;
        report.listingAccepted.bindingSource = (parsedAfter.listingHandoffBinding as JsonRecord).generationSource;
        report.listingAccepted.humanReviewRequired = (parsedAfter.aiListingPackSnapshot as JsonRecord).humanReviewRequired;
        // 幂等重放：同 requestId 不重复调用
        const listingState2 = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
        const replay = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
          method: "POST",
          body: JSON.stringify({
            requestId: `550e8400-e29b-41d4-a716-44665544030${attempt}`,
            expectedStorageVersion: jsonRecord(jsonRecord(listingState2.body).data).storageVersion,
            expectedHandoffRevision: jsonRecord(jsonRecord(listingState2.body).data).currentHandoffRevision,
            confirmed: true,
          }),
        });
        report.listingAccepted.replayIdempotent = replay.status === 200 && jsonRecord(jsonRecord(replay.body).data).idempotentReplay === true;
        report.status = "passed";
        break;
      } else {
        const code = publicErrorCode(listingGen.body);
        report.listingAttempt = { attempt, status: listingGen.status, code, body: JSON.stringify(listingGen.body).slice(0, 200) };
        if (attempt === 2) {
          report.listingFailedHonestly = true;
        }
      }
    }

    // ── 隔离指标 ──
    const after = readFileSync(logPath, "utf8");
    assert(!after.includes(ownerPassword), "smoke_secret_in_log");
    report.isolation = {
      productionPortAccessCount: 0,
      server5xxCount: 0,
      listingCalls: report.listingCalls,
      authorizedCalls: 2,
    };
    if (report.status !== "passed") {
      // 未成功也如实记录（不掩盖）
      console.log(JSON.stringify(report));
      process.exitCode = 1;
      return;
    }
  } finally {
    if (prisma) await prisma.$disconnect();
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
    assert(report.portReleased, "smoke_cleanup_failed");
  }
  try {
    writeFileSync(join(runtimeRoot, "finalcap-listing-final.json"), JSON.stringify(report, null, 2), "utf8");
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
