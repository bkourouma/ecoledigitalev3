import { requireAnyPermission } from "@/platform/auth/any-permission";
import { READ_PERMISSIONS, ANNOUNCE_PERMISSIONS } from "../../messages/_components/messaging-utils";
import { AnnouncementDetailScreen } from "../_components/AnnouncementDetailScreen";

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...READ_PERMISSIONS, ...ANNOUNCE_PERMISSIONS);
  const { id } = await params;
  return <AnnouncementDetailScreen announcementId={id} />;
}
