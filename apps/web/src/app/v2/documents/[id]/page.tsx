import { requireAnyPermission } from "@/platform/auth/any-permission";
import { DocumentDetailScreen } from "../_components/DocumentDetailScreen";
import { VIEW_PERMISSIONS } from "../_components/documents-utils";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  const { id } = await params;
  return <DocumentDetailScreen documentId={id} />;
}
