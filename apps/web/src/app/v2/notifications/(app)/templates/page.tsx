import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TemplatesScreen } from "../../_components/TemplatesScreen";
import { VIEW_PERMISSIONS } from "../../_components/notifications-utils";

export default async function NotificationsTemplatesPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <TemplatesScreen />;
}
