import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ANNOUNCE_PERMISSIONS } from "../../messages/_components/messaging-utils";
import { AnnouncementEditor } from "../_components/AnnouncementEditor";

export default async function NewAnnouncementPage() {
  await requireAnyPermission(...ANNOUNCE_PERMISSIONS);
  return <AnnouncementEditor />;
}
