import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AccountNotificationsScreen } from "../../notifications/_components/AccountNotificationsScreen";
import { SELF_PERMISSIONS } from "../../notifications/_components/notifications-utils";

export default async function AccountNotificationsPage() {
  await requireAnyPermission(...SELF_PERMISSIONS);
  return <AccountNotificationsScreen />;
}
