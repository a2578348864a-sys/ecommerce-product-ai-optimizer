#!/usr/bin/env node
/**
 * V3.1 Phase 2 — PUBLIC_RELEASE 前置门禁检查（§12 / §26 / §55）
 *
 * 1) QX_RUNTIME_MODE 必须显式 = public_showcase（env missing 不得通过）；
 * 2) PUBLIC_SHOWCASE_NODE_INSTANCES = 1（fork_mode 单实例；instances>1 或 cluster → BLOCKED）。
 *
 * 用法：node scripts/v31-release-gate-check.mjs [--instances N --exec-mode fork_mode]
 * 不传实例参数时尝试读取 pm2 jlist（存在则校验，否则要求环境变量 QX_NODE_INSTANCES）。
 */

const RUNTIME_MODE_ENV = "QX_RUNTIME_MODE";

function isExplicitPublicShowcase() {
  return (process.env[RUNTIME_MODE_ENV] || "").trim().toLowerCase() === "public_showcase";
}

function isNodeInstancesOne(instances, execMode) {
  return execMode === "fork_mode" && instances === 1;
}

async function readPm2Instances() {
  const { execFileSync } = await import("node:child_process");
  try {
    const raw = execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 10000 });
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return null;
    const app = list.find((item) => item?.pm2_env?.exec_mode !== undefined) || list[0];
    return {
      execMode: app?.pm2_env?.exec_mode || null,
      instances: typeof app?.pm2_env?.instances === "number" ? app.pm2_env.instances : null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const reasons = [];
  if (!isExplicitPublicShowcase()) {
    reasons.push("QX_RUNTIME_MODE must be explicitly set to public_showcase (env missing is NOT allowed)");
  }

  const args = process.argv.slice(2);
  let instances = null;
  let execMode = null;
  const idxI = args.indexOf("--instances");
  const idxE = args.indexOf("--exec-mode");
  if (idxI >= 0 && args[idxI + 1]) instances = Number(args[idxI + 1]);
  if (idxE >= 0 && args[idxE + 1]) execMode = args[idxE + 1];

  if (instances === null) {
    const pm2 = await readPm2Instances();
    if (pm2) { instances = pm2.instances; execMode = pm2.execMode; }
    else if (process.env.QX_NODE_INSTANCES) {
      instances = Number(process.env.QX_NODE_INSTANCES);
      execMode = process.env.QX_NODE_EXEC_MODE || "fork_mode";
    }
  }

  if (!isNodeInstancesOne(instances, execMode)) {
    reasons.push(`PUBLIC_SHOWCASE must run fork_mode with instances=1 (got exec=${execMode ?? "unknown"} instances=${instances ?? "unknown"}); multi-instance requires CROSS_PROCESS_ATOMICITY=PASS`);
  }

  if (reasons.length > 0) {
    console.error("PUBLIC_RELEASE = BLOCKED");
    for (const reason of reasons) console.error("  - " + reason);
    process.exit(1);
  }
  console.log("PUBLIC_RELEASE = GATE_PASS");
  console.log("  - QX_RUNTIME_MODE=public_showcase (explicit)");
  console.log(`  - fork_mode single instance (instances=${instances})`);
}

main().catch((error) => {
  console.error("PUBLIC_RELEASE = BLOCKED (gate check error)");
  console.error("  - " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});