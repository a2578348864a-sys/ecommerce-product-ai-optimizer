#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const LOCAL_DATABASE_URL = "file:./dev.db";
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = "3005";

export function buildLocalRuntimeConfig({
  cwd = process.cwd(),
  mode = "start",
  parentEnv = process.env,
} = {}) {
  if (mode !== "start" && mode !== "dev") {
    throw new Error("Local runtime mode must be start or dev.");
  }

  const projectRoot = resolve(cwd);
  return {
    databasePath: resolve(projectRoot, "prisma", "dev.db"),
    env: {
      ...parentEnv,
      DATABASE_URL: LOCAL_DATABASE_URL,
    },
    command: process.execPath,
    args: [
      resolve(projectRoot, "node_modules", "next", "dist", "bin", "next"),
      mode,
      "-H",
      LOCAL_HOST,
      "-p",
      LOCAL_PORT,
    ],
  };
}

export function inspectLocalDatabaseFile(databasePath) {
  if (!existsSync(databasePath)) {
    throw new Error("local_database_missing");
  }

  const size = statSync(databasePath).size;
  if (size === 0) {
    throw new Error("local_database_empty");
  }

  const header = Buffer.alloc(16);
  let handle;
  try {
    handle = openSync(databasePath, "r");
    const bytesRead = readSync(handle, header, 0, header.length, 0);
    if (bytesRead !== header.length || header.toString("utf8") !== "SQLite format 3\0") {
      throw new Error("local_database_invalid");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "local_database_invalid") throw error;
    throw new Error("local_database_unreadable");
  } finally {
    if (handle !== undefined) closeSync(handle);
  }

  return { size };
}

async function probeWithPrisma(databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const quickCheckRows = await prisma.$queryRawUnsafe("PRAGMA quick_check");
    const firstRow = Array.isArray(quickCheckRows) ? quickCheckRows[0] : undefined;
    const quickCheck = firstRow && typeof firstRow === "object"
      ? String(Object.values(firstRow)[0] ?? "unknown")
      : "unknown";
    const candidateCount = await prisma.opportunityCandidate.count();
    const taskCount = await prisma.viralAnalysisRecord.count();
    return { quickCheck, candidateCount, taskCount };
  } finally {
    await prisma.$disconnect();
  }
}

export async function verifyLocalDatabase({
  databasePath,
  databaseUrl = LOCAL_DATABASE_URL,
  probe = probeWithPrisma,
}) {
  inspectLocalDatabaseFile(databasePath);
  const result = await probe(databaseUrl);
  if (result.quickCheck !== "ok") {
    throw new Error("local_database_quick_check_failed");
  }
  if (!Number.isInteger(result.candidateCount) || !Number.isInteger(result.taskCount)) {
    throw new Error("local_database_counts_invalid");
  }
  return result;
}

export async function runLocalNext({
  cwd = process.cwd(),
  mode = "start",
  checkOnly = false,
  parentEnv = process.env,
  spawnProcess = spawn,
  probe = probeWithPrisma,
} = {}) {
  const config = buildLocalRuntimeConfig({ cwd, mode, parentEnv });
  const database = await verifyLocalDatabase({
    databasePath: config.databasePath,
    databaseUrl: config.env.DATABASE_URL,
    probe,
  });

  console.log(JSON.stringify({
    status: "local_database_ready",
    quickCheck: database.quickCheck,
    candidateCount: database.candidateCount,
    taskCount: database.taskCount,
  }));

  if (checkOnly) return database;

  const child = spawnProcess(config.command, config.args, {
    cwd: resolve(cwd),
    env: config.env,
    stdio: "inherit",
    windowsHide: true,
  });

  return new Promise((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectRun(new Error(`local_next_stopped_by_${signal}`));
      } else if (code !== 0) {
        rejectRun(new Error(`local_next_exit_${code ?? "unknown"}`));
      } else {
        resolveRun(database);
      }
    });
  });
}

async function main() {
  const requestedMode = process.argv[2];
  const checkOnly = requestedMode === "check";
  const mode = checkOnly ? "start" : requestedMode;
  await runLocalNext({ mode, checkOnly });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : "local_runtime_failed";
    console.error(`Local runtime refused to start: ${reason}`);
    process.exitCode = 1;
  });
}
