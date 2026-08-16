/**
 * Qingxuan 1688 Sourcing Helper — service worker（V3.5 正式版）
 *
 * §30 SW 生命周期：不依赖内存变量持久；job 状态在 bridge（phase 记录）；
 * SW 重启后心跳轮询自动恢复（命令队列在 bridge）。
 * §29 消息安全：只转发 bridge 下发的白名单命令（getState/upload/submit/collect）。
 * §31/§32 幂等：bridge 侧 phase 门禁 + command nonce 去重 → No Double Submit。
 * §34 敏感数据：日志不含 cookie/token/路径；只记录 jobId/status/时长。
 */

const BRIDGE_BASE_PORTS = [53318, 53319, 53320, 53321, 53322, 53323, 53324, 53325, 53326, 53327];
const SW_VERSION = "0.2.1";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
let bridgePort = null; // 运行时缓存（SW 重启后经 storage.session 恢复）

/** 探测端口是否为轻选 bridge（health 有响应即可，401 也证明端口被 bridge 占用） */
async function probePort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    return response.status === 200 || response.status === 401;
  } catch {
    return false;
  }
}

/** 解析 bridge 端口：storage.session 缓存 → 候选端口扫描 */
async function resolveBridgePort() {
  if (bridgePort && await probePort(bridgePort)) return bridgePort;
  try {
    const cached = await chrome.storage.session.get("bridgePort");
    if (cached && typeof cached.bridgePort === "number" && await probePort(cached.bridgePort)) {
      bridgePort = cached.bridgePort;
      return bridgePort;
    }
  } catch {
    // storage 不可用时忽略
  }
  for (const port of BRIDGE_BASE_PORTS) {
    if (await probePort(port)) {
      bridgePort = port;
      try {
        await chrome.storage.session.set({ bridgePort: port });
      } catch {
        // 忽略
      }
      return port;
    }
  }
  return null;
}

async function fetchBridge(path, options) {
  const port = await resolveBridgePort();
  if (!port) {
    const error = new Error("bridge_not_found");
    error.code = "bridge_not_found";
    throw error;
  }
  return await fetch(`http://127.0.0.1:${port}${path}`, options);
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
  if (command.type === "navigateUploadPage") {
    // 固定能力：仅导航到 1688 图搜上传页（非任意 URL；§8 禁止 openAnyUrl）
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => tab.id && tab.url && /^https:\/\/(s\.1688\.com|air\.1688\.com)\//.test(tab.url));
    if (!target || !target.id) return { ok: false, code: "no_1688_tab" };
    try {
      await chrome.tabs.update(target.id, { url: "https://s.1688.com/selloffer/offer_search.html" });
      return { ok: true };
    } catch {
      return { ok: false, code: "navigation_failed" };
    }
  }
  return await sendTo1688Tab({ type: command.type, version: "1.0", jobId, payload: command.payload || {} });
}

let polling = false;

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    // 心跳版本上报（诊断：区分扩展旧版/未加载）
    fetchBridge("/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ swVersion: SW_VERSION }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
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
  // SW 自唤醒（30s 周期）：不依赖页面 content script 心跳也能轮询 bridge（页面心跳 2s 加速）
  chrome.alarms.create("poll", { periodInMinutes: 0.5 }).catch(() => undefined);
  void pollOnce();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") void pollOnce();
});
