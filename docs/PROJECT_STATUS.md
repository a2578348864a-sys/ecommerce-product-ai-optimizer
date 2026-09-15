# 项目当前状态（单一权威状态页）

> 本页是仓库**唯一**的当前状态说明。历史冻结记录不再堆在本页，统一归档于 [HISTORY.md](HISTORY.md)。
> 最后核验：`main` @ `cb9166882e4e2bcf28d4c724285f23768a105197`（本地 `main` == `origin/main`，工作区 clean）。

## 1. 一句话状态

**代码与运行基线已冻结（FROZEN）**，可交付、可复现；仅剩 1 项**人工验收待办**（见 §5）。

## 2. 版本与运行基线

| 项 | 值 |
| --- | --- |
| 主分支 | `main` |
| 基线提交 | `cb9166882e4e2bcf28d4c724285f23768a105197` |
| 本地 `main` / `origin/main` | 同一 SHA（同步，ahead/behind `0/0`） |
| 工作区 | clean（无未提交、无未跟踪） |
| 正式运行目录 | 仓库根（本工作树）；本机 3005 由计划任务 `QingXuanAgent-Local-3005` 管理 |
| 运行入口 | `npm run check:local` → `npm run start:local`（`http://127.0.0.1:3005`） |
| 构建 | `npm run build`（`next build --webpack`）通过 |
| 健康检查 | `GET /api/health` → 200 |

## 3. 当前稳定主链（唯一正式链路）

```
采集证据（Amazon / Keyword / VOC / 1688）
  → AI 整理与结构化
  → 人工确认事实（confirmedFacts：唯一事实权威）
  → 研究结论记录（/tasks 研究记录）
  → 下游产出：Listing 素材草稿 · 图片工作台候选
  → 人工复核后使用
```

- **事实权威**：只有人工确认的 `confirmedFacts` 能成为事实；VOC / 关键词 / 竞品 / 采集原文一律是 `UNTRUSTED_REFERENCE_DATA`，只影响表达与构图，**永不升级为事实**。
- **人工边界**：自动化保留人工确认、证据门禁、权限边界与失败路径；AI 不替代人工决定。
- **失败可见**：失败路径返回分类错误码，不伪装成功（旧版"统一报 AI 服务不可用"已移除）。

## 4. 已验收证据（最近一轮）

| 验收项 | 结果 |
| --- | --- |
| `main` 基线（本地/远端/HEAD 四路 SHA 一致、clean） | ✅ |
| 运行来源唯一（BUILD_ID 静态资产指纹 + 任务工作目录 + 运行时状态文件） | ✅ |
| 无旧进程/旧工作树抢占 3005 | ✅ |
| `/image-studio`（独立图片工具）真实浏览器可用 | ✅ Console Error 0 / 网络 5xx 0 |
| `/image-studio?taskId=…`（研究驱动）真实浏览器可用：商品事实 + 参考图 + 生成入口 | ✅ Console Error 0 / 网络 5xx 0 |
| `npm run build` | ✅ 通过 |

## 5. 未闭环事项（不阻塞代码冻结）

| 事项 | 说明 | 需要谁 |
| --- | --- | --- |
| **采集链展示人工验收** | Amazon / Keyword / VOC / 1688 的采集状态展示与真实一致性尚未验收：研究记录页 `(/tasks)` 受访问密码门禁保护，未认证状态无法查看 | Owner 登录后人工验收 |
| Visitor sandbox 数据存储 | 正式运行目录缺少 `data/demo-sandbox.json`（`recoverBackup()` 会优雅降级、不会崩溃）；影响范围为 Visitor sandbox：既有 Visitor 数据不会被正式运行读取 | Owner 决定是否以共享链接方式补齐 |

## 6. 明确不做的事（产品边界）

- 不宣称无人值守自动选品 / 自动采购 / 自动上架 / 已验证商业成功；
- 缺少证据的真实销量、成本、物流、费用、利润、合规与经营结果一律保留为**未知**，不由 AI 猜测补齐；
- 不提供公网公开 Demo（依赖本地 SQLite、服务端开关与真实付费 Provider）。

## 7. 相关文档

- 架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)
- 历史归档索引：[HISTORY.md](HISTORY.md)
- 文档中心：[docs/README.md](README.md)
- 冻结声明（历史里程碑，正文以本页为准）：[../FINAL_FREEZE.md](../FINAL_FREEZE.md)
