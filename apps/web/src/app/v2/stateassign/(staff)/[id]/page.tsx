import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssignmentDetailScreen } from "../../_components/AssignmentDetailScreen";
import { VIEW_PERMISSIONS } from "../../_components/permissions";

export default async function StateassignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  const { id } = await params;
  return <AssignmentDetailScreen id={id} />;
}
