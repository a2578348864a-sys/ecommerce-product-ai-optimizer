/**
 * Phase Demo-Login.1-B — Create Demo Password Script
 *
 * Usage:
 *   node scripts/create-demo-password.mjs --label "杭州某公司一面" --hours 24 --max-ai-calls 5
 *   npm run demo:create -- --label "杭州某公司一面" --hours 24 --max-ai-calls 5
 *
 * Generates a random demo password, hashes it, stores in data/demo-access.json.
 * Prints the plain password ONCE to stdout. Does NOT write passwords to any file.
 */

import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const STORE_PATH = resolve(DATA_DIR, "demo-access.json");

// ── Parse args ──────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

const label = getArg("label");
const hoursStr = getArg("hours");
const maxAiCallsStr = getArg("max-ai-calls");

if (!label || !hoursStr || !maxAiCallsStr) {
  console.error("Usage: node scripts/create-demo-password.mjs --label <label> --hours <hours> --max-ai-calls <n>");
  console.error("  --label          Label for this demo access (e.g. '杭州某公司一面')");
  console.error("  --hours          Validity in hours (e.g. 24)");
  console.error("  --max-ai-calls   Max AI calls (e.g. 5)");
  process.exit(1);
}

const hours = parseInt(hoursStr, 10);
const maxAiCalls = parseInt(maxAiCallsStr, 10);

if (isNaN(hours) || hours < 1 || hours > 720) {
  console.error("Error: --hours must be 1-720");
  process.exit(1);
}
if (isNaN(maxAiCalls) || maxAiCalls < 1 || maxAiCalls > 100) {
  console.error("Error: --max-ai-calls must be 1-100");
  process.exit(1);
}

// ── Crypto ──────────────────────────────────────

function generateSalt() {
  return randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  const h = createHash("sha256").update(salt + password).digest("hex");
  return `sha256:${h}`;
}

function generateDemoPassword() {
  return randomBytes(12).toString("base64url");
}

function generateDemoId() {
  return `demo_${randomBytes(8).toString("hex")}`;
}

// ── Load / Save store ───────────────────────────

function loadStore() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(STORE_PATH)) {
    return { version: 1, accesses: [] };
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.accesses)) {
      return parsed;
    }
    return { version: 1, accesses: [] };
  } catch {
    return { version: 1, accesses: [] };
  }
}

function saveStore(store) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ── Main ────────────────────────────────────────

const plainPassword = generateDemoPassword();
const salt = generateSalt();
const passwordHash = hashPassword(plainPassword, salt);
const now = new Date();
const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

const record = {
  id: generateDemoId(),
  label,
  passwordHash,
  salt,
  expiresAt: expiresAt.toISOString(),
  maxAiCalls,
  usedAiCalls: 0,
  isActive: true,
  createdAt: now.toISOString(),
  lastUsedAt: null,
  notes: "",
};

const store = loadStore();
store.accesses.push(record);
saveStore(store);

// ── Output ──────────────────────────────────────

console.log("Demo access created.");
console.log(`  Label:      ${label}`);
console.log(`  ExpiresAt:  ${expiresAt.toISOString()}`);
console.log(`  MaxAiCalls: ${maxAiCalls}`);
console.log(`  Password:   ${plainPassword}`);
console.log("");
console.log("Password 只显示一次，请复制保存。不会写入任何文件。");
