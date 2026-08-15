# V3.5-A — Candidate Matrix（统一 3 Candidate 对比矩阵）

> 任务书三十八节。Candidate 设计 + 各 Route 状态（**静态 + Route B/C 实测（2026-08-15）；Route A 待实测**）。
> Candidate 均基于 V3.4 已验证的真实 Amazon ASIN（同一批，保证跨 Route 公平比较）。

## 1. 统一 Candidate（任务书十一/十四节）

| Case | Amazon ASIN（真实） | 类型 | 选择理由 |
|---|---|---|---|
| **A** | B0C3NFB3CZ（OtterBox 保温杯） | 外观明显、易找相似款 | 简单高相似场景 |
| **B** | B0BG3C7CNJ（Igloo 16-Can Snoopy 午餐盒） | 多规格/SKU 复杂（颜色/容量/材质变体） | SKU 复杂场景 |
| **C** | B07G4VTV2F（KINTO 杯）/ B00063QBL8（John Boos 砧板） | 视觉相似但规格易错（容量/材质/尺寸口径） | 误判风险场景 |

## 2. 矩阵（静态 + Route B/C 实测；Route A 待实测）

| | Route A（官方 API） | Route B（1688-cli） | Route C（OpenCLI Bridge） | Manual |
|---|---|---|---|---|
| **Candidate A** | NOT_TESTED（无 AK） | ✅ **实测成功**：搜索 10 候选（5 广告位 isP4P 标记）；同品类相似无同款；实体绑定 10/10；❌ 图搜失败（fail-open） | ✅ **实测成功**：搜索 8 候选 8/8 唯一 offer_id；item 结构化+阶梯价；❌ 无 image-search 能力 | 已执行（"完成"；定量缺失） |
| **Candidate B** | NOT_TESTED | ✅ **实测成功**："Snoopy 午餐包"10 候选 4 条 Snoopy（实体级 partial）；❌ 图搜失败 | ✅ **实测成功**："Snoopy 午餐包"8 候选 4 条 Snoopy（与 B 结果一致互证） | 已执行（同上） |
| **Candidate C** | NOT_TESTED | ✅ **实测成功**："实木砧板"5 候选；❌ KINTO 图搜失败 | ⚠️ 部分实测（item/store 覆盖 A/B 案例；C 案例未逐格跑，能力与 A/B 格等价） | 已执行（同上） |

**每格记录口径**（B/C 实测值）：acquisition success=YES（关键词路径）/ candidates=B:10、C:8 / entity integrity=B 10/10+C 8/8 唯一，B/C 跨路线同 offer 互证（价格/MOQ/供应商/年限一致）/ field coverage=B 15 字段全结构化；C search=原文拼接需解析、item=结构化（属性仅 9 项）/ image search=B ❌fail-open 不可用、C 无此能力 / user steps=首次：B 扫码 1 次、C 手动装扩展+登录 1 次（命令行加载失效实测）；后续均命令即得 / latency=B 6–13s、C 6–24s / credential model=B OWN_PROFILE+扫码、C EXISTING_BROWSER_SESSION / risk control=未登录/未连接均 fail-closed（B exit 3、C exit 69）/ failure mode=B 图搜静默垃圾；C 扩展断连明确报错 / restart stability=B daemon 重启会话复用、C daemon 重启自动重连+无需重新 bind/登录。

## 3. 实测设计（Route B/C 已执行；A 待执行）

- **Route A**（若 AK 获得）：`text_search(关键词)` → `image_search(主图)` → `link_search(URL)` → 3-5 offer → detail 字段；五态匹配人工核查。
- **Route B**：✅ 已执行 `search`×3 关键词 → `offer`×3 → `image-search`×3（失败）→ `similar`（官方引擎不可用）→ 重启复测（会话复用）。
- **Route C**：✅ 已执行 隔离 profile 登录 + Extension 加载 → `bind` 当前 Tab → `search`×2 → `item`×1 → `store`×1 → 重启复测（自动重连、无需重新 bind）→ 停 daemon。
- **Manual**：用户已执行（回复"完成"）；**定量指标（耗时/操作数）未提供——对比判据留缺口，如实记录**。
- 统一记录 15 字段（field-matrix.md）+ 五态匹配 + Wrong Entity 检查（B/C：search/detail 结构层 0 错误 + 跨路线互证；B 图搜路径 100% 无关——fail-open）。

## 4. 图片找货（任务书十五节，核心实验）

- 静态证据：Route A 有 image_search 能力（代码存在）；Route B README 声称支持；**Route C 无**。
- **实测结果（Route B 1688-cli image-search）**：3 张不同 Amazon 主图 → **同一批 8 条无关商品，exit 0 无告警（fail-open）** → 该命令不可用（禁用）。
- **实测结果（Native 1688 图搜，s.1688.com 相机入口）**：3 张 Amazon 主图 **3/3 成功**（A 8 候选全相关、B 6 候选 3 史努比、C 6 候选全相关）；Wrong Entity=0；三路互证（图搜卡片↔OpenCLI item↔1688-cli detail）；**exact_match=0**（同类候选发现，五态人工核查）。
- **结论**：**IMAGE_SEARCH = APPROVED（带约束）**——走 Native 1688 图搜（s.1688.com 入口），不走 1688-cli image-search；半自动（按钮点击需用户）；结果=候选发现非精确匹配。

## 5. 用户操作量（任务书二十七节）

- First-time friction / Recurring friction 将在实测阶段分 Route 记录；静态预估：
  - A：配置 AK 一次 → 后续一键（若 AK 易得则最佳）
  - B：扫码一次 → CLI 复用（daemon/session）
  - C：装 Bridge + Chrome 登录一次 → bind 当前 Tab 即可
  - Manual：每次搜索+复制+粘贴（无复用）
