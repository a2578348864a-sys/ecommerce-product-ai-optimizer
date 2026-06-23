import { WorkflowClient } from "@/components/cross-border/WorkflowClient";

export default async function WorkflowPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const params = await searchParams;
  const initialProductName = params.product ? decodeURIComponent(params.product) : undefined;
  return <WorkflowClient initialProductName={initialProductName} />;
}
