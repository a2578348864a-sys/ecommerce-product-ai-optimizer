import { redirect } from "next/navigation";

/**
 * F8：批量分析 MVP 收口——无正式导航入口，且可绕过候选研究流程直接创建 Task。
 * 已按 Final Product Integration 决定下线：主链唯一入口为「候选池 → 开始研究 → Research Workbench」。
 */
export default function WorkflowBatchPage() {
  redirect("/opportunity-candidates");
}
