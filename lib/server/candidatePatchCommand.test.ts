/**
 * Phase 3F Reset-A2-2B — Candidate PATCH command parser TDD tests.
 *
 * Target contract: only `status` and `sourceReviewAcknowledged` allowed.
 */
import { describe, expect, it } from "vitest";
import { parseCandidatePatchCommand } from "@/lib/server/candidatePatchCommand";

describe("candidatePatchCommand — legal", () => {
  it("accepts a legal status", () => {
    const r = parseCandidatePatchCommand({ status: "paused" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.status).toBe("paused");
  });

  it.each(["pending", "worth_analyzing", "analyzed", "paused", "rejected"])(
    "accepts status=%s", (s) => {
    const r = parseCandidatePatchCommand({ status: s });
    expect(r.ok).toBe(true);
  });

  it("accepts status + sourceReviewAcknowledged:true", () => {
    const r = parseCandidatePatchCommand({ status: "pending", sourceReviewAcknowledged: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.status).toBe("pending");
      expect(r.command.sourceReviewAcknowledged).toBe(true);
    }
  });

  it("accepts only sourceReviewAcknowledged:true", () => {
    const r = parseCandidatePatchCommand({ sourceReviewAcknowledged: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.sourceReviewAcknowledged).toBe(true);
  });

  it("ignores sourceReviewAcknowledged:false", () => {
    const r = parseCandidatePatchCommand({ sourceReviewAcknowledged: false });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });
});

describe("candidatePatchCommand — invalid status", () => {
  it.each([
    "invalid",
    "",
    "PAUSED",
    "Paused",
  ])("rejects invalid status=%j", (s) => {
    const r = parseCandidatePatchCommand({ status: s });
    expect(r.ok).toBe(false);
    expect(r.ok).toBe(false); if (!r.ok) { expect((r as any).code).toBe("invalid_payload"); expect((r as any).status).toBe(400); }
  });

  it.each([null, 42, true, [], {}])("rejects non-string status=%j", (s) => {
    const r = parseCandidatePatchCommand({ status: s });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });
});

describe("candidatePatchCommand — non-editable fields", () => {
  const FIELDS = ["name","score","link","keyword","risk","riskLevel","riskLabel","summary","summaryLabel","rawInput","source"];

  it.each(FIELDS)("rejects %s alone", (field) => {
    const r = parseCandidatePatchCommand({ [field]: "test" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r as any).code).toBe("candidate_field_not_editable");
      expect((r as any).status).toBe(400);
      expect((r as any).field).toBe(field);
    }
  });

  it.each(FIELDS)("rejects status + %s (mixed, whole request fails)", (field) => {
    const r = parseCandidatePatchCommand({ status: "pending", [field]: "test" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects name=null", () => {
    const r = parseCandidatePatchCommand({ name: null });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects score=150 (no longer clamps)", () => {
    const r = parseCandidatePatchCommand({ score: 150 });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects score=-1", () => {
    const r = parseCandidatePatchCommand({ score: -1 });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects score=1.5", () => {
    const r = parseCandidatePatchCommand({ score: 1.5 });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects link=empty string", () => {
    const r = parseCandidatePatchCommand({ link: "" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("rejects link=whitespace only", () => {
    const r = parseCandidatePatchCommand({ link: "   " });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_field_not_editable");
  });
});

describe("candidatePatchCommand — source fields", () => {
  it("passes sourceMetaJson through for route-level signed-vs-legacy handling", () => {
    // Source fields pass through parser; route checks candidate type
    const r = parseCandidatePatchCommand({ sourceMetaJson: "{}" });
    expect(r.ok).toBe(true); // passes through (no status needed for source field check)
  });

  it("passes status + analysisJson through for route-level handling", () => {
    const r = parseCandidatePatchCommand({ status: "pending", analysisJson: "{}" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.status).toBe("pending");
  });
});

describe("candidatePatchCommand — convertedTaskId lock", () => {
  it("signals task_link_locked for convertedTaskId set", () => {
    const r = parseCandidatePatchCommand({ convertedTaskId: "task-1" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_task_link_locked");
    expect((r as any).status).toBe(409);
  });

  it("signals task_link_locked for convertedTaskId clear", () => {
    const r = parseCandidatePatchCommand({ convertedTaskId: null });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_task_link_locked");
    expect((r as any).status).toBe(409);
  });

  it("signals task_link_locked even with status present", () => {
    const r = parseCandidatePatchCommand({ status: "pending", convertedTaskId: "x" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("candidate_task_link_locked");
  });
});

describe("candidatePatchCommand — internal fields", () => {
  it.each(["id","scopeId","demoAccessId","subject","subjectId","createdAt","updatedAt"])(
    "rejects %s as invalid_payload", (field) => {
    const r = parseCandidatePatchCommand({ [field]: "x" });
    expect(r.ok).toBe(false);
    expect(r.ok).toBe(false); if (!r.ok) { expect((r as any).code).toBe("invalid_payload"); expect((r as any).status).toBe(400); }
  });
});

describe("candidatePatchCommand — unknown fields", () => {
  it("rejects unknown field alone", () => {
    const r = parseCandidatePatchCommand({ foo: "bar" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });

  it("rejects status + unknown field (mixed, whole request fails)", () => {
    const r = parseCandidatePatchCommand({ status: "pending", foo: "bar" });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });
});

describe("candidatePatchCommand — empty / invalid body", () => {
  it("rejects empty object", () => {
    const r = parseCandidatePatchCommand({});
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });

  it("rejects null", () => {
    const r = parseCandidatePatchCommand(null);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });

  it("rejects array", () => {
    const r = parseCandidatePatchCommand([]);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });

  it("rejects string", () => {
    const r = parseCandidatePatchCommand("hello");
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });

  it("rejects undefined", () => {
    const r = parseCandidatePatchCommand(undefined);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("invalid_payload");
  });
});

describe("candidatePatchCommand — error priority", () => {
  it("convertedTaskId > non_editable", () => {
    const r = parseCandidatePatchCommand({ convertedTaskId: "x", name: "y" });
    expect((r as any).code).toBe("candidate_task_link_locked");
  });

  it("convertedTaskId > internal", () => {
    const r = parseCandidatePatchCommand({ convertedTaskId: "x", scopeId: "y" });
    expect((r as any).code).toBe("candidate_task_link_locked");
  });

  it("non_editable > unknown", () => {
    const r = parseCandidatePatchCommand({ name: "x", foo: "y" });
    expect((r as any).code).toBe("candidate_field_not_editable");
  });

  it("unknown after all allowed (none present)", () => {
    const r = parseCandidatePatchCommand({ foo: "bar" });
    expect((r as any).code).toBe("invalid_payload");
  });
});
