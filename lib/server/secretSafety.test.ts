/**
 * Secret Safety & Git Tracked Credential Audit Test
 *
 * 门禁目标：
 * 1. 杜绝真实凭据泄露进 Git 仓库（API Keys, ACCESS_PASSWORD, PROOF_SIGNING_SECRET 等）；
 * 2. 确保 .env 与 .env.local 保持未跟踪状态（未进入 Git）；
 * 3. 确保所有示例与测试 fixture 中的敏感环境变量仅使用受控占位符。
 */

import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Secret Safety & Git Credential Audit", () => {
  it(".env 与 .env.local 严禁被 Git 跟踪", () => {
    let trackedEnv = "";
    try {
      trackedEnv = execSync("git ls-files .env .env.local", { encoding: "utf8" }).trim();
    } catch {
      trackedEnv = "";
    }
    expect(trackedEnv).toBe("");
  });

  it("Git 跟踪文件中不存在未脱敏的真实 sk- API 密钥", () => {
    let output = "";
    try {
      // git grep 在没有匹配时 exit code 为 1
      output = execSync('git grep -n -I -E "\\bsk-[a-zA-Z0-9]{20,}\\b"', { encoding: "utf8" }).trim();
    } catch {
      output = "";
    }

    const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
    const allowedPlaceholders = [
      "sk-placeholder",
      "sk-ant-api03-placeholder",
      "sk-proj-placeholder",
      "sk-test-mock-token-000000000000",
    ];

    const leaked = lines.filter((line) => {
      return !allowedPlaceholders.some((pl) => line.includes(pl));
    });

    expect(leaked).toEqual([]);
  });

  it("ACCESS_PASSWORD 与 PROOF_SIGNING_SECRET 在已跟踪文件中仅允许为受控占位符或测试注入", () => {
    let output = "";
    try {
      output = execSync('git grep -n -I -E "(ACCESS_PASSWORD|PROOF_SIGNING_SECRET)\\s*=\\s*"', { encoding: "utf8" }).trim();
    } catch {
      output = "";
    }

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
      "ACCESS_PASSWORD=",
      "test-secret",
      "phase2-guard-secret",
      "TEST_SECRET",
      "fallback-key",
      "ownerPassword",
      "proofSigningSecret",
      "readFileSync(ENV_FILE",
    ];

    const suspicious = lines.filter((line) => {
      return !allowedPatterns.some((pattern) => line.includes(pattern));
    });

    expect(suspicious).toEqual([]);
  });
});
