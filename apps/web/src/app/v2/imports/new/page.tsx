import { requirePermission } from "@/platform/auth/server";
import { ImportAssistant } from "../_components/ImportAssistant";

export default async function NewImportPage() {
  await requirePermission("imports.create");
  return <ImportAssistant />;
}
