# V3.5-R1 Formal Smoke — Runbook（用户就绪后执行）

> 前置：用户已加载生产版扩展（`D:\...\电商工具-v3-5-r1-formal\extensions\qingxuan-1688-helper`）、
> 普通 Chrome 打开 `https://s.1688.com/selloffer/offer_search.html` 且页面在前台。

## 执行步骤

```bash
# 1) 清理任何残留 bridge（防端口/进程污染）
#    （任务内执行：kill node 进程匹配 qingxuan-1688-helper.*server.mjs）

# 2) 启用 smoke 测试（从默认套件外移入）
move lib/server/v35FormalSmoke.tmp.ts lib/server/v35FormalSmoke.tmp.test.ts

# 3) 运行正式 smoke 全链（3 项）
npx vitest run lib/server/v35FormalSmoke.tmp.test.ts

# 4) 结束后移回（保持默认套件干净）
move lib/server/v35FormalSmoke.tmp.test.ts lib/server/v35FormalSmoke.tmp.ts
```

## 通过标准

```
T-Acquire  ≥3 候选（正式驱动 + 生产 bridge + 生产扩展；trace.driverVersion=native-1688-extension-driver）
T-Detail   1688-cli 详情交叉验证（offerId/title 一致；displayedPrice/阶梯价差异保留）
T-Evidence Preview → Human Confirm(save) → sourcing-evidence.v1 → GET 读回一致
```

## Restart Smoke（§41）

1. 完全关闭 Chrome（专用 profile 所有窗口）
2. 重新启动（普通方式）→ 打开 s.1688.com 上传页
3. 确认登录态保持（无需重新扫码）
4. 重跑步骤 3（至少 T-Acquire）

## A/B 验证（§42）

```
A. 无扩展：登录/刷新正常（R1 已证；正式版由用户日常使用确认）
B. 装扩展 idle：登录/刷新正常（R1 已证 T1-B）
C. 扩展 active（图搜执行）：无风控（正式 smoke T-Acquire 覆盖）
若 C 稳定触发无限风控 → NOT_ADOPTED（不修改反检测，直接降级 Manual）
```

## 判定（Contract §42.6）

```
FULL PASS  → V3_5_IMAGE_ACQUISITION = APPROVED；V3.5 结项（main 集成 + push）
PARTIAL    → SEMI_AUTOMATED_ONE_USER_CLICK；停止研究
FAIL       → NOT_ADOPTED；Image = Manual / Future Official API；停止浏览器研究
```
