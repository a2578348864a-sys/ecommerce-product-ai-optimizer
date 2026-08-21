# P4 E2E 证据 — 三情景 + Gate B（V4-FINAL-R2）
- Journey：V4-P4-E2E-01；3005 local_owner flag on；runId（脱敏）349ae962-…
- 链路：PLAN_REVIEW→GATE_A(continue_sourcing)→FACT_GATE→COMMERCIAL_INPUT_REQUIRED(waiting_input)→POST /commercial→GATE_B(content_ready)→CONTENT_REVIEW→**completed**
- Calculator live：scenarios=optimistic,baseline,pessimistic；baseline landed=4.74USD、marginRate=0.438、moqCapital=347.22；sensitive=fxRate:0.530;fulfillmentFee:0.350;freight:0.300；unknowns=0
- 缺失输入：400 blocked_missing_input（列出 freightPerKg, commissionRate, fulfillmentFee, weightKg, dims）
- Gate B 选项：content_ready 通过；abandon/needs_information/revise_product 路由已实现（单测），E2E 走 content_ready 主链
- flag off 恢复：/api/v4/runs→404、V3.1 health 200
- 结论：**PASS**（刷新一致由 commercialJson 持久化 + GET 复验；确定性由同输入两次调用一致断言）。
