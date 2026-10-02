import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ThreadScreen } from "../_components/ThreadScreen";
import { READ_PERMISSIONS } from "../_components/messaging-utils";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(...READ_PERMISSIONS);
  const { id } = await params;
  return <ThreadScreen conversationId={id} />;
}
