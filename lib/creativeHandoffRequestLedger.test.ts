import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES,
  CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES,
  appendRequestLedgerEntry,
  buildRequestFingerprint,
  buildRequestKeyHash,
  createEmptyRequestLedger,
  lookupRequestLedger,
  parseRequestLedger,
  RequestLedgerError,
} from "@/lib/creativeHandoffRequestLedger";

describe("creative-handoff-request-ledger.v1 严格内部合同", () => {
  const now = "2026-08-05T00:00:00.000Z";

  function entry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      requestKeyHash: `sha256:${"a".repeat(64)}`,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
      ...overrides,
    };
  }

  it("11. 严格 Parser 接受合法 Ledger", () => {
    const ledger = appendRequestLedgerEntry(null, entry() as never);
    expect(parseRequestLedger(ledger)).not.toBeNull();
    expect(ledger.schema).toBe("creative-handoff-request-ledger.v1");
    expect(ledger.version).toBe(1);
  });

  it("12. 未知字段拒绝", () => {
    const bad = { ...entry(), extra: 1 };
    const ledger = { schema: "creative-handoff-request-ledger.v1", version: 1, entries: [bad] };
    expect(parseRequestLedger(ledger)).toBeNull();
  });

  it("13. 第32条允许", () => {
    let ledger = createEmptyRequestLedger();
    for (let i = 0; i < CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES; i++) {
      const key = `sha256:${(i.toString(16).padStart(64, "0"))}`;
      ledger = appendRequestLedgerEntry(ledger, {
        requestKeyHash: key,
        requestFingerprint: `sha256:${"f".repeat(64)}`,
        action: "create",
        outcomeKind: i % 2 === 0 ? "created" : "appended",
        outcomeRevision: 1,
        recordedAt: now,
      });
    }
    expect(ledger.entries).toHaveLength(CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES);
    expect(parseRequestLedger(ledger)).not.toBeNull();
  });

  it("14. 第33条拒绝", () => {
    let ledger = createEmptyRequestLedger();
    for (let i = 0; i < CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES; i++) {
      ledger = appendRequestLedgerEntry(ledger, {
        requestKeyHash: `sha256:${(i.toString(16).padStart(64, "0"))}`,
        requestFingerprint: `sha256:${"f".repeat(64)}`,
        action: "create",
        outcomeKind: "created",
        outcomeRevision: 1,
        recordedAt: now,
      });
    }
    expect(() => appendRequestLedgerEntry(ledger, {
      requestKeyHash: `sha256:${"e".repeat(64)}`,
      requestFingerprint: `sha256:${"f".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
    })).toThrow(RequestLedgerError);
    try {
      appendRequestLedgerEntry(ledger, {
        requestKeyHash: `sha256:${"e".repeat(64)}`,
        requestFingerprint: `sha256:${"f".repeat(64)}`,
        action: "create",
        outcomeKind: "created",
        outcomeRevision: 1,
        recordedAt: now,
      });
    } catch (e) {
      expect((e as RequestLedgerError).code).toBe("idempotency_ledger_capacity_exceeded");
    }
  });

  it("15. 超 24KiB 拒绝", () => {
    const fat = { ...entry(), recordedAt: now, requestFingerprint: `sha256:${"b".repeat(64)}` };
    const fatEntry = {
      requestKeyHash: `sha256:${"a".repeat(64)}`,
      requestFingerprint: `sha256:${"c".repeat(64)}`,
      action: "revoke",
      outcomeKind: "revoked",
      outcomeRevision: 1,
      recordedAt: now,
    };
    // 构造超过 24KiB 的 ledger
    let ledger = createEmptyRequestLedger();
    for (let i = 0; i < CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_ENTRIES; i++) {
      ledger = appendRequestLedgerEntry(ledger, {
        requestKeyHash: `sha256:${(i.toString(16).padStart(64, "0"))}`,
        requestFingerprint: `sha256:${"f".repeat(64)}`,
        action: "create",
        outcomeKind: "created",
        outcomeRevision: 1,
        recordedAt: now,
      });
    }
    const serialized = JSON.stringify(ledger);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES);
    // 直接用超大 entries 验证 parser 字节限制
    const huge = {
      schema: "creative-handoff-request-ledger.v1",
      version: 1,
      entries: [{
        ...fatEntry,
        recordedAt: "2026-08-05T00:00:00.000Z",
        requestKeyHash: `sha256:${"0".repeat(64)}`,
      }],
    };
    // 单条不会超，用多重复制
    huge.entries = Array.from({ length: 100 }, (_, i) => ({ ...fatEntry, requestKeyHash: `sha256:${(i.toString(16).padStart(64, "0"))}` }));
    expect(Buffer.byteLength(JSON.stringify(huge), "utf8")).toBeGreaterThan(CREATIVE_HANDOFF_REQUEST_LEDGER_MAX_UTF8_BYTES);
    expect(parseRequestLedger(huge)).toBeNull();
    expect(fat).toBeTruthy();
  });

  it("16. 原始 requestId 未保存 — Ledger 只有哈希", () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const key = buildRequestKeyHash({
      subjectKind: "owner",
      subjectRef: "a1b2c3d4e5f6a7b8",
      taskId: "task-1",
      action: "create",
      requestId,
    });
    const ledger = appendRequestLedgerEntry(null, {
      requestKeyHash: key,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
    });
    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain(requestId);
    expect(serialized).not.toContain("550e8400");
  });

  it("18. requestKeyHash 绑定主体/Task/action/requestId", () => {
    const base = {
      subjectKind: "owner" as const,
      subjectRef: "a1b2c3d4e5f6a7b8",
      taskId: "task-1",
      action: "create" as const,
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    };
    const k1 = buildRequestKeyHash(base);
    expect(buildRequestKeyHash({ ...base, taskId: "task-2" })).not.toBe(k1);
    expect(buildRequestKeyHash({ ...base, requestId: "550e8400-e29b-41d4-a716-446655440001" })).not.toBe(k1);
    expect(buildRequestKeyHash({ ...base, action: "revoke" })).not.toBe(k1);
    expect(buildRequestKeyHash({ ...base, subjectKind: "visitor", subjectRef: "bb" })).not.toBe(k1);
  });

  it("F1. requestFingerprint 不含时间/随机值 — 同语义稳定", () => {
    const fp1 = buildRequestFingerprint({
      action: "create",
      selectedFactIds: ["fact:abc", "fact:def"],
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" },
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      confirmed: true,
    });
    const fp2 = buildRequestFingerprint({
      action: "create",
      selectedFactIds: ["fact:def", "fact:abc"], // 顺序无关
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" },
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      confirmed: true,
    });
    expect(fp1).toBe(fp2);
  });

  it("F2. 语义变化改变 fingerprint", () => {
    const base = {
      action: "create" as const,
      selectedFactIds: ["fact:abc"],
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-05T00:00:00.000Z" },
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      confirmed: true,
    };
    const fp1 = buildRequestFingerprint(base);
    expect(buildRequestFingerprint({ ...base, selectedFactIds: ["fact:xyz"] })).not.toBe(fp1);
    expect(buildRequestFingerprint({ ...base, expectedResearchRevision: 2 })).not.toBe(fp1);
  });

  it("F3. lookup: 同键同指纹 → replay", () => {
    const key = `sha256:${"a".repeat(64)}`;
    const ledger = appendRequestLedgerEntry(null, {
      requestKeyHash: key,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
    });
    const lookup = lookupRequestLedger(ledger, key, `sha256:${"b".repeat(64)}`);
    expect(lookup.kind).toBe("replay");
  });

  it("F4. lookup: 同键不同指纹 → conflict", () => {
    const key = `sha256:${"a".repeat(64)}`;
    const ledger = appendRequestLedgerEntry(null, {
      requestKeyHash: key,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
    });
    const lookup = lookupRequestLedger(ledger, key, `sha256:${"c".repeat(64)}`);
    expect(lookup.kind).toBe("conflict");
  });

  it("F5. lookup: 无键 → fresh", () => {
    const ledger = createEmptyRequestLedger();
    expect(lookupRequestLedger(ledger, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`).kind).toBe("fresh");
  });

  it("F6. 重复 requestKeyHash 拒绝追加", () => {
    const key = `sha256:${"a".repeat(64)}`;
    let ledger = appendRequestLedgerEntry(null, {
      requestKeyHash: key,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 1,
      recordedAt: now,
    });
    expect(() => appendRequestLedgerEntry(ledger, {
      requestKeyHash: key,
      requestFingerprint: `sha256:${"c".repeat(64)}`,
      action: "create",
      outcomeKind: "created",
      outcomeRevision: 2,
      recordedAt: now,
    })).toThrow(RequestLedgerError);
  });
});

describe("请求哈希域分离", () => {
  it("key 与 fingerprint 使用不同 schema 前缀", () => {
    const key = buildRequestKeyHash({
      subjectKind: "owner",
      subjectRef: "a1b2c3d4e5f6a7b8",
      taskId: "t",
      action: "create",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const fp = buildRequestFingerprint({
      action: "create",
      selectedFactIds: ["fact:1"],
      confirmed: true,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
    });
    expect(key).not.toBe(fp);
    // 原始值未泄漏
    expect(key).not.toContain("550e8400");
    expect(fp).not.toContain("fact:1");
  });
});
