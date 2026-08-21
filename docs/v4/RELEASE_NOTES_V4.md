# Release Notes — V4 研究图（v4.0.0，已发布）

- 发布记录（2026-08-22）：validatedCodeSha=`2feb848fa46ccb88b770c80874dad8beddd5865f`（lint/typecheck/全量测试 5769-0/Build/浏览器 E2E 全部实测基线）；release SHA 与 Git tag `v4.0.0` 一致；公网部署 https://112.124.54.81（public_showcase，公网只读 Replay）
- 验证基线（2feb848 实测）：npm test 5769 passed / 0 failed；npm run build exit 0；浏览器：ContentHandoff 空值失败→批准参考图→生成 2 候选成功链 + Public Replay 浏览/刷新持久链
- 内容：单 Research Workflow（LangGraph 1.4.12）——计划/行动/观察/修订/5 个人工中断/恢复/取消/幂等；市场研究（SellerSprite/Amazon/Keyword/VOC adapters）；Supplier 1688 + Fact Gate（追加式 revision）；确定性三情景 Calculator + Gate B；内容 Skills/Guards（Listing/ImagePlan/Visual Fact Check）+ 人工审核；ReplayBundle 脱敏导出/防篡改。
- 兼容：V3.1 冻结；flag 默认关（关闭=原样）。
- 阻断项收口：B1/B3/B4 已修复/确认（见 KNOWN_LIMITATIONS.md）；剩余仅授权类动作（公网无痕 E2E 记录见发布验收报告）。
