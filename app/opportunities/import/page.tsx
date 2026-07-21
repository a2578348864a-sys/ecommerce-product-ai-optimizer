import type { Metadata } from "next";
import { OpportunitiesForm } from "@/components/cross-border/OpportunitiesForm";
import FamilyTop5Review from "@/components/cross-border/FamilyTop5Review";
import { loadFamilyTop5Data } from "@/lib/upstream/family-top5-adapter";

export const metadata: Metadata = {
  title: "高级手工导入 - 轻选 Agent",
  description: "通过 URL、RSS 或 Sitemap 补充外部公开来源。",
};

export default function OpportunitiesImportPage() {
  // Attempt to load frozen Family Top 5 review data
  const { data, readiness } = loadFamilyTop5Data();

  // If family review data is available and valid, show it as an additional section
  if (readiness === "ready" && data) {
    return (
      <div>
        <FamilyTop5Review
          topFamilies={data.topFamilies}
          remainingFamilies={data.remainingFamilies}
          baseline={data.codeBaseline}
        />
        {/* Existing import form below the review */}
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 16px 40px" }}>
          <hr style={{ border: "none", borderTop: "1px solid #E0E0E0", margin: "24px 0" }} />
          <OpportunitiesForm surface="advanced_import" />
        </div>
      </div>
    );
  }

  // Fallback: show import form if family data is unavailable
  if (readiness === "artifact_missing") {
    return (
      <div>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px", background: "#FFF3E0", border: "1px solid #FF9800", borderRadius: 8, fontSize: ".9em", color: "#E65100" }}>
          ⚠ 公开市场预筛数据尚未准备（{readiness}）。以下为手工导入入口。
        </div>
        <OpportunitiesForm surface="advanced_import" />
      </div>
    );
  }

  if (readiness !== "ready") {
    return (
      <div>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px", background: "#FFEBEE", border: "2px solid #C62828", borderRadius: 8, fontSize: ".9em", color: "#C62828" }}>
          ⚠ 公开市场预筛数据完整性校验失败（{readiness}）。请勿使用本页面做商业判断。
        </div>
        <OpportunitiesForm surface="advanced_import" />
      </div>
    );
  }

  return <OpportunitiesForm surface="advanced_import" />;
}
