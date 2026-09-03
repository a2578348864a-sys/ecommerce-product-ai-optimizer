<div align="center">

# 🛒 轻选工作台
### Evidence-driven AI Commerce Workbench

**证据驱动型 AI 跨境商品研究与上架准备工作台**

把真实多源采集、证据链治理、人工事实裁决与受控内容生成，组织成一条**可复核、防幻觉、符合平台合规标准**的完整上架全链路。

---

[![Next.js 16](https://img.shields.io/badge/Next.js-16.3-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.0-blue?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma SQLite](https://img.shields.io/badge/Prisma-5.22-teal?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Tests Passing](https://img.shields.io/badge/Tests-6649%20Passed-2ea44f?style=flat-square&logo=vitest)](https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer)
[![License MIT](https://img.shields.io/badge/License-MIT-orange?style=flat-square)](LICENSE)

</div>

---

> **💡 一句话定位**：  
> 轻选工作台面向跨境电商新手与小团队。它不是“输入标题就无脑写文案”的套壳 Demo，而是先整合 **SellerSprite 选品报表、Amazon 竞品、真实买家评论 (VOC) 与 1688 货源线索**，由运营人员最终打勾核准商品真实事实，再由代码级安全门禁驱动生成合规的 **Listing 与图片策划草稿**。

---

## 🎯 核心设计哲学：证据不等于事实（Evidence ≠ Fact）

在真实跨境电商上架中，AI 最致命的缺陷是**把外部推测、竞品夸大和买家主观情绪当成了本商品的物理规格**。  
为此，轻选工作台在系统底层确立了**不可逾越的事实隔离红线**：

```text
  Evidence ≠ Fact               # 采集到的文本仅作为参考证据，不自动升格为商品事实
  VOC ≠ Fact                    # 买家评论与吐槽是主观感知，不等于商品的物理属性
  AI Summary ≠ Fact             # AI 的推演与归纳只是参谋意见，不能直接作为上架规格
  Competitor Evidence ≠ Fact    # 竞品详情页的卖点是竞品特性，严禁直接挪用至本品
  Sourcing Evidence ≠ Fact      # 1688 批发商的声明不能等同于 Amazon 最终合规规格
  Keyword Evidence ≠ Fact       # 搜索关键词只提供流量靶向，不代表商品自带该项功能
```

### 📊 传统 AI 生成 vs 轻选工作台证据治理

| 维度 | 传统套壳 AI 工具 (Prompt-only) | 轻选工作台 (Evidence-driven) |
| :--- | :--- | :--- |
| **事实依据** | 模型自带知识或模糊网页推断（容易产生幻觉） | **严格 Positive-Allow**，每条事实必在证据索引中逐字可溯 |
| **竞品挪用** | 容易将竞品专有特性、专利卖点照抄到本品 | **实体隔离**，竞品五点仅作为市场定位参考，绝不进事实库 |
| **文案质量** | 机器味浓重、容易生成语法结构病句（假通过） | **Copy Quality 语法引擎**，正则级拦截 5 类僵硬病句 |
| **审核机制** | 全黑盒一键生成，运营人员无法溯源证据 | **人机协同确认**，事实由运营打勾确认并加盖 CAS 锁 |
| **供应链关联** | 脱离采购与成本现实 | **打通 1688 受控线索**，实时核算采购价、物流与合规状态 |

---

## 🔄 核心运行主链路 (Master Workflow)

系统将复杂的跨境选品、调研与创作解构为五步高可信数据流：

```text
 ┌─────────────────┐
 │ 外部多源真实数据 │ ──> SellerSprite 报表 / Amazon CDP 详情 / 1688 批发线索 / 买家真实评论
 └────────┬────────┘
          │ (美区环境校准 + 字段白名单 + 实体绑定 + 错误风控隔离)
          ▼
 ┌─────────────────┐
 │ Evidence 证据治理│ ──> 结构化归一化、来源溯源哈希、广告剔除、买家真实 VOC 洞察
 └────────┬────────┘
          │ (AI 深度归纳与风险推演)
          ▼
 ┌─────────────────┐
 │ 运营人工裁决门禁 │ ──> 人机协同核对、事实候选筛查、解决冲突、打勾确认 (CAS 乐观锁防踩踏)
 └────────┬────────┘
          │ (沉淀为不可篡改的 Human Confirmed Facts)
          ▼
 ┌─────────────────┐
 │ 受控创作双工坊   │ ──> 阶段 A 事实语义渲染 ──> 阶段 B 运营自然润色 ──> 视觉策略生成
 └────────┬────────┘
          │
          ├─► [Listing Studio] ──► Positive-Allow 证据回溯门禁 + Copy Quality 语法防假通过
          └─► [Image Studio]   ──► 视觉参考审批 + 受控 Prompt 契约 + 多尺寸自适应
```

1. **机会发现与导入**：解析 SellerSprite 市场报表与选品雷达，建立候选商品池（`OpportunityCandidate`）。
2. **多源真实取证与分析**：采集真实关键词、竞品五点、真实 VOC 评论、1688 供应链货源及采购物流成本。
3. **人工决策与事实锁定**：由人做最终裁决，将推测性信息与物理事实严格剥离，确认硬性规格并加盖 CAS 版本印章。
4. **Listing Studio 受控创作**：基于已确认事实生成标题、五点、描述与后台搜索词；受事实安全与英文语法双重门禁护航。
5. **Image Studio 视觉策划**：基于已批准视觉参考与确认事实生成合规提示词与分镜设计，成果由运营最终审核。

---

## 🛡️ 四大工程核心支柱（技术杀手锏）

### 1. 有约束的 Web Acquisition 工程（真实美区环境采集）
- **真实环境校准**：通过独立 Chrome CDP Session 驱动，注入美国真实 ZIP 邮区（90001）与 USD 货币环境校准；
- **实体强制绑定**：页面抽取与 ASIN、变体 Key 严格绑定；非 USD 币种不私自汇率换算，主动 Fail-Closed 熔断；
- **反爬与噪声防御**：自动识别并剔除 Sponsored 广告；遭遇验证码（Captcha）、登录墙、异常重定向立即安全退出。

### 2. 受控 1688 货源线索引擎（供应链受控接入）
- **安全命令白名单**：只读 CLI 命令白名单执行，实施版本握手、超时控制与最大输出体积限制；
- **风控与 Schema 归一化**：将供应商接口风控错误精准映射为业务状态；搜索结果必须经过运营 Preview 确认后才进入 Evidence；
- **访客权限隔离**：在 Public / Visitor 模式下物理切断外部命令执行，严防私有供应链资产泄露。

### 3. 代码级 Positive-Allow 门禁与 Copy Quality 语法防假通过
- **Positive Allow 原则**：文案中出现的任何事实性 Claim（材质、隔层数、尺寸、容量），必须能在 Evidence 索引中找到逐字支持依据；无依据推断材质等级、认证、夸大性能一律**代码级拦截拒绝**；
- **语法级防假通过 (Copy Quality Engine)**：突破“词数达标就放行”的虚假门禁，构建严格的模式识别引擎，深度拦截 5 类机器容易犯的僵硬病句：
  - 动词机制套壳（如 `opens through its ... mechanism`）
  - 介词与搭配错误（如 `suitable for use at daily hydration`）
  - 场景复读口吃（如 `suitable for use at ... desk use`）
  - 主客体逻辑倒置（如 `fits cup holder-friendly base`）
  - 单数可数名词无冠词裸奔（如 `features MagSlider lid`）
- **跨商品形态泛化**：针对 **Organizer（刀叉收纳盒）**、**Water Bottle（吸管水杯）**、**Tumbler（车载咖啡杯）** 三类差异明显的形态，通过全套红绿泛化测试验收。

### 4. 双运行模式与状态版本治理（Dual Runtimes & State Governance）
- **两套运行模式**：
  - `local_owner`：本机 Owner 免密完整工作台，本地 SQLite CAS 乐观锁版本并发控制（零脏写、防踩踏）；
  - `public_showcase`：公开脱敏演示沙箱，仅对外呈现静态案例与快照，物理阻断实时采集与数据库写入；
- **历史快照读取动态重判（Historical Draft Read Guard）**：即使旧数据库中曾将某份草稿标记为 `pass`，新版本在读取历史快照时依然实时执行最新门禁，一旦检测到坏文案立即自动清空正文并提示重审，绝不糊弄过关。

---

## 📂 仓库全景架构与模块职责

```text
ecommerce-product-ai-optimizer/
├── app/                              # Next.js 16 App Router 前端与服务层 (29 页面 + 83 API)
│   ├── (studios)/                    # Listing Studio 与 Image Studio 受控工坊
│   ├── opportunities/                # 市场发现、选品雷达与 SellerSprite 报表透视
│   ├── tasks/                        # 商品深度研究主控台 (7 大证据锚点与事实确认)
│   └── v4/runs/                      # LangGraph 流程执行追踪与调试面板
├── components/                       # 模块化 UI 组件库 (Tailwind CSS + Lucide)
│   ├── creative-handoff/             # 创作交接与事实候选审核交互
│   ├── cross-border/                 # 竞品分析、买家评论 VOC、1688 货源面板
│   └── listing-handoff/              # Listing 运营编辑器与质量检测卡片
├── lib/                              # 核心业务与领域逻辑层
│   ├── listingHandoff/               # Listing 阶段 A 渲染、阶段 B 运营润色、Copy Quality 引擎
│   ├── imageHandoff/                 # 视觉参考匹配、Prompt 拼装与图片元数据
│   └── server/                       # 权限契约、SQLite CAS 锁、Fail-Closed 防护与安全 DTO
├── tools/                            # 外部采集实现 (Chrome CDP 采集器、SellerSprite 解析器)
├── prisma/                           # 混合数据架构 (任务表、批次表、原子事实表 schema.prisma)
├── scripts/                          # 本地守护进程管理、构建代理与数据库备份脚本
├── docs/                             # 规范文档库 (架构总览、权限契约、发布冻结清单)
│   ├── architecture/                 # 架构总览与核心契约
│   └── v4.1/                         # V4.1 里程碑验收与实测证据截图
└── FINAL_FREEZE.md                   # 项目最终结项基线与不可篡改审计证据
```

---

## 📊 工程基线与质量表现

| 质量维度 | 测量标准与实际指标 | 状态 |
| :--- | :--- | :---: |
| **自动化测试套件** | **6,649 项测试通过**（563 个测试套件通过，覆盖率 97.5%） | ✅ 通过 |
| **应用源码类型检查** | `app/`, `components/`, `lib/`, `hooks/` 源码全量 `tsc --noEmit`，**0 错误** | ✅ 纯净 |
| **代码规范扫描** | 全库源码执行 ESLint，**0 错误** | ✅ 纯净 |
| **真实浏览器端到端** | 无头 Chrome (CDP) 走查 8 大主页面（1440 宽屏 / 390 手机端），**0 控制台错误 / 0 横向滚动** | ✅ 完美 |
| **生产打包构建** | Next.js 16 Webpack 生产构建成功，生成确定性 `BUILD_ID` | ✅ 通过 |
| **数据安全基线** | SQLite 混合结构 + CAS 乐观锁版本并发控制，全流程主库 **0 脏写** | ✅ 安全 |

---

## 🚀 极简快速上手 (Getting Started)

### 1. 环境准备
- **Node.js**: 20.9.0 或更高版本
- **npm**: 10.0.0 或更高版本

### 2. 安装与配置
```bash
# 克隆代码仓库
git clone https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer.git
cd ecommerce-product-ai-optimizer

# 安装依赖
npm install

# 初始化本地数据库
npx prisma generate
npx prisma db push

# 配置本地环境变量 (默认开启免密安全 Mock 模式，零成本体验完整闭环)
cp .env.example .env.local
```

`.env.local` 基础默认配置：
```dotenv
QX_RUNTIME_MODE=local_owner
DATABASE_URL="file:./dev.db"
LISTING_PROVIDER_MODE=mock
IMAGE_PROVIDER_MODE=mock
```

### 3. 启动工作台
```bash
# 本地守护进程启动 (推荐，带 SQLite 门禁保护)
npm run start:local

# 或使用开发模式
npm run dev:local
```

打开浏览器访问：**<http://127.0.0.1:3005>**

---

## 💡 操盘手四步走指引（极简大白话）

- **Step 1. 挑选商品与导入线索**：上传一份 SellerSprite 市场报表，系统自动解析市场体量与价格分布，沉淀至候选池。
- **Step 2. 深度查证并确认事实**：启动商品研究，系统抓取竞品五点与真实 VOC 评论。你在页面中只做一件事：**为当前商品真实具备的物理特性打勾（确认事实）**。
- **Step 3. 一键生成合规 Listing**：进入 Listing Studio，系统严格基于确认事实进行自然渲染与润色，一键复制符合 Amazon 规范的标题、五点与描述。
- **Step 4. 策划营销视觉方案**：进入 Image Studio，依据确认事实与批准的视觉风格生成图片策略与合规分镜，导出交付美工。

---

## 🧭 进阶与权威文档索引

- **结项与基线冻结报告**：[FINAL_FREEZE.md](FINAL_FREEZE.md)
- **文档中心全景索引**：[docs/README.md](docs/README.md)
- **系统架构与数据流**：[docs/architecture/overview.md](docs/architecture/overview.md)
- **权限隔离与配额契约**：[docs/architecture/auth-and-quota-contract.md](docs/architecture/auth-and-quota-contract.md)
- **生产环境部署手册**：[docs/deployment/production-runbook.md](docs/deployment/production-runbook.md)
- **安全策略与漏洞报告**：[SECURITY.md](SECURITY.md)
- **版本历史记录**：[CHANGELOG.md](CHANGELOG.md)

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
