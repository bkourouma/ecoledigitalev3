import { requirePermission } from "@/platform/auth/server";
import { NewApplicationScreen } from "../../_components/NewApplicationScreen";

export default async function NewApplicationPage() {
  await requirePermission("admission.create");
  return <NewApplicationScreen />;
}
