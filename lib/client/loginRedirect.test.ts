import { describe, expect, it } from "vitest";
import { getSafeLoginRedirect } from "@/lib/client/loginRedirect";

describe("getSafeLoginRedirect", () => {
  it("allows same-site absolute paths after login", () => {
    expect(getSafeLoginRedirect("?redirect=%2Fagent%2Frun")).toBe("/agent/run");
    expect(getSafeLoginRedirect("?redirect=%2Ftasks%3Fview%3Dactive")).toBe("/tasks?view=active");
  });

  it("rejects external, protocol-relative, and invalid redirect targets", () => {
    expect(getSafeLoginRedirect("?redirect=https%3A%2F%2Fevil.example")).toBe("");
    expect(getSafeLoginRedirect("?redirect=%2F%2Fevil.example")).toBe("");
    expect(getSafeLoginRedirect("?redirect=javascript%3Aalert(1)")).toBe("");
    expect(getSafeLoginRedirect("?redirect=%5C%5Cevil.example")).toBe("");
  });

  it("returns an empty string when redirect is missing", () => {
    expect(getSafeLoginRedirect("")).toBe("");
    expect(getSafeLoginRedirect("?foo=bar")).toBe("");
  });
});
