#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSellerSpritePreviewAcceptanceEvidence,
} from "./sellersprite-preview-acceptance-evidence.mjs";
import {
  cleanupSmokeRuntime,
  formatSmokeRuntimeStartOutput,
  getSmokeRuntimeStatus,
  startSmokeRuntime,
  stopSmokeRuntime,
} from "./local-smoke-runtime.mjs";
import { findLocalPortListeners } from "./local-next-runtime.mjs";

const WORKTREE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOST = "127.0.0.1";
const PORT = 3115;
const CDP_PORT = 24801;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function localListeners(port) {
  return findLocalPortListeners({ port }).filter((item) => item.address === `${HOST}:${port}`);
}

function assertPortFree(port) {
  if (localListeners(port).length > 0) throw new Error("smoke_port_not_free");
}

function isCredentialFree(value, credentials) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return typeof text === "string" && credentials.every((credential) => (
    typeof credential !== "string" || credential.length === 0 || !text.includes(credential)
  ));
}

function collectCredentialLeakCheck({ runtimeRoot, credentials, cliStartOutput, report }) {
  const marker = readFileSync(join(runtimeRoot, "smoke-runtime.json"), "utf8");
  const runtimeLog = readFileSync(join(runtimeRoot, "runtime.log"), "utf8");
  const status = getSmokeRuntimeStatus({ runtimeRoot });
  const basic = {
    cliStdoutCredentialFree: isCredentialFree(cliStartOutput, credentials),
    cliStderrCredentialFree: isCredentialFree(JSON.stringify({ status: "smoke_runtime_failed" }), credentials),
    markerCredentialFree: isCredentialFree(marker, credentials),
    statusCredentialFree: isCredentialFree(status, credentials),
    runtimeLogCredentialFree: isCredentialFree(runtimeLog, credentials),
  };
  const driverLogCredentialFree = isCredentialFree(
    JSON.stringify({ ...report, credentialLeakCheck: basic }),
    credentials,
  );
  const finalEvidenceSummaryCredentialFree = isCredentialFree(
    JSON.stringify({
      credentialLeakCheck: { ...basic, driverLogCredentialFree },
      ownerStatus: report.ownerFirst?.evidence.response.status ?? null,
      visitorAStatus: report.visitorA?.evidence.response.status ?? null,
      visitorBStatus: report.visitorB?.evidence.response.status ?? null,
    }),
    credentials,
  );
  return { ...basic, driverLogCredentialFree, finalEvidenceSummaryCredentialFree };
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const state = { request: null, response: null, finishedAt: null, consoleErrorCount: 0, externalHttpRequestCount: 0 };
  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", resolveReady, { once: true });
    socket.addEventListener("error", rejectReady, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error("cdp_command_failed"));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      state.consoleErrorCount += 1;
      return;
    }
    const params = message.params ?? {};
    if (message.method === "Network.requestWillBeSent" && typeof params.request?.url === "string") {
      try {
        const requestUrl = new URL(params.request.url);
        if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") && requestUrl.origin !== `http://${HOST}:${PORT}`) {
          state.externalHttpRequestCount += 1;
        }
      } catch { /* malformed values are not emitted or followed */ }
    }
    const url = params.request?.url ?? params.response?.url;
    if (typeof url !== "string" || !url.endsWith("/api/opportunities/sellersprite-preview")) return;
    if (message.method === "Network.requestWillBeSent") {
      const headers = params.request?.headers ?? {};
      const get = (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
      state.request = {
        id: params.requestId,
        url,
        method: params.request?.method,
        startedAt: new Date().toISOString(),
        headers: {
          origin: get("origin"), referer: get("referer"), host: get("host"), ":authority": get(":authority"),
          "sec-fetch-site": get("sec-fetch-site"), "sec-fetch-mode": get("sec-fetch-mode"), "content-type": get("content-type"),
        },
      };
    }
    if (message.method === "Network.responseReceived" && state.request?.id === params.requestId) {
      const headers = params.response?.headers ?? {};
      const get = (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
      state.response = {
        id: params.requestId,
        status: params.response?.status,
        headers: { "content-type": get("content-type"), "cache-control": get("cache-control") },
        receivedAt: new Date().toISOString(),
      };
    }
    if (message.method === "Network.loadingFinished" && state.response?.id === params.requestId) state.finishedAt = new Date().toISOString();
  });
  return {
    ready,
    state,
    async send(method, params = {}, sessionId) {
      await ready;
      return await new Promise((resolveSend, rejectSend) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); },
  };
}

async function startChrome(runtimeRoot) {
  assertPortFree(CDP_PORT);
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-address=${HOST}`, `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(runtimeRoot, "chrome-profile")}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank",
  ], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  if (!Number.isInteger(child.pid)) throw new Error("smoke_chrome_pid_missing");
  for (let index = 0; index < 80; index += 1) {
    try {
      const version = await (await fetch(`http://${HOST}:${CDP_PORT}/json/version`)).json();
      if (version.webSocketDebuggerUrl) return { pid: child.pid, webSocketDebuggerUrl: version.webSocketDebuggerUrl };
    } catch { /* wait for this owned browser only */ }
    await wait(100);
  }
  throw new Error("smoke_chrome_cdp_timeout");
}

function stopOwnedProcess(pid) {
  if (!Number.isInteger(pid)) throw new Error("smoke_owned_pid_missing");
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) throw new Error("smoke_owned_process_stop_failed");
}

async function pageSession(client) {
  const context = await client.send("Target.createBrowserContext");
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId);
  return { sessionId, browserContextId: context.browserContextId };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error("smoke_page_script_failed");
  return result.result?.value;
}

async function waitFor(client, sessionId, expression) {
  for (let index = 0; index < 100; index += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await wait(50);
  }
  throw new Error("smoke_page_timeout");
}

async function login(client, sessionId, mode, password, inspection) {
  await client.send("Page.navigate", { url: `http://${HOST}:${PORT}/` }, sessionId);
  await waitFor(client, sessionId, "document.readyState === 'complete'");
  const selector = mode === "owner" ? "#owner-password" : "#guest-password";
  if (mode === "visitor") await evaluate(client, sessionId, "document.querySelector('[role=tab][aria-selected=\"false\"]')?.click(); true");
  for (let index = 0; index < 100; index += 1) {
    if (await evaluate(client, sessionId, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) break;
    await wait(50);
  }
  inspection.beforeSubmit = await evaluate(client, sessionId, "(() => ({ ownerControl: Boolean(document.querySelector('#owner-password')), visitorControl: Boolean(document.querySelector('#guest-password')), previewControl: Boolean(document.querySelector('#sellersprite-xlsx')), ready: document.readyState === 'complete', pagePath: location.pathname }))()");
  if (!inspection.beforeSubmit[mode === "owner" ? "ownerControl" : "visitorControl"]) throw new Error("smoke_login_control_missing");
  await evaluate(client, sessionId, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(password)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  for (let index = 0; index < 20; index += 1) {
    if (await evaluate(client, sessionId, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); return Boolean(input?.value && !input.closest('form').querySelector('button[type=submit]').disabled); })()`)) break;
    await wait(25);
  }
  await evaluate(client, sessionId, `document.querySelector(${JSON.stringify(selector)}).closest('form').querySelector('button[type=submit]').click(); true`);
  for (let index = 0; index < 100; index += 1) {
    if (await evaluate(client, sessionId, `!document.querySelector(${JSON.stringify(selector)})`)) break;
    await wait(50);
  }
  inspection.afterSubmit = await evaluate(client, sessionId, "(() => ({ ownerControl: Boolean(document.querySelector('#owner-password')), visitorControl: Boolean(document.querySelector('#guest-password')), previewControl: Boolean(document.querySelector('#sellersprite-xlsx')), ready: document.readyState === 'complete', pagePath: location.pathname }))()");
  if (inspection.afterSubmit[mode === "owner" ? "ownerControl" : "visitorControl"]) throw new Error("smoke_login_not_completed");
  await client.send("Page.navigate", { url: `http://${HOST}:${PORT}/opportunities/sellersprite-preview` }, sessionId);
  for (let index = 0; index < 100; index += 1) {
    if (await evaluate(client, sessionId, "Boolean(document.querySelector('#sellersprite-xlsx'))")) break;
    await wait(50);
  }
  inspection.previewPage = await evaluate(client, sessionId, "(() => ({ previewControl: Boolean(document.querySelector('#sellersprite-xlsx')), pagePath: location.pathname }))()");
  if (!inspection.previewPage.previewControl) throw new Error("smoke_preview_control_missing");
}

async function upload(client, sessionId, fixturePath, addForgedRole) {
  client.state.request = null; client.state.response = null; client.state.finishedAt = null;
  if (addForgedRole) {
    await evaluate(client, sessionId, "(() => { const nativeFetch = window.fetch.bind(window); window.fetch = (input, init) => { const url = typeof input === 'string' ? input : String(input?.url ?? ''); if (!url.endsWith('/api/opportunities/sellersprite-preview')) return nativeFetch(input, init); const headers = new Headers(init?.headers ?? {}); headers.set('x-client-role', 'owner'); return nativeFetch(input, { ...init, headers }); }; return true; })()");
  }
  const documentRoot = await client.send("DOM.getDocument", { depth: 1 }, sessionId);
  const node = await client.send("DOM.querySelector", { nodeId: documentRoot.root.nodeId, selector: "#sellersprite-xlsx" }, sessionId);
  if (!node.nodeId) throw new Error("smoke_file_input_missing");
  await client.send("DOM.setFileInputFiles", { files: [fixturePath], nodeId: node.nodeId }, sessionId);
  const selected = await evaluate(client, sessionId, "(() => { const file = document.querySelector('#sellersprite-xlsx')?.files?.[0]; return Boolean(file && file.name.endsWith('.xlsx')); })()");
  if (!selected) throw new Error("smoke_file_not_selected");
  await evaluate(client, sessionId, "document.querySelector('#sellersprite-xlsx').closest('form').querySelector('button[type=submit]').click(); true");
  for (let index = 0; index < 120; index += 1) {
    if (client.state.response && client.state.finishedAt) break;
    await wait(50);
  }
  if (!client.state.request || !client.state.response) throw new Error("smoke_preview_response_missing");
  const rawBody = await client.send("Network.getResponseBody", { requestId: client.state.response.id }, sessionId);
  let json = null;
  let isJson = false;
  try { json = JSON.parse(rawBody.body); isJson = true; } catch { /* evidence remains status-only */ }
  const pageFinalUrl = await evaluate(client, sessionId, "location.href");
  const evidence = buildSellerSpritePreviewAcceptanceEvidence({
    request: { ...client.state.request, pageFinalUrl, finishedAt: client.state.finishedAt ?? client.state.response.receivedAt ?? new Date().toISOString() },
    response: { ...client.state.response, isJson, json },
  });
  const ui = await evaluate(client, sessionId, "(() => { const panel = document.querySelector('[aria-label=\"卖家精灵安全预览操作区\"]'); const panelText = panel?.textContent ?? ''; const pageText = document.body.textContent ?? ''; return { summary: Boolean(document.querySelector('[aria-label=\"预览摘要\"]')), blocking: Boolean(document.querySelector('[aria-label=\"阻断冲突\"]')), readonly: pageText.includes('只读预览，尚未进入商品研究池'), ownerOnly: pageText.includes('仅 Owner'), forbidden: ['Ranking','Snapshot','Shadow Report','机会分','采购建议','Candidate','Task'].some((term) => panelText.includes(term)) }; })()");
  return { evidence, ui };
}

function appendSyntheticVisitor(storePath, password) {
  const store = JSON.parse(readFileSync(storePath, "utf8"));
  const salt = randomBytes(16).toString("hex");
  store.accesses.push({ id: `demo_${randomBytes(8).toString("hex")}`, label: "3115 synthetic Visitor B", passwordHash: `sha256:${createHash("sha256").update(salt + password).digest("hex")}`, salt, expiresAt: null, maxAiCalls: 1, usedAiCalls: 0, isActive: true, createdAt: new Date().toISOString(), lastUsedAt: null, notes: "Disposable local smoke runtime only." });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
  const runtimeRoot = `C:\\Users\\a2578\\Desktop\\qingxuan-smoke\\seller-preview-3115-${startedAt}-response-evidence`;
  let smoke; let chrome; let client;
  let ownerPassword; let visitorAPassword; let visitorBPassword;
  let phase = "preflight";
  let cliStartOutput;
  const report = { ownerFirst: null, ownerLoginState: null, ownerNormal: null, visitorA: null, visitorB: null, isolatedDbUnchangedDuringPreview: null, credentialLeakCheck: null, failurePhase: null, failureCode: null, cleanup: null };
  try {
    assertPortFree(PORT); assertPortFree(CDP_PORT);
    phase = "start_runtime";
    smoke = await startSmokeRuntime({ runtimeRoot, worktreeRoot: WORKTREE });
    cliStartOutput = formatSmokeRuntimeStartOutput(smoke);
    ownerPassword = smoke.ownerPassword;
    visitorAPassword = smoke.visitorPassword;
    delete smoke.ownerPassword;
    delete smoke.visitorPassword;
    const fixturePath = join(runtimeRoot, "synthetic-last-round.xlsx");
    const fixtureTool = join(WORKTREE, "node_modules", "tsx", "dist", "cli.mjs");
    const fixtureScript = join(WORKTREE, "scripts", "sellersprite-preview-smoke-fixtures.ts");
    phase = "write_fixture";
    const fixtureResult = spawnSync(process.execPath, [fixtureTool, fixtureScript, "last-round", fixturePath], { cwd: WORKTREE, windowsHide: true, stdio: "ignore" });
    if (fixtureResult.status !== 0 || !existsSync(fixturePath)) throw new Error("smoke_fixture_write_failed");
    phase = "start_chrome";
    chrome = await startChrome(runtimeRoot);
    phase = "connect_cdp";
    client = cdpClient(chrome.webSocketDebuggerUrl); await client.ready;
    phase = "owner_context";
    const owner = await pageSession(client);
    phase = "owner_login";
    report.ownerLoginState = {};
    await login(client, owner.sessionId, "owner", ownerPassword, report.ownerLoginState);
    const isolatedDbHashBeforePreview = fileSha256(join(runtimeRoot, "dev.db"));
    phase = "owner_upload";
    report.ownerFirst = await upload(client, owner.sessionId, fixturePath, false);
    if (report.ownerFirst.evidence.response.status !== 200 || !report.ownerFirst.ui.summary || !report.ownerFirst.ui.readonly || report.ownerFirst.ui.ownerOnly || report.ownerFirst.ui.forbidden) return;
    visitorBPassword = randomBytes(18).toString("base64url");
    appendSyntheticVisitor(join(runtimeRoot, "demo-access.json"), visitorBPassword);
    const visitorA = await pageSession(client);
    await login(client, visitorA.sessionId, "visitor", visitorAPassword, {});
    report.visitorA = await upload(client, visitorA.sessionId, fixturePath, true);
    const visitorB = await pageSession(client);
    await login(client, visitorB.sessionId, "visitor", visitorBPassword, {});
    const blank = await evaluate(client, visitorB.sessionId, "!document.querySelector('[aria-label=\"预览摘要\"]')");
    report.visitorB = { blankBeforeUpload: blank, ...(await upload(client, visitorB.sessionId, fixturePath, false)) };
    report.ownerNormal = { ownerStillRendered: await evaluate(client, owner.sessionId, "Boolean(document.querySelector('[aria-label=\"预览摘要\"]'))") };
    report.isolatedDbUnchangedDuringPreview = fileSha256(join(runtimeRoot, "dev.db")) === isolatedDbHashBeforePreview;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    report.failureCode = /^smoke_(?:login_control_missing|login_not_completed|preview_control_missing|preview_response_missing|file_input_missing|file_not_selected|fixture_write_failed|chrome_cdp_timeout|page_timeout|page_script_failed|port_not_free)$/.test(code)
      ? code
      : "acceptance_driver_failed";
  } finally {
    if (smoke) {
      try {
        report.credentialLeakCheck = collectCredentialLeakCheck({
          runtimeRoot: smoke.runtimeRoot,
          credentials: [ownerPassword, visitorAPassword, visitorBPassword],
          cliStartOutput,
          report,
        });
        if (!Object.values(report.credentialLeakCheck).every(Boolean)) {
          report.failureCode = report.failureCode ?? "credential_leak_detected";
        }
      } catch {
        report.failureCode = report.failureCode ?? "credential_leak_check_failed";
      }
    }
    ownerPassword = undefined;
    visitorAPassword = undefined;
    visitorBPassword = undefined;
    if (client) client.close();
    if (chrome?.pid) stopOwnedProcess(chrome.pid);
    if (smoke) { stopSmokeRuntime({ runtimeRoot: smoke.runtimeRoot }); cleanupSmokeRuntime({ runtimeRoot: smoke.runtimeRoot, worktreeRoot: WORKTREE }); }
    report.failurePhase = phase === "owner_upload" && report.ownerFirst ? null : phase;
    report.cleanup = { port3115Free: localListeners(PORT).length === 0, cdpPortFree: localListeners(CDP_PORT).length === 0, chromeConsoleErrors: client?.state.consoleErrorCount ?? null, externalHttpRequestCount: client?.state.externalHttpRequestCount ?? null };
    console.log(JSON.stringify(report));
    if (report.failureCode) process.exitCode = 1;
  }
}

main().catch(() => { console.log(JSON.stringify({ status: "acceptance_driver_failed" })); process.exitCode = 1; });
