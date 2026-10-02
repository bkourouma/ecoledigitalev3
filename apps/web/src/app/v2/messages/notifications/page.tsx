import { requireAnyPermission } from "@/platform/auth/any-permission";
import { NotificationsScreen } from "../_components/NotificationsScreen";
import { READ_PERMISSIONS } from "../_components/messaging-utils";

export default async function NotificationsPage() {
  await requireAnyPermission(...READ_PERMISSIONS);
  return <NotificationsScreen />;
}
