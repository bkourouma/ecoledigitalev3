import { requirePermission } from "@/platform/auth/server";
import { YearResultScreen } from "../../../_components/YearResultScreen";

export default async function YearResultPage({ params }: { params: Promise<{ enrollmentId: string; yearId: string }> }) {
  await requirePermission("result.read");
  const { enrollmentId, yearId } = await params;
  return <YearResultScreen enrollmentId={enrollmentId} yearId={yearId} />;
}
