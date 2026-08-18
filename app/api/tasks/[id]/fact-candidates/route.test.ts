/**
 * V3 UX Closure — Fact Candidate API 测试（批量确认 + 隔离 + fail-closed）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
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

  it("确认不存在于候选列表的项 → 400 candidate_not_found（禁止伪造来源）", async () => {
    const post = await postJson({
      selections: [{ candidateId: "fake:field", confirmed: true, value: "x" }],
      expectedStorageVersion: toStorageVersion(),
    });
    expect(post.status).toBe(400);
    const body = await post.json();
    expect(body.error.code).toBe("candidate_not_found");
  });

  it("stale storageVersion → 409 task_result_conflict", async () => {
    const get1 = await (await getJson()).json();
    const brand = get1.data.candidates.find((c: { field: string }) => c.field === "brand");
    // 先确认一次（版本变化）
    await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: toStorageVersion(),
    });
    // 用旧 storageVersion 再确认 → 409
    const post = await postJson({
      selections: [{ candidateId: brand.candidateId, confirmed: true, value: "THERMOS" }],
      expectedStorageVersion: {
        resultJsonHash: "0".repeat(64),
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(post.status).toBe(409);
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
