import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import {
  buildHumanAssistedRuntimeCommand,
  parseHumanAssistedCliArguments,
} from "./human-assisted-cli-options.mjs";

let options;
try {
  options = parseHumanAssistedCliArguments(process.argv);
} catch {
  console.error("用法：node tools/collectors/amazon/human-assisted-cli.mjs --output <本地JSON路径> --max-samples <1-20>");
  process.exitCode = 2;
}
if (options) {
  const { outputFile, maxSamples } = options;
  const triggerFile = resolve(tmpdir(), `amazon-human-assisted-${randomUUID()}.trigger`);
  const readyFile = `${triggerFile}.ready`;
  const runtimeCommand = buildHumanAssistedRuntimeCommand();
  const child = spawn(runtimeCommand.executable, runtimeCommand.args, {
    cwd: process.cwd(),
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
    env: {
      ...process.env,
      RUN_AMAZON_HUMAN_ASSISTED_CURRENT_PAGE: "authorized-once",
      HUMAN_ASSISTED_TRIGGER_FILE: triggerFile,
      HUMAN_ASSISTED_OUTPUT_FILE: outputFile,
      HUMAN_ASSISTED_MAX_APPEARANCES: String(maxSamples),
    },
  });
  const requestCancellation = () => {
    try {
      writeFileSync(triggerFile, "CANCEL\n", "utf8");
    } catch {
      // The child cleanup path remains authoritative if the trigger cannot be written.
    }
  };
  process.once("SIGINT", requestCancellation);
  process.once("SIGTERM", requestCancellation);
  const startedAt = Date.now();
  while (!existsSync(readyFile) && child.exitCode === null && Date.now() - startedAt < 30_000) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  if (!existsSync(readyFile)) {
    console.error("浏览器会话未在 30 秒内就绪；运行将 fail-closed 并清理。 ");
    writeFileSync(triggerFile, "CANCEL\n", "utf8");
  } else {
    console.log("\n独立临时浏览器已就绪。请仅在该窗口中手动完成：");
    console.log("1. 打开 amazon.com；如遇提示或 Captcha，仅由你本人决定是否处理；");
    console.log("2. 设置 US / English / USD / New York 10001；");
    console.log("3. 搜索 closet organizer，停留在第 1 页，不打开详情；");
    console.log(`4. 确认页面准备好后，在下方输入 COLLECT_CURRENT_PAGE；本次最多读取 ${maxSamples} 条。输入其他内容将取消。\n`);
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const command = (await readline.question("触发命令：")).trim();
    readline.close();
    writeFileSync(triggerFile, `${command === "COLLECT_CURRENT_PAGE" ? command : "CANCEL"}\n`, "utf8");
  }
  const exitCode = child.exitCode ?? await new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code ?? 1)));
  process.removeListener("SIGINT", requestCancellation);
  process.removeListener("SIGTERM", requestCancellation);
  rmSync(triggerFile, { force: true });
  rmSync(readyFile, { force: true });
  process.exitCode = Number(exitCode);
}
