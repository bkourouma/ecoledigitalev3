import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ApplicationDetailScreen } from "../../_components/ApplicationDetailScreen";
import { VIEW_PERMISSIONS } from "../../_components/admissions-utils";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  const { id } = await params;
  return <ApplicationDetailScreen applicationId={id} />;
}
