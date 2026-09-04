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
    badge: "V4.1 · Final Frozen Baseline",
    title: "轻选工作台",
    subtitle: "Evidence-driven AI Commerce Workbench",
    description:
      "面向跨境电商商品研究与 Amazon 上架准备，把商品研究、证据整理、人工事实确认、Listing 与图片创作收成一条可复核的工作流。",
    primaryCta: {
      text: "▶ 观看真实演示",
      targetId: "demo-video",
    },
    secondaryCta: {
      text: "查看项目亮点",
      targetId: "project-slides",
    },
    githubLink: {
      text: "GitHub ↗",
      url: "https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer",
    },
  },

  video: {
    src: null,
    poster: null,
    durationLabel: "90 秒",
    status: "placeholder",
    title: "真实项目演示",
    subtitle:
      "完整演示将展示从商品研究、证据确认，到 Listing Studio 与 Image Studio 的真实本地流程。",
    badge: "演示视频准备中",
    futureSrcPath: "/showcase/video/project-demo.mp4",
    futurePosterPath: "/showcase/video/project-demo-poster.webp",
  },

  slides: [
    {
      id: "problem",
      eyebrow: "01 / Problem",
      title: "这个项目解决什么问题",
      description:
        "跨境商品研究往往散落在报表、竞品、评论与供应链资料中，而生成式 AI 又容易把推测当成事实。轻选工作台把这些资料先整理成可核验的 Evidence，再进入后续人工事实确认。",
      image: null,
      alt: "这个项目解决什么问题",
      futureImagePath: "/showcase/images/01-problem.webp",
    },
    {
      id: "workflow",
      eyebrow: "02 / Workflow",
      title: "从商品研究到内容产出的完整主链",
      description:
        "候选商品进入研究后，依次完成关键词、竞品、VOC、1688 与成本风险分析，再通过人工事实门禁，最终进入 Listing Studio 与 Image Studio。",
      image: null,
      alt: "从商品研究到内容产出的完整主链",
      futureImagePath: "/showcase/images/02-workflow.webp",
    },
    {
      id: "sources",
      eyebrow: "03 / Multi-source",
      title: "商品研究不是只看一个数据源",
      description:
        "SellerSprite、Amazon 竞品、真实买家评论、1688 货源与成本风险分别解决不同问题。系统保留每类信息的来源和边界，避免把外部资料直接当成本商品事实。",
      image: null,
      alt: "商品研究不是只看一个数据源",
      futureImagePath: "/showcase/images/03-research.webp",
    },
    {
      id: "facts",
      eyebrow: "04 / Fact Boundary",
      title: "研究资料 ≠ 商品事实",
      description:
        "Evidence 只是证据，只有经过运营人员审核确认的内容才能进入 Human Confirmed Facts。后续 Listing 与图片创作只能使用受控权威事实。",
      image: null,
      alt: "研究资料 ≠ 商品事实",
      futureImagePath: "/showcase/images/04-human-confirmed-facts.webp",
    },
    {
      id: "review",
      eyebrow: "05 / Human Review",
      title: "最终输出仍然需要人工审核",
      description:
        "Listing Studio 与 Image Studio 负责把已确认事实转化为可用草稿，但系统不会自动发布或自动上架。最终输出始终进入 Human Review 阶段。",
      image: null,
      alt: "最终输出仍然需要人工审核",
      futureImagePath: "/showcase/images/05-output.webp",
    },
  ],

  workflow: {
    sectionTitle: "核心主链说明",
    sectionSubtitle: "把复杂的跨境商品研究与内容创作收敛为四步确定性状态流",
    steps: [
      {
        step: "01",
        title: "Research Input",
        summary: "多源资料输入",
        desc: "关键词 / 竞品 / VOC / 1688 / 成本风险",
      },
      {
        step: "02",
        title: "Evidence",
        summary: "证据治理分析",
        desc: "整理来源、冲突与未知信息",
      },
      {
        step: "03",
        title: "Human Confirmed Facts",
        summary: "人工事实确认",
        desc: "由人决定哪些内容是真实商品事实",
      },
      {
        step: "04",
        title: "Controlled Output",
        summary: "受控草稿输出",
        desc: "Listing / Image 草稿进入人工复核",
      },
    ],
  },

  projectWork: {
    sectionTitle: "这个项目我具体做了什么",
    roleStatement:
      "以 AI Coding 为主要开发方式，完成产品设计、任务拆解、实现推进、验证与迭代收口。",
    items: [
      {
        title: "从需求到产品主链设计",
        desc: "梳理跨境电商运营真实卡点，确立「Evidence ≠ Fact」核心安全红线与端到端状态机架构。",
      },
      {
        title: "AI 辅助开发与前后端实现",
        desc: "主导提示词工程拆解、代码级门禁契约约束、Next.js 响应式界面与本地持久化治理。",
      },
      {
        title: "数据 / Evidence / Fact 权限边界设计",
        desc: "建立正向白名单与多源证据溯源机制，防止模型幻觉、竞品卖点误挪用与脏数据污染。",
      },
      {
        title: "Listing / Image 生成链与真实浏览器验收",
        desc: "构建 Copy Quality 语法过滤引擎与真实无头浏览器 CDP 验收套件，确保全流程真实可用。",
      },
    ],
    baseline: "V4.1 · Final Frozen Baseline",
    badges: [
      "Business Flow Complete",
      "CI Verified",
      "Human-in-the-Loop",
      "Local Production Workflow",
    ],
  },

  footer: {
    title: "轻选工作台",
    description: "本页面为项目展示入口。完整工程、测试与冻结基线见 GitHub。",
    githubUrl: "https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer",
  },
};
