import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3102";
const TASK_ID = "cmshfa7z70005t7f0b57kpn4f";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ENV_FILE = "C:/Users/a2578/Documents/Qingxuan-Cutover-Backup/v2-final-acceptance-20260806/env.isolation.local";
const PW = readFileSync(ENV_FILE, "utf8").split("\n").find((l) => l.startsWith("ACCESS_PASSWORD="))!.split("=").slice(1).join("=").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PW }) })).json();
  const token = login.accessToken;
  const profile = mkdtempSync(join(tmpdir(), "v2-draft-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9250", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  await sleep(2500);
  const targets = await fetch("http://127.0.0.1:9250/json/list").then((r) => r.json());
  const page = targets.find((t: { type: string }) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let msgId = 0; const pending = new Map<number, (v: unknown) => void>();
  ws.onmessage = (event) => { const msg = JSON.parse(event.data as string); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); } };
  const send = (m: string, p: Record<string, unknown> = {}) => new Promise<unknown>((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async (e: string) => { const m = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }) as any; return m.result?.result?.value; };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: `${BASE}/` }); await sleep(2500);
  await ev(`(function(){ sessionStorage.setItem("qx:access-token:session:v1", ${JSON.stringify(token)}); sessionStorage.setItem("qx:access-mode:session:v1", "owner"); sessionStorage.setItem("qx:access-password:session:v2", ${JSON.stringify(token)}); sessionStorage.setItem("qx:access-expires:session:v2", String(Date.now()+3600e3)); return "ok"; })()`);
  await send("Page.navigate", { url: `${BASE}/tasks/${TASK_ID}` });
  await sleep(9000);

  // 1. 打开创作交接步骤，走到第 3 步，勾选事实，填补充要求
  await ev(`(function(){
    const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('创作交接') && x.getAttribute('aria-expanded')!==null);
    if(b)b.click(); return 'ok';
  })()`);
  await sleep(2000);
  // 勾选第一个事实
  await ev(`(function(){ const c=[...document.querySelectorAll('input[type="checkbox"]')].find(x=>x.id && x.id.startsWith('confirm-')); if(c){c.click();} return 'ok'; })()`);
  await sleep(800);
  // 点击下一步到步骤2
  await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('下一步')); if(b)b.click(); return 'ok'; })()`);
  await sleep(500);
  // 到步骤3
  await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('下一步')); if(b)b.click(); return 'ok'; })()`);
  await sleep(500);
  // 填补充要求
  await ev(`(function(){
    const t=[...document.querySelectorAll('textarea')].find(x=>x.closest('label') && x.closest('label').innerText.includes('补充要求'));
    if(t){ const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,'强调便携轻量'); t.dispatchEvent(new Event('input',{bubbles:true})); }
    return 'ok';
  })()`);
  await sleep(1500);
  // 读取当前状态
  const step3 = await ev(`(function(){
    const text=document.body.innerText;
    return JSON.stringify({ atStep3: text.includes('补充要求（可选）'), hasDraftSaved: text.includes('草稿已自动保存'), textareaVal: [...document.querySelectorAll('textarea')].find(t=>t.closest('label')&&t.closest('label').innerText.includes('补充要求'))?.value });
  })()`);
  console.log("步骤3状态:", step3);

  // 2. 刷新页面，验证恢复
  await send("Page.reload");
  await sleep(9000);
  await ev(`(function(){
    const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('创作交接') && x.getAttribute('aria-expanded')!==null);
    if(b)b.click(); return 'ok';
  })()`);
  await sleep(2000);
  const restored = await ev(`(function(){
    const text=document.body.innerText;
    const ta=[...document.querySelectorAll('textarea')].find(t=>t.closest('label')&&t.closest('label').innerText.includes('补充要求'));
    return JSON.stringify({ restoredMsg: text.includes('已恢复刷新前的未提交内容'), textareaVal: ta?.value, hasSelected: [...document.querySelectorAll('input[type="checkbox"]')].some(c=>c.checked) });
  })()`);
  console.log("刷新后恢复:", restored);
  ws.close(); chrome.kill();
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
