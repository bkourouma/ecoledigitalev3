import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ExplorerScreen } from "./_components/ExplorerScreen";
import { VIEW_PERMISSIONS } from "./_components/documents-utils";

export default async function DocumentsExplorerPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <ExplorerScreen />;
}
