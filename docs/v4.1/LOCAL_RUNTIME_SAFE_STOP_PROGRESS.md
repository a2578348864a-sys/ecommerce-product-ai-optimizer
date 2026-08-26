# 本地运行器安全停止（stop / stop --dry-run）— 进度与验证记录

> 第二轮记录：修复独立复审 P1（Windows PowerShell 5.1 管道中文路径失真 U+FFFD）。本轮未完成事项以本文件为准。

## 一、P1 根因与最小修复

- 根因：`buildOwnershipSnapshotScript` 的 JSON 经由 `powershell.exe`（5.1）管道输出，默认按 OEM 代码页编码；Node 端 `execFile(...,{encoding:"utf8"})` 读取时中文路径字节被解码为 U+FFFD（实测码点：≈12 处 U+FFFD + 残留 U+0339），导致真实 3005 的 `next start` child CommandLine（含 `跨境电商AI工具/电商工具` 绝对路径）永远 `child_next_entry_mismatch` → 恒 reject，无法识别真实归属。
- 修复（仅影响输出编码，不改证据字段与归属校验）：`buildOwnershipSnapshotScript` 在脚本最前（任何 JSON 输出之前）执行
  `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)` 与 `$OutputEncoding = [Console]::OutputEncoding`（本机 PowerShell 5.1 实测语法有效；Node 仍按 utf8 读取；PID 参数仍内联；`.join("\n")` 保持真实换行；无尾随 argv）。
- 同轮微小接线（非修复语义）：`collectOwnershipEvidence` 导出并给 child/ancestors 附带 `parentPid`（证据更完整，归属判定不受影响），供真实管道测试断言。

## 二、TDD 红→绿证据

1. 红（修改实现前，真实管道 + 自建子进程）：新测试 17 失败 —
   `AssertionError: 中文片段『测试』必须保留: "...node.exe -e ... D:\����\���̹���\node_modules\next\dist\bin\next"`（27 pass / 1 fail；证据 `%TEMP%\local-runtime-safe-stop-encoding-fix\red-test17.txt`）。
2. 绿（修复后）：28/28 pass、0 fail、0 skip、0 todo（证据 `green-test17.txt` / 任务3 各门）。
3. 反向验证：仅移除两条 OutputEncoding 行 → 测试 17 红（27/1，失败信息同上）；`Copy-Item` 字节级恢复后 SHA256 与 good 快照一致（92C9C775F81F84A4F6762EB83C54A253E19F268E4037FFD7A9EA316BD5ACBBA7），全套复绿 28/28。

## 三、验证结果（全部）

1. `node --check` 两文件 0；`node --test scripts/local-next-runtime.stop.test.mjs` **28/28**；`vitest run scripts/local-next-runtime.test.ts --reporter=dot --maxWorkers=1` **10/10**；`eslint` 0；`git diff --check` 0。
2. 真实 CLI：`node scripts/local-next-runtime.mjs stop --dry-run --port 3005` →
   `{"action":"none",... "signalSent":false,"dryRun":true}`，exit=0，执行前后 3005 均无 listener，未产生 .next/local-runtime-*.json。
3. 真实管道实测（加工后）：自建子进程 CommandLine 含 `D:\测试\电商工具\node_modules\next\dist\bin\next`，经生产 `collectOwnershipEvidence` 返回 child.pid==自建 pid、parentPid==测试进程、中文片段完整、无 U+FFFD、JSON 可解析。

## 四、停止线（全部未触发）

未启动/停止/重启 3005；未执行真实 stop；未 taskkill/Stop-Process/SIGKILL/杀树（测试17 仅用自建 ChildProcess 句柄的一次 SIGTERM 温和收尾并 5s 有界确认退出）；未 commit/push；未安装依赖；未改白名单外文件、dev.db、.env、Prisma。
