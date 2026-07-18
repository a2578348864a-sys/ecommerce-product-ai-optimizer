import { createHash } from "node:crypto";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildStage15ShadowObservation } from "./stage15-shadow-calibration";
import { buildStage15ShadowPublicSource } from "./stage15-shadow-public-source";

type AccessBudget = {
  maxAggregatePageRequests: number;
  maxDetailPageRequests: number;
  maxAutomaticRetries: number;
  maxImageDownloads: number;
  actualAggregatePageRequests: number;
  requestedUrls: string[];
};

export type Stage15ShadowPublicUpstreamInput = {
  role: "calibration" | "validation";
  batchId: string;
  manifestId: string;
  briefId: string;
  collectionRunId: string;
  query: string;
  category: string;
  targetScenario: string;
  targetPriceRange: { min: number; max: number };
  sourceUrl: string;
  sourceMarkdown: string;
  sourceFileSha256: string;
  page: 1 | 2;
  capturedAt: string;
  accessBudget: AccessBudget;
  forbiddenPlatformProductIds: string[];
  outputDirectory: string;
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateAccessBudget(budget: AccessBudget): void {
  const nonNegativeIntegers = [
    budget.maxAggregatePageRequests,
    budget.maxDetailPageRequests,
    budget.maxAutomaticRetries,
    budget.maxImageDownloads,
    budget.actualAggregatePageRequests,
  ].every((value) => Number.isInteger(value) && value >= 0);
  if (!nonNegativeIntegers
    || budget.actualAggregatePageRequests > budget.maxAggregatePageRequests
    || budget.maxDetailPageRequests !== 0
    || budget.maxAutomaticRetries !== 0
    || budget.maxImageDownloads !== 0
    || budget.requestedUrls.length !== budget.actualAggregatePageRequests
    || !budget.requestedUrls.every((url) => /^https:\/\/www\.amazon\.com\//u.test(url))) {
    throw new Error("SHADOW_PUBLIC_ACCESS_BUDGET_INVALID");
  }
}

function missing<T>(reason: string) {
  return {
    value: null as T | null,
    status: "missing" as const,
    evidenceRefs: [] as string[],
    capturedAt: null,
    exactVariant: null,
    missingReason: reason,
  };
}

function observed<T>(value: T, evidenceRef: string, capturedAt: string) {
  return {
    value,
    status: "observed" as const,
    evidenceRefs: [evidenceRef],
    capturedAt,
    exactVariant: true as const,
    missingReason: null,
  };
}

function humanForm(packet: {
  batchLabel: string;
  items: Array<{
    evaluationItemId: string;
    sourceEvidence: {
      title: string;
      imageUrl: string | null;
      price: number | null;
      rating: number | null;
      reviewCount: number | null;
      categoryRank: number;
      category: string;
      dimensions: null;
      material: null;
    };
  }>;
}) {
  const sections = packet.items.map((item) => {
    const evidence = item.sourceEvidence;
    const image = evidence.imageUrl
      ? `![${item.evaluationItemId} 商品图](${evidence.imageUrl})\n\n> 图片为公开来源的外部引用，未下载到本地。`
      : "> 商品图缺失：类目页未提供可用图片。";
    return `## ${item.evaluationItemId}\n\n${image}\n\n`
      + `- 商品标题：${evidence.title}\n`
      + `- 价格：${evidence.price === null ? "未显示" : `$${evidence.price.toFixed(2)}`}\n`
      + `- 评分：${evidence.rating ?? "未显示"}\n`
      + `- 评论数量：${evidence.reviewCount ?? "未显示"}\n`
      + `- 类目排名：#${evidence.categoryRank}（${evidence.category}）\n`
      + "- 尺寸：未采集（详情页访问预算为 0）\n"
      + "- 材料：未采集（详情页访问预算为 0）\n"
      + "- 月购买量／上架时间／精确同款好差评：未采集（详情页访问预算为 0）\n\n"
      + "请填写：\n\n"
      + "- 能否理解商品：yes / no / uncertain：\n"
      + "- 是否愿意花接下来 10 分钟继续调查：yes / no / uncertain：\n"
      + "- Stage 1.5 证据是否足够：yes / no：\n"
      + "- 是否值得进一步调查：yes / no / insufficient_evidence：\n"
      + "- 影子评价证据是否足够：yes / no：\n"
      + "- 主导信号：market_validation / listing_maturity / buyer_reviews / product_fit / risk / other（可多选）：\n"
      + "- 信心：high / medium / low：\n"
      + "- 理由（保留原话）：\n";
  });
  return `# Stage 1.5 影子校准盲化人工评价（${packet.batchLabel}）\n\n`
    + "状态：`pending_human_evaluation`。这不是商业候选或盈利判断。请不要查看私有绑定文件；只按本表可见证据作答。\n\n"
    + `${sections.join("\n\n")}\n`;
}

export function generateStage15ShadowPublicUpstream(input: Stage15ShadowPublicUpstreamInput) {
  validateAccessBudget(input.accessBudget);
  if (sha256(input.sourceMarkdown) !== input.sourceFileSha256.toLowerCase()) {
    throw new Error("SHADOW_PUBLIC_SOURCE_HASH_MISMATCH");
  }
  const source = buildStage15ShadowPublicSource(input);
  const platformIds = source.importPackage.candidates.map((candidate) =>
    candidate.evidenceSnapshot.product.platformProductId.toUpperCase());
  const forbidden = new Set(input.forbiddenPlatformProductIds.map((value) => value.toUpperCase()));
  if (platformIds.some((value) => forbidden.has(value))) {
    throw new Error("SHADOW_PUBLIC_BATCH_IDENTITY_OVERLAP");
  }
  const recordByAsin = new Map(source.records.map((record) => [record.asin, record]));
  const observations = source.importPackage.candidates.map((candidate) => {
    const product = candidate.evidenceSnapshot.product;
    const record = recordByAsin.get(product.platformProductId);
    if (!record) throw new Error("SHADOW_PUBLIC_IDENTITY_BINDING_MISSING");
    const evidenceRef = `source-capture.amazon-bestsellers.md#category-rank-${record.rank}`;
    return buildStage15ShadowObservation({
      schemaVersion: "stage15-shadow-observation-input.v1",
      batchId: input.batchId,
      productKey: candidate.productKey,
      evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
      marketValidation: {
        monthlyBought: missing<number>("monthly_bought_not_reported_on_category_page"),
        categoryRank: observed({ rank: record.rank, category: input.category }, evidenceRef, input.capturedAt),
        rating: record.rating === null ? missing<number>("rating_not_visible") : observed(record.rating, evidenceRef, input.capturedAt),
        reviewCount: record.reviewCount === null ? missing<number>("review_count_not_visible") : observed(record.reviewCount, evidenceRef, input.capturedAt),
      },
      listingMaturity: {
        firstAvailableAt: missing<string>("detail_page_not_accessed_under_approved_budget"),
        ageDays: missing<number>("first_available_date_not_collected"),
      },
      buyerReviews: {
        positive: missing<string[]>("detail_page_reviews_not_accessed_under_approved_budget"),
        negative: missing<string[]>("detail_page_reviews_not_accessed_under_approved_budget"),
        sampleCount: missing<number>("detail_page_reviews_not_accessed_under_approved_budget"),
      },
      decisionImpact: false,
    });
  });
  const orderedCandidates = [...source.importPackage.candidates]
    .sort((left, right) => stableHash(`${input.batchId}:combined-human:${left.productKey}`)
      .localeCompare(stableHash(`${input.batchId}:combined-human:${right.productKey}`)));
  const prefix = input.role === "calibration" ? "C" : "V";
  const bindings = orderedCandidates.map((candidate, index) => ({
    evaluationItemId: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    productKey: candidate.productKey,
    candidateId: candidate.candidateId,
    evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
    platformProductId: candidate.evidenceSnapshot.product.platformProductId,
    sourceUrl: candidate.evidenceSnapshot.sourceUrl,
  }));
  const bindingByProductKey = new Map(bindings.map((binding) => [binding.productKey, binding]));
  const recordForCandidate = (productKey: string) => {
    const binding = bindingByProductKey.get(productKey);
    const record = binding ? recordByAsin.get(binding.platformProductId) : null;
    if (!binding || !record) throw new Error("SHADOW_PUBLIC_PRESENTATION_BINDING_MISSING");
    return { binding, record };
  };
  const packetBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1" as const,
    batchLabel: `Batch ${prefix}`,
    status: "pending_human_evaluation" as const,
    proofLevel: "real_public_category_page_evidence" as const,
    blindBoundary: {
      hidesProductIdentity: true,
      hidesStage1RankAndScore: true,
      hidesStage15Status: true,
      hidesShadowPolicyAndPrediction: true,
    },
    items: orderedCandidates.map((candidate) => {
      const { binding, record } = recordForCandidate(candidate.productKey);
      return {
        schemaVersion: "stage15-shadow-combined-human-evaluation-item.v1" as const,
        evaluationItemId: binding.evaluationItemId,
        presentationAid: {
          purpose: input.targetScenario,
          status: "presentation_aid_not_source_fact" as const,
        },
        sourceEvidence: {
          title: record.title,
          imageUrl: record.imageUrl,
          imageStatus: record.imageUrl ? "external_reference_not_cached" as const : "missing" as const,
          price: record.price,
          currency: "USD" as const,
          rating: record.rating,
          reviewCount: record.reviewCount,
          categoryRank: record.rank,
          category: input.category,
          dimensions: null,
          material: null,
          monthlyBought: null,
          firstAvailableAt: null,
          exactVariantPositiveReviews: null,
          exactVariantNegativeReviews: null,
          missingReasons: [
            ...record.missingReasons,
            "dimensions_not_collected",
            "material_not_collected",
            "monthly_bought_not_reported_on_category_page",
            "first_available_date_not_collected",
            "exact_variant_reviews_not_collected",
          ],
          capturedAt: input.capturedAt,
        },
      };
    }),
  };
  const packet = { ...packetBody, packetHash: stableHash(packetBody) };
  const privateBindingsBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-bindings.private.v1" as const,
    batchId: input.batchId,
    packetHash: packet.packetHash,
    bindings,
  };
  const privateBindings = { ...privateBindingsBody, bindingHash: stableHash(privateBindingsBody) };
  const resultTemplate = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-result-template.v1" as const,
    batchId: input.batchId,
    sourcePacketHash: packet.packetHash,
    status: "pending_human_evaluation" as const,
    answers: packet.items.map((item) => ({
      evaluationItemId: item.evaluationItemId,
      productUnderstood: null,
      investigateNext10Minutes: null,
      screeningEvidenceSufficient: null,
      worthFurtherInvestigation: null,
      evidenceSufficient: null,
      dominantSignals: [],
      confidence: null,
      reason: "",
    })),
  };
  const accessBudget = {
    schemaVersion: "stage15-shadow-access-budget.v1" as const,
    batchId: input.batchId,
    sourceType: "public_amazon_bestsellers_via_jina_reader" as const,
    ...input.accessBudget,
    detailPagesAccessed: 0,
    automaticRetriesPerformed: 0,
    imagesDownloaded: 0,
    stopOnLoginCaptchaOrDenial: true,
    remoteImageReferencesIncluded: true,
  };
  const visualReferences = {
    schemaVersion: "stage15-shadow-visual-reference-packet.v1" as const,
    batchId: input.batchId,
    status: "reference_only_not_cached" as const,
    items: bindings.map((binding) => {
      const record = recordByAsin.get(binding.platformProductId);
      return {
        productKey: binding.productKey,
        imageUrl: record?.imageUrl ?? null,
        status: record?.imageUrl ? "external_reference_not_cached" as const : "missing" as const,
      };
    }),
  };
  const sourceAdapterArtifact = {
    ...source.sourceAdapterResult,
    pipeline: null,
    pipelineArtifactReferences: ["collection-run.v2.json", "import-package.v1.json"],
  };
  const preManifest: VersionedArtifact[] = [
    { relativePath: "selection-brief.v1.json", content: json(source.brief) },
    { relativePath: "stage15-shadow-access-budget.v1.json", content: json(accessBudget) },
    { relativePath: "source-capture.amazon-bestsellers.md", content: input.sourceMarkdown },
    { relativePath: "collection-run.v2.json", content: json(source.collectionRun) },
    { relativePath: "source-adapter-result.v1.json", content: json(sourceAdapterArtifact) },
    { relativePath: "import-package.v1.json", content: json(source.importPackage) },
    { relativePath: "ranking-run.v1.json", content: json(source.rankingRun) },
    { relativePath: "stage15-shadow-observations.v1.json", content: json({ schemaVersion: "stage15-shadow-observations.v1", batchId: input.batchId, observations, observationsHash: stableHash(observations) }) },
    { relativePath: "stage15-shadow-visual-reference-packet.v1.json", content: json(visualReferences) },
    { relativePath: "stage15-shadow-combined-human-evaluation-packet.v1.json", content: json(packet) },
    { relativePath: "stage15-shadow-combined-human-evaluation-bindings.private.v1.json", content: json(privateBindings) },
    { relativePath: "stage15-shadow-combined-human-evaluation-result-template.v1.json", content: json(resultTemplate) },
    { relativePath: "human-evaluation-form.md", content: humanForm(packet) },
  ];
  const artifactEntries = preManifest.map((artifact) => ({
    relativePath: artifact.relativePath,
    sha256: sha256(artifact.content),
    canonicalStableHash: artifact.relativePath.endsWith(".json")
      ? stableHash(JSON.parse(artifact.content))
      : null,
  }));
  const summary = {
    schemaVersion: "stage15-shadow-public-upstream-generation-summary.v1" as const,
    batchId: input.batchId,
    role: input.role,
    readiness: "upstream_only" as const,
    itemCount: source.importPackage.candidates.length,
    stage1Counts: Object.fromEntries(["promoted", "rejected", "insufficient_evidence"].map((status) => [
      status,
      source.rankingRun.results.filter((result) => result.promotionDecision === status).length,
    ])),
    pending: ["combined_human_evaluation", "stage15_screening_run", "formal_visual_packet", "optional_detail_evidence"],
    boundary: { candidateGenerated: false, databaseWritten: false, productionEffect: false, stage1OrStage15WeightsChanged: false },
    createdAt: input.capturedAt,
  };
  const summaryArtifact = { relativePath: "generation-summary.stage15-shadow-public-upstream.v1.json", content: json({ ...summary, summaryHash: stableHash(summary) }) };
  const allEntries = [...artifactEntries, {
    relativePath: summaryArtifact.relativePath,
    sha256: sha256(summaryArtifact.content),
    canonicalStableHash: stableHash(JSON.parse(summaryArtifact.content)),
  }];
  const manifestBody = {
    schemaVersion: "stage15-shadow-upstream-manifest.v1" as const,
    manifestId: input.manifestId,
    batchId: input.batchId,
    role: input.role,
    frozenValidationBatch: true,
    environment: "local_evidence_workspace" as const,
    explicitPathOnly: true,
    automaticLatestSelectionAllowed: false,
    crossBatchArtifactFallbackAllowed: false,
    readiness: "upstream_only" as const,
    readinessReasons: ["stage15_pending_human_evaluation", "formal_visual_packet_pending", "optional_detail_evidence_not_collected"],
    artifactLevels: {
      upstream: { required: true, status: "ready" as const },
      stage: { required: true, status: "pending_human_evaluation" as const },
      presentation: { required: true, status: "reference_only_not_cached" as const },
    },
    stage1: { status: "ready" as const, rankingRuleVersion: source.rankingRun.rankingRuleVersion },
    stage15: { status: "pending_human_evaluation" as const, existingWeightsChanged: false },
    artifacts: allEntries,
    sourceFile: { relativePath: "source-capture.amazon-bestsellers.md", sha256: input.sourceFileSha256 },
    identity: { count: 20, productKeysHash: stableHash([...source.importPackage.candidates.map((candidate) => candidate.productKey)].sort()) },
    boundary: summary.boundary,
    createdAt: input.capturedAt,
  };
  const manifest = { ...manifestBody, manifestHash: stableHash(manifestBody) };
  const manifestArtifact = { relativePath: "stage15-shadow-upstream-manifest.v1.json", content: json(manifest) };
  const artifacts = [...preManifest, summaryArtifact, manifestArtifact];
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, artifacts, "STAGE15_SHADOW_PUBLIC_OUTPUT_CONFLICT");
  return {
    source,
    observations,
    packet,
    privateBindings,
    resultTemplate,
    summary,
    manifest,
    platformProductIds: platformIds,
    files: artifacts.map((artifact) => artifact.relativePath),
    artifactWrite,
  };
}
