import { requirePermission } from "@/platform/auth/server";
import { ConfigsScreen } from "../_components/Configuration";

export default async function ConfigurationPage() {
  await requirePermission("payroll.config.read");
  return <ConfigsScreen />;
}
