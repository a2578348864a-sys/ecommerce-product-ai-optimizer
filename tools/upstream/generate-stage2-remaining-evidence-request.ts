import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeArtifactsIdempotently } from "./artifact-writer";
import { buildStage2RemainingEvidenceRequest } from "./stage2-remaining-evidence-request";

type Input = {
  applicationFile: string;
  validationFile: string;
  createdAt: string;
  outputDirectory: string;
};

export function generateStage2RemainingEvidenceRequest(input: Input) {
  const read = (file: string) => JSON.parse(readFileSync(resolve(file), "utf8"));
  const request = buildStage2RemainingEvidenceRequest({
    application: read(input.applicationFile),
    validation: read(input.validationFile),
    createdAt: input.createdAt,
  });
  const files = ["stage2-remaining-evidence-request.v1.json", "README-小白补证据清单.md"];
  const groups = request.evidenceGroups.map((group, index) => [
    `## ${index + 1}. ${group.groupId}`,
    "",
    group.beginnerInstruction,
    "",
    `还缺字段：${group.fields.join("、")}`,
    "",
    `可以提供：${group.acceptedEvidence.join("；")}`,
  ].join("\n")).join("\n\n");
  const packageHeightRule = request.missingFields.includes("packageHeightCm")
    ? "- 不凭感觉选择 3.5cm 或 3.8cm。"
    : "- 包装高度3.5cm已作为人工工作值记录，不再重复选择；原始冲突证据继续保留。";
  const readme = `# Stage 2 下一步补证据（小白版）

当前已经确认：BOM 暂定值为 **${request.target.acceptedProvisionalBomUsd.toFixed(2)} USD/件**。它不是最终报价。

你现在不需要判断“这个商品能不能赚钱”，也不需要自己计算。只需提供看得见、能追溯的原始资料；不知道的继续留空。

${groups}

## 必须遵守

${packageHeightRule}
- 不把 Amazon 页面展示类目直接当作实际收费类目。
- 不把没有数量的总报价强行换算成单件成本。
- 不知道的字段保持 null，不填 0。
- 这些材料齐全前，系统继续输出 profit_insufficient_evidence。
`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: `${JSON.stringify(request, null, 2)}\n` },
    { relativePath: files[1], content: readme },
  ], "STAGE2_REMAINING_EVIDENCE_OUTPUT_CONFLICT");
  return { request, files, artifactWrite };
}
