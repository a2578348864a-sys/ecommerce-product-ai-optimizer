import { requestPinnedRadarResponse } from "../../lib/server/radarCrawler";
import {
  validateTargetUrlForRequest,
  type ValidatedTarget,
  type ValidatedTargetAddress,
} from "../../lib/server/ssrfGuard";
import { GLOBAL_SOURCES_ROBOTS_URL } from "./stage2-global-sources-discovery-r1";

export type GlobalSourcesRobotsFetchResult = {
  body: string;
  status: number;
  contentType: string;
  finalUrl: string;
  elapsedMs: number;
};

type RobotsRequestDependencies = {
  validateTarget: (url: URL) => Promise<ValidatedTarget | null>;
  requestPinned: (url: URL, address: ValidatedTargetAddress, signal: AbortSignal) => Promise<Response>;
  now: () => number;
};

const defaultDependencies: RobotsRequestDependencies = {
  validateTarget: validateTargetUrlForRequest,
  requestPinned: requestPinnedRadarResponse,
  now: Date.now,
};

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("ROBOTS_BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function fetchGlobalSourcesRobotsOnce(
  url: string,
  dependencies: RobotsRequestDependencies = defaultDependencies,
): Promise<GlobalSourcesRobotsFetchResult> {
  if (url !== GLOBAL_SOURCES_ROBOTS_URL) throw new Error("ROBOTS_REQUEST_URL_INVALID");
  const parsed = new URL(url);
  const target = await dependencies.validateTarget(parsed);
  if (!target || target.url.href !== url || target.addresses.length === 0) {
    throw new Error("ROBOTS_DNS_TARGET_REJECTED");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const startedAt = dependencies.now();
  let response: Response | null = null;
  try {
    response = await dependencies.requestPinned(target.url, target.addresses[0], controller.signal);
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200) throw new Error(`ROBOTS_HTTP_STATUS_${response.status}`);
    if (!contentType.toLowerCase().includes("text/plain")) throw new Error("ROBOTS_CONTENT_TYPE_INVALID");
    const body = await readBoundedText(response, 262_144);
    return {
      body,
      status: response.status,
      contentType: contentType.slice(0, 120),
      finalUrl: url,
      elapsedMs: Math.max(0, dependencies.now() - startedAt),
    };
  } finally {
    clearTimeout(timer);
  }
}
