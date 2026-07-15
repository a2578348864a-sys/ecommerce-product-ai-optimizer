import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2PublicRevalidationBrief } from "./stage2-public-revalidation-brief";
import {
  buildStage2PublicRevalidationAuthorization,
  validateStage2PublicRevalidationAuthorization,
} from "./run-stage2-public-revalidation";

const BRIEF_FILE = resolve(import.meta.dirname,
  "../../../06_测试与验证/2026-07-15-Phase-Stage2-Public-Evidence-01/revalidation-authorization/stage2-public-revalidation-brief.v1.json");

function brief(): Stage2PublicRevalidationBrief {
  return JSON.parse(readFileSync(BRIEF_FILE, "utf8")) as Stage2PublicRevalidationBrief;
}

describe("Stage 2 public revalidation execution authorization", () => {
  it("refuses to manufacture authorization without an explicit current confirmation", () => {
    expect(() => buildStage2PublicRevalidationAuthorization({
      brief: brief(),
      userAuthorizationConfirmed: false,
      authorizedAt: "2026-07-15T01:00:00.000Z",
    })).toThrow("STAGE2_REVALIDATION_USER_AUTHORIZATION_REQUIRED");
  });

  it("binds an explicit grant to the exact brief hash and frozen scope", () => {
    const authorization = buildStage2PublicRevalidationAuthorization({
      brief: brief(),
      userAuthorizationConfirmed: true,
      authorizedAt: "2026-07-15T01:00:00.000Z",
    });
    expect(authorization).toMatchObject({
      schemaVersion: "stage2-public-revalidation-authorization.v1",
      status: "granted",
      briefHash: "662342c0268602d555039bf7af0ebeb7914c95ba5d6b7904ff0cf8f044570533",
      authorizedBy: "project_owner",
      scope: {
        allowedOrigin: "https://www.alibaba.com",
        maxTotalNavigations: 4,
        automaticRetryCount: 0,
      },
    });
    expect(validateStage2PublicRevalidationAuthorization(brief(), authorization)).toEqual({
      status: "valid_granted_authorization",
      reasonCodes: [],
    });
  });

  it("fails closed if the authorization hash or scope no longer matches", () => {
    const authorization = buildStage2PublicRevalidationAuthorization({
      brief: brief(),
      userAuthorizationConfirmed: true,
      authorizedAt: "2026-07-15T01:00:00.000Z",
    });
    authorization.scope.maxTotalNavigations = 3 as 4;
    expect(validateStage2PublicRevalidationAuthorization(brief(), authorization)).toMatchObject({
      status: "invalid_authorization",
      reasonCodes: expect.arrayContaining(["authorization_hash_mismatch", "authorization_scope_mismatch"]),
    });
  });
});
