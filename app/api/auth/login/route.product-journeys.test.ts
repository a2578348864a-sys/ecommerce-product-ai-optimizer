import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { NextRequest } from "next/server";

const ACCESS_STORE = `${tmpdir()}/login-product-journey-access-${randomBytes(4).toString("hex")}.json`;
const SANDBOX_STORE = `${tmpdir()}/login-product-journey-sandbox-${randomBytes(4).toString("hex")}.json`;

beforeAll(() => {
  process.env.DEMO_ACCESS_STORE_PATH = ACCESS_STORE;
  process.env.DEMO_SANDBOX_STORE_PATH = SANDBOX_STORE;
});

afterAll(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  vi.unstubAllEnvs();
  for (const path of [ACCESS_STORE, SANDBOX_STORE]) {
    try { unlinkSync(path); } catch { /* optional test store */ }
  }
});

import {
  createDemoAccess,
  loadDemoAccessStore,
  saveDemoAccessStore,
} from "@/lib/server/demoAccess";
import { replaceDemoSandboxStoreForTest } from "@/lib/server/demoSandbox.testSupport";
import {
  buildProductJourneyIdentity,
  commitDemoProductJourney,
  reserveDemoProductJourney,
} from "@/lib/server/demoProductJourneyQuota";
import { verifySignedToken } from "@/lib/server/signedToken";
import { POST } from "./route";

function loginRequest(password: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", "owner-signing-secret-for-test");
  saveDemoAccessStore({ version: 1, accesses: [] });
  replaceDemoSandboxStoreForTest({ version: 1, tasks: [], candidates: [] });
});

describe("Visitor login after product-journey quota migration", () => {
  it("removes the old 24h code expiry while keeping a short-lived 12h signed session", async () => {
    const { record, plainPassword } = createDemoAccess({ label: "Legacy active Visitor", hours: 24, maxAiCalls: 5 });
    const store = loadDemoAccessStore();
    store.accesses[0].expiresAt = "2020-01-01T00:00:00.000Z";
    saveDemoAccessStore(store);

    const response = await POST(loginRequest(plainPassword));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "demo",
      demoAccess: {
        id: record.id,
        expiresAt: null,
        quotaMetric: "product_journeys_v1",
        maxProducts: 5,
        usedProducts: 0,
        remainingProducts: 5,
      },
    });
    const verified = verifySignedToken(body.accessToken);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      const lifetime = verified.payload.exp - verified.payload.iat;
      expect(lifetime).toBe(12 * 60 * 60 * 1000);
      expect(verified.payload.demoAccessId).toBe(record.id);
    }
    expect(loadDemoAccessStore().accesses[0].expiresAt).toBeNull();
  });

  it("preserves used product journeys when the same Visitor logs in again", async () => {
    const { record, plainPassword } = createDemoAccess({ label: "Returning Visitor", hours: 24, maxAiCalls: 5 });
    const identity = buildProductJourneyIdentity({ candidateId: "candidate-one", productName: "Product One" });
    expect(reserveDemoProductJourney(record.id, identity, "request-one").ok).toBe(true);
    expect(commitDemoProductJourney(record.id, identity, "request-one").ok).toBe(true);

    const first = await POST(loginRequest(plainPassword));
    const firstBody = await first.json();
    const second = await POST(loginRequest(plainPassword));
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.demoAccess).toMatchObject({ usedProducts: 1, remainingProducts: 4 });
    expect(secondBody.demoAccess).toMatchObject({ usedProducts: 1, remainingProducts: 4 });
  });

  it("still rejects an administratively disabled Visitor", async () => {
    const { plainPassword } = createDemoAccess({ label: "Disabled Visitor", hours: 24, maxAiCalls: 5 });
    const store = loadDemoAccessStore();
    store.accesses[0].isActive = false;
    saveDemoAccessStore(store);

    const response = await POST(loginRequest(plainPassword));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "demo_access_inactive" },
    });
  });
});
