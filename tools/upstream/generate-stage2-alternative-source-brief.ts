import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRevalidationResult } from "./stage2-public-revalidation-result";
import {
  buildStage2AlternativeSourceBrief,
  validateStage2AlternativeSourceBrief,
} from "./stage2-alternative-source-brief";

type FailedRevalidation = ReturnType<typeof buildStage2PublicRevalidationResult>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildResearch(createdAt: string) {
  const body = {
    schemaVersion: "stage2-alternative-source-research.v1" as const,
    status: "selected_pending_authorization" as const,
    createdAt,
    decisionPurpose: "select_https_only_public_supplier_source_for_stage2_high_01" as const,
    selectedPlatform: "made_in_china" as const,
    selectedOrigin: "https://www.made-in-china.com" as const,
    realProductEvidenceCollected: false as const,
    candidates: [
      {
        platform: "made_in_china" as const,
        decision: "selected" as const,
        officialEvidence: [
          {
            url: "https://www.made-in-china.com/",
            supports: "official_b2b_product_and_supplier_directory",
          },
          {
            url: "https://www.made-in-china.com/help/faq/",
            supports: "official_keyword_search_and_supplier_discovery_workflow",
          },
          {
            url: "https://www.made-in-china.com/products-search/hot-china-products/Hanging_Organizer.html",
            supports: "public_https_result_page_exposes_listing_price_and_moq",
          },
          {
            url: "https://www.made-in-china.com/help/terms/",
            supports: "supplier_listing_information_requires_independent_evaluation",
          },
        ],
        limitations: [
          "supplier_subdomains_are_not_allowed_by_this_brief",
          "public_listing_price_is_not_a_confirmed_quotation",
          "platform_does_not_guarantee_each_supplier_claim",
          "amazon_source_title_does_not_observe_material",
          "attribute_match_alone_cannot_confirm_same_variant",
          "robots_policy_must_be_checked_at_runtime_before_navigation",
        ],
      },
      {
        platform: "global_sources" as const,
        decision: "deferred" as const,
        officialEvidence: [{
          url: "https://s.globalsources.com/HELP/GSOLHELP/SUPPTIP.HTM",
          supports: "official_supplier_search_exists",
        }],
        limitations: [
          "exact_single_origin_product_route_not_frozen",
          "registration_bound_services_are_out_of_scope",
        ],
      },
      {
        platform: "alibaba" as const,
        decision: "blocked_for_current_route" as const,
        officialEvidence: [],
        limitations: ["authoritative_run_observed_unexpected_http_intermediate_origin"],
      },
    ],
    boundary: {
      researchUsedOnlyPublicOfficialPages: true as const,
      noProductDetailEvidenceCollected: true as const,
      noLoginOrInquiry: true as const,
      noCookieOrPrivateProfile: true as const,
      noProxyOrAntiDetection: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noExternalAiOrPaidApi: true as const,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

function buildHandoff(briefId: string, briefHash: string): string {
  return `# Stage2 替代公开来源授权交接\n\n`
    + `当前状态：\`pending_user_authorization\`。这份材料不会自动访问网站，也不是采集授权。\n\n`
    + `## 已选来源\n\n`
    + `- 平台：Made-in-China.com。\n`
    + `- 唯一允许 Origin：\`https://www.made-in-china.com\`。\n`
    + `- 禁止所有 HTTP、供应商子域名、登录、询盘、Captcha 处理、代理和自动重试。\n`
    + `- 搜索页最多 1 页；同一精确 Origin 的商品页最多 2 页；总导航最多 3 次。\n\n`
    + `## 证据边界\n\n`
    + `公开页面显示的价格、MOQ 和包装字段只能标记为 direct_observation；不是确认报价，也不代表平台已核实。`
    + `Amazon 现有标题只明确支持 6 层、灰色和悬挂式，材料未知，禁止把 non-woven 写成目标事实。`
    + `属性相似本身不能确认同一变体，仍需明确供应链关联，否则以 variant_identity_cannot_be_confirmed 停止。`
    + `真实运行必须先检查 robots/站点政策；未知或不允许时停止，且该政策请求计入最多 4 次外部请求。\n\n`
    + `## 下一步\n\n`
    + `先复核 Brief-02；确认后只离线实现能力探针、Fixture 和 fail-closed 测试，不访问网站。`
    + `离线验收通过后，真实能力探针仍需另行明确授权。\n\n`
    + `Brief ID：\`${briefId}\`\n\nBrief Hash：\`${briefHash}\`\n`;
}

function buildOfflineProbeSpecification(briefId: string, briefHash: string): string {
  return `# Made-in-China 离线能力探针实现规格\n\n`
    + `关联 Brief：\`${briefId}\`\n\n关联 Hash：\`${briefHash}\`\n\n`
    + `## 目的\n\n`
    + `能力探针只证明浏览器能否在固定安全边界内识别公开搜索页和允许的商品链接。能力探针不采集供应商字段，不生成 Stage 2 submission、Candidate 或数据库记录，也不确认同一变体。\n\n`
    + `## 离线实现范围\n\n`
    + `- 复用现有系统 Chrome、动态 loopback CDP、全新临时 Profile 和清理机制；不新增依赖。\n`
    + `- 实现 robots/站点政策预检结果输入；unknown 或 disallow 必须在浏览器导航前阻断。\n`
    + `- 精确校验 Origin 为 \`https://www.made-in-china.com\`，拒绝 HTTP、供应商子域名和任何非预期中间跳转。\n`
    + `- 只识别 \`/products-search/\` 搜索页，以及 Brief 中两类精确商品路径；只输出脱敏页面分类和发现的白名单 URL。\n`
    + `- Captcha、登录/询盘、拒绝访问、浏览器错误页、未知页面、没有允许商品链接时 fail-closed；0 自动重试。\n`
    + `- 无论成功或失败，都必须关闭页面和浏览器、释放端口、删除本轮临时 Profile，并记录清理证据。\n\n`
    + `## 必须离线覆盖的 Fixture\n\n`
    + `1. 正常搜索页和轻微非关键 DOM 变化。\n`
    + `2. 精确 Origin 下两类允许商品路径。\n`
    + `3. HTTP、供应商子域名、异常 Origin 和异常中间跳转。\n`
    + `4. robots allow、disallow、unknown 和解析失败。\n`
    + `5. Captcha、登录/询盘、Access Denied、Service Unavailable、浏览器错误页和 unknown_page。\n`
    + `6. 搜索页无允许商品链接、导航预算耗尽和异常路径清理。\n\n`
    + `## 真实运行边界（本文件不授权）\n\n`
    + `未来若单独获授权：站点政策请求最多 1 次，浏览器导航最多 3 次，总外部请求预算最多 4 次；单次运行、0 重试。真实运行不得自动进入供应商取证；能力探针通过后仍需单独冻结取证 Brief。\n`;
}

function buildUserReviewChecklist(briefId: string, briefHash: string): string {
  return `# Brief-02 用户复核清单\n\n`
    + `你不需要判断供应商真假、成本或利润，只需确认下面的安全边界是否符合你的意思。\n\n`
    + `- [ ] 只允许 Made-in-China.com 的精确 HTTPS 主域名，不进入供应商子域名。\n`
    + `- [ ] 第一阶段只离线写能力探针和测试，不访问任何真实网站。\n`
    + `- [ ] 以后真实探针仍需我再次授权，且最多 1 次政策请求 + 3 次浏览器导航、0 重试。\n`
    + `- [ ] 公开价格、MOQ 和包装信息不是确认报价；6 层、灰色、悬挂式之外的材料等事实不得猜测。\n`
    + `- [ ] 属性相似不能证明同一变体；没有明确供应链关联就停止。\n\n`
    + `如以上边界都接受，请回复：\n\n`
    + `\`确认 Brief-02，离线实现能力探针\`\n\n`
    + `这句话只授权离线实现和测试，不授权访问 Made-in-China。\n\n`
    + `Brief ID：\`${briefId}\`\n\nBrief Hash：\`${briefHash}\`\n`;
}

export function generateStage2AlternativeSourceMaterials(input: {
  originalBriefFile: string;
  failedRevalidationResultFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const brief = buildStage2AlternativeSourceBrief({
    originalBrief: readJson<Stage2EvidenceCollectionBrief>(input.originalBriefFile),
    failedRevalidation: readJson<FailedRevalidation>(input.failedRevalidationResultFile),
    createdAt: input.createdAt,
  });
  const validation = validateStage2AlternativeSourceBrief(brief);
  if (validation.status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_GENERATION_INVALID");
  }
  const research = buildResearch(input.createdAt);
  const files = [
    "stage2-alternative-source-research.v1.json",
    "stage2-alternative-source-brief.v1.json",
    "stage2-alternative-source-brief-validation.v1.json",
    "01-用户授权交接.md",
    "02-离线能力探针实现规格.md",
    "03-用户复核清单.md",
    "generation-summary.stage2-alternative-source.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-generation-summary.v1" as const,
    status: validation.status,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    researchEvidenceHash: research.evidenceHash,
    validationInputHash: validation.inputHash,
    realWebsiteAccessedDuringGeneration: false as const,
    realProductEvidenceCollected: false as const,
    authorizationGranted: false as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(research) },
    { relativePath: files[1], content: jsonContent(brief) },
    { relativePath: files[2], content: jsonContent(validation) },
    { relativePath: files[3], content: buildHandoff(brief.briefId, brief.briefHash) },
    { relativePath: files[4], content: buildOfflineProbeSpecification(brief.briefId, brief.briefHash) },
    { relativePath: files[5], content: buildUserReviewChecklist(brief.briefId, brief.briefHash) },
    { relativePath: files[6], content: jsonContent(summary) },
  ], "STAGE2_ALTERNATIVE_SOURCE_OUTPUT_CONFLICT");
  return { research, brief, validation, summary, artifactWrite };
}
