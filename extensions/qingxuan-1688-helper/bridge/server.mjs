/**
 * Qingxuan 1688 Sourcing Helper — Authenticated Loopback Bridge（V3.5 正式版）
 *
 * §11/§12：V1 采用 Authenticated Loopback Bridge（Native Messaging DEFERRED）。
 *
 * 安全边界：
 * - 仅监听 127.0.0.1（禁止 0.0.0.0）。
 * - 轻选客户端通道（/jobs、/enqueue-command、/results GET、/status）：要求 `x-bridge-token`
 *   header 等于启动参数 `--token <256bit>`（轻选服务端生成并持有）。
 * - 扩展 SW 通道（/pending-command、/results POST）：无 token（loopback + 128bit jobId 凭证 +
 *   一次性消费 + TTL）。已知偏差：本机进程可轮询 SW 通道；威胁与"本机进程可读用户文件"等价，
 *   文档化接受；正式升级路径 = Native Messaging（DEFERRED）。
 * - 命令 action allowlist：getState/upload/submit/collect；未知 action 拒绝。
 * - 图片仅接受轻选注册的 job（base64 内联命令；大小 ≤30MB；MIME 允许集）。
 * - No Double Submit（§31/§32）：job.phase 门禁——submit 每 job 只执行一次；重复提交返回
 *   duplicate_submit（fail-closed，绝不重新点击）。command nonce 去重防 retry 双执行。
 * - 不记录 cookie/token/QR/路径；只记录 jobId/status/timing（§34）。
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = 53318;
const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_COMMAND_BYTES = 6 * 1024 * 1024; // 命令含图片 base64（候选图 ≤4MB 时足够）
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_COMMANDS = new Set(["getState", "upload", "submit", "collect"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

const token = parseToken(process.argv);
if (!token) {
  console.error("用法: node server.mjs --token <256bit-hex>");
  process.exit(1);
}

function parseToken(argv) {
  const index = argv.indexOf("--token");
  if (index < 0 || !argv[index + 1]) return null;
  const value = argv[index + 1];
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

/** @type {Map<string, {image: Buffer|null, meta: Object, phase: string, nonces: Set<string>, expiresAt: number}>} */
const jobs = new Map();
const pendingCommands = [];
/** @type {Map<string, {jobId: string, result: Object, expiresAt: number}>} */
const results = new Map();
let lastExtensionSeenAt = 0;

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-private-network": "true",
  });
  res.end(JSON.stringify(body));
}

function prune() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt <= now) jobs.delete(id);
  while (pendingCommands.length > 0 && pendingCommands[0].expiresAt <= now) pendingCommands.shift();
  for (const [id, result] of results) if (result.expiresAt <= now) results.delete(id);
}

function readBody(req, limitBytes) {
  return new Promise((resolveRead, rejectRead) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        rejectRead(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveRead(Buffer.concat(chunks)));
    req.on("error", rejectRead);
  });
}

/** 轻选客户端认证：header x-bridge-token 必须匹配启动 token */
function requireClientToken(req, res) {
  const header = req.headers["x-bridge-token"];
  if (typeof header !== "string" || header !== token) {
    json(res, 401, { ok: false, code: "invalid_token" });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  prune();
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type, x-bridge-token",
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600",
    });
    return res.end();
  }

  try {
    // 扩展 SW 通道（无 token；jobId 凭证）
    if (path === "/pending-command" && req.method === "GET") {
      lastExtensionSeenAt = Date.now();
      const next = pendingCommands.shift();
      if (!next) return res.writeHead(204).end();
      return json(res, 200, { jobId: next.jobId, command: next.command, commandNonce: next.nonce });
    }
    if (path === "/results" && req.method === "POST") {
      lastExtensionSeenAt = Date.now();
      const raw = await readBody(req, 2 * 1024 * 1024);
      const body = JSON.parse(raw.toString("utf8"));
      if (!body || typeof body.jobId !== "string" || !body.result) {
        return json(res, 400, { ok: false, code: "invalid_result" });
      }
      const job = jobs.get(body.jobId);
      if (!job) return json(res, 404, { ok: false, code: "job_not_found" });
      // 命令回报幂等：同 nonce 只接受一次（SW 重连/重试不覆盖）
      if (typeof body.commandNonce === "string" && job.nonces.has(`result:${body.commandNonce}`)) {
        return json(res, 200, { ok: true, duplicate: true });
      }
      if (typeof body.commandNonce === "string") job.nonces.add(`result:${body.commandNonce}`);
      results.set(body.jobId, { jobId: body.jobId, result: body.result, expiresAt: Date.now() + JOB_TTL_MS });
      return json(res, 200, { ok: true });
    }

    // ── 以下全部为轻选客户端通道（需 token） ──
    if (!requireClientToken(req, res)) return;

    if (path === "/health" && req.method === "GET") {
      return json(res, 200, { ok: true, jobs: jobs.size, extensionSeen: lastExtensionSeenAt > 0, lastExtensionSeenAt });
    }

    if (path === "/jobs" && req.method === "POST") {
      const raw = await readBody(req, MAX_IMAGE_BYTES + 64 * 1024);
      const body = JSON.parse(raw.toString("utf8"));
      if (!body || typeof body.imageBase64 !== "string" || !body.meta || typeof body.meta !== "object") {
        return json(res, 400, { ok: false, code: "invalid_job" });
      }
      const image = Buffer.from(body.imageBase64, "base64");
      if (image.length < 1 || image.length > MAX_IMAGE_BYTES) {
        return json(res, 400, { ok: false, code: "image_size_invalid" });
      }
      const contentType = typeof body.meta.contentType === "string" ? body.meta.contentType : "image/jpeg";
      if (!ALLOWED_MIME.has(contentType)) {
        return json(res, 400, { ok: false, code: "invalid_mime" });
      }
      // job 绑定（§13/§48）：taskId/candidateId/imageHash 必须由轻选提供且强校验在服务端
      const meta = {
        taskId: typeof body.meta.taskId === "string" ? body.meta.taskId.slice(0, 200) : "",
        candidateId: typeof body.meta.candidateId === "string" ? body.meta.candidateId.slice(0, 200) : "",
        imageHash: typeof body.meta.imageHash === "string" ? body.meta.imageHash.slice(0, 128) : "",
        contentType,
      };
      if (!meta.taskId || !meta.candidateId || !meta.imageHash) {
        return json(res, 400, { ok: false, code: "invalid_job_binding" });
      }
      const jobId = randomBytes(16).toString("hex");
      jobs.set(jobId, { image, meta, phase: "created", nonces: new Set(), expiresAt: Date.now() + JOB_TTL_MS });
      return json(res, 200, { ok: true, jobId });
    }

    if (path === "/jobs/enqueue-command" && req.method === "POST") {
      const raw = await readBody(req, MAX_COMMAND_BYTES);
      const body = JSON.parse(raw.toString("utf8"));
      if (!body || typeof body.jobId !== "string" || !body.command || !ALLOWED_COMMANDS.has(body.command.type)) {
        return json(res, 400, { ok: false, code: "invalid_command" });
      }
      const job = jobs.get(body.jobId);
      if (!job) return json(res, 404, { ok: false, code: "job_not_found" });
      // No Double Submit（§31/§32）：submit 每 job 只执行一次
      if (body.command.type === "submit" && job.phase === "submitted") {
        return json(res, 200, { ok: true, duplicate: true, code: "duplicate_submit" });
      }
      // command nonce 去重（防 retry 双执行）
      const nonce = typeof body.nonce === "string" && /^[a-f0-9]{32,64}$/.test(body.nonce) ? body.nonce : randomBytes(16).toString("hex");
      if (job.nonces.has(`cmd:${nonce}`)) {
        return json(res, 200, { ok: true, duplicate: true });
      }
      job.nonces.add(`cmd:${nonce}`);
      if (body.command.type === "upload") {
        // 图片内联（§14）：从 job 取图片 base64 注入命令（避免重复传图；命令仍小）
        const imageBase64 = job.image ? job.image.toString("base64") : "";
        if (!imageBase64) return json(res, 400, { ok: false, code: "job_image_consumed" });
        job.image = null; // 一次性
        job.phase = "uploading";
        pendingCommands.push({ jobId: body.jobId, command: { ...body.command, payload: { imageBase64 } }, nonce, expiresAt: Date.now() + JOB_TTL_MS });
      } else {
        if (body.command.type === "submit" && job.phase !== "submitted") job.phase = "submitted";
        pendingCommands.push({ jobId: body.jobId, command: body.command, nonce, expiresAt: Date.now() + JOB_TTL_MS });
      }
      return json(res, 200, { ok: true });
    }

    const resultMatch = path.match(/^\/results\/([a-f0-9]{32})$/);
    if (resultMatch && req.method === "GET") {
      const entry = results.get(resultMatch[1]);
      if (!entry) return json(res, 404, { ok: false, code: "result_not_found" });
      results.delete(resultMatch[1]);
      return json(res, 200, { ok: true, result: entry.result });
    }

    if (path === "/jobs/status" && req.method === "GET") {
      const jobId = url.searchParams.get("jobId") ?? "";
      const job = jobs.get(jobId);
      if (!job) return json(res, 404, { ok: false, code: "job_not_found" });
      return json(res, 200, { ok: true, phase: job.phase, taskId: job.meta.taskId, candidateId: job.meta.candidateId });
    }

    return json(res, 404, { ok: false, code: "not_found" });
  } catch (error) {
    return json(res, 400, { ok: false, code: "bad_request", message: String(error).slice(0, 200) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[v35-bridge] listening on http://${HOST}:${PORT} (token auth enabled)`);
});
