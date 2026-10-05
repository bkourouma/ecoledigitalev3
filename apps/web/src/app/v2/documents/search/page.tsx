import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TextSearchScreen } from "../_components/TextSearchScreen";
import { VIEW_PERMISSIONS } from "../_components/documents-utils";

export default async function DocumentsTextSearchPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <TextSearchScreen />;
}
