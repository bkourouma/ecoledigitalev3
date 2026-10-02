import { requirePermission } from "@/platform/auth/server";
import { WebhooksScreen } from "./_components/Webhooks";

export default async function WebhooksPage() {
  await requirePermission("finance.webhook.read");
  return <WebhooksScreen />;
}
