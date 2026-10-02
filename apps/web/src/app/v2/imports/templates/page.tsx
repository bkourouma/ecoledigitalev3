import { requirePermission } from "@/platform/auth/server";
import { TemplatesScreen } from "../_components/TemplatesScreen";

export default async function ImportTemplatesPage() {
  await requirePermission("imports.read");
  return <TemplatesScreen />;
}
