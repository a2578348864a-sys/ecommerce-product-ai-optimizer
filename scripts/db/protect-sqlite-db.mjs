#!/usr/bin/env node

/**
 * DB-Protection.1 — SQLite Deployment Guard
 *
 * Usage:
 *   node scripts/db/protect-sqlite-db.mjs summary
 *   node scripts/db/protect-sqlite-db.mjs backup [--reason predeploy]
 *   node scripts/db/protect-sqlite-db.mjs predeploy
 *   node scripts/db/protect-sqlite-db.mjs postdeploy --baseline <path>
 *
 * Does NOT: print DATABASE_URL, full resultJson, env values, or DB contents.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Load .env / .env.local silently for DATABASE_URL only (never printed).
// Uses cwd which is the project root when run via npm.
const cwd = resolve(process.cwd());
function loadDatabaseUrl() {
  for (const envName of [".env", ".env.local"]) {
    try {
      const envPath = join(cwd, envName);
      if (!existsSync(envPath)) continue;
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          if (key === "DATABASE_URL" && process.env.DATABASE_URL === undefined) {
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env.DATABASE_URL = val;
            return;
          }
        }
      }
    } catch { /* continue to next */ }
  }
}
loadDatabaseUrl();

// ── DB path resolution ────────────────────────────

function getRawDbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Cannot locate SQLite database.");
  }
  return url;
}

function safeDbBasename() {
  const url = getRawDbUrl();
  if (url.startsWith("file:")) {
    const pathPart = url.slice(5);
    return basename(pathPart) || "unknown.db";
  }
  return basename(url) || "unknown.db";
}

function resolveDbPath() {
  const url = getRawDbUrl();
  if (!url.startsWith("file:")) {
    throw new Error("Only file: SQLite URLs are supported.");
  }
  const relative = url.slice(5);
  // Support Windows absolute paths like file:C:/...
  if (/^[A-Za-z]:[\\/]/.test(relative)) {
    return relative;
  }
  // Resolve relative path from cwd (project root when run via npm)
  let resolved = resolve(relative);
  // If not found, try prisma/ subdirectory (Prisma convention for relative URLs)
  if (!existsSync(resolved)) {
    const altResolved = resolve("prisma", basename(relative));
    if (existsSync(altResolved)) {
      resolved = altResolved;
    }
  }
  return resolved;
}

function safeDbPathLabel() {
  const p = resolveDbPath();
  const parts = p.split(/[\\/]/);
  // Only show last 2 segments
  return parts.slice(-2).join("/");
}

// ── quick_check ────────────────────────────────────

function quickCheck() {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    return { ok: false, reason: "db_file_missing", details: "Database file does not exist." };
  }
  const size = statSync(dbPath).size;
  if (size === 0) {
    return { ok: false, reason: "db_file_empty", details: "Database file exists but is empty (0 bytes)." };
  }
  // Basic SQLite header check: "SQLite format 3\0"
  try {
    const header = readFileSync(dbPath, { encoding: "utf-8", flag: "r" }).slice(0, 16);
    if (!header.startsWith("SQLite format 3")) {
      return { ok: false, reason: "invalid_sqlite_header", details: "Database file does not start with valid SQLite header." };
    }
  } catch {
    return { ok: false, reason: "db_read_error", details: "Cannot read database file for header check." };
  }
  return { ok: true, size };
}

// ── Count tasks ────────────────────────────────────

async function countTasks() {
  const prisma = new PrismaClient();
  try {
    const total = await prisma.viralAnalysisRecord.count();
    return total;
  } finally {
    await prisma.$disconnect();
  }
}

// ── Count listing snapshots ────────────────────────

async function countListingSnapshots() {
  const prisma = new PrismaClient();
  try {
    const records = await prisma.viralAnalysisRecord.findMany({
      select: { id: true, resultJson: true },
    });
    let total = 0;
    let realAi = 0;
    for (const r of records) {
      try {
        const parsed = JSON.parse(r.resultJson);
        const snap = parsed?.aiListingPackSnapshot;
        if (snap?.snapshotType === "ai_listing_pack") {
          total += 1;
          if (snap.source === "real_ai_draft") realAi += 1;
        }
      } catch { /* skip malformed JSON */ }
    }
    return { total, realAi };
  } finally {
    await prisma.$disconnect();
  }
}

// ── Backup ─────────────────────────────────────────

function backupDb(reason = "manual") {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    throw new Error("Database file not found, cannot backup.");
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDirName = `${stamp}`;
  const backupRoot = join(cwd, ".local-backups", "db-guard");
  const backupDir = join(backupRoot, backupDirName);

  mkdirSync(backupDir, { recursive: true });

  const dbName = safeDbBasename();
  const dest = join(backupDir, dbName);
  copyFileSync(dbPath, dest);

  const size = statSync(dest).size;
  if (size === 0) {
    throw new Error("Backup file is empty after copy.");
  }

  // Write metadata
  const metaPath = join(backupDir, "backup-meta.json");
  writeFileSync(metaPath, JSON.stringify({
    timestamp: now.toISOString(),
    reason,
    dbBasename: dbName,
    backupPath: dest,
    sizeBytes: size,
    sha256: createHash("sha256").update(readFileSync(dest)).digest("hex"),
  }, null, 2), "utf-8");

  return { backupDir, dest, size, reason };
}

// ── Baseline ───────────────────────────────────────

function baselinePath() {
  return join(cwd, ".local-backups", "db-guard", "baseline.json");
}

async function writeBaseline() {
  const qc = quickCheck();
  const taskCount = await countTasks();
  const snapCounts = await countListingSnapshots();
  const dbPath = resolveDbPath();
  const size = existsSync(dbPath) ? statSync(dbPath).size : 0;

  const baseline = {
    timestamp: new Date().toISOString(),
    dbBasename: safeDbBasename(),
    dbSizeBytes: size,
    quickCheck: qc,
    taskCount,
    listingSnapshotCount: snapCounts.total,
    realAiListingCount: snapCounts.realAi,
  };

  const bp = baselinePath();
  mkdirSync(dirname(bp), { recursive: true });
  writeFileSync(bp, JSON.stringify(baseline, null, 2), "utf-8");
  return { baseline, baselinePath: bp };
}

async function compareBaseline(baselineFile) {
  if (!existsSync(baselineFile)) {
    return { ok: false, reason: "baseline_missing", details: `Baseline file not found: ${baselineFile}` };
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
  } catch {
    return { ok: false, reason: "baseline_invalid", details: "Baseline file is not valid JSON." };
  }

  const qc = quickCheck();
  if (!qc.ok) {
    return { ok: false, reason: `quick_check_failed: ${qc.reason}`, details: qc.details };
  }

  const taskCount = await countTasks();
  const snapCounts = await countListingSnapshots();
  const dbPath = resolveDbPath();
  const currentSize = existsSync(dbPath) ? statSync(dbPath).size : 0;

  const issues = [];

  if (taskCount < baseline.taskCount) {
    issues.push(`Task count decreased from ${baseline.taskCount} to ${taskCount}.`);
  }
  if (snapCounts.total < baseline.listingSnapshotCount) {
    issues.push(`Listing snapshot count decreased from ${baseline.listingSnapshotCount} to ${snapCounts.total}.`);
  }
  if (snapCounts.realAi < baseline.realAiListingCount) {
    issues.push(`Real AI draft listing count decreased from ${baseline.realAiListingCount} to ${snapCounts.realAi}.`);
  }
  if (currentSize === 0) {
    issues.push("Current DB file size is 0.");
  }

  const result = {
    ok: issues.length === 0,
    baseline: {
      taskCount: baseline.taskCount,
      listingSnapshotCount: baseline.listingSnapshotCount,
      realAiListingCount: baseline.realAiListingCount,
      dbSizeBytes: baseline.dbSizeBytes,
    },
    current: {
      quickCheck: qc,
      taskCount,
      listingSnapshotCount: snapCounts.total,
      realAiListingCount: snapCounts.realAi,
      dbSizeBytes: currentSize,
    },
    issues,
  };

  return result;
}

// ── Safe summary output ────────────────────────────

function safeSummary(qc, taskCount, snapCounts) {
  console.log("═══════════════════════════════════");
  console.log("  DB Protection Summary");
  console.log("═══════════════════════════════════");
  console.log(`  DB basename     : ${safeDbBasename()}`);
  console.log(`  DB path (safe)  : ${safeDbPathLabel()}`);
  console.log(`  Quick check     : ${qc.ok ? "OK" : "FAIL — " + qc.reason}`);
  if (qc.ok) {
    console.log(`  DB size         : ${(qc.size / 1024).toFixed(1)} KB`);
  }
  console.log(`  Task count      : ${taskCount}`);
  console.log(`  Listing snapshots: ${snapCounts.total} (real AI draft: ${snapCounts.realAi})`);
  console.log("═══════════════════════════════════");
}

// ── CLI ────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error("Usage: node protect-sqlite-db.mjs <summary|backup|predeploy|postdeploy> [--reason <reason>] [--baseline <path>]");
    process.exit(1);
  }

  if (command === "summary") {
    const qc = quickCheck();
    const taskCount = await countTasks();
    const snapCounts = await countListingSnapshots();
    safeSummary(qc, taskCount, snapCounts);
    if (!qc.ok) process.exit(1);
  } else if (command === "backup") {
    const reasonIdx = args.indexOf("--reason");
    const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : "manual";
    const result = backupDb(reason);
    console.log(`Backup created: ${result.backupDir}`);
    console.log(`  Size: ${(result.size / 1024).toFixed(1)} KB`);
    console.log(`  Reason: ${result.reason}`);
  } else if (command === "predeploy") {
    console.log("Pre-deploy guard running...");
    const result = backupDb("predeploy");
    console.log(`Backup saved: ${result.backupDir}`);
    const { baseline } = await writeBaseline();
    console.log(`Baseline written: ${baselinePath()}`);
    const qc = baseline.quickCheck;
    safeSummary(qc, baseline.taskCount, { total: baseline.listingSnapshotCount, realAi: baseline.realAiListingCount });
    if (!qc.ok) {
      console.error("ERROR: Quick check failed. Abort deployment.");
      process.exit(1);
    }
  } else if (command === "postdeploy") {
    const baselineIdx = args.indexOf("--baseline");
    const baselineFile = baselineIdx >= 0 ? args[baselineIdx + 1] : baselinePath();
    console.log(`Post-deploy guard running against baseline: ${baselineFile}`);
    const result = await compareBaseline(baselineFile);
    if (!result.ok) {
      console.error("═══════════════════════════════════");
      console.error("  DEPLOY GUARD FAILED");
      console.error("═══════════════════════════════════");
      const issues = result.issues ?? [result.reason ?? "Unknown failure"];
      for (const issue of issues) {
        console.error(`  ✗ ${issue}`);
      }
      if (result.baseline) {
        console.error("───────────────────────────────────");
        console.error("  Baseline:");
        console.error(`    Task count: ${result.baseline.taskCount}`);
        console.error(`    Listing snapshots: ${result.baseline.listingSnapshotCount}`);
        console.error(`    Real AI draft: ${result.baseline.realAiListingCount}`);
      }
      if (result.current) {
        console.error("  Current:");
        console.error(`    Task count: ${result.current.taskCount}`);
        console.error(`    Listing snapshots: ${result.current.listingSnapshotCount}`);
        console.error(`    Real AI draft: ${result.current.realAiListingCount}`);
      }
      console.error("═══════════════════════════════════");
      process.exit(1);
    }
    console.log("Post-deploy guard passed. Task counts and listing snapshots are intact.");
    const qc = result.current.quickCheck;
    safeSummary(qc, result.current.taskCount, { total: result.current.listingSnapshotCount, realAi: result.current.realAiListingCount });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Valid commands: summary, backup, predeploy, postdeploy");
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 0)); // let Prisma disconnect cleanly
}

main().catch((err) => {
  console.error("DB Guard error:", err.message);
  process.exit(1);
});
