import "server-only";

function parseOrigin(value: string | null, allowPath: boolean): string | null {
  if (!value || value.trim().toLowerCase() === "null") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin === "null"
      || parsed.username
      || parsed.password
      || (!allowPath && (parsed.pathname !== "/" || parsed.search || parsed.hash))
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function expectedOriginFromRequestAuthority(request: Request): string | null {
  let protocol: string;
  try {
    protocol = new URL(request.url).protocol;
  } catch {
    return null;
  }

  // This direct route does not have a trusted-proxy contract. The actual Host
  // authority therefore defines the browser-visible origin; forwarded headers
  // are intentionally not consulted.
  const host = request.headers.get("host");
  if (!host || host !== host.trim() || /[\\/?#@,\s]/.test(host)) return null;

  try {
    const parsed = new URL(`${protocol}//${host}`);
    if (
      parsed.origin === "null"
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function hasSellerSpritePreviewSameOrigin(request: Request): boolean {
  const expectedOrigin = expectedOriginFromRequestAuthority(request);
  if (!expectedOrigin) return false;

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const refererOrigin = parseOrigin(refererHeader, true);

  if (originHeader !== null) {
    const origin = parseOrigin(originHeader, false);
    return origin === expectedOrigin && (refererHeader === null || refererOrigin === expectedOrigin);
  }
  return refererOrigin === expectedOrigin;
}
