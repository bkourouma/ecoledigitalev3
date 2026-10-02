import { requirePermission } from "@/platform/auth/server";
import { JournalScreen } from "../_components/JournalScreen";
import { READ } from "../_components/notifications-utils";

export default async function NotificationsJournalPage() {
  await requirePermission(READ);
  return <JournalScreen />;
}
