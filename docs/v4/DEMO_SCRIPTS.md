# 演示脚本（3 分钟 / 10 分钟）

素材：`D:\Workspace\tmp\v4-p1-evidence\`（各 Phase 截图）、`.playwright-cli\page-*.png`（本机）。

## 3 分钟
1. 打开 /v4/runs 列表（flag on）。
2. 新建 run → 计划审核 → Gate A → 1688（recorded）→ Fact Gate。
3. 展示市场报告面板（引用完整）→ Gate B → 内容生成 + Guards → 人工审核 → 完成。
4. 打开 /replay 回放已发布案例（「真实脱敏历史案例回放」）。

## 10 分钟
1. 3 分钟内容（全链）。
2. 失败路径：错误实体阻断（WRONG_ENTITY）、缺输入 blocked、篡改 Replay→409。
3. 恢复：刷新后状态保持；取消后不可写。
4. 双模式：V3.1 flag 关 → 原样；flag 开 → V4。
5. 证据链：报告 evidenceRefs → 事实确认方法/revision 历史。
