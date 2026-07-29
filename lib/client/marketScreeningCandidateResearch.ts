"use client";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CandidateResearchResponse =
  | {
      ok: true;
      href: string;
      item: { id: string; name: string };
    }
  | {
      ok: false;
      error?: { code?: string; message?: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): CandidateResearchResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  return value as CandidateResearchResponse;
}

function isValidCandidateHandoff(
  href: unknown,
  item: unknown,
) {
  if (typeof href !== "string" || !href.startsWith("/agent/run?")) return false;
  if (!isRecord(item)
    || typeof item.id !== "string"
    || !item.id
    || typeof item.name !== "string"
    || !item.name) return false;
  const url = new URL(href, "http://localhost");
  return url.pathname === "/agent/run"
    && url.searchParams.get("source") === "opportunity"
    && url.searchParams.get("candidateId") === item.id
    && [...url.searchParams.keys()].every((key) => key === "source" || key === "candidateId");
}

export async function requestMarketScreeningCandidateResearch(
  productKey: string,
  accessHeaders: Record<string, string>,
  fetcher: Fetcher = fetch,
) {
  const normalizedProductKey = productKey.trim();
  if (!normalizedProductKey) throw new Error("商品标识缺失，无法进入研究。");

  const response = await fetcher("/api/opportunity-candidates/from-market-screening", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...accessHeaders,
    },
    body: JSON.stringify({ productKey: normalizedProductKey }),
  });
  const payload = parseResponse(await response.json().catch(() => null));

  if (!response.ok || !payload || !payload.ok) {
    const message = payload && !payload.ok ? payload.error?.message : null;
    throw new Error(message || "商品暂时无法进入研究，请稍后重试。");
  }
  if (!isValidCandidateHandoff(payload.href, payload.item)) {
    throw new Error("商品研究入口无效，已停止跳转。");
  }

  return payload.href;
}
