# 已知限制（V4-FINAL-R2 RC）

1. ~~B1~~ **已修复**（2feb848）：image-handoff 路由 gate 空值 fail-closed（409 creative_gate_unavailable）+ 回归测试；全量 0 失败。
2. ~~B3~~ **已下线**（2feb848）：`/api/opportunities` 根路由返回 410（legacy_endpoint），子路由保留。
3. ~~B4~~ **已确认**（2feb848）：Demo 记录不失效契约（12h Token/Cookie 控制访问；isActive 开关；GC 独立）；已补契约注释，逻辑不变。
4. **P6 公网部署**：未执行（需用户显式授权）；本地 3005 全链已验证。
5. **Amazon/1688 真机**：live 模式代码就绪但需授权真实会话（登录/验证码→人工接管）。
6. **视觉检查**：无资产观测时保守 blocked（真实图片生成属授权范围）。
7. **移动端**：/v4/runs 导航仅桌面（V3.1 常量冻结约束）。
8. **依赖**：1 high（brace-expansion dev-only，npm audit fix 可修）。
9. **报告 schema 漂移**：项目书 research-report.schema.json 未接线（运行时用 MarketResearchReport）。
10. **README/CHANGELOG**：V4 声明与 G6 统一需在发布授权后执行。
