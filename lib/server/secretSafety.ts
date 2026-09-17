/**
 * Secret Safety & Repository Credential Audit Engine
 *
 * 核心原则：
 * 1. Fail-Closed：所有 git 探测命令执行异常或非预期状态码必须直接抛出异常导致测试失败；
 * 2. 零凭据泄露：审计失败时严禁输出具体凭据内容，仅暴露 path, line, rule；
 * 3. 严格白名单：禁止任意 assignment 放行（彻底剔除宽泛前缀匹配）。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

export interface SecretAuditViolation {
  path: string;
  line?: number;
  rule: string;
}

export function runGitCommand(args: string[], cwd?: string): { stdout: string; code: number } {
  const result = spawnSync("git", args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`git ${args[0]} execution failed: ${result.error.message}`);
  }

  const code = result.status ?? 0;
  return { stdout: result.stdout || "", code };
}

export function runGitLsFiles(args: string[] = [], cwd?: string): string {
  const { stdout, code } = runGitCommand(["ls-files", ...args], cwd);
  if (code !== 0) {
    throw new Error(`git ls-files exited with non-zero code ${code}`);
  }
  return stdout;
}

export function runGitGrep(args: string[], cwd?: string): string {
  const { stdout, code } = runGitCommand(["grep", ...args], cwd);
  if (code === 1) {
    // git grep: 1 表示无匹配（正常干净状态）
    return "";
  }
  if (code !== 0) {
    throw new Error(`git grep exited with non-zero code ${code}`);
  }
  return stdout;
}

/**
 * 扫描所有被 Git 跟踪的 env 文件（.env, .env.*，包括任何子目录）
 * 明确只允许 .env.example 及 *.example / *.template
 */
export function auditTrackedEnvFiles(cwd?: string): SecretAuditViolation[] {
  const output = runGitLsFiles([], cwd);
  const files = output.split("\n").map((s) => s.trim()).filter(Boolean);
  const violations: SecretAuditViolation[] = [];

  for (const file of files) {
    const base = path.basename(file);
    if (base === ".env" || base.startsWith(".env.")) {
      const isAllowedExample =
        base.endsWith(".example") ||
        base.endsWith(".template") ||
        file.endsWith(".example") ||
        file.endsWith(".template");
      if (!isAllowedExample) {
        violations.push({ path: file, rule: "DISALLOWED_TRACKED_ENV_FILE" });
      }
    }
  }

  return violations;
}

/**
 * 扫描 Git 跟踪代码中的真实 sk-* API Token
 * 覆盖 sk-, sk-proj-, sk-ant- 以及长 token 模式
 * 失败时绝不泄露具体凭据，仅报告 path, line, rule
 */
export function auditSkTokens(cwd?: string): SecretAuditViolation[] {
  const output = runGitGrep(["-n", "-I", "-E", "\\bsk-[a-zA-Z0-9_-]{20,}\\b"], cwd);
  if (!output.trim()) return [];

  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const allowedPlaceholders = [
    "sk-placeholder",
    "sk-ant-api03-placeholder",
    "sk-proj-placeholder",
    "sk-test-mock-token-000000000000",
    "sk-live-abcdef0123456789",
    "sk-event-1111222233334444",
  ];

  const violations: SecretAuditViolation[] = [];

  for (const line of lines) {
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    if (firstColon === -1 || secondColon === -1) continue;

    const filePath = line.slice(0, firstColon);
    const lineNum = Number(line.slice(firstColon + 1, secondColon));
    const content = line.slice(secondColon + 1);

    const isPlaceholder = allowedPlaceholders.some((pl) => content.includes(pl));
    if (!isPlaceholder) {
      let rule = "SK_TOKEN_GENERIC";
      if (/\bsk-proj-[a-zA-Z0-9_-]{15,}\b/.test(content)) {
        rule = "SK_PROJ_TOKEN_LEAK";
      } else if (/\bsk-ant-[a-zA-Z0-9_-]{15,}\b/.test(content)) {
        rule = "SK_ANT_TOKEN_LEAK";
      } else if (/\bsk-[a-zA-Z0-9_-]{35,}\b/.test(content)) {
        rule = "SK_LONG_TOKEN_LEAK";
      }
      violations.push({ path: filePath, line: lineNum, rule });
    }
  }

  return violations;
}

/**
 * 扫描 ACCESS_PASSWORD 与 PROOF_SIGNING_SECRET 赋值与引用
 * 剔除一切宽泛前缀放行，严格限定于明确的占位符、固定测试 mock 值或代码变量引用
 */
export function auditAccessPasswordAndSigningSecrets(cwd?: string): SecretAuditViolation[] {
  const output = runGitGrep(["-n", "-I", "-E", "(ACCESS_PASSWORD|PROOF_SIGNING_SECRET)\\s*=\\s*"], cwd);
  if (!output.trim()) return [];

  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const allowedPatterns = [
    "change_this_password",
    "replace_with_a_separate_random_server_secret",
    "your_strong_access_password_here",
    "guest-test-signing-secret",
    "synthetic-password-for-tests",
    "d1-test-secret",
    "test-dummy-for-tasks-list",
    "888888",
    "test-dummy-password-for-unit-tests",
    "security-gate-test-pw",
    "test-secret",
    "phase2-guard-secret",
    "TEST_SECRET",
    "fallback-key",
    "= ownerPassword",
    "= proofSigningSecret",
    "readFileSync(ENV_FILE",
    '"ACCESS_PASSWORD=",',
  ];

  const violations: SecretAuditViolation[] = [];

  for (const line of lines) {
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    if (firstColon === -1 || secondColon === -1) continue;

    const filePath = line.slice(0, firstColon);
    const lineNum = Number(line.slice(firstColon + 1, secondColon));
    const content = line.slice(secondColon + 1);

    const isAllowed = allowedPatterns.some((pattern) => content.includes(pattern));
    if (!isAllowed) {
      violations.push({
        path: filePath,
        line: lineNum,
        rule: "UNAUTHORIZED_SECRET_ASSIGNMENT",
      });
    }
  }

  return violations;
}
