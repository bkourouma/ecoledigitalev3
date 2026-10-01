import { requirePermission } from "@/platform/auth/server";
import { EnrollmentDetail } from "../_components/EnrollmentDetail";

export default async function EnrollmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("enrollment.read");
  const { id } = await params;
  return <EnrollmentDetail id={id} />;
}
