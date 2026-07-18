import { createHash } from "node:crypto";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";

type Role = "calibration" | "validation";

type CombinedPacket = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1";
  batchLabel: string;
  status: "pending_human_evaluation";
  proofLevel: string;
  blindBoundary: Record<string, boolean>;
  items: Array<{
    schemaVersion: "stage15-shadow-combined-human-evaluation-item.v1";
    evaluationItemId: string;
    presentationAid: { purpose: string; status: "presentation_aid_not_source_fact" };
    sourceEvidence: {
      title: string;
      imageUrl: string | null;
      imageStatus: string;
      price: number | null;
      currency: string;
      rating: number | null;
      reviewCount: number | null;
      categoryRank: number;
      category: string;
      dimensions: unknown;
      material: unknown;
      monthlyBought: unknown;
      firstAvailableAt: unknown;
      exactVariantPositiveReviews: unknown;
      exactVariantNegativeReviews: unknown;
      exactVariantReviewSampleCount?: unknown;
      missingReasons: string[];
      capturedAt: string;
    };
  }>;
  packetHash: string;
};

type ResultTemplate = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-result-template.v1";
  batchId: string;
  sourcePacketHash: string;
  status: "pending_human_evaluation";
  answers: Array<{ evaluationItemId: string }>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function embeddedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/&/gu, "\\u0026");
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
}

function validateMaterial(packet: CombinedPacket, resultTemplate: ResultTemplate, role: Role, locked: boolean): void {
  const { packetHash, ...packetBody } = packet;
  const packetIds = packet.items.map((item) => item.evaluationItemId);
  const templateIds = resultTemplate.answers.map((answer) => answer.evaluationItemId);
  const prefix = role === "calibration" ? "C-" : "V-";
  if (packet.schemaVersion !== "stage15-shadow-combined-human-evaluation-packet.v1"
    || packet.status !== "pending_human_evaluation" || packet.items.length !== 20
    || stableHash(packetBody) !== packetHash || !sameIds(packetIds, templateIds)
    || resultTemplate.schemaVersion !== "stage15-shadow-combined-human-evaluation-result-template.v1"
    || resultTemplate.sourcePacketHash !== packetHash || resultTemplate.status !== "pending_human_evaluation"
    || !resultTemplate.batchId || packetIds.some((id) => !id.startsWith(prefix))
    || (role === "validation" && !locked) || (role === "calibration" && locked)) {
    throw new Error("SHADOW_EVALUATION_WORKBENCH_INPUT_INVALID");
  }
}

function radioGroup(itemId: string, field: string, values: string[], disabled: boolean): string {
  return `<div class="choice-row" data-required-group="${escapeHtml(field)}">${values.map((value) =>
    `<label><input type="radio" name="${escapeHtml(`${itemId}-${field}`)}" value="${escapeHtml(value)}" data-field="${escapeHtml(field)}"${disabled ? " disabled" : ""}> ${escapeHtml(value)}</label>`).join("")}</div>`;
}

function itemCard(item: CombinedPacket["items"][number], disabled: boolean): string {
  const evidence = item.sourceEvidence;
  const image = evidence.imageUrl && /^https:\/\//u.test(evidence.imageUrl)
    ? `<img src="${escapeHtml(evidence.imageUrl)}" alt="${escapeHtml(`${item.evaluationItemId} 商品图`)}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="image-missing">图片缺失</div>`;
  const value = (input: unknown, suffix = "") => input === null || input === undefined ? "未采集" : `${escapeHtml(input)}${suffix}`;
  const reviewList = (input: unknown) => Array.isArray(input) && input.length > 0
    ? `<ul>${input.map((review) => `<li>${escapeHtml(review)}</li>`).join("")}</ul>`
    : `<p>未采集</p>`;
  const signals = ["market_validation", "listing_maturity", "buyer_reviews", "product_fit", "risk", "other"];
  return `<article class="card" data-item="${escapeHtml(item.evaluationItemId)}">
    <div class="image-wrap">${image}</div>
    <div class="content">
      <div class="item-heading"><span>${escapeHtml(item.evaluationItemId)}</span><h2>${escapeHtml(evidence.title)}</h2></div>
      <p class="aid">用途理解辅助：${escapeHtml(item.presentationAid.purpose)}（不是来源事实）</p>
      <dl class="facts">
        <div><dt>价格</dt><dd>${value(evidence.price, ` ${escapeHtml(evidence.currency)}`)}</dd></div>
        <div><dt>评分</dt><dd>${value(evidence.rating)}</dd></div>
        <div><dt>评论数量</dt><dd>${value(evidence.reviewCount)}</dd></div>
        <div><dt>类目排名</dt><dd>#${escapeHtml(evidence.categoryRank)} · ${escapeHtml(evidence.category)}</dd></div>
        <div><dt>尺寸</dt><dd>${value(evidence.dimensions)}</dd></div>
        <div><dt>材料</dt><dd>${value(evidence.material)}</dd></div>
        <div><dt>月购买量</dt><dd>${value(evidence.monthlyBought)}</dd></div>
        <div><dt>上架时间</dt><dd>${value(evidence.firstAvailableAt)}</dd></div>
      </dl>
      <section class="review-evidence"><h3>精确同款评论证据</h3><p>评论样本数：${value(evidence.exactVariantReviewSampleCount)}</p><div class="review-columns"><div><strong>精确同款好评</strong>${reviewList(evidence.exactVariantPositiveReviews)}</div><div><strong>精确同款差评</strong>${reviewList(evidence.exactVariantNegativeReviews)}</div></div></section>
      <details><summary>缺失证据与限制</summary><ul>${evidence.missingReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>
      <fieldset${disabled ? " disabled" : ""}>
        <legend>人工评价</legend>
        <label class="question">能否理解商品？${radioGroup(item.evaluationItemId, "productUnderstood", ["yes", "no", "uncertain"], disabled)}</label>
        <label class="question">是否愿意花接下来10分钟继续调查？${radioGroup(item.evaluationItemId, "investigateNext10Minutes", ["yes", "no", "uncertain"], disabled)}</label>
        <label class="question">Stage 1.5 证据是否足够？${radioGroup(item.evaluationItemId, "screeningEvidenceSufficient", ["yes", "no"], disabled)}</label>
        <label class="question">是否值得进一步调查？${radioGroup(item.evaluationItemId, "worthFurtherInvestigation", ["yes", "no", "insufficient_evidence"], disabled)}</label>
        <label class="question">影子评价证据是否足够？${radioGroup(item.evaluationItemId, "evidenceSufficient", ["yes", "no"], disabled)}</label>
        <div class="question">主导信号（至少一个）<div class="choice-row">${signals.map((signal) => `<label><input type="checkbox" value="${signal}" data-field="dominantSignals"${disabled ? " disabled" : ""}> ${signal}</label>`).join("")}</div></div>
        <label class="question">信心${radioGroup(item.evaluationItemId, "confidence", ["high", "medium", "low"], disabled)}</label>
        <label class="question">理由（保留原话）<textarea data-field="reason" rows="3"${disabled ? " disabled" : ""}></textarea></label>
      </fieldset>
    </div>
  </article>`;
}

export function renderStage15ShadowEvaluationWorkbench(input: {
  packet: CombinedPacket;
  resultTemplate: ResultTemplate;
  role: Role;
  locked: boolean;
}): string {
  validateMaterial(input.packet, input.resultTemplate, input.role, input.locked);
  const cards = input.packet.items.map((item) => itemCard(item, input.locked)).join("\n");
  const controls = input.locked
    ? `<button type="button" disabled>等待 Batch C policy Hash 冻结</button>`
    : `<button type="button" id="save">保存到本机草稿</button><button type="button" id="export" class="primary">导出已完成评价 JSON</button><button type="button" id="clear" class="danger">清空本批草稿</button>`;
  return `<!doctype html>
<html lang="zh-CN" data-locked="${input.locked}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.packet.batchLabel)} 人工评价工作台</title>
<style>
:root{font-family:Inter,"Microsoft YaHei",sans-serif;color:#172033;background:#f4f6f9}body{margin:0}.top{position:sticky;top:0;z-index:5;background:#172033;color:#fff;padding:16px 24px;box-shadow:0 2px 12px #0003}.top h1{font-size:20px;margin:0 0 6px}.top p{margin:0;color:#cbd5e1}.progress{margin-top:10px;font-weight:700}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}button{border:1px solid #94a3b8;border-radius:8px;padding:9px 14px;background:#fff;color:#172033;font-weight:700}button.primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}button.danger{color:#b91c1c}button:disabled{opacity:.55}.notice{max-width:1160px;margin:18px auto;padding:14px 18px;border-left:4px solid #eab308;background:#fffbeb}.grid{max-width:1160px;margin:0 auto 60px;display:grid;gap:18px}.card{display:grid;grid-template-columns:320px 1fr;background:#fff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px #0f172a0d}.image-wrap{background:#eef2f7;min-height:260px;display:grid;place-items:center}.image-wrap img{width:100%;height:100%;max-height:360px;object-fit:contain}.image-missing{color:#64748b}.content{padding:20px}.item-heading{display:flex;gap:12px;align-items:flex-start}.item-heading span{background:#172033;color:#fff;border-radius:999px;padding:5px 9px;font-weight:800}.item-heading h2{font-size:18px;line-height:1.45;margin:0}.aid{color:#475569}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.facts div{background:#f8fafc;padding:9px;border-radius:8px}.facts dt{font-size:12px;color:#64748b}.facts dd{margin:3px 0 0;font-weight:700}.review-evidence{margin:14px 0;padding:12px;background:#f8fafc;border-radius:10px}.review-evidence h3{margin:0 0 8px;font-size:15px}.review-evidence p{margin:6px 0}.review-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.review-columns ul{margin:7px 0;padding-left:20px}fieldset{margin-top:16px;border:1px solid #cbd5e1;border-radius:10px;padding:14px}.question{display:block;margin:12px 0;font-weight:700}.choice-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;font-weight:400}textarea{box-sizing:border-box;width:100%;margin-top:7px;border:1px solid #94a3b8;border-radius:8px;padding:9px}details{color:#475569}@media(max-width:760px){.card{grid-template-columns:1fr}.image-wrap{min-height:220px}.facts,.review-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.top{position:static;padding:14px}.content{padding:14px}}
</style></head>
<body><header class="top"><h1>${escapeHtml(input.packet.batchLabel)} · Stage 1.5 影子校准盲化人工评价</h1><p>这不是“值得卖”或“能赚钱”的结论。图片为外部公开引用；缺失字段不得猜测。</p><div id="progress" class="progress">已完成 0 / 20</div><div class="actions">${controls}</div></header>
${input.locked ? `<div class="notice"><strong>当前锁定：</strong>等待 Batch C policy Hash 冻结后才能填写 Batch V，防止留出批次提前解盲。</div>` : `<div class="notice">回答会自动保存在当前浏览器本机草稿中；完成20项后导出 JSON，再交给校验器。不会写数据库。</div>`}
<main class="grid">${cards}</main>
<script>
const packet=${embeddedJson(input.packet)};
const seed=${embeddedJson(input.resultTemplate)};
const locked=${input.locked};
const storageKey="stage15-shadow-evaluation:"+packet.packetHash;
const fields=["productUnderstood","investigateNext10Minutes","screeningEvidenceSufficient","worthFurtherInvestigation","evidenceSufficient","confidence"];
function collectCard(card){const answer={evaluationItemId:card.dataset.item,dominantSignals:[]};for(const field of fields){answer[field]=card.querySelector('[data-field="'+field+'"]:checked')?.value??null}answer.dominantSignals=[...card.querySelectorAll('[data-field="dominantSignals"]:checked')].map(node=>node.value);answer.reason=card.querySelector('[data-field="reason"]').value.trim();return answer}
function collect(){return [...document.querySelectorAll("[data-item]")].map(collectCard)}
function complete(answer){return fields.every(field=>answer[field])&&answer.dominantSignals.length>0&&answer.reason.length>0}
function update(){const answers=collect();document.getElementById("progress").textContent="已完成 "+answers.filter(complete).length+" / 20";return answers}
function save(){if(locked)return;localStorage.setItem(storageKey,JSON.stringify({answers:collect(),savedAt:new Date().toISOString()}));update()}
function hydrate(){if(locked)return;const raw=localStorage.getItem(storageKey);if(!raw)return;let draft;try{draft=JSON.parse(raw)}catch{return}for(const answer of draft.answers??[]){const card=document.querySelector('[data-item="'+answer.evaluationItemId+'"]');if(!card)continue;for(const field of fields){const node=card.querySelector('[data-field="'+field+'"][value="'+answer[field]+'"]');if(node)node.checked=true}for(const signal of answer.dominantSignals??[]){const node=card.querySelector('[data-field="dominantSignals"][value="'+signal+'"]');if(node)node.checked=true}card.querySelector('[data-field="reason"]').value=answer.reason??""}update()}
if(!locked){document.querySelector("main").addEventListener("change",save);document.querySelector("main").addEventListener("input",save);document.getElementById("save").addEventListener("click",save);document.getElementById("clear").addEventListener("click",()=>{if(confirm("确认清空本批本机草稿？")){localStorage.removeItem(storageKey);location.reload()}});document.getElementById("export").addEventListener("click",()=>{const answers=update();if(answers.length!==20||!answers.every(complete)){alert("请先完成全部20项及每项理由。");return}const result={schemaVersion:"stage15-shadow-combined-human-evaluation-result.v1",batchId:seed.batchId,sourcePacketHash:packet.packetHash,status:"completed",completedAt:new Date().toISOString(),answers};const blob=new Blob([JSON.stringify(result,null,2)+"\\n"],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=seed.batchId+"-completed-human-evaluation.json";link.click();URL.revokeObjectURL(url)});hydrate()}
</script></body></html>\n`;
}

export function generateStage15ShadowEvaluationWorkbench(input: {
  packet: CombinedPacket;
  resultTemplate: ResultTemplate;
  sourceManifest: { schemaVersion: string; manifestId: string; batchId: string; role: Role; manifestHash: string };
  sourceManifestFileSha256: string;
  accessBudget: { maxDetailPageRequests: number; detailPagesAccessed: number };
  role: Role;
  outputDirectory: string;
  createdAt: string;
}) {
  const locked = input.role === "validation";
  validateMaterial(input.packet, input.resultTemplate, input.role, locked);
  if (input.sourceManifest.schemaVersion !== "stage15-shadow-upstream-manifest.v1"
    || input.sourceManifest.batchId !== input.resultTemplate.batchId || input.sourceManifest.role !== input.role
    || !/^[a-f0-9]{64}$/u.test(input.sourceManifest.manifestHash)
    || !/^[a-f0-9]{64}$/u.test(input.sourceManifestFileSha256)
    || Number.isNaN(Date.parse(input.createdAt))
    || !Number.isInteger(input.accessBudget.maxDetailPageRequests) || !Number.isInteger(input.accessBudget.detailPagesAccessed)
    || input.accessBudget.detailPagesAccessed > input.accessBudget.maxDetailPageRequests) {
    throw new Error("SHADOW_EVALUATION_SUPPLEMENT_INPUT_INVALID");
  }
  const html = renderStage15ShadowEvaluationWorkbench({
    packet: input.packet,
    resultTemplate: input.resultTemplate,
    role: input.role,
    locked,
  });
  const htmlHash = sha256(html);
  const sidecar = `${htmlHash}  human-evaluation-workbench.html\n`;
  const supplementBody = {
    schemaVersion: "stage15-shadow-evaluation-readiness-supplement.v1" as const,
    batchId: input.resultTemplate.batchId,
    role: input.role,
    sourceUpstreamManifest: {
      manifestId: input.sourceManifest.manifestId,
      manifestHash: input.sourceManifest.manifestHash,
      fileSha256: input.sourceManifestFileSha256,
    },
    packetHash: input.packet.packetHash,
    workbench: {
      relativePath: "human-evaluation-workbench.html",
      sha256: htmlHash,
      mode: locked ? "read_only_locked" as const : "editable_local_draft_and_export" as const,
    },
    status: locked ? "locked_pending_calibration_policy" as const : "ready_for_human_evaluation" as const,
    policyCandidateFeasibility: input.accessBudget.maxDetailPageRequests === 0
      ? "blocked_by_exact_variant_review_coverage_0_of_10" as const
      : "pending_exact_variant_review_coverage_validation" as const,
    detailEvidenceBudget: input.accessBudget,
    boundary: {
      frozenUpstreamManifestModified: false as const,
      externalWebsiteAccessedDuringGeneration: false as const,
      aiOrPaidApiCalled: false as const,
      databaseWritten: false as const,
      candidateGenerated: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  const supplement = { ...supplementBody, supplementHash: stableHash(supplementBody) };
  const artifacts: VersionedArtifact[] = [
    { relativePath: "human-evaluation-workbench.html", content: html },
    { relativePath: "human-evaluation-workbench.sha256", content: sidecar },
    { relativePath: "evaluation-readiness-supplement.v1.json", content: json(supplement) },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_SHADOW_EVALUATION_WORKBENCH_CONFLICT",
  );
  return { html, htmlHash, supplement, files: artifacts.map((artifact) => artifact.relativePath), artifactWrite };
}
