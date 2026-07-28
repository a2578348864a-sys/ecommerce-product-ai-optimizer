"use client";

import Image from "next/image";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  Download,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import type { StudioImageResultMeta } from "@/lib/studioImageInput";
import styles from "./ImageStudioPolish.module.css";

export type ImageStudioData = {
  images: Array<{ base64: string; width?: number; height?: number }>;
  meta: StudioImageResultMeta;
};

type ImageResultWorkspaceProps = {
  result: ImageStudioData;
  selectedIndices: number[];
  onToggleSelected: (index: number) => void;
};

const IMAGE_TYPE_LABELS = {
  product_main: "商品主图",
  lifestyle_scene: "场景图",
  selling_point_display: "卖点展示图",
  ad_creative: "广告素材",
} as const;

const STYLE_LABELS = {
  minimal: "极简",
  premium: "高端",
  tech: "科技",
  home: "家居",
  outdoor: "户外",
  brand_ad: "品牌广告",
} as const;

const RATIO_LABELS = {
  square_1_1: "1:1",
  portrait_4_5: "4:5",
  landscape_16_9: "16:9",
} as const;

function downloadExtension(dataUrl: string) {
  if (dataUrl.startsWith("data:image/svg+xml")) return "svg";
  if (dataUrl.startsWith("data:image/webp")) return "webp";
  if (dataUrl.startsWith("data:image/jpeg")) return "jpg";
  return "png";
}

function QualityRow({
  title,
  value,
  isMock,
}: {
  title: string;
  value: string;
  isMock: boolean;
}) {
  return (
    <div className={styles.qualityRow}>
      {isMock ? (
        <CheckCircle2 aria-hidden="true" className={styles.qualityIcon} data-tone="success" />
      ) : (
        <CircleDashed aria-hidden="true" className={styles.qualityIcon} data-tone="pending" />
      )}
      <div>
        <p>{title}</p>
        <span>{value}</span>
      </div>
    </div>
  );
}

export function ImageResultWorkspace({
  result,
  selectedIndices,
  onToggleSelected,
}: ImageResultWorkspaceProps) {
  const meta = result.meta;
  const { input, qualityCheck } = meta;
  const isMock = meta.mode === "mock";
  const isPrompt = meta.creationMode === "prompt";
  const imageTypeLabel = meta.creationMode === "prompt"
    ? "自由提示词"
    : IMAGE_TYPE_LABELS[meta.input.imageType];
  const styleLabel = meta.creationMode === "prompt"
    ? "服务端整理"
    : STYLE_LABELS[meta.input.visualStyle];
  const downloadKind = meta.creationMode === "prompt" ? "prompt" : meta.input.imageType;
  const productAltName = input.productName.trim() || (isPrompt ? "自由提示词方案" : "未命名商品");
  const localCheckText = isMock ? {
    logo: "Mock 模板未添加 Logo",
    text: isPrompt ? "仅展示整理摘要与 Mock 标识" : "仅含商品名与 Mock 标识",
    watermark: "Mock 模板未添加水印",
    description: "请求上下文已写入预览",
  } : {
    logo: "未自动检查，请人工查看",
    text: "未执行 OCR，请人工查看",
    watermark: "未自动检查，请人工查看",
    description: "未做像素级一致性判断",
  };

  return (
    <div className={styles.resultWorkspace} data-testid="image-result-workspace">
      <div className={styles.strategyStrip} aria-label="本次图片策略">
        <span>{imageTypeLabel}</span>
        <span>{styleLabel}</span>
        <span>{RATIO_LABELS[input.aspectRatio]}</span>
        <span>{result.images.length} 张方案</span>
      </div>

      <div className={styles.contactSheet}>
        {result.images.map((image, index) => {
          const selected = selectedIndices.includes(index);
          const extension = downloadExtension(image.base64);
          return (
            <figure
              key={`${image.base64.slice(-24)}-${index}`}
              className={styles.imageCard}
              data-selected={selected}
            >
              <div className={styles.imageStage} data-aspect={input.aspectRatio}>
                <Image
                  src={image.base64}
                  alt={`${productAltName}的${isMock ? "本地 Mock 预览" : "AI 概念草稿"} ${index + 1}`}
                  width={image.width || 800}
                  height={image.height || 800}
                  unoptimized
                  className={styles.previewImage}
                />
                <span className={styles.mockWaterline}>
                  {isMock ? "LOCAL MOCK" : "REAL AI DRAFT"}
                </span>
              </div>
              <figcaption className={styles.imageCaption}>
                <div className={styles.cardTitleRow}>
                  <div>
                    <p>方案 {String(index + 1).padStart(2, "0")}</p>
                    <span>{imageTypeLabel} · {styleLabel}</span>
                  </div>
                  <span className={styles.cardStatus} data-selected={selected}>
                    {selected ? "已选择" : "待人工选择"}
                  </span>
                </div>
                {meta.creationMode === "prompt" ? (
                  <div className={styles.promptMeta}>
                    <p><strong>提示词摘要</strong><span>{meta.promptSummary}</span></p>
                    <p><strong>避免元素</strong><span>{meta.avoidElementsSummary}</span></p>
                  </div>
                ) : null}
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.selectButton}
                    aria-pressed={selected}
                    onClick={() => onToggleSelected(index)}
                  >
                    {selected ? <Check aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
                    {selected ? "取消选择" : "选择图片"}
                  </button>
                  <a
                    className={styles.downloadButton}
                    href={image.base64}
                    download={`image-studio-${downloadKind}-${index + 1}.${extension}`}
                    title={`下载方案 ${index + 1}`}
                  >
                    <Download aria-hidden="true" />
                    下载
                  </a>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <section className={styles.qualityPanel} aria-labelledby="image-quality-title">
        <div className={styles.qualityHeader}>
          <span className={styles.qualityMark}><ShieldCheck aria-hidden="true" /></span>
          <div>
            <p className={styles.sectionEyebrow}>Local review aid</p>
            <h3 id="image-quality-title">图片质量检查</h3>
            <p>本地辅助检查，不等于平台审核，也不替代对真实商品素材的人工核验。</p>
          </div>
        </div>
        <div className={styles.qualityGrid}>
          <QualityRow title="Logo 检查" value={localCheckText.logo} isMock={isMock} />
          <QualityRow title="文字检查" value={localCheckText.text} isMock={isMock} />
          <QualityRow title="水印检查" value={localCheckText.watermark} isMock={isMock} />
          <QualityRow title="描述一致性检查" value={localCheckText.description} isMock={isMock} />
        </div>
        <div className={styles.manualReview}>
          <strong>人工复核提示</strong>
          <span>
            {qualityCheck.humanReviewRequired
              ? "请核对商品外观、颜色、材质、文字与平台政策后再使用。"
              : "仍建议发布前人工复核。"}
          </span>
        </div>
      </section>
    </div>
  );
}
