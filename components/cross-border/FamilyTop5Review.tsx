"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import type { ProductFamily, FamilyReviewDecision } from "@/lib/upstream/family-top5-types";

const LS_KEY = "opportunities-family-review-v1";

function loadDecisions(): Record<string, FamilyReviewDecision> {
  if (typeof window === "undefined") return {};
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function saveDecisions(d: Record<string, FamilyReviewDecision>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {}
}

export default function FamilyTop5Review({ topFamilies, remainingFamilies, baseline }: {
  topFamilies: ProductFamily[];
  remainingFamilies: ProductFamily[];
  baseline: { commit: string; tree: string };
}) {
  const [decisions, setDecisions] = useState<Record<string, FamilyReviewDecision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedRest, setExpandedRest] = useState(false);
  const [topPicks, setTopPicks] = useState<string[]>([]);
  const [comments, setComments] = useState("");

  useEffect(() => { setDecisions(loadDecisions()); }, []);

  const save = useCallback((d: Record<string, FamilyReviewDecision>) => { setDecisions(d); saveDecisions(d); }, []);

  const decide = (f: ProductFamily, decision: string) => {
    const next = { ...decisions, [f.familyId]: { familyId: f.familyId, representativeStableId: f.representativeStableId, memberStableIds: f.memberStableIds, decision: decision as FamilyReviewDecision["decision"], notes: notes[f.familyId] || "" } };
    save(next);
  };
  const setNote = (fid: string, n: string) => { setNotes(prev => { const next = { ...prev, [fid]: n }; if (decisions[fid]) { const d = { ...decisions, [fid]: { ...decisions[fid], notes: n } }; saveDecisions(d); setDecisions(d); } return next; }); };

  const exportJSON = () => {
    const rev = topFamilies.map(f => decisions[f.familyId] || { familyId: f.familyId, representativeStableId: f.representativeStableId, memberStableIds: f.memberStableIds, decision: "暂时观察", notes: notes[f.familyId] || "" });
    const exp = { schemaVersion: "family-review-response.v1", exportedAt: new Date().toISOString(), codeBaseline: baseline, reviewedFamilies: rev, overall: { topPicks, comments } };
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "family-review-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px", background: "#FFFEF9", color: "#2c3e50", lineHeight: 1.6, fontSize: 17, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.3em", color: "#2E7D32", marginBottom: 4 }}>商品家族 Top 5 视觉复核</h1>
      <div style={{ background: "#E8F5E9", borderLeft: "3px solid #4CAF50", padding: "12px 16px", borderRadius: 4, margin: "12px 0", fontSize: ".9em", color: "#555" }}>
        当前结果仅用于公开市场预筛与人工继续调查，<strong>不代表采购、利润、合规或上架结论。</strong>
      </div>

      {/* ═══ Batch Header ═══ */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0", fontSize: ".85em", color: "#888" }}>
        <span>Listing: 23</span> <span>家族: 22</span> <span>Top: 5</span> <span>剩余: 17</span>
        <span>Commit: {baseline.commit.slice(0, 7)}</span>
        <span style={{ color: "#E65100" }}>只读验收样本</span>
      </div>
      <div style={{ fontSize: ".8em", color: "#E65100", margin: "4px 0 12px", padding: "6px 10px", background: "#FFF3E0", borderRadius: 4 }}>
        本批次Top候选品牌集中度较高（Everbilt占4/5），结果可能受单关键词、单平台和单页样本影响。
      </div>

      {/* ═══ Top 5 Cards ═══ */}
      {topFamilies.map(f => {
        const rl = f.representativeListing;
        const dec = decisions[f.familyId];
        return (
          <div key={f.familyId} style={{ background: "#fff", border: "1px solid #C8E6C9", borderRadius: 8, padding: 16, margin: "12px 0", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              {rl.thumbnailUrl ? (
                <div style={{ flexShrink: 0, width: 100, height: 100, position: "relative", borderRadius: 6, overflow: "hidden", border: "1px solid #E0E0E0" }}>
                  <Image src={rl.thumbnailUrl} alt="" fill style={{ objectFit: "contain" }} unoptimized referrerPolicy="no-referrer"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
              ) : <div style={{ flexShrink: 0, width: 100, height: 100, background: "#ECEFF1", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".7em", color: "#999" }}>无图片</div>}
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.05em", color: "#2E7D32", marginBottom: 2 }}>家族#{f.familyRank} {rl.parsedNameZh}</h3>
                <div style={{ fontSize: ".78em", color: "#888", marginBottom: 6, wordBreak: "break-all" }}>{rl.title}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0" }}>
                  <span style={tagStyle}>{f.normalizedBrand}</span>
                  <span style={tagStyle}>{rl.installation}</span>
                  <span style={tagStyle}>{rl.packInfo}</span>
                  {f.familyStatus === "variant_or_listing_conflict" && <span style={{ ...tagStyle, background: "#FFF3E0", color: "#E65100" }}>检测到{f.memberCount}条相关Listing</span>}
                </div>
              </div>
            </div>

            {/* Facts grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4, margin: "8px 0" }}>
              <Fact label="价格" value={`$${rl.price.toFixed(2)}`} note="币种:市场推断" />
              <Fact label="评分" value={`${rl.rating} / 5`} />
              <Fact label="评论数" value={`${rl.reviewCount}`} />
              {rl.dimensions.length > 0 && <Fact label="尺寸" value={rl.dimensions.join(" x ")} />}
              {rl.capacities.length > 0 && <Fact label="承重" value={`${rl.capacities.join(", ")} 磅`} />}
              {rl.materials.length > 0 && <Fact label="材质" value={rl.materials.join(", ")} />}
            </div>

            {/* Detail grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, margin: "10px 0" }}>
              <DetailBox type="why" title="进入Top 5原因"><ul>{f.factualReasons.map((r, i) => <li key={i}>{r}</li>)}</ul></DetailBox>
              <DetailBox type="caution" title="需要谨慎"><ul>{f.cautionReasons.map((r, i) => <li key={i}>{r}</li>)}</ul></DetailBox>
              <DetailBox type="unknown" title="还不知道"><ul>{f.unknowns.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}</ul></DetailBox>
            </div>

            {/* Member table for multi-listing families */}
            {f.familyStatus === "variant_or_listing_conflict" && (
              <div style={{ margin: "10px 0", padding: "8px 0", borderTop: "1px solid #f0f0f0" }}>
                <h4 style={{ fontSize: ".9em", color: "#2E7D32", marginBottom: 6 }}>📦 同家族Listing差异表</h4>
                <div style={{ fontSize: ".8em", color: "#E65100", marginBottom: 4 }}>同品牌、同型号，但包装描述存在差异。目前无法确认是包装版本、重复Listing还是不同销售来源。</div>
                <div style={{ fontSize: ".8em", color: "#888", marginBottom: 6 }}>{f.sellerWarning}</div>
                <div style={{ maxWidth: "100%", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em", minWidth: 720 }}>
                    <thead>
                      <tr style={{ background: "#ECEFF1" }}>
                        <th style={thStyle}></th><th style={thStyle}>stableId</th><th style={thStyle}>原排名</th><th style={thStyle}>价格</th><th style={thStyle}>包装</th><th style={thStyle}>评分</th><th style={thStyle}>评论</th><th style={thStyle}>图片</th><th style={thStyle}>链接</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.memberListings.map(ml => (
                        <tr key={ml.stableId}>
                          <td style={tdStyle}>{ml.stableId === f.representativeStableId ? "⭐代表" : "成员"}</td>
                          <td style={tdStyle}>{ml.stableId}</td><td style={tdStyle}>#{ml.originalRank}</td><td style={tdStyle}>${ml.price.toFixed(2)}</td><td style={tdStyle}>{ml.packInfo}</td><td style={tdStyle}>{ml.rating}</td><td style={tdStyle}>{ml.reviewCount}</td>
                          <td style={tdStyle}>{ml.thumbnailUrl ? <Image src={ml.thumbnailUrl} alt="" width={60} height={60} style={{ objectFit: "contain", borderRadius: 4 }} unoptimized referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <span style={{ fontSize: ".7em", color: "#999" }}>无图</span>}</td>
                          <td style={tdStyle}><a href={ml.link} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0" }}>打开</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Source + disclaimer */}
            <div style={{ fontSize: ".75em", color: "#888", marginTop: 6 }}>
              <a href={rl.link} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0" }}>打开原商品页(外部)</a> | ID: {f.representativeStableId}
            </div>
            <p style={{ fontSize: ".7em", color: "#999", fontStyle: "italic" }}>需人工复核。不代表采购或上架建议。</p>

            {/* Decision */}
            <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
              {["继续调查", "暂时观察", "不继续调查"].map(opt => (
                <button key={opt} onClick={() => decide(f, opt)}
                  style={{ padding: "8px 18px", border: "2px solid " + (dec?.decision === opt ? "#4CAF50" : "#C8E6C9"), background: dec?.decision === opt ? "#4CAF50" : "#fff", color: dec?.decision === opt ? "#fff" : "#2c3e50", borderRadius: 20, cursor: "pointer", fontSize: ".88em", fontFamily: "inherit" }}>
                  {opt}
                </button>
              ))}
            </div>
            <textarea placeholder="备注（可选）" value={notes[f.familyId] || ""} onChange={e => setNote(f.familyId, e.target.value)}
              style={{ width: "100%", padding: 6, border: "1px solid #E0E0E0", borderRadius: 4, fontSize: ".85em", minHeight: 32, resize: "vertical", fontFamily: "inherit" }} />
          </div>
        );
      })}

      {/* ═══ Rest 17 ═══ */}
      <div style={{ margin: "20px 0", border: "1px solid #E0E0E0", borderRadius: 8, overflow: "hidden" }}>
        <button onClick={() => setExpandedRest(!expandedRest)} style={{ width: "100%", padding: "12px 16px", background: "#FAFAFA", border: "none", textAlign: "left", fontSize: ".95em", cursor: "pointer", fontFamily: "inherit", color: "#555" }}>
          📋 查看其余{remainingFamilies.length}个家族摘要 ▸
        </button>
        {expandedRest && (
          <div style={{ padding: 8, maxWidth: "100%", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em" }}>
              <thead><tr style={{ background: "#ECEFF1" }}><th style={thStyle}>排名</th><th style={thStyle}>家族ID</th><th style={thStyle}>代表商品</th><th style={thStyle}>品牌</th><th style={thStyle}>价格</th><th style={thStyle}>评分</th><th style={thStyle}>评论</th><th style={thStyle}>未进入Top5原因</th></tr></thead>
              <tbody>
                {remainingFamilies.map(r => (
                  <tr key={r.familyId}><td style={tdStyle}>#{r.familyRank}</td><td style={tdStyle}>{r.familyId}</td><td style={tdStyle}>{r.representativeListing.parsedNameZh}</td><td style={tdStyle}>{r.normalizedBrand}</td><td style={tdStyle}>${r.representativeListing.price.toFixed(2)}</td><td style={tdStyle}>{r.representativeListing.rating}</td><td style={tdStyle}>{r.representativeListing.reviewCount}</td><td style={{ ...tdStyle, fontSize: ".8em", color: "#888" }}>{r.notTopFamilyReason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ Overall ═══ */}
      <div style={{ background: "#E8F5E9", border: "1px solid #4CAF50", borderRadius: 8, padding: 16, margin: "16px 0" }}>
        <h2 style={{ color: "#2E7D32", marginTop: 0, fontSize: "1.1em" }}>📝 我的结论</h2>
        <div style={{ margin: "8px 0" }}><strong>最愿意继续调查的家族（最多5个）</strong></div>
        {topFamilies.map(f => (
          <label key={f.familyId} style={{ display: "block", fontSize: ".9em", padding: "3px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={topPicks.includes(f.familyId)} onChange={e => { if (e.target.checked && topPicks.length >= 5) return; setTopPicks(e.target.checked ? [...topPicks, f.familyId] : topPicks.filter(x => x !== f.familyId)); }} /> 家族#{f.familyRank} {f.representativeListing.parsedNameZh}
          </label>
        ))}
        <div style={{ margin: "8px 0" }}><strong>总体意见（可选）</strong></div>
        <textarea value={comments} onChange={e => setComments(e.target.value)} maxLength={1000} style={{ width: "100%", minHeight: 60, padding: 8, border: "1px solid #C8E6C9", borderRadius: 4, fontSize: ".9em", fontFamily: "inherit", resize: "vertical" }} />
        <button onClick={exportJSON} style={{ display: "inline-block", padding: "10px 24px", margin: "6px 4px", background: "#4CAF50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: ".95em", fontFamily: "inherit" }}>📥 导出评价结果JSON</button>
      </div>

      <p style={{ fontSize: ".8em", color: "#888", marginTop: 16 }}>当前决定仅保存在本浏览器，尚未写入正式任务或候选数据库。这些能力不属于当前公开市场预筛MVP。</p>
    </div>
  );
}

const tagStyle: React.CSSProperties = { display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: ".75em", background: "#E8F5E9", color: "#388E3C" };
const thStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #E0E0E0", textAlign: "left", fontSize: ".8em", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #E0E0E0", fontSize: ".82em" };

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div style={{ padding: "4px 8px", background: "#FAFAFA", borderRadius: 4, fontSize: ".82em" }}>
    <strong>{label}</strong> {value}{note && <span style={{ color: "#E65100", fontSize: ".8em" }}> ({note})</span>}
  </div>;
}

function DetailBox({ type, title, children }: { type: "why" | "caution" | "unknown"; title: string; children: React.ReactNode }) {
  const colors = { why: { bg: "#E8F5E9", color: "#2E7D32" }, caution: { bg: "#FFF3E0", color: "#E65100" }, unknown: { bg: "#ECEFF1", color: "#607D8B" } };
  return <div style={{ padding: 8, borderRadius: 6, fontSize: ".82em", background: colors[type].bg }}>
    <h4 style={{ fontSize: ".88em", marginBottom: 4, color: colors[type].color }}>{title}</h4>
    <div style={{ listStyle: "none", padding: 0 }}>{children}</div>
  </div>;
}
