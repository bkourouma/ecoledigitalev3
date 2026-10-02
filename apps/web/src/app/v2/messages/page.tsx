import { requireAnyPermission } from "@/platform/auth/any-permission";
import { InboxScreen } from "./_components/InboxScreen";
import { READ_PERMISSIONS } from "./_components/messaging-utils";

export default async function MessagesInboxPage() {
  await requireAnyPermission(...READ_PERMISSIONS);
  return <InboxScreen />;
}
