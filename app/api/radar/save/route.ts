import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";

export const runtime = "nodejs";

const MAX_SAVE_BODY_BYTES = 512 * 1024;
const REDACTED = "[REDACTED]";
const RELATIVE_SAVE_DIR = ".local/radar-research";
const SENSITIVE_KEY_PATTERN = /^(api[_-]?key|key|authorization|cookie|set-cookie|token|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|secret|password|database_url|DATABASE_URL|openai_api_key|OPENAI_API_KEY|deepseek_api_key|DEEPSEEK_API_KEY|dashscope_api_key|DASHSCOPE_API_KEY)$/i;
const SENSITIVE_TEXT_PATTERN = /((?:api[_-]?key|key|authorization|cookie|set-cookie|token|accessToken|refreshToken|secret|password|DATABASE_URL|OPENAI_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY)\s*[:=]\s*)([^\s,;'"`]+)/gi;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LIKELY_SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

function isRadarEnabled() {
  return process.env.NODE_ENV !== "production";
}

function radarNotFoundResponse() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") || "";
  return host.startsWith("localhost:")
    || host.startsWith("127.0.0.1:")
    || host.startsWith("[::1]:");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactSensitiveText(value: string) {
  return value
    .replace(SENSITIVE_TEXT_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_TOKEN_PATTERN, REDACTED)
    .replace(LIKELY_SECRET_PATTERN, REDACTED);
}

function redactSensitiveData(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSensitiveData(item),
      ]),
    );
  }

  return value;
}

function cleanFilePart(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "未命名选品";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timestampId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function POST(request: NextRequest) {
  if (!isRadarEnabled()) {
    return radarNotFoundResponse();
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "本地选品档案只能在 localhost 保存。" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_SAVE_BODY_BYTES) {
    return NextResponse.json({ error: "保存内容过大，请先导出 Markdown 或减少输入内容。" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "保存请求格式不正确，请刷新页面后重试。" }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ error: "保存请求格式不正确。" }, { status: 400 });
  }

  // Demo-Login.1-F: Owner only — Demo forbidden from saving radar data
  const auth = requireAuthenticated(request, body as Record<string, unknown>);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return NextResponse.json({ error: "服务端未配置访问密码，不能保存本地档案。" }, { status: 500 });
  }

  if (typeof body.accessPassword !== "string" || body.accessPassword !== configuredPassword) {
    return NextResponse.json({ error: "访问密码错误，不能保存本地档案。" }, { status: 401 });
  }

  const keyword = cleanFilePart(typeof body.keyword === "string" ? body.keyword : "未命名选品");
  const decision = cleanFilePart(typeof body.finalDecision === "string" ? body.finalDecision : "caution");
  const markdown = redactSensitiveText(typeof body.markdown === "string" ? body.markdown : "");
  const jsonContent = JSON.stringify(redactSensitiveData(body.payload ?? {}), null, 2);

  if (!markdown.trim()) {
    return NextResponse.json({ error: "没有可保存的报告内容，请先生成完整分析。" }, { status: 400 });
  }

  const saveDir = path.join(process.cwd(), ".local", "radar-research");
  await mkdir(saveDir, { recursive: true });

  const baseName = `${today()}_${timestampId()}_${keyword}_${decision}`;
  const markdownFileName = `${baseName}.md`;
  const jsonFileName = `${baseName}.json`;
  const markdownPath = path.join(saveDir, markdownFileName);
  const jsonPath = path.join(saveDir, jsonFileName);

  await Promise.all([
    writeFile(markdownPath, markdown, "utf8"),
    writeFile(jsonPath, jsonContent, "utf8"),
  ]);

  return NextResponse.json({
    ok: true,
    markdownFileName,
    jsonFileName,
    relativeDir: RELATIVE_SAVE_DIR,
  });
}

export async function GET(request: NextRequest) {
  if (!isRadarEnabled()) {
    return radarNotFoundResponse();
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "本地选品档案只能在 localhost 读取。" }, { status: 403 });
  }

  const saveDir = path.join(process.cwd(), ".local", "radar-research");
  try {
    const files = await readdir(saveDir, { withFileTypes: true });
    const jsonFiles = files
      .filter((file) => file.isFile() && file.name.endsWith(".json"))
      .map((file) => file.name)
      .sort()
      .reverse()
      .slice(0, 10);

    const items = await Promise.all(jsonFiles.map(async (fileName) => {
      const fullPath = path.join(saveDir, fileName);
      try {
        const raw = await readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw) as { result?: { finalDecision?: string; summary?: string; riskWarnings?: Array<{ riskType?: string }> }; form?: { keyword?: string }; generatedAt?: string };
        return {
          fileName,
          keyword: parsed.form?.keyword || fileName,
          finalDecision: parsed.result?.finalDecision || "",
          summary: parsed.result?.summary || "",
          risks: parsed.result?.riskWarnings?.map((risk) => risk.riskType).filter(Boolean).slice(0, 3) || [],
          generatedAt: parsed.generatedAt || "",
        };
      } catch {
        return {
          fileName,
          keyword: fileName,
          finalDecision: "",
          summary: "该本地档案暂时无法读取，请直接打开文件检查。",
          risks: [],
          generatedAt: "",
        };
      }
    }));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
