# 历史归档索引（HISTORY）

> 本页是**唯一**的历史内容索引。历史内容一律**保留、不删除、不改写**，只是从首页与当前状态页移出，避免与当前稳定版本混淆。
> 当前状态请看 [PROJECT_STATUS.md](PROJECT_STATUS.md)。

## 1. 本轮从 README 移出的内容

| 原 README 区段 | 现位置 |
| --- | --- |
| `## V4 / LangGraph 实验链` | [history/v4-langgraph-experiment.md](history/v4-langgraph-experiment.md) |
| `## Listing V5.1 — Listing Intelligence Layer`（含基准与回滚说明） | [history/listing-v5-freeze-notes.md](history/listing-v5-freeze-notes.md) |
| `## Listing V5.7 — 冻结里程碑`（含三案基线与 Validator 修复） | [history/listing-v5-freeze-notes.md](history/listing-v5-freeze-notes.md) |

## 2. 仓库中既有历史目录（**保留原位**，未移动）

这些目录被 50+ 处文档交叉引用，物理移动会打断链接，因此保持原路径，仅在此登记：

| 目录 | 文件数 | 内容 |
| --- | --- | --- |
| `docs/v3/` | 119 | V3 阶段设计、发布与冻结审计报告 |
| `docs/v3.1/` | 16 | V3.1 阶段报告（含 Public Guest RC） |
| `docs/v4/` | 27 | V4 / LangGraph 实验链文档 |
| `docs/v4.1/` | 150 | V4.1 阶段文档 |
| `docs/listing-v5/` | 1 | Listing V5（含 v6）冻结记录 |
| `docs/archive/` | 52 | 早期归档材料 |
| `ops/`（含 `ops/v3.1/`） | 8 | V3.1 阶段运维脚本与说明 |

## 3. 版本演进简述

| 阶段 | 主题 | 归档位置 |
| --- | --- | --- |
| V3 → V3.1 | 研究链路成型、公开发布准备 | `docs/v3`, `docs/v3.1`, `ops/v3.1` |
| V4 → V4.1 | LangGraph 图编排实验链（feature-flagged，非当前主链） | `docs/v4`, `docs/v4.1` |
| Listing V5 → V5.7 → v6 | Listing 生成与校验迭代、冻结里程碑与基准 | `docs/listing-v5`, [history/listing-v5-freeze-notes.md](history/listing-v5-freeze-notes.md) |
| **当前（main）** | **受控研究主链 + Listing 素材草稿 + Image Studio 双链路** | [PROJECT_STATUS.md](PROJECT_STATUS.md) |

## 4. 阅读建议

- 只想了解项目是什么、怎么用：看根目录 [README.md](../README.md)
- 想确认当前能力与边界：看 [PROJECT_STATUS.md](PROJECT_STATUS.md)
- 想理解技术实现：看 [ARCHITECTURE.md](ARCHITECTURE.md)
- 需要追溯历史决策与证据：从本页第 2 节进入对应目录；历史报告中的版本号、状态与结论**仅代表当时**，不代表当前状态。
