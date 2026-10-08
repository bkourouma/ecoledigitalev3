import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssessmentDetail } from "../_components/AssessmentDetail";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("assessment.read", "grade.read", "grade.enter");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <AssessmentDetail id={id} />;
}
