import { requireAnyPermission } from "@/platform/auth/any-permission";
import { READ_PERMISSIONS, ANNOUNCE_PERMISSIONS } from "../messages/_components/messaging-utils";
import { AnnouncementsScreen } from "./_components/AnnouncementsScreen";

export default async function AnnouncementsPage() {
  await requireAnyPermission(...READ_PERMISSIONS, ...ANNOUNCE_PERMISSIONS);
  return <AnnouncementsScreen />;
}
