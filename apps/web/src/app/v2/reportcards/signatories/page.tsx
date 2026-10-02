import { requirePermission } from "@/platform/auth/server";
import { SignatoriesScreen } from "../_components/SignatoriesScreen";

export default async function ReportcardSignatoriesPage() {
  await requirePermission("reportcard.signatory.manage");
  return <SignatoriesScreen />;
}
