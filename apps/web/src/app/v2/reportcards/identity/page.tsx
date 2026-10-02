import { requirePermission } from "@/platform/auth/server";
import { IdentityScreen } from "../_components/IdentityScreen";

export default async function ReportcardIdentityPage() {
  await requirePermission("reportcard.branding.manage");
  return <IdentityScreen />;
}
