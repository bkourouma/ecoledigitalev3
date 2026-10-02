import { requirePermission } from "@/platform/auth/server";
import { SessionsScreen } from "./_components/SessionsScreen";

export default async function ExaminationsPage() {
  await requirePermission("exam.session.read");
  return <SessionsScreen />;
}
