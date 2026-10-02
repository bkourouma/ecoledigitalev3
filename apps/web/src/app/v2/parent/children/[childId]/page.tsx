import { requirePermission } from "@/platform/auth/server";
import { ChildDashboard } from "../../_components/ParentHome";

export default async function ChildDashboardPage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("student.child.read");
  const { childId } = await params;
  return <ChildDashboard childId={childId} />;
}
