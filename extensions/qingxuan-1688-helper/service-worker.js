/**
 * Qingxuan 1688 Sourcing Helper — service worker（V3.5 正式版）
 *
 * §30 SW 生命周期：不依赖内存变量持久；job 状态在 bridge（phase 记录）；
 * SW 重启后心跳轮询自动恢复（命令队列在 bridge）。
 * §29 消息安全：只转发 bridge 下发的白名单命令（getState/upload/submit/collect）。
 * §31/§32 幂等：bridge 侧 phase 门禁 + command nonce 去重 → No Double Submit。
 * §34 敏感数据：日志不含 cookie/token/路径；只记录 jobId/status/时长。
 */

const BRIDGE_BASE = "http://127.0.0.1:53318";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

async function fetchBridge(path, options) {
  return await fetch(`${BRIDGE_BASE}${path}`, options);
}

async function sendTo1688Tab(message) {
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((tab) => tab.id && tab.url && /^https:\/\/(s\.1688\.com|air\.1688\.com)\//.test(tab.url));
  if (!target || !target.id) {
    return { ok: false, code: "no_1688_tab" };
  }
  try {
    return await chrome.tabs.sendMessage(target.id, message);
  } catch {
    return { ok: false, code: "content_script_unreachable" };
  }
}

async function handleCommand(command, jobId) {
  if (!command || typeof command.type !== "string") {
    return { ok: false, code: "invalid_command" };
  }
  if (command.type === "upload") {
    const imageBase64 = command.payload && typeof command.payload.imageBase64 === "string" ? command.payload.imageBase64 : "";
    if (!imageBase64) return { ok: false, code: "image_payload_missing" };
    if (Math.ceil(imageBase64.length / 4) * 3 > MAX_IMAGE_BYTES) return { ok: false, code: "image_too_large" };
    return await sendTo1688Tab({ type: "upload", version: "1.0", jobId, payload: { imageBase64 } });
  }
  return await sendTo1688Tab({ type: command.type, version: "1.0", jobId, payload: command.payload || {} });
}

let polling = false;

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetchBridge("/pending-command?worker=1", { signal: AbortSignal.timeout(10_000) });
    if (response.status === 204) return;
    if (!response.ok) return;
    const body = await response.json();
    if (!body || !body.command) return;
    const result = await handleCommand(body.command, body.jobId);
    try {
      await fetchBridge("/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: body.jobId, commandNonce: body.commandNonce, result }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // 回报失败：bridge 超时回收；SW 重启/重连后 bridge 幂等处理
    }
  } catch {
    // bridge 不可达：静默等下一轮
  } finally {
    polling = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "heartbeat") {
    void pollOnce().finally(() => {
      try {
        sendResponse({ ok: true });
      } catch {
        // 通道已关闭时忽略
      }
    });
    return true; // 异步响应：保持通道打开 = SW 保活（§30）
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  void pollOnce();
});
