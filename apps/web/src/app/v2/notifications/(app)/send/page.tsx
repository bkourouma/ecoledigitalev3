import { requireAnyPermission } from "@/platform/auth/any-permission";
import { SendScreen } from "../../_components/SendScreen";
import { SEND_PERMISSIONS } from "../../_components/notifications-utils";

export default async function NotificationsSendPage() {
  await requireAnyPermission(...SEND_PERMISSIONS);
  return <SendScreen />;
}
