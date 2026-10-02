import { requirePermission } from "@/platform/auth/server";
import { ModerationScreen } from "../_components/ModerationScreen";

export default async function ModerationPage() {
  await requirePermission("messaging.moderation.read");
  return <ModerationScreen />;
}
