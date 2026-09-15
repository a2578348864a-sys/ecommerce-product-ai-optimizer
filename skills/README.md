# skills — 项目技能源目录

本目录是**项目维护的 AI 助手技能源目录**，存放可复用的技能（skill）定义。它**不参与应用运行时**，不影响产品功能与 3005 服务。

## 本目录内容

| 名称 | 说明 |
| --- | --- |
| `amazon-product-research/` | Amazon 商品研究相关技能定义 |
| `sellersprite-market-preview/` | SellerSprite 市场预览相关技能定义 |
| `v4/` | 一组可复用的电商运营 playbook（A+ 方案、竞品研究、Listing、主图/副图方案、关键词研究、合规）。V4 非当前稳定主链，见 [../docs/history/v4-langgraph-experiment.md](../docs/history/v4-langgraph-experiment.md) |

## 分发关系

技能在本目录维护后，按各 AI 工具的发现约定同步到对应路径：

```
skills/                 （源：本目录）
  ├─→ .agents/skills/   （通用 AI 编码助手路径）
  └─→ .claude/skills/   （Claude Code 路径）
```

`.agents/skills/` 与 `.claude/skills/` 中各自带有说明文件，解释了为什么公开仓库里会出现三处同名目录。

> 技能定义的具体字段与用法以各子目录内的文件为准（保持原名称、目录与入口不变）。
