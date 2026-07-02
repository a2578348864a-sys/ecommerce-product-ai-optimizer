"use client";

export function getSafeLoginRedirect(search: string): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return "";
  }

  const target = (params.get("redirect") || "").trim();
  if (!target) return "";
  if (!target.startsWith("/") || target.startsWith("//")) return "";
  if (target.includes("\\") || target.includes("\u0000")) return "";

  return target;
}
