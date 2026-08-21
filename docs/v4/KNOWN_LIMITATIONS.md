# 已知限制（V4-FINAL-R2 RC）

1. **B1（发布阻断，待用户裁定）**：`handoff.product-journey-quota.test.ts` 在 v3.1.0 基线稳定失败（route:369 直读 mock 缺失字段）。方向 A=route 防御 / B=修 mock。
2. **B3**：`/api/opportunities` legacy pipeline 在线无 410（UI 孤儿）——建议加 410。
3. **B4**：`isDemoAccessExpired` 无条件 false（依赖 isActive，注释明示刻意）——待确认语义。
4. **P6 公网部署**：未执行（需用户显式授权）；本地 3005 全链已验证。
5. **Amazon/1688 真机**：live 模式代码就绪但需授权真实会话（登录/验证码→人工接管）。
6. **视觉检查**：无资产观测时保守 blocked（真实图片生成属授权范围）。
7. **移动端**：/v4/runs 导航仅桌面（V3.1 常量冻结约束）。
8. **依赖**：1 high（brace-expansion dev-only，npm audit fix 可修）。
9. **报告 schema 漂移**：项目书 research-report.schema.json 未接线（运行时用 MarketResearchReport）。
10. **README/CHANGELOG**：V4 声明与 G6 统一需在发布授权后执行。
