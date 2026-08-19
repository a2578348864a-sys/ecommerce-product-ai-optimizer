/**
 * V3 UX Closure — Fact Candidate API 测试（批量确认 + 隔离 + fail-closed）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask, updateSandboxTaskResultJson } from "@/lib/server/demoSandbox";
import { GET, POST } from "./route";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3u-fact-candidates-route");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const authState: { context: { mode: "demo"; demoAccessId: string } | { mode: "owner" } } = {
  context: { mode: "demo", demoAccessId: "demo-access-a" },
};

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: authState.context }),
  requireOwnerOnly: () => ({ ok: true, context: authState.context }),
}));

const DEMO = "demo-access-a";
let taskId = "";

function thermosResultJson(): Record<string, unknown> {
  return {
    productName: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
    candidateAnalysisContext: {
      schema: "candidate-analysis-context-v1",
      facts: {
        productFacts: {
          productTitle: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
          brand: "THERMOS",
          price: 19.99,
          rating: 4.7,
          reviews: 48110,
          rootCategory: "Kitchen & Dining",
          rootCategoryBsr: 9,
        },
      },
    },
  };
}

function toStorageVersion() {
  const task = getSandboxTask(DEMO, taskId);
  if (!task) throw new Error("task missing");
  return {
    resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
    updatedAt: task.updatedAt,
  };
}

async function postJson(body: unknown) {
  const request = new NextRequest("http://localhost/api/tasks/x/fact-candidates", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": "tok-a" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: taskId }) });
}

async function getJson() {
  const request = new NextRequest("http://localhost/api/tasks/x/fact-candidates", {
    headers: { "x-access-token": "tok-a" },
  });
  return GET(request, { params: Promise.resolve({ id: taskId }) });
}

beforeEach(async () => {
  authState.context = { mode: "demo", demoAccessId: DEMO };
  const task = await createTrustedSandboxTask(DEMO, {
    title: "THERMOS Demo",
    resultJson: JSON.stringify(thermosResultJson()),
  });
  taskId = task.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /fact-candidates", () => {
  it("提取候选：brand/capacity/category 等确定性字段（不含 VOC/AI/供应商声称）", async () => {
    const response = await getJson();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const fields = body.data.candidates.map((c: { field: string }) => c.field);
    expect(fields).toContain("brand");
    expect(fields).toContain("capacity");
    expect(fields).toContain("category");
    expect(fields).not.toContain("voc_theme");
    expect(body.data.confirmed).toEqual([]);
  });
});

describe("POST /fact-candidates（批量人工确认）", () => {
  it("确认 2 项候选 → confirmedCount=2；再次 GET 候选减少、confirmed 保留来源", async () => {
    const get1 = await (await getJson()).json();
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const capacity = get1.data.candidates.find((c: { field: string }) => c.field === "capacity");
    const post = await postJson({
      selections: [
        { candidateId: brand.candidateId, confirmed: true, value: "THERMOS" },
        { candidateId: capacity.candidateId, confirmed: true, value: "12oz" },
      ],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(post.status).toBe(200);
    const postBody = await post.json();
    expect(postBody.ok).toBe(true);
    expect(postBody.data.confirmedCount).toBe(2);

    const get2 = await (await getJson()).json();
    const remainingFields = get2.data.candidates.map((c: { field: string }) => c.field);
    expect(remainingFields).not.toContain("brand");
    expect(remainingFields).not.toContain("capacity");
    const confirmedFields = get2.data.confirmed.map((c: { field: string }) => c.field);
    expect(confirmedFields).toContain("brand");
    expect(confirmedFields).toContain("capacity");
    const confirmedBrand = get2.data.confirmed.find((c: { field: string }) => c.field === "brand");
    expect(confirmedBrand.sourceKind).toBe("seller_sprite_product_facts");
    expect(confirmedBrand.confirmedBy).toBe("visitor:demo-access-a");
  });

  it("确认不存在于候选列表的项 → 409 fact_conflict（fail-closed，禁止伪造来源）", async () => {
    const post = await postJson({
      selections: [{ candidateId: "fake:field", confirmed: true, value: "x" }],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(post.status).toBe(409);
    const body = await post.json();
    expect(body.error.code).toBe("fact_conflict");
    expect(body.error.conflicts[0].reason).toBe("candidate_missing");
  });

  // ── V3 Final HWF：Safe Rebase / Partial Conflict / 幂等 / Selection Preservation ──

  it("UNRELATED_TASK_UPDATE：无关 namespace 更新 → 候选 fingerprint 未变 → 批量确认仍成功（FALSE_CONFLICT 消除）", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const capacity = get1.data.candidates.find((c: { field: string }) => c.field === "capacity");
    // 无关更新：其他 writer 的 namespace（aiEvidenceSummary）变化 → resultJson hash 变
    const task = getSandboxTask(DEMO, taskId);
    const rj = JSON.parse(task!.resultJson);
    rj.aiEvidenceSummary = { schema: "ai-evidence-summary.v1", version: 1, summary: "x" };
    await updateSandboxTaskResultJson(DEMO, taskId, JSON.stringify(rj));

    const post = await postJson({
      selections: [
        { candidateId: brand.candidateId, confirmed: true, value: "THERMOS" },
        { candidateId: capacity.candidateId, confirmed: true, value: "12oz" },
      ],
      expectedStorageVersion: svOld, // 过期版本 → Safe Rebase
    });
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.ok).toBe(true);
    expect(body.data.confirmedCount).toBe(2);
    expect(body.data.conflicts).toEqual([]);

    const get2 = await (await getJson()).json();
    expect(get2.data.confirmed.map((c: { field: string }) => c.field)).toEqual(
      expect.arrayContaining(["brand", "capacity"]),
    );
  });

  it("SAFE_REBASE_ONCE：候选未变 → 旧版本冲突自动重试成功（用户无感，仅 1 次）", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    // 先确认另一条 → 版本变化（模拟其他区域更新）
    await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: svOld,
    });
    const get2 = await (await getJson()).json();
    const capacity = get2.data.candidates.find((c: { field: string }) => c.field === "capacity");
    // 用旧版本确认 capacity（候选未变）→ Safe Rebase 自动成功
    const post = await postJson({
      selections: [{ candidateId: capacity.candidateId, confirmed: true, value: "12oz" }],
      expectedStorageVersion: svOld,
    });
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.data.confirmedCount).toBe(1);
    expect(body.data.conflicts).toEqual([]);
    const get3 = await (await getJson()).json();
    expect(get3.data.confirmed.map((c: { field: string }) => c.field)).toContain("capacity");
  });

  it("REAL_CANDIDATE_CHANGE：候选值被其他操作改变 + 提交旧值（无 edited）→ 409 fact_conflict（value_changed），不自动确认", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const task = getSandboxTask(DEMO, taskId);
    const rj = JSON.parse(task!.resultJson);
    rj.candidateAnalysisContext.facts.productFacts.brand = "THERMOS Inc"; // 候选值变化
    await updateSandboxTaskResultJson(DEMO, taskId, JSON.stringify(rj));

    const post = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: svOld,
    });
    expect(post.status).toBe(409);
    const body = await post.json();
    expect(body.error.code).toBe("fact_conflict");
    expect(body.error.conflicts).toHaveLength(1);
    expect(body.error.conflicts[0].reason).toBe("value_changed");
    // fail-closed：未写入任何确认
    const get2 = await (await getJson()).json();
    expect(get2.data.confirmed).toEqual([]);
  });

  it("用户显式修改值（edited=true）→ 尊重用户值（Human Review CORRECT），不视为冲突", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const task = getSandboxTask(DEMO, taskId);
    const rj = JSON.parse(task!.resultJson);
    rj.candidateAnalysisContext.facts.productFacts.brand = "THERMOS Inc"; // 候选值变化
    await updateSandboxTaskResultJson(DEMO, taskId, JSON.stringify(rj));

    const post = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS Pro", edited: true }],
      expectedStorageVersion: svOld,
    });
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.data.confirmedCount).toBe(1);
    const get2 = await (await getJson()).json();
    expect(get2.data.confirmed.find((c: { field: string }) => c.field === "brand").value).toBe("THERMOS Pro");
  });

  it("PARTIAL_CONFLICT：4 选 1 值变化 → 3 条成功确认 + 1 条返回复核（不整批清空）", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const byField = new Map(get1.data.candidates.map((c: { field: string }) => [c.field, c]));
    const picks = ["brand", "capacity", "category", "price"];
    for (const field of picks) expect(byField.has(field)).toBe(true);
    const task = getSandboxTask(DEMO, taskId);
    const rj = JSON.parse(task!.resultJson);
    rj.candidateAnalysisContext.facts.productFacts.price = 29.99; // price 候选值变化
    await updateSandboxTaskResultJson(DEMO, taskId, JSON.stringify(rj));

    const post = await postJson({
      selections: picks.map((field) => {
        const c = byField.get(field) as { candidateId: string; value: string | number };
        return { candidateId: c.candidateId, confirmed: true, value: String(c.value) };
      }),
      expectedStorageVersion: svOld,
    });
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.data.confirmedCount).toBe(3);
    expect(body.data.conflicts).toHaveLength(1);
    expect(body.data.conflicts[0].reason).toBe("value_changed");
    expect(body.data.conflicts[0].candidateId).toBe((byField.get("price") as { candidateId: string }).candidateId);

    const get2 = await (await getJson()).json();
    const confirmedFields = get2.data.confirmed.map((c: { field: string }) => c.field);
    expect(confirmedFields).toEqual(expect.arrayContaining(["brand", "capacity", "category"]));
    expect(confirmedFields).not.toContain("price");
  });

  it("CANDIDATE_MISSING：候选被删除 → 409 fact_conflict（candidate_missing），fail-closed", async () => {
    const get1 = await (await getJson()).json();
    const svOld = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const task = getSandboxTask(DEMO, taskId);
    const rj = JSON.parse(task!.resultJson);
    delete rj.candidateAnalysisContext.facts.productFacts.brand; // 候选消失
    await updateSandboxTaskResultJson(DEMO, taskId, JSON.stringify(rj));

    const post = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: svOld,
    });
    expect(post.status).toBe(409);
    const body = await post.json();
    expect(body.error.conflicts[0].reason).toBe("candidate_missing");
    const get2 = await (await getJson()).json();
    expect(get2.data.confirmed).toEqual([]);
  });

  it("IDEMPOTENT_BATCH：重复提交同值 batch → alreadyConfirmed，不重复写入、不 bump 版本（不触发 Stale）", async () => {
    const get1 = await (await getJson()).json();
    const sv = get1.data.storageVersion;
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    const post1 = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: sv,
    });
    expect(post1.status).toBe(200);
    const svAfter1 = (await (await getJson()).json()).data.storageVersion;

    // 重复同值 batch（模拟网络重试/双击）→ 幂等
    const post2 = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: svAfter1,
    });
    expect(post2.status).toBe(200);
    const b2 = await post2.json();
    expect(b2.data.confirmedCount).toBe(0);
    expect(b2.data.alreadyConfirmedCount).toBe(1);

    // 版本未 bump（updatedAt / hash 不变）
    const svAfter2 = (await (await getJson()).json()).data.storageVersion;
    expect(svAfter2.updatedAt).toBe(svAfter1.updatedAt);
    expect(svAfter2.resultJsonHash).toBe(svAfter1.resultJsonHash);
  });

  it("MANUAL_FACT：human_manual 白名单 + 值必填（fail-closed）", async () => {
    const post = await postJson({
      selections: [{ candidateId: "human_manual:weight", confirmed: true, value: "12.7 oz" }],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(post.status).toBe(200);
    const bad = await postJson({
      selections: [{ candidateId: "human_manual:not_a_field", confirmed: true, value: "x" }],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(bad.status).toBe(400);
    const empty = await postJson({
      selections: [{ candidateId: "human_manual:weight", confirmed: true, value: "" }],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(empty.status).toBe(400);
  });

  it("过期 storageVersion + 已确认同值 → 幂等成功（不再 409 要求重新勾选）", async () => {
    const get1 = await (await getJson()).json();
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    // 先确认一次（版本变化）
    await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: toStorageVersion(),
    });
    // 用旧 storageVersion 重复确认同值 → 幂等：200 + alreadyConfirmedCount=1，不重复写
    const post = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: {
        resultJsonHash: "0".repeat(64),
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.data.confirmedCount).toBe(0);
    expect(body.data.alreadyConfirmedCount).toBe(1);
  });

  it("重复确认同候选 → 更新不重复（幂等，confirmed 数量不变）", async () => {
    const get1 = await (await getJson()).json();
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: toStorageVersion(),
    });
    const sv = toStorageVersion();
    const post2 = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS 2" }],
      expectedStorageVersion: sv,
    });
    expect(post2.status).toBe(200);
    const get2 = await (await getJson()).json();
    const brandConfirmed = get2.data.confirmed.filter((c: { field: string }) => c.field === "brand");
    expect(brandConfirmed.length).toBe(1);
    expect(brandConfirmed[0].value).toBe("THERMOS 2");
  });

  it("跨 Visitor 隔离：visitor B 无法读取 visitor A 的任务", async () => {
    authState.context = { mode: "demo", demoAccessId: "demo-access-b" };
    const response = await getJson();
    expect(response.status).toBe(404);
  });
});
