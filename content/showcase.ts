/**
 * 公网 HR 项目展示页静态配置文件。
 *
 * 核心规范：
 * 1. 静态单页，零运行时 API，零数据库依赖；
 * 2. 未来仅需替换 video.src/poster 与 slides[i].image，即可无缝加载真实媒体，无需修改任何组件或布局；
 * 3. 严格遵守 Evidence-driven 产品边界与事实隔离表达。
 */

export interface ShowcaseVideoConfig {
  src: string | null;
  poster: string | null;
  durationLabel: string;
  status: "placeholder" | "ready";
  title: string;
  subtitle: string;
  badge: string;
  futureSrcPath: string;
  futurePosterPath: string;
}

export interface ShowcaseSlideItem {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string | null;
  alt: string;
  futureImagePath: string;
}

export interface ShowcaseWorkflowStep {
  step: string;
  title: string;
  summary: string;
  desc: string;
}

export interface ShowcaseWorkItem {
  title: string;
  desc: string;
}

export interface ShowcaseContent {
  hero: {
    badge: string;
    title: string;
    subtitle: string;
    description: string;
    primaryCta: {
      text: string;
      targetId: string;
    };
    secondaryCta: {
      text: string;
      targetId: string;
    };
    githubLink: {
      text: string;
      url: string;
    };
  };
  video: ShowcaseVideoConfig;
  slides: ShowcaseSlideItem[];
  workflow: {
    sectionTitle: string;
    sectionSubtitle: string;
    steps: ShowcaseWorkflowStep[];
  };
  projectWork: {
    sectionTitle: string;
    roleStatement: string;
    items: ShowcaseWorkItem[];
    baseline: string;
    badges: string[];
  };
  footer: {
    title: string;
    description: string;
    githubUrl: string;
  };
}

export const showcaseContent: ShowcaseContent = {
  hero: {
    badge: "跨境电商专用 · 智能工作台",
    title: "轻选工作台",
    subtitle: "让 AI 帮你做电商：查得准、写得真、绝不瞎编",
    description:
      "专为跨境卖家打造的智能帮手。我们先把同行卖点、买家差评吐槽、1688 源头工厂实测数据找齐；你点一下确认真实卖点，AI 再根据真材实料写文案、做图片，彻底杜绝虚假宣传与平台封店风险！",
    primaryCta: {
      text: "▶ 观看 90 秒完整演示",
      targetId: "demo-video",
    },
    secondaryCta: {
      text: "浏览核心功能大图",
      targetId: "project-slides",
    },
    githubLink: {
      text: "GitHub 源码 ↗",
      url: "https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer",
    },
  },

  video: {
    src: null,
    poster: null,
    durationLabel: "90 秒",
    status: "placeholder",
    title: "核心业务闭环实操演示",
    subtitle:
      "90 秒完整演示：从多源数据调研、人工证据核准，到 Listing 与高质感生图受控产出的真实流程。",
    badge: "演示视频准备中",
    futureSrcPath: "/showcase/video/project-demo.mp4",
    futurePosterPath: "/showcase/video/project-demo-poster.webp",
  },

  slides: [
    {
      id: "problem",
      eyebrow: "01 核心痛点",
      title: "普通 AI 写文案，太容易瞎编乱造",
      description:
        "很多卖家用通用 AI 写文案，AI 经常凭空捏造虚假参数，导致退货甚至被亚马逊封店。轻选工作台先把资料收纳成真凭实据，你点一下确认真实卖点，AI 才能开始写。",
      image: "/showcase/images/4k/01-problem-4k.png?v=4k_v13",
      alt: "这个项目解决什么问题：普通 AI 容易瞎编乱造，轻选工作台先整理真实资料再进入创作",
      futureImagePath: "/showcase/images/4k/01-problem-4k.png",
    },
    {
      id: "workflow",
      eyebrow: "02 业务全貌",
      title: "从选品调研到一键出图的完整全流程",
      description:
        "输入你想做的商品，系统自动查热搜词、同行竞品、买家差评与 1688 货源底价，经过你一眼核对后，自动写出高转化文案并生成商品图。",
      image: "/showcase/images/4k/02-workflow-4k.png?v=4k_v13",
      alt: "从商品研究到内容产出的完整主链：研究、事实确认与创作全流程闭环",
      futureImagePath: "/showcase/images/4k/02-workflow-4k.png",
    },
    {
      id: "sources",
      eyebrow: "03 多源数据",
      title: "找资料不只看一家，多维度对比才靠谱",
      description:
        "行业大盘词频、亚马逊热卖同行、真实买家吐槽痛点、1688 源头工厂出厂价，四路数据同时对比，哪些是同行吹牛、哪些是真实需求，一清二楚。",
      image: "/showcase/images/4k/03-research-4k.png?v=4k_v13",
      alt: "一次商品研究同时看多类信息：关键词、竞品、差评吐槽与 1688 工厂底价",
      futureImagePath: "/showcase/images/4k/03-research-4k.png",
    },
    {
      id: "facts",
      eyebrow: "04 事实边界",
      title: "网上资料 ≠ 最终卖点（核心红线）",
      description:
        "网上搜来的资料难免有夸大虚标，只有你亲自核对确认过的内容，才算作“真实卖点”。系统严格保证：AI 只能用你确认过的真实数据写文案，绝不多嘴瞎编。",
      image: "/showcase/images/4k/04-human-confirmed-facts-4k.png?v=4k_v13",
      alt: "网上资料不等于商品事实：多源证据来源经人工确认后，方可进入权威事实库",
      futureImagePath: "/showcase/images/4k/04-human-confirmed-facts-4k.png",
    },
    {
      id: "review",
      eyebrow: "05 人工把关",
      title: "文案图片做好了，运营确认好直接上架",
      description:
        "AI 自动帮你排版好亚马逊标准的英文标题、五点描述和产品图，系统不搞不可控的自动上架，由你最终看一眼，满意了直接一键复制去后台发布。",
      image: "/showcase/images/4k/05-output-4k.png?v=4k_v13",
      alt: "最终输出仍然需要人工审核：文案与图片受控产出，待人工复核后一键复制上架",
      futureImagePath: "/showcase/images/4k/05-output-4k.png",
    },
  ],

  workflow: {
    sectionTitle: "怎么帮你把商品做起来？",
    sectionSubtitle: "只需简单四步，从找资料到出文案出图，清清楚楚、绝不瞎编",
    steps: [
      {
        step: "01",
        title: "自动挖全网资料",
        summary: "多维度素材一键汇总",
        desc: "热搜词 / 同行竞品卖点 / 买家真实差评吐槽 / 1688 源头工厂底价",
      },
      {
        step: "02",
        title: "过滤吹牛假大空",
        summary: "去假存真，清爽干净",
        desc: "剔除同行虚标夸大的参数，整理出实打实的真实参数和买家吐槽，不当冤大头",
      },
      {
        step: "03",
        title: "运营一眼核对",
        summary: "点一下确认，防 AI 瞎编",
        desc: "哪些卖点能说、哪些涉嫌违规，您一眼过目点确认，给 AI 划清说话边界",
      },
      {
        step: "04",
        title: "自动出文案与图片",
        summary: "字数合规、卖点真实",
        desc: "严格按核实好的事实写标题、5 点描述并生成商品图，复制就能直接上架",
      },
    ],
  },

  projectWork: {
    sectionTitle: "这个项目我具体做了什么",
    roleStatement:
      "针对跨境卖家害怕 AI 瞎编导致退货封店的痛点，独立完成产品设计、安全门禁规则制定、前后端开发与自动化验证。",
    items: [
      {
        title: "从卖家痛点出发设计产品主流程",
        desc: "深入跨境运营真实卡点，确立“先核对真实数据、再让 AI 生成”的安全规则，杜绝大模型幻觉瞎编。",
      },
      {
        title: "全栈开发工作台前端与后台逻辑",
        desc: "采用 Next.js 独立完成全部界面交互、数据清洗过滤机制以及本地持久化治理。",
      },
      {
        title: "严控数据边界，绝不混淆真实卖点",
        desc: "建立严格白名单机制，同行吹牛的夸大宣称自动隔离，只允许经过运营确认的真实参数进入文案。",
      },
      {
        title: "Listing 与生图质量把关及自动化测试",
        desc: "编写文案质量过滤器与真实无头浏览器端到端测试，确保每个按钮、每张大图在手机和电脑上都顺畅可用。",
      },
    ],
    baseline: "实操验证 · 交付基线",
    badges: [
      "全流程业务闭环",
      "自动化测试保障",
      "彻底杜绝 AI 瞎编",
      "极简大白话操作",
    ],
  },

  footer: {
    title: "轻选工作台",
    description: "专为跨境卖家打造的智能商品研究与内容创作工具。源码与工程沉淀已开源在 GitHub。",
    githubUrl: "https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer",
  },
};
