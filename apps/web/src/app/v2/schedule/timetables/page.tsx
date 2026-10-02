import { requirePermission } from "@/platform/auth/server";
import { TimetablesScreen } from "../_components/TimetablesScreen";

export default async function TimetablesPage() {
  await requirePermission("schedule.read");
  return <TimetablesScreen />;
}
