import { requirePermission } from "@/platform/auth/server";
import { HistoryScreen } from "./_components/HistoryScreen";

export default async function ImportsPage() {
  await requirePermission("imports.read");
  return <HistoryScreen />;
}
