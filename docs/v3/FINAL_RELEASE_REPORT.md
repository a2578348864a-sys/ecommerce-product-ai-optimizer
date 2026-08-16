# 轻选工作台 — Final Release Report（V3.5 Final）

> 状态：`LOCAL_RELEASE_CANDIDATE = APPROVED`（2026-08-16 Final Local Acceptance）
> Git HEAD：`0457265`（main == origin/main）
> 公网部署：`PUBLIC_DEPLOY = FORBIDDEN`（等待用户本地验收后单独授权）

## 产品定位

> 轻选工作台是一套基于真实电商数据的 AI 商品研究与内容生产工作台，通过 Evidence 驱动的研究流程，把 SellerSprite、Amazon、VOC、1688 供应线索与 AI 内容生产连接起来，并保留人工确认作为关键决策门禁。

- 真实数据提供 Evidence；AI 负责整理、解释、辅助；人工负责判断、确认。
- Content Studio 产出 Listing / Image 内容。
- **不是**自动赚钱系统、自动选爆款系统、自动采购系统、供应商评分系统。

## 最终主链

```
SellerSprite XLSX
  ↓ Candidate 候选池
  ↓ 商品研究
  ↓ Evidence Workbench
      ├─ Amazon 商品证据
      ├─ 关键词 / 竞品证据
      ├─ VOC / Review Evidence
      └─ 1688 Sourcing Evidence
  ↓ AI Evidence Summary
  ↓ 人工决策（continue / need_info / rejected）
  ↓ Content Handoff
  ↓ Listing Studio + Image Studio
  ↓ 任务中心 / Evidence Trace
```

## 1688 供应线索支线

```
Candidate → 供应线索 → 三入口（关键词找货 / 图片找货 / 1688 URL）
  → Acquisition Candidate → Preview → Human Confirm → sourcing-evidence.v1
  → Evidence Matrix → Unknowns → Next Inquiry Questions
```

- 关键词找货 / 详情：`LocalSession1688CliDriver`（1688-cli v0.1.47 本地只读）
- 图片找货：`Native1688ExtensionDriver`（普通 Chrome + 窄权限扩展 + Authenticated Loopback Bridge；零 CDP）
- Manual：Fallback
- 语义纪律：displayedPrice ≠ 采购成本；displayedMOQ 不归一化；Seller Claim ≠ 事实；无供应商评分/推荐。

## 最终功能

- SellerSprite XLSX 导入与候选池（发现商品 / 待研究商品）
- AI 商品研究（来源 / 风险 / 总结 / Listing 维度）
- Evidence Workbench（Amazon / 关键词 / VOC / 1688 Sourcing）
- 人工决策（continue / need_info / rejected）与事实确认
- Listing Studio（AI Listing 生成 + 事实来源约束 + Human Review）
- Image Studio（AI 图片草稿 + 状态 + 历史）
- 任务中心 / 任务详情（Evidence / Decision / Listing / Images / Sourcing）
- 管理员 / 访客双入口（访客沙箱隔离；每访客码 5 个商品完整流程）

## 真实验证（2026-08-16）

| 项 | 结果 |
|---|---|
| V3.5 正式 smoke（生产扩展 + 生产 bridge） | FULL PASS ×2（60 候选 + 详情交叉 + Evidence 链） |
| V3.5 Restart smoke（Chrome 完全重启） | FULL PASS |
| 全量测试 | 4781 PASS（2 偶发并行超时单独重跑 PASS） |
| targeted / lint / build / secret scan | 41 PASS / 0 errors / PASS / CLEAN |
| Final Local Acceptance（本报告） | 16 页面 headless 渲染正常、console 0 错误、路由冒烟无 500、窄屏不炸版、文案口径审计通过 |

## 已知边界

- 1688 图搜需要：普通 Chrome + Qingxuan 1688 Helper 扩展 + 1688 登录态 + 页面在前台。
- Unpacked 扩展在 Chrome 完全重启后本机可能不自动加载，需手动重新加载（见下方安装方式）。
- 1688 触发风控时返回明确提示，需人工正常完成验证；系统不绕过、不降级 CDP。
- 利润/成本仅用户自填假设试算（ASSUMPTION_ONLY），标注"待确认"，不用于自动决策。
- 公网未部署；V3.6 未开始（等待单独授权）。

## 本地运行方式

1. 由本机计划任务 `QingXuanAgent-Local-3005` 自动管理（`npm run autostart:local` 注册）。
2. 打开 `http://localhost:3005`，输入管理员密码，或使用访客码体验。
3. 停止/重启：`npm run start:local` / `npm run check:local`（禁止替代 3005 的其他端口入口）。

## 1688 Extension 本地安装（3 步）

1. Chrome 打开 `chrome://extensions` → 开启右上角"开发者模式"。
2. 点"加载已解压的扩展程序" → 选择 `extensions/qingxuan-1688-helper/` 文件夹（含 manifest.json，版本 0.3.1）。
3. 普通 Chrome 登录 1688（s.1688.com），保持页面在前台；轻选工作台内即可使用关键词/图片/URL 找货。

## Git 状态

- HEAD：`0457265`（docs(v3.5): closeout - mark V3.5 implementation COMPLETE）
- main == origin/main == 0457265；tracked clean。
- V3_5 = CLOSED；CORE_FEATURE_DEVELOPMENT = FROZEN；PUBLIC_DEPLOY = FORBIDDEN。
