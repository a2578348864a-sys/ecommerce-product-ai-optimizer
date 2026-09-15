# .claude/skills — Claude Code 技能目录（工具约定）

本目录是 **Claude Code** 的技能发现路径，存放该工具可用的技能定义。它**不参与应用运行时**。

## 本目录内容

| 名称 | 用途 |
| --- | --- |
| `sellersprite-market-preview/` | SellerSprite 市场预览相关的技能定义 |

## 与其他 skills 目录的关系

| 目录 | 关系 |
| --- | --- |
| `skills/` | 项目维护的技能源目录（内容最全） |
| `.agents/skills/` | 通用 AI 编码助手路径，含本项目两个技能 |
| `.claude/skills/` | 本目录，Claude Code 路径，当前为其可用子集 |

同名技能在不同路径下**按工具约定分别存放**，属预期重复。若在 `skills/` 中更新了技能，需要同步到本目录才能在 Claude Code 中生效。

> 技能定义的具体字段与用法以各子目录内的文件为准（保持原名称、目录与入口不变）。
