import { redirect } from "next/navigation";

/**
 * The V5 preview route became the primary Listing Studio at cutover. It now
 * redirects so the app never ships two Listing Studio implementations that can
 * drift apart.
 */
export default async function ListingStudioV5Redirect({ searchParams }: { searchParams?: Promise<{ taskId?: string | string[] }> }) {
  const params = await searchParams;
  const raw = Array.isArray(params?.taskId) ? params.taskId[0] : params?.taskId;
  const taskId = raw?.trim().slice(0, 200) || "";
  redirect(taskId ? `/listing-studio?taskId=${encodeURIComponent(taskId)}` : "/listing-studio");
}
