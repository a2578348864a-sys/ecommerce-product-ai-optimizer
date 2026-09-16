# 项目当前状态（单一权威状态页）

> 本页是仓库**唯一**的当前状态说明。历史记录见 [HISTORY.md](HISTORY.md)。  
> 当前版本：**轻选工作台 单用户本地工作台收敛与新稳定基线**。  
> 权威 HEAD：`f2a8d7277a91642b9adc7febdfa584e990951e7f`（待提交单用户本地工作台收口变更）。  
> 运行模式：唯一恒定模式 **`local_single_user`**（完全无登录、无密码拦截、无 Owner/Guest 区分）。

---

## 1. 一句话状态

**单用户本地工作台收敛完成，全门禁（TSC/Lint/Build/Test/真实浏览器）100% 绿灯，建立新稳定冻结基线。**

---

## 2. 版本与运行基线

| 维度 | 当前权威状态与配置 | 状态核验 |
| :--- | :--- | :---: |
| **主分支** | `main` | 跟踪 `origin/main` |
| **当前 HEAD** | `f2a8d7277a91642b9adc7febdfa584e990951e7f` | 同步对齐 |
| **工作区定位** | `ecommerce-clean-main`（单用户本地产品工作台） | 活跃开发与运行基线 |
| **运行时模式** | `local_single_user`（恒定单用户无鉴权） | `GET /api/runtime-mode` → HTTP 200 |
| **服务运行端口** | `127.0.0.1:3005`（Next.js Production Build） | 监听中 (HTTP 200) |
| **数据库** | 本地 SQLite (`prisma/dev.db`) | 零迁移风险，完全隔离保护 |
| **类型检查** | `npx tsc --noEmit` | ✅ 0 errors |
| **代码规范** | `npm run lint` | ✅ 0 errors, 8 warnings |
| **应用构建** | `npm run build` | ✅ 59 页面生成通过 |
| **全量测试** | `npx vitest run` | ✅ 570 passed, 60 skipped, 0 failed (6635 tests passed) |
| **浏览器验收** | 真实 Google Chrome 桌面 (1440×900) + 移动 (390×844) | ✅ Page Errors 0, Console Errors 0, 无横向溢出 |

---

## 3. 核心产品主链路（唯一单用户链路）

```text
[ 01. 机会发现与导入 ] ──> SellerSprite 数据导入 / 机会分析 (OpportunityAnalysis Spike)
          │
[ 02. 商品研究与取证 ] ──> 关键词 + 竞品证据 + 买家评论 (VOC) + 1688 货源
          │
[ 03. 人工决策与确认 ] ──> 审核候选事实 ──> 确认商品事实 (Human Confirmed Facts)
          │
[ 04. 受控创作准备 ]   ──> 创作资料交接 (Creative Handoff) ──> 事实与视觉上下文冻结
          │
[ 05. 双工作台交付 ]   ──> Listing Studio V5 文案草稿 + Image Studio 视觉图生成
          │
[ 06. 人工复核交付 ]   ──> 免密直接查看与保存快照，下一步由用户决定
```

- **单用户本地直通**：所有页面彻底移除登录弹窗、密码输入框与拦截蒙层；所有 API 恒定返回单用户有效上下文，无 401 权限阻断。
- **历史 Auth 安全归档**：历史 `authGuard`, `demoGuard`, `session`, `LoginPage`, `DemoAccessBanner` 等全部完整保留并迁移至 `archive/auth-system/`，物理无损，业务代码引用完全解耦清理。
- **事实与证据边界**：只有人工确认的 `confirmedFacts` 是事实真理源；未确认的参考数据、VOC 评价、竞品信息永不越权升级为产品事实。

---

## 4. 真实浏览器端到端验收证据

于 2026-09-16 18:33 在本地 `http://127.0.0.1:3005` 使用真实 Google Chrome 验证：

1. **桌面首页 (`/`)**：
   - 登录与密码入口存在性检查：**False**（完全无登录遮罩）；
   - 主标题为“轻选工作台”；
   - 状态栏显示“本地工作台已就绪 · 数据已同步”；
   - 页面截图：`output/browser-evidence/01_desktop_home.png`。
2. **待研究商品池 (`/opportunity-candidates`)**：
   - 正常加载候选项，直通无拦截；
   - 页面截图：`output/browser-evidence/02_desktop_candidates.png`。
3. **真实任务详情 (`/tasks/cmu0zrjjg000l9641b2a57bti`)**：
   - THERMOS FUNTAINER 真实商品研究数据完整渲染；
   - 页面截图：`output/browser-evidence/03_desktop_task_detail.png`。
4. **文案工作台 (`/listing-studio`)**：
   - 正常直通访问，页面截图：`output/browser-evidence/04_desktop_listing_studio.png`。
5. **图片工作台 (`/image-studio`)**：
   - 正常直通访问，页面截图：`output/browser-evidence/05_desktop_image_studio.png`。
6. **移动端自适应 (390×844)**：
   - 首页横向溢出：**False**（`scrollWidth <= window.innerWidth`）；
   - 详情页横向溢出：**False**；
   - 页面截图：`output/browser-evidence/06_mobile_home.png`, `07_mobile_task_detail.png`。
7. **控制台与报错统计**：
   - Page Errors: `0`
   - Console Errors: `0`

---

## 5. 明确不做的事（产品边界）

- 保持单用户本地工作台，不重新引入多租户、密码保护或公开 Showcase 演示模式；
- 不自动采购、不自动上架、不自动投放广告；
- 缺少客观证据的数据一律诚实保留为未知，不让 AI 幻觉编造。

