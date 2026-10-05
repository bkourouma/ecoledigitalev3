import { requirePermission } from "@/platform/auth/server";
import { GeneratorRunsScreen } from "../_components/GeneratorRunsScreen";

export default async function GeneratorPage() {
  await requirePermission("schedule.read");
  return <GeneratorRunsScreen />;
}
