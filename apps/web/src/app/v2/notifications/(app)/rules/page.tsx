import { requireAnyPermission } from "@/platform/auth/any-permission";
import { RulesScreen } from "../../_components/RulesScreen";
import { VIEW_PERMISSIONS } from "../../_components/notifications-utils";

export default async function NotificationsRulesPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <RulesScreen />;
}
