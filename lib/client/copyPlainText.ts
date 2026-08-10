/**
 * v2.2.14：共享纯文本复制 helper（HTTP 公网兼容）。
 *
 * 优先 navigator.clipboard.writeText（仅 secure context 且 API 可用）；
 * 否则执行临时 textarea + document.execCommand("copy") 兼容回退（仅纯文本）。
 * 两条路径都失败才返回 false（调用方展示"复制失败"）。
 *
 * 通过 globalThis 访问 window/document，node 测试环境可注入 mock。
 */
export async function copyPlainText(text: string): Promise<boolean> {
  if (!text) return false;
  const g = globalThis as Record<string, unknown>;
  const win = g.window as (Window & typeof globalThis) | undefined;
  try {
    if (win?.isSecureContext && win.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const doc = (g.document ?? win?.document) as Document | undefined;
    if (!doc) return false;
    const textarea = doc.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    doc.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const success = doc.execCommand("copy");
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}
