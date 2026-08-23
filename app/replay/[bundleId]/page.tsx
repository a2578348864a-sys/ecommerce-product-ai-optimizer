import { redirect } from "next/navigation";

/**
 * 公网 HR 演示收口：旧脱敏回放详情链接统一内部跳转到「完整商品研究案例」页。
 */
export default function LegacyReplayDetail() {
  redirect("/replay");
}
