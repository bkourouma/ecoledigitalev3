import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ComposeScreen } from "../_components/ComposeScreen";

export default async function ComposeMessagePage() {
  await requireAnyPermission("messaging.send", "messaging.send.any", "messaging.child.send", "messaging.self.send");
  return <ComposeScreen />;
}
