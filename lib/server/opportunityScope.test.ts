import { describe, expect, it } from "vitest";
import { resolveScopeSubject } from "@/lib/server/opportunityScope";

describe("resolveScopeSubject", () => {
  it("maps every Owner context to the server-owned default subject", () => {
    const first = resolveScopeSubject({ mode: "owner", token: "owner-token-a" });
    const second = resolveScopeSubject({ mode: "owner", token: "owner-token-b" });

    expect(first).toEqual({ kind: "owner", subjectId: "default" });
    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("scopeId");
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("maps a Visitor context from the server-validated demoAccessId", () => {
    const subject = resolveScopeSubject({
      mode: "demo",
      token: "visitor-session-token",
      demoAccessId: "visitor-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 3,
    });

    expect(subject).toEqual({ kind: "visitor", subjectId: "visitor-a" });
    expect(subject).not.toHaveProperty("scopeId");
    expect(Object.isFrozen(subject)).toBe(true);
  });
});
