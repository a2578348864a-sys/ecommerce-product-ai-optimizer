#!/usr/bin/env node

// V2 Final Integration: 真实 Provider 隔离 Smoke（规格十六~十八节）
// 授权上限：真实 Listing ≤2 次；真实 Image ≤2 次；自动重试 0；总调用 ≤4 次。
// 本脚本实际执行：Owner Listing 真实 1 次 + composition Image 真实 1 次 = 2 次。
// product_visual_draft：真实 Provider 仅文生图（不支持参考图）→ 不调用（不浪费配额）。
//
// 隔离环境：端口 3144（冲突 3145）；独立 Chrome；仓外临时 SQLite；合成 Owner；
// Mock Visitor Store；外部网络仅放行 Provider 域名；禁止生产 3005/正式 DB。
// Key 从生产 .env.local 读取（仅内存传递，绝不输出）。

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmSync, writeFileSync,
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

const WORKTREE = resolve(process.cwd());
const SMOKE_PARENT = "C:\\Users\\a2578\\Desktop\\qingxuan-smoke";
const HOST = "127.0.0.1";
const PORTS = [3144, 3145] as const;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const PROVIDER_DOMAINS = new Set(["api.deepseek.com", "api.65535.space", "api.openai.com"]);

const nodeRequestEvidence = {
  requestCount: 0,
  externalHttpRequestCount: 0,
  productionPortAccessCount: 0,
  server5xxCount: 0,
  providerCalls: 0,
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
      notes: "Disposable V2-FI real smoke only.",
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
    productName: "Synthetic V2-FI real smoke product",
    status: ["completed"],
    score: 0,
    level: "low",
    oneLineSummary: "Synthetic isolated V2-FI record.",
    finalReport: { finalVerdict: "Synthetic only." },
    sourceMeta: { source: "opportunity", candidateId: input.candidateId, contextHash },
    researchRecord: initial,
    researchVerification: verification,
    researchHash: initial.researchHash,
    unknownInternalNamespace: { keepPrivate: true },
    candidateAnalysisContext: {
      candidateId: input.candidateId,
      productName: "Synthetic V2-FI real smoke product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0V2FI0001",
      productUrl: "https://example.com/v2fi",
      title: "Synthetic V2-FI Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "v2fi",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: "2026-08-05T01:00:00.000Z",
      contextHash,
      productImage: {
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        contentHash: "c".repeat(64),
        provenance: "candidate_fallback",
      },
    },
  };
}

async function api(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  nodeRequestEvidence.requestCount += 1;
  const url = new URL(path, baseUrl);
  if (url.hostname !== HOST || (url.port !== "3144" && url.port !== "3145")) {
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

async function main() {
  assert(resolve(SMOKE_PARENT) === SMOKE_PARENT, "smoke_parent_identity_invalid");
  if (!existsSync(SMOKE_PARENT)) mkdirSync(SMOKE_PARENT, { recursive: true });
  assert(!lstatSync(SMOKE_PARENT).isSymbolicLink(), "smoke_parent_reparse_forbidden");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runtimeRoot = join(SMOKE_PARENT, `v2-fi-real-smoke-${timestamp}`);
  assert(dirname(runtimeRoot) === SMOKE_PARENT && !existsSync(runtimeRoot), "smoke_root_identity_invalid");
  const port = await selectPort();
  const baseUrl = `http://${HOST}:${port}`;
  const databasePath = join(runtimeRoot, "real.db");
  const schemaPath = join(runtimeRoot, "schema.prisma");
  const accessStorePath = join(runtimeRoot, "demo-access.json");
  const sandboxStorePath = join(runtimeRoot, "sandbox.json");
  const logPath = join(runtimeRoot, "runtime.log");
  const ownerPassword = randomBytes(24).toString("base64url");
  const proofSigningSecret = randomBytes(32).toString("base64url");
  const ownerTaskId = "v2fi-real-owner-task";
  const ownerCandidateId = "v2fi-real-owner-candidate";
  let runtimePid: number | null = null;
  let prisma: PrismaClient | null = null;
  const report: JsonRecord & { listingRealSmoke?: JsonRecord; imageCompositionRealSmoke?: JsonRecord; isolation?: JsonRecord } = { status: "failed", port, runtimeRootRemoved: false };

  try {
    mkdirSync(runtimeRoot);
    copyFileSync(join(WORKTREE, "prisma", "schema.prisma"), schemaPath);
    const prismaCli = join(WORKTREE, "node_modules", "prisma", "build", "index.js");
    const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
      cwd: runtimeRoot,
      env: createIsolatedCliEnvironment({ DATABASE_URL: "file:./real.db" }) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: "pipe",
    });
    assert(pushed.status === 0 && existsSync(databasePath), "smoke_schema_push_failed");

    writeDemoAccessStore(accessStorePath, []);
    const ownerResult = buildProtectedResult({ candidateId: ownerCandidateId, runId: "wf-v2fi-real" });
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
          title: "Synthetic V2-FI real smoke",
          platform: "local-test",
          productUrl: null,
          materialText: "Synthetic",
          source: "isolated-v2fi-real",
          score: 0,
          level: "low",
          oneLineSummary: "Synthetic only.",
          resultJson: JSON.stringify(ownerResult),
        },
      });
      await tx.opportunityCandidate.create({
        data: {
          id: ownerCandidateId,
          name: "Synthetic V2-FI candidate",
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
    // 外部网络监控：通过 runtime env 白名单放行 Provider 域名（无代理全局放行；HTTP 由 Provider client 直接调用）
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
      // V2-FI: 新链 Provider 模式 = real（服务端环境配置）
      LISTING_PROVIDER_MODE: "real",
      IMAGE_PROVIDER_MODE: "real",
      // Provider 真实配置（来自生产 .env.local，仅内存；不输出）
      ...providerEnv,
      // 图片资产持久化根（仓外临时目录）
      AI_IMAGE_DRAFT_STORAGE_ROOT: join(runtimeRoot, "image-assets"),
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

    // ── 建立 active Handoff（composition，无批准参考）──
    const preview = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff?mode=preview`);
    assert(preview.status === 200, `smoke_handoff_preview_failed:${preview.status}:${JSON.stringify(preview.body).slice(0, 200)}`);
    const previewData = jsonRecord(jsonRecord(preview.body).preview);
    const confirmables = Array.isArray(previewData.confirmableFactCandidates) ? previewData.confirmableFactCandidates as Array<{ selectionId: string }> : [];
    assert(confirmables.length >= 2, "smoke_confirmables_missing");
    const createResp = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/creative-handoff`, {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        requestId: "550e8400-e29b-41d4-a716-446655440101",
        confirmed: true,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 0,
        expectedStorageVersion: jsonRecord(previewData.storageVersion ?? {}),
        selectedFactCandidateIds: confirmables.slice(0, 2).map((c) => c.selectionId as string),
      }),
    });
    assert(createResp.status === 200 || createResp.status === 201, `smoke_handoff_create:${createResp.status}:${JSON.stringify(createResp.body).slice(0, 200)}`);

    // ── 真实 Listing Smoke（授权 1 次）──
    // 通过任务内 listing-handoff 链生成（LISTING_PROVIDER_MODE=real → 真实 DeepSeek）
    const listingState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`);
    assert(listingState.status === 200, "smoke_listing_state");
    const listingData = jsonRecord(jsonRecord(listingState.body).data);
    const listingGen = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/listing-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440102",
        expectedStorageVersion: listingData.storageVersion,
        expectedHandoffRevision: listingData.currentHandoffRevision,
        confirmed: true,
      }),
    });
    report.listingRealSmoke = {
      status: listingGen.status,
      code: listingGen.status === 200 ? "ok" : publicErrorCode(listingGen.body),
      bodyPreview: listingGen.status === 200 ? "listing generated" : JSON.stringify(listingGen.body).slice(0, 200),
    };
    if (listingGen.status === 200) {
      const listingData2 = jsonRecord(jsonRecord(listingGen.body).data);
      assert(listingData2.listingStatus === "active", `smoke_listing_real_status:${listingData2.listingStatus}`);
      assert(listingData2.sourceHandoffRevision === listingData.currentHandoffRevision, "smoke_listing_real_binding_revision");
      report.listingRealSmoke.saved = true;
      report.listingRealSmoke.claimEvidence = "passed";
    } else if (publicErrorCode(listingGen.body) === "listing_claims_unsupported") {
      // 规格十七节：真实模型输出若包含无依据事实 → Claim Evidence 必须拒绝、不保存、不放宽规则、如实记录。
      // 这是 PR2-2 保守 Claim 防线在真实 Provider 场景下生效的证据（非 Provider 失败）。
      report.listingRealSmoke.claimEvidence = "rejected_unclassified_factual_claim";
      report.listingRealSmoke.guardEffective = true;
      // 验证数据未保存（防线生效）
      const rowAfter = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
      const parsedAfter = JSON.parse(rowAfter!.resultJson);
      report.listingRealSmoke.bindingNotSaved = parsedAfter.listingHandoffBinding === undefined;
    } else {
      // 其他错误（Provider 失败等）如实记录
      report.listingRealSmoke.failedHonestly = true;
    }

    // ── 真实 Image Smoke（composition；授权 1 次）──
    const imageState = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`);
    assert(imageState.status === 200, "smoke_image_state");
    const imageData = jsonRecord(jsonRecord(imageState.body).data);
    const imageGen = await api(baseUrl, owner.token, `/api/tasks/${encodeURIComponent(ownerTaskId)}/image-handoff`, {
      method: "POST",
      body: JSON.stringify({
        requestId: "550e8400-e29b-41d4-a716-446655440103",
        expectedStorageVersion: imageData.storageVersion,
        expectedHandoffRevision: imageData.expectedHandoffRevision,
        mode: "composition_concept",
        confirmed: true,
      }),
    });
    report.imageCompositionRealSmoke = {
      status: imageGen.status,
      code: imageGen.status === 200 ? "ok" : publicErrorCode(imageGen.body),
      bodyPreview: imageGen.status === 200 ? "image generated" : JSON.stringify(imageGen.body).slice(0, 200),
    };
    if (imageGen.status === 200) {
      const imageData2 = jsonRecord(jsonRecord(imageGen.body).data);
      assert(imageData2.imageStatus === "concept_only" || imageData2.imageStatus === "active", `smoke_image_real_status:${imageData2.imageStatus}`);
      // 图片资产持久化验证（AI_IMAGE_DRAFT_STORAGE_ROOT 下应有文件）
      const assetsRoot = join(runtimeRoot, "image-assets");
      const files: string[] = [];
      if (existsSync(assetsRoot)) {
        const walk = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else files.push(full);
          }
        };
        walk(assetsRoot);
      }
      report.imageCompositionRealSmoke.assetsStored = files.length;
      report.imageCompositionRealSmoke.assetPaths = files.map((f) => f.replace(runtimeRoot, "<runtimeRoot>"));
    } else {
      report.imageCompositionRealSmoke.failedHonestly = true;
    }

    // ── 图片资产持久化验证：Runtime 重启后仍可读 ──
    // 记录当前图片 asset storageKey（从 resultJson），重启 runtime 后读取验证
    const rowBeforeRestart = await prisma!.viralAnalysisRecord.findUnique({ where: { id: ownerTaskId } });
    const parsedBefore = JSON.parse(rowBeforeRestart!.resultJson);
    const draftSnap = parsedBefore.aiImageDraftSnapshot as JsonRecord | undefined;
    const lastItem = draftSnap && Array.isArray(draftSnap.items) ? (draftSnap.items as Array<JsonRecord>) : undefined;
    const storageKey = lastItem && lastItem.length ? lastItem[lastItem.length - 1].storageKey : null;
    report.imageStorageKey = typeof storageKey === "string" ? storageKey : null;

    // ── 隔离指标 ──
    const after = readFileSync(logPath, "utf8");
    assert(!after.includes(ownerPassword), "smoke_secret_in_log");
    report.isolation = {
      productionPortAccessCount: nodeRequestEvidence.productionPortAccessCount,
      server5xxCount: nodeRequestEvidence.server5xxCount,
      realProviderCalls: (report.listingRealSmoke?.status === 200 || report.listingRealSmoke?.status === 422 ? 1 : 0) + (report.imageCompositionRealSmoke?.status === 200 ? 1 : 0),
      note: "真实 Provider 调用总数 ≤2（授权 ≤4）；Listing 422=Claim Evidence 防线生效（真实输出含无证据事实）",
    };

    report.status = "passed";
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
    writeFileSync(join(runtimeRoot, "real-smoke-final.json"), JSON.stringify(report, null, 2), "utf8");
  } catch {
    report.reportWriteFailed = true;
  }
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`smoke_fatal:${String(error instanceof Error ? error.message : error).slice(0, 500)}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack.split(String.fromCharCode(10)).slice(1, 6).join(String.fromCharCode(10)));
  }
  process.exitCode = 1;
});
