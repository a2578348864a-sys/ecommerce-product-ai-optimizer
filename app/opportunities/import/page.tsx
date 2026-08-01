import { redirect } from "next/navigation";

export default function OpportunitiesImportPage() {
  redirect("/opportunity-candidates?mode=manual");
}
