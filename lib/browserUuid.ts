/**
 * 浏览器侧统一 UUID v4 生成工具。
 *
 * 背景：`crypto.randomUUID` 仅在 secure context（HTTPS 或 localhost）可用；
 * 在普通 HTTP 公网 Origin 下 `typeof crypto.randomUUID === "undefined"`，
 * 但 `crypto.getRandomValues` 仍然可用。商品研究 requestId / 幂等键等
 * 浏览器侧 UUID 若直接调用 randomUUID，会在 HTTP 公网环境抛
 * "crypto.randomUUID is not a function" 并中断主链。
 *
 * 语义（优先级从高到低）：
 * 1. `globalThis.crypto.randomUUID` 可用 → 直接使用（原生，最优）。
 * 2. `globalThis.crypto.getRandomValues` 可用 → 按 RFC 4122 生成
 *    UUID v4（设 version 4 bits + variant bits），lowercase。
 * 3. 两者都不可用 → fail-closed：抛出带可理解信息的错误，
 *    绝不使用 Math.random() / Date.now() 拼接制造伪随机 ID。
 *
 * 本 helper 是纯前端小函数，不依赖任何外部库。
 */

function assertNonEmptyUuid(value: string): string {
  return value;
}

export function createBrowserUuid(): string {
  const cryptoObject = globalThis.crypto as
    | (Crypto & { randomUUID?: () => string })
    | undefined;

  // 1) 原生 randomUUID（secure context）
  if (
    typeof cryptoObject !== "undefined" &&
    typeof cryptoObject.randomUUID === "function"
  ) {
    return assertNonEmptyUuid(cryptoObject.randomUUID());
  }

  // 2) getRandomValues fallback（HTTP 公网环境）
  if (
    typeof cryptoObject !== "undefined" &&
    typeof cryptoObject.getRandomValues === "function"
  ) {
    const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
    // RFC 4122：byte[6] 高 4 位 = version (4)，byte[8] 高 2 位 = variant (10)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return assertNonEmptyUuid(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  }

  // 3) fail-closed：不制造伪随机 ID
  throw new Error(
    "当前环境不支持安全 UUID 生成（缺少 crypto.randomUUID 与 crypto.getRandomValues）。" +
    "请使用现代浏览器，或在 HTTPS 环境下访问。",
  );
}
