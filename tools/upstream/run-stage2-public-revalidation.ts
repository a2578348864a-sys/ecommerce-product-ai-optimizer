import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import { runStage2PublicEvidenceCollection } from "./run-stage2-public-evidence-collection";
import {
  validateStage2PublicRevalidationBrief,
  type Stage2PublicRevalidationBrief,
} from "./stage2-public-revalidation-brief";

export type Stage2PublicRevalidationAuthorization = {
  schemaVersion: "stage2-public-revalidation-authorization.v1";
  status: "granted";
  briefId: string;
  briefHash: string;
  authorizedAt: string;
  authorizedBy: "project_owner";
  grantSource: "explicit_current_thread_user_instruction";
  scope: {
    allowedOrigin: "https://www.alibaba.com";
    maxTotalNavigations: 4;
    maxSearchResultPages: 1;
    maxSupplierProductPages: 3;
    maxSamples: 1;
    automaticRetryCount: 0;
  };
  acknowledgedBoundaries: {
    noLoginOrPrivateProfile: true;
    noCookieOrStorageRead: true;
    noCaptchaBypass: true;
    noProxyOrAntiDetection: true;
    noPaidApiOrExternalAi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage1Rewrite: true;
  };
  evidenceHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function buildStage2PublicRevalidationAuthorization(input: {
  brief: Stage2PublicRevalidationBrief;
  userAuthorizationConfirmed: boolean;
  authorizedAt: string;
}): Stage2PublicRevalidationAuthorization {
  if (!input.userAuthorizationConfirmed) throw new Error("STAGE2_REVALIDATION_USER_AUTHORIZATION_REQUIRED");
  if (validateStage2PublicRevalidationBrief(input.brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_REVALIDATION_BRIEF_INVALID");
  }
  if (!validIso(input.authorizedAt)) throw new Error("STAGE2_REVALIDATION_AUTHORIZED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-public-revalidation-authorization.v1" as const,
    status: "granted" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    authorizedAt: input.authorizedAt,
    authorizedBy: "project_owner" as const,
    grantSource: "explicit_current_thread_user_instruction" as const,
    scope: { ...input.brief.requestedScope },
    acknowledgedBoundaries: {
      noLoginOrPrivateProfile: true as const,
      noCookieOrStorageRead: true as const,
      noCaptchaBypass: true as const,
      noProxyOrAntiDetection: true as const,
      noPaidApiOrExternalAi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function validateStage2PublicRevalidationAuthorization(
  brief: Stage2PublicRevalidationBrief,
  authorization: Stage2PublicRevalidationAuthorization,
) {
  const reasonCodes: string[] = [];
  const { evidenceHash, ...body } = authorization;
  if (stableHash(body) !== evidenceHash) reasonCodes.push("authorization_hash_mismatch");
  if (validateStage2PublicRevalidationBrief(brief).status !== "valid_pending_authorization") {
    reasonCodes.push("brief_invalid");
  }
  if (authorization.schemaVersion !== "stage2-public-revalidation-authorization.v1"
    || authorization.status !== "granted"
    || authorization.briefId !== brief.briefId
    || authorization.briefHash !== brief.briefHash
    || authorization.authorizedBy !== "project_owner"
    || authorization.grantSource !== "explicit_current_thread_user_instruction"
    || !validIso(authorization.authorizedAt)) reasonCodes.push("authorization_identity_mismatch");
  if (stableHash(authorization.scope) !== stableHash(brief.requestedScope)) {
    reasonCodes.push("authorization_scope_mismatch");
  }
  if (!Object.values(authorization.acknowledgedBoundaries).every((value) => value === true)) {
    reasonCodes.push("authorization_boundary_mismatch");
  }
  return {
    status: reasonCodes.length === 0 ? "valid_granted_authorization" as const : "invalid_authorization" as const,
    reasonCodes,
  };
}

export async function runStage2PublicRevalidation(input: {
  originalBriefFile: string;
  revalidationBriefFile: string;
  outputDirectory: string;
  authorizedAt: string;
  userAuthorizationConfirmed: boolean;
}) {
  const outputDirectory = resolve(input.outputDirectory);
  if (existsSync(outputDirectory)) throw new Error("STAGE2_REVALIDATION_OUTPUT_ALREADY_EXISTS");
  const brief = JSON.parse(readFileSync(resolve(input.revalidationBriefFile), "utf8")) as Stage2PublicRevalidationBrief;
  const authorization = buildStage2PublicRevalidationAuthorization({
    brief,
    userAuthorizationConfirmed: input.userAuthorizationConfirmed,
    authorizedAt: input.authorizedAt,
  });
  if (validateStage2PublicRevalidationAuthorization(brief, authorization).status !== "valid_granted_authorization") {
    throw new Error("STAGE2_REVALIDATION_AUTHORIZATION_INVALID");
  }
  writeArtifactsIdempotently(outputDirectory, [{
    relativePath: "stage2-public-revalidation-authorization.v1.json",
    content: `${JSON.stringify(authorization, null, 2)}\n`,
  }], "STAGE2_REVALIDATION_AUTHORIZATION_OUTPUT_CONFLICT");
  const result = await runStage2PublicEvidenceCollection({
    briefFile: input.originalBriefFile,
    outputDirectory,
    capturedAt: input.authorizedAt,
  });
  return { authorization, ...result };
}
