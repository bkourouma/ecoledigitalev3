import { requirePermission } from "@/platform/auth/server";
import { OccurrencesScreen } from "../_components/OccurrencesScreen";

export default async function OccurrencesPage() {
  await requirePermission("schedule.read");
  return <OccurrencesScreen />;
}
