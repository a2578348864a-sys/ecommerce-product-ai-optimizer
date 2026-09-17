/**
 * Secret Safety & Git Tracked Credential Audit Test
 *
 * 门禁测试目标：
 * 1. 生产基线审计：确保当前仓库 0 泄露、0 非法跟踪环境文件；
 * 2. Self-Test 闭环：基于临时 Git fixture 证明 Fail-Closed 机制有效拦截所有风险模式。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditAccessPasswordAndSigningSecrets,
  auditSkTokens,
  auditTrackedEnvFiles,
  runGitGrep,
  runGitLsFiles,
} from "./secretSafety";

describe("Secret Safety & Git Credential Audit (Production Baseline)", () => {
  it(".env 及 .env.* 严禁被 Git 跟踪（仅允许 .env.example 等模版）", () => {
    const violations = auditTrackedEnvFiles();
    expect(violations).toEqual([]);
  });

  it("Git 跟踪文件中不存在未脱敏的真实 sk-* API 密钥（覆盖 sk-, sk-proj-, sk-ant- 等）", () => {
    const violations = auditSkTokens();
    expect(violations).toEqual([]);
  });

  it("ACCESS_PASSWORD 与 PROOF_SIGNING_SECRET 严禁任意赋值，仅允许明确固定测试值或代码引用", () => {
    const violations = auditAccessPasswordAndSigningSecrets();
    expect(violations).toEqual([]);
  });
});

describe("Secret Safety Gate Self-Test (Fail-Closed Verification)", () => {
  let fixtureDir = "";

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-safety-fixture-"));
    execSync("git init", { cwd: fixtureDir, stdio: "ignore" });
    execSync('git config user.email "security-audit@example.com"', { cwd: fixtureDir, stdio: "ignore" });
    execSync('git config user.name "Security Audit"', { cwd: fixtureDir, stdio: "ignore" });
  });

  afterAll(() => {
    if (fixtureDir && fs.existsSync(fixtureDir)) {
      try {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      } catch {
        // 忽略 Windows 临时句柄延迟释放
      }
    }
  });

  it("Self-Test A: 真实 ACCESS_PASSWORD 任意 assignment 必须 FAIL", () => {
    const testFile = "auth-leak.ts";
    const fullPath = path.join(fixtureDir, testFile);
    const secretVar = ["ACCESS", "PASSWORD"].join("_");
    fs.writeFileSync(fullPath, `const ${secretVar} = "real_production_secret_9988";\n`, "utf8");
    execSync(`git add "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    const violations = auditAccessPasswordAndSigningSecrets(fixtureDir);
    execSync(`git rm -f "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].path).toBe(testFile);
    expect(violations[0].rule).toBe("UNAUTHORIZED_SECRET_ASSIGNMENT");
    // 保证绝不打印具体 secret 内容
    expect(JSON.stringify(violations)).not.toContain("real_production_secret_9988");
  });

  it("Self-Test B: 真实长 sk-* token (含 sk-proj- / sk-ant-) 必须 FAIL 且不泄露内容", () => {
    const testFile = "ai-key-leak.ts";
    const fullPath = path.join(fixtureDir, testFile);
    const fakeToken = ["sk", "proj", "abc1234567890123456789012345678901234567890"].join("-");
    fs.writeFileSync(fullPath, `const apiKey = "${fakeToken}";\n`, "utf8");
    execSync(`git add "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    const violations = auditSkTokens(fixtureDir);
    execSync(`git rm -f "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].path).toBe(testFile);
    expect(violations[0].rule).toBe("SK_PROJ_TOKEN_LEAK");
    // 保证只输出 path, line, rule，绝不输出 token 字符串本身
    expect(JSON.stringify(violations)).not.toContain(fakeToken);
  });

  it("Self-Test C: .env.local tracked 必须 FAIL", () => {
    const testFile = ".env.local";
    const fullPath = path.join(fixtureDir, testFile);
    fs.writeFileSync(fullPath, "DATABASE_URL=file:./dev.db\n", "utf8");
    execSync(`git add "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    const violations = auditTrackedEnvFiles(fixtureDir);
    execSync(`git rm -f "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].path).toBe(testFile);
    expect(violations[0].rule).toBe("DISALLOWED_TRACKED_ENV_FILE");
  });

  it("Self-Test D: .env.production tracked 必须 FAIL", () => {
    const testFile = ".env.production";
    const fullPath = path.join(fixtureDir, testFile);
    fs.writeFileSync(fullPath, "NODE_ENV=production\n", "utf8");
    execSync(`git add "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    const violations = auditTrackedEnvFiles(fixtureDir);
    execSync(`git rm -f "${testFile}"`, { cwd: fixtureDir, stdio: "ignore" });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].path).toBe(testFile);
    expect(violations[0].rule).toBe("DISALLOWED_TRACKED_ENV_FILE");
  });

  it("Self-Test E: 合法 placeholder 与白名单测试值必须 PASS", () => {
    const safeEnvExample = ".env.example";
    const safeCode = "safeFixture.ts";

    fs.writeFileSync(path.join(fixtureDir, safeEnvExample), "ACCESS_PASSWORD=change_this_password\n", "utf8");
    fs.writeFileSync(
      path.join(fixtureDir, safeCode),
      'const dummyKey = "sk-placeholder";\nprocess.env.ACCESS_PASSWORD = "test-dummy-password-for-unit-tests";\n',
      "utf8"
    );

    execSync(`git add "${safeEnvExample}" "${safeCode}"`, { cwd: fixtureDir, stdio: "ignore" });

    const envViolations = auditTrackedEnvFiles(fixtureDir);
    const skViolations = auditSkTokens(fixtureDir);
    const pwViolations = auditAccessPasswordAndSigningSecrets(fixtureDir);

    execSync(`git rm -f "${safeEnvExample}" "${safeCode}"`, { cwd: fixtureDir, stdio: "ignore" });

    expect(envViolations).toEqual([]);
    expect(skViolations).toEqual([]);
    expect(pwViolations).toEqual([]);
  });

  it("Self-Test F: git grep 与 git ls-files 命令异常必须 FAIL (绝不当成空结果)", () => {
    // 传递非法参数，git grep 必须抛出异常导致测试失败
    expect(() => {
      runGitGrep(["--unrecognized-fatal-flag-xyz"], fixtureDir);
    }).toThrow();

    // 探测不存在的非 git 目录，git ls-files 必须抛出异常导致测试失败
    const nonGitDir = path.join(os.tmpdir(), "non-git-empty-dir-" + Date.now());
    fs.mkdirSync(nonGitDir, { recursive: true });
    try {
      expect(() => {
        runGitLsFiles([], nonGitDir);
      }).toThrow();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
