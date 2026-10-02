import { requirePermission } from "@/platform/auth/server";
import { ExplainScreen } from "../../_components/ExplainScreen";

export default async function ResultExplainPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ classroom?: string }> }) {
  await requirePermission("result.explain");
  const { id } = await params;
  const { classroom } = await searchParams;
  return <ExplainScreen resultId={id} classroomId={classroom ?? ""} />;
}
