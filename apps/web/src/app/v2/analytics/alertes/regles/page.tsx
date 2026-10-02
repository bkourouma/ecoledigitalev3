import { requirePermission } from "@/platform/auth/server";
import { AlertRulesScreen } from "../../_components/AlertRules";

export default async function Page() {
  await requirePermission("analytics.alerts.read");
  return <AlertRulesScreen />;
}
