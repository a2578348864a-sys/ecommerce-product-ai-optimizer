import { describe, expect, it } from "vitest";
import {
  SYSTEM_MANAGED_TASK_RESULT_KEYS,
  TaskResultNamespacePolicyError,
  assertGenericTaskResultAllowed,
} from "@/lib/server/taskResultNamespacePolicy";

describe("generic task result namespace policy", () => {
  it("rejects every system-managed namespace with the stable error code", () => {
    expect(SYSTEM_MANAGED_TASK_RESULT_KEYS.length).toBeGreaterThanOrEqual(24);
    for (const key of SYSTEM_MANAGED_TASK_RESULT_KEYS) {
      expect(() => assertGenericTaskResultAllowed({ [key]: { injected: true } }))
        .toThrowError(expect.objectContaining({ code: "reserved_system_namespace", key }));
    }
  });

  it("allows ordinary legacy and mock result fields", () => {
    expect(() => assertGenericTaskResultAllowed({
      score: 72,
      level: "medium",
      oneLineSummary: "Synthetic summary",
      sellingPoints: ["Synthetic point"],
    })).not.toThrow();
  });

  it("exports a typed policy error", () => {
    const error = new TaskResultNamespacePolicyError("researchRecord");
    expect(error).toMatchObject({ code: "reserved_system_namespace", key: "researchRecord" });
  });
});
