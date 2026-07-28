import { Check, Copy, ShieldCheck } from "lucide-react";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { buildListingStudioReview } from "@/lib/listingStudioReview";
import type {
  StudioListingPreferences,
  StudioListingTone,
} from "@/lib/studioListingInput";
import styles from "@/components/listing-studio/ListingStudioPolish.module.css";

export type StudioMode = "mock" | "real";
export type CopySection = "all" | "title" | "bullets" | "description" | "keywords";
export type CopyStyle = StudioListingTone;
export type ListingPack = AiListingPackDraft;

type ListingResultWorkspaceProps = {
  listingPack: ListingPack;
  preferences: StudioListingPreferences;
  mode: StudioMode;
  copiedSection: CopySection | null;
  onCopy: (text: string, section: CopySection) => void | Promise<void>;
};

function CopyAction({
  copied,
  label,
  disabled = false,
  onClick,
}: {
  copied: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`listing-module-copy ${styles.copyAction}`}
      disabled={disabled}
      title={disabled ? "当前分区没有可复制内容" : label}
      onClick={onClick}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "已复制" : label}
    </button>
  );
}

function Terms({ values, empty }: { values: string[]; empty: string }) {
  return (
    <div className="listing-keyword-list">
      {values.map((value) => <span key={value}>{value}</span>)}
      {values.length === 0 ? <em>{empty}</em> : null}
    </div>
  );
}

export function ListingResultWorkspace({
  listingPack,
  preferences,
  mode,
  copiedSection,
  onCopy,
}: ListingResultWorkspaceProps) {
  const title = listingPack.titles[0] ?? "";
  const bullets = listingPack.bullets;
  const description = listingPack.description;
  const keywords = listingPack.keywords;
  const review = buildListingStudioReview(listingPack, preferences);
  const titleLengthNote = review.title.characterCount > 200
    ? "当前标题超过 200 字符；请按目标平台的实际限制人工缩短。"
    : `当前标题为 ${review.title.characterCount} 字符；平台上限仍需人工核对。`;
  const keywordAdvice = review.keywords.targets.length === 0
    ? "本次生成未设置主关键词或次关键词，因此不计算目标关键词覆盖。"
    : review.keywords.uncovered.length > 0
      ? `未覆盖：${review.keywords.uncovered.join("、")}。仅在准确、自然时人工补充。`
      : "本次目标关键词均能在生成文本中直接匹配；仍需人工检查相关性和堆砌风险。";
  const blockedClaimNote = review.risk.blockedClaims.length > 0
    ? `Claim Filter 已拦截：${review.risk.blockedClaims.join("、")}。`
    : "Claim Filter 未记录被拦截的禁限词；这不代表平台合规已通过。";
  const missingFactNote = review.missingFacts.length > 0
    ? `输入仍缺少：${review.missingFacts.join("、")}。`
    : "核心功能、目标用户、解决问题和差异化卖点均已提供。";

  return (
    <article
      className={`studio-result-content listing-result-modules ${styles.resultModules}`}
      data-testid="listing-result-content"
    >
      <aside className={styles.qualityRail} aria-label="Listing 本地质量提示">
        <div>
          <span>标题长度</span>
          <strong>{review.title.characterCount} 字符</strong>
        </div>
        <div>
          <span>关键词覆盖</span>
          <strong>
            {review.keywords.targets.length
              ? `${review.keywords.covered.length}/${review.keywords.targets.length}`
              : "未设置"}
          </strong>
        </div>
        <div>
          <span>审核状态</span>
          <strong>{review.humanReviewRequired ? "需要人工复核" : "仍按人工复核处理"}</strong>
        </div>
        <p>本地辅助检查，不等于 AI 判断或平台合规结论。</p>
      </aside>

      <section className={`listing-result-module ${styles.resultModule}`}>
        <div className="listing-result-module-header">
          <div>
            <p className={styles.moduleEyebrow}>Listing 标题</p>
            <h3>标题</h3>
          </div>
          <CopyAction
            copied={copiedSection === "title"}
            label="复制标题"
            disabled={!title}
            onClick={() => void onCopy(title, "title")}
          />
        </div>
        <p className={styles.titleOutput}>{title || "暂无标题"}</p>
        <div className={styles.moduleMeta} aria-label="标题辅助信息">
          <span>{review.title.characterCount} 字符</span>
          <span>
            标题关键词覆盖：
            {review.title.coveredKeywords.length
              ? review.title.coveredKeywords.join("、")
              : review.keywords.targets.length ? "未检测到" : "未设置目标关键词"}
          </span>
        </div>
      </section>

      <section className={`listing-result-module ${styles.resultModule}`}>
        <div className="listing-result-module-header">
          <div>
            <p className={styles.moduleEyebrow}>核心利益点</p>
            <h3>Bullet Points</h3>
          </div>
          <CopyAction
            copied={copiedSection === "bullets"}
            label="复制要点"
            disabled={bullets.length === 0}
            onClick={() => void onCopy(bullets.join("\n"), "bullets")}
          />
        </div>
        <ol className={styles.bulletList}>
          {review.bullets.map((bullet, index) => (
            <li key={`${index}-${bullet.text}`}>
              <span className={styles.bulletIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <p>{bullet.text}</p>
                <div className={styles.moduleMeta}>
                  <span>
                    使用卖点（文本匹配）：
                    {bullet.matchedSellingPoints.length
                      ? bullet.matchedSellingPoints.join("、")
                      : "未匹配到已输入卖点"}
                  </span>
                  <span>
                    覆盖关键词：
                    {bullet.coveredKeywords.length ? bullet.coveredKeywords.join("、") : "未检测到"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={`listing-result-module ${styles.resultModule}`}>
        <div className="listing-result-module-header">
          <div>
            <p className={styles.moduleEyebrow}>长文案</p>
            <h3>Description</h3>
          </div>
          <CopyAction
            copied={copiedSection === "description"}
            label="复制描述"
            disabled={!description}
            onClick={() => void onCopy(description, "description")}
          />
        </div>
        <p className={styles.descriptionOutput}>{description || "暂无商品描述"}</p>
        <p className={styles.structureHint}>
          {review.description.characterCount} 字符；
          {preferences.coreFunction
            ? `核心功能${review.description.coreFunctionCovered ? "已" : "未"}在描述中直接出现。`
            : "本次未设置核心功能。"}
        </p>
      </section>

      <section className={`listing-result-module ${styles.resultModule}`}>
        <div className="listing-result-module-header">
          <div>
            <p className={styles.moduleEyebrow}>SEO 辅助</p>
            <h3>Search Terms</h3>
          </div>
          <CopyAction
            copied={copiedSection === "keywords"}
            label="复制搜索词"
            disabled={keywords.length === 0}
            onClick={() => void onCopy(keywords.join(", "), "keywords")}
          />
        </div>
        <div className={styles.termGroup}>
          <h4>生成的 Search Terms</h4>
          <Terms values={review.keywords.used} empty="生成结果没有 Search Terms" />
        </div>
        <div className={styles.termGroup}>
          <h4>已覆盖关键词</h4>
          <Terms values={review.keywords.covered} empty="未覆盖已设置的目标关键词" />
        </div>
        <div className={styles.termGroup}>
          <h4>建议关键词</h4>
          <Terms values={review.keywords.suggested} empty="没有基于当前输入的未覆盖关键词" />
        </div>
        <div className={styles.termGroup}>
          <h4>关键词落位矩阵</h4>
          {review.keywords.matrix.length > 0 ? (
            <div
              className="max-w-full overflow-x-auto"
              role="region"
              aria-label="关键词落位矩阵"
              tabIndex={0}
            >
              <table className="min-w-[640px] w-full text-left text-xs">
                <caption className="sr-only">关键词在 Listing 各分区中的实际出现次数</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">关键词</th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      类型（主关键词 / 次关键词）
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">标题</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Bullet</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Search Terms</th>
                    <th scope="col" className="px-3 py-2 font-semibold">总次数</th>
                  </tr>
                </thead>
                <tbody>
                  {review.keywords.matrix.map((entry) => (
                    <tr key={`${entry.kind}-${entry.keyword}`}>
                      <th scope="row" className="px-3 py-2 font-medium">{entry.keyword}</th>
                      <td className="px-3 py-2">
                        {entry.kind === "primary" ? "主关键词" : "次关键词"}
                      </td>
                      <td className="px-3 py-2">{entry.title}</td>
                      <td className="px-3 py-2">{entry.bullet}</td>
                      <td className="px-3 py-2">{entry.description}</td>
                      <td className="px-3 py-2">{entry.searchTerms}</td>
                      <td className="px-3 py-2 font-semibold">{entry.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.structureHint}>设置主关键词或次关键词后显示实际落位次数。</p>
          )}
          <p className={styles.structureHint}>
            仅统计当前输出中的直接文本匹配，不代表 SEO 排名、曝光或转化效果。
          </p>
        </div>
        {review.keywords.competitorTerms.length > 0 ? (
          <div className={styles.termGroup}>
            <h4>竞品词边界</h4>
            <p className={styles.structureHint}>
              竞品词仅作研究参考，不作为建议词。
              {review.keywords.competitorLeaks.length > 0
                ? ` 检测到结果中出现：${review.keywords.competitorLeaks.join("、")}，请人工删除。`
                : " 本次未检测到竞品词进入生成文本。"}
            </p>
          </div>
        ) : null}
      </section>

      <section className={`listing-result-module listing-review-module ${styles.reviewModule}`}>
        <div className="listing-result-module-header">
          <div>
            <p className={styles.moduleEyebrow}>
              {mode === "mock" ? "Mock 本地辅助检查" : "确定性本地辅助检查"}
            </p>
            <h3><ShieldCheck aria-hidden="true" />AI Review</h3>
          </div>
          <span className={styles.localReviewBadge}>非真实 AI 评分</span>
        </div>
        <div className={styles.reviewGrid}>
          <div>
            <h4>风险检查</h4>
            <p>{titleLengthNote} {blockedClaimNote}</p>
          </div>
          <div>
            <h4>优化建议</h4>
            <p>{keywordAdvice} {missingFactNote}</p>
          </div>
          <div>
            <h4>人工复核提示</h4>
            <p>
              {review.risk.riskNotes[0] || "核对商品事实、知识产权与平台政策后再发布。"}
              {" "}
              {review.risk.reviewChecklist[0] || "发布前必须完成人工复核。"}
            </p>
          </div>
        </div>
      </section>

      <p className="sr-only" aria-live="polite">{copiedSection ? "结果已复制" : ""}</p>
    </article>
  );
}
