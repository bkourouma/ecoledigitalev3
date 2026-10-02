import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ChannelsScreen } from "../../_components/ChannelsScreen";
import { VIEW_PERMISSIONS } from "../../_components/notifications-utils";

export default async function NotificationsChannelsPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <ChannelsScreen />;
}
