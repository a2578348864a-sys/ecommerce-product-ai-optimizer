import { spawn } from "node:child_process";

const [mode, runId] = process.argv.slice(2);

function send(message) {
  if (typeof process.send === "function") process.send(message);
}

function isShutdownMessage(message) {
  return Boolean(
    message
    && typeof message === "object"
    && message.type === "controlled-shutdown"
    && message.runId === runId,
  );
}

function keepAlive() {
  setInterval(() => undefined, 1_000);
}

if (typeof runId !== "string" || runId.length === 0) {
  process.exitCode = 2;
} else if (mode === "exit-before-ready") {
  process.exit(0);
} else if (mode === "grandchild") {
  keepAlive();
} else if (mode === "sentinel") {
  process.on("message", (message) => {
    if (isShutdownMessage(message)) process.exit(0);
  });
  process.on("disconnect", () => process.exit(0));
  send({ type: "controlled-ready", mode: "sentinel", runId, pid: process.pid, grandchildPid: null });
  keepAlive();
} else if (mode === "root") {
  const grandchild = spawn(process.execPath, [process.argv[1], "grandchild", runId], {
    stdio: "ignore",
    windowsHide: true,
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (grandchild.exitCode !== null || grandchild.signalCode !== null) {
      process.exit(0);
      return;
    }
    const timeout = setTimeout(() => {
      if (grandchild.exitCode === null && grandchild.signalCode === null) grandchild.kill("SIGKILL");
      process.exit(0);
    }, 250);
    grandchild.once("exit", () => {
      clearTimeout(timeout);
      process.exit(0);
    });
    grandchild.kill("SIGTERM");
  };
  process.on("message", (message) => {
    if (isShutdownMessage(message)) stop();
  });
  process.on("disconnect", stop);
  send({
    type: "controlled-ready",
    mode: "root",
    runId,
    pid: process.pid,
    grandchildPid: grandchild.pid ?? null,
  });
  keepAlive();
} else {
  process.exitCode = 2;
}