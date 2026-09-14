/**
 * 原型样例数据读取（**唯一入口**）。
 *
 * 背景：另一会话正在把 `docs/v4.1/` 迁移到 `docs/archive/prototypes/releases/v4.1/`。
 * 两个原型页面此前各自硬编码旧路径，迁移后预渲染时 ENOENT，导致整包 `next build` 失败
 * （编译与类型检查都通过，只在 `/prototype*` 静态预渲染阶段炸掉）。
 *
 * 这里收口为单一入口并**兼容新旧两个位置**，使迁移期间打包不再中断；
 * 待搬迁稳定后可把 CANDIDATES 收敛为单一路径。
 */
import { promises as fsp } from "node:fs";
import path from "node:path";

const CANDIDATES: ReadonlyArray<readonly string[]> = [
  ["docs", "v4.1", "proto-data.json"],
  ["docs", "archive", "prototypes", "releases", "v4.1", "proto-data.json"],
];

export async function loadPrototypeData(): Promise<Array<Record<string, unknown>>> {
  const tried: string[] = [];
  for (const segments of CANDIDATES) {
    const candidate = path.join(process.cwd(), ...segments);
    try {
      const raw = await fsp.readFile(candidate, "utf8");
      return JSON.parse(raw) as Array<Record<string, unknown>>;
    } catch (error) {
      // 只对"文件不在这个位置"继续尝试；JSON 损坏等其它错误必须暴露，不得静默兜底
      const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOENT") throw error;
      tried.push(candidate);
    }
  }
  throw new Error(`prototype data not found; tried: ${tried.join(" | ")}`);
}
