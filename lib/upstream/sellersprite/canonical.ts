import { createHash } from "node:crypto";

export function sellerSpriteDeterministicStringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sellerSpriteCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SELLERSPRITE_NON_FINITE_CANONICAL_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sellerSpriteCanonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(sellerSpriteDeterministicStringCompare)
      .map((key) => `${JSON.stringify(key)}:${sellerSpriteCanonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("SELLERSPRITE_UNSUPPORTED_CANONICAL_VALUE");
}

export function sellerSpriteStableHash(value: unknown): string {
  return createHash("sha256")
    .update(sellerSpriteCanonicalJson(value), "utf8")
    .digest("hex");
}

export function sellerSpriteCanonicalCompare(left: unknown, right: unknown): number {
  const leftJson = sellerSpriteCanonicalJson(left);
  const rightJson = sellerSpriteCanonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}
