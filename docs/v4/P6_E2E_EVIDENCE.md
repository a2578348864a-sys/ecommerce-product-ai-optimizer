# P6 E2E 证据 — Replay 导出/审批/防篡改（V4-FINAL-R2）
- Journey：V4-P6-E2E-01；3005 local_owner flag on；源 run（脱敏）91255746-…（completed）
- 链路：POST /replay（预览：scanOk=true、redactions=2、bundleSha=4ca5e77c…）→ POST {approve:true}（published=true）→ GET /api/v4/replay（列表含 replay-b39aa…）→ GET bundle（hash 校验通过）→ **篡改文件 → 409 bundle_tampered** → 恢复 → Replay UI（「真实脱敏历史案例回放」标识 + 截图）
- 结论：**PASS（本地）**；公网部署待授权。
