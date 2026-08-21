# P5 E2E 证据 — Gate B → 内容 → 审核（V4-FINAL-R2）
- Journey：V4-P5-E2E-01；3005 local_owner flag on；runId（脱敏）91255746-…
- 链路：PLAN_REVIEW→GATE_A→FACT_GATE→COMMERCIAL_INPUT→GATE_B(content_ready)→CONTENT_GENERATION_REQUIRED(waiting_input)→POST /content→CONTENT_REVIEW→approve_export→**completed**
- 内容生成：listing 0 issues（无 304/商标/绝对词）；visual overall=blocked（无资产观测/缺参考图，保守正确）
- 审核门禁：approve_export on blocked → **409 content_blocked**（P5-C 裁定落地）
- resume 重查：未生成内容时 resume → 保持在 waiting_input（修复后）
- flag off 恢复：/api/v4/runs→404、V3.1 health 200
- 结论：**PASS**（截图/控制台存 v4-p1-evidence 与 .playwright-cli）。
