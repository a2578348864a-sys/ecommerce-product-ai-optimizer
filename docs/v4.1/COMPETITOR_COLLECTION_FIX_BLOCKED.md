# 竞品采集收口 — 阻塞记录（BLOCKED）

> 只记录无法完成/必须越界的项；每项含：现象、涉及文件、尝试、结论。
> 当前无阻塞项时写作"无"。

## 当前

无（本轮 4 项反向验证全部完成：破坏1/2/3红→恢复复绿；破坏4因目标实现已结构性消灭旧缺陷时序而无需回退验证）。

## 既知漂移（非本轮范围，仅记录）

- `components/evidence/EvidenceWorkbench.test.ts` 引用已删除的 `components/evidence/KeywordBriefCreateCard.tsx`（`readFileSync` ENOENT）导致该测试文件级失败。任务书明确：不修、不为凑全绿恢复旧文件。全量 run 时该文件失败可忽略，属预存在基线。
