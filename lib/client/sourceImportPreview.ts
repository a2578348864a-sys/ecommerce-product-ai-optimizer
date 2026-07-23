import type { CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import type { SourceImportCandidateSaveData } from "@/lib/client/sourceImportCandidateSave";

export type SourceImportCandidateData = SourceImportCandidateSaveData & {
  evidenceSnapshot?: CandidateEvidenceSnapshot;
};

export type SourceImportResponse = {
  ok: true;
  candidates: SourceImportCandidateData[];
  summary: {
    totalUrls: number;
    okUrls: number;
    failedUrls: number;
    totalCandidates: number;
  };
  warnings: string[];
} | {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type SourceImportPreviewRequest = Readonly<{
  input: string;
  accessPassword: string;
  accessHeaders: Readonly<Record<string, string>>;
}>;

export type SourceImportPreviewResult = {
  kind: "json";
  status: number;
  payload: SourceImportResponse;
} | {
  kind: "non_json";
  status: number;
} | {
  kind: "invalid_json";
  status: number;
};

export async function requestSourceImportPreview(
  request: SourceImportPreviewRequest,
): Promise<SourceImportPreviewResult> {
  const response = await fetch("/api/opportunities/source-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...request.accessHeaders,
    },
    body: JSON.stringify({
      input: request.input,
      accessPassword: request.accessPassword,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {
      kind: "non_json",
      status: response.status,
    };
  }

  try {
    return {
      kind: "json",
      status: response.status,
      payload: await response.json() as SourceImportResponse,
    };
  } catch {
    return {
      kind: "invalid_json",
      status: response.status,
    };
  }
}
