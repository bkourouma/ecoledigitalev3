import { requirePermission } from "@/platform/auth/server";
import { TemplatesScreen } from "../_components/TemplatesScreen";

export default async function ReportcardTemplatesPage() {
  await requirePermission("reportcard.template.manage");
  return <TemplatesScreen />;
}
