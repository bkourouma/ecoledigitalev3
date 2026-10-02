import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ANNOUNCE_PERMISSIONS } from "../../../messages/_components/messaging-utils";
import { AnnouncementEditor } from "../../_components/AnnouncementEditor";

export default async function EditAnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...ANNOUNCE_PERMISSIONS);
  const { id } = await params;
  return <AnnouncementEditor announcementId={id} />;
}
