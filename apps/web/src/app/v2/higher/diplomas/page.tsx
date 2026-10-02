import { requirePermission } from "@/platform/auth/server";
import { DiplomasScreen } from "../_components/DiplomasScreen";

export default async function HigherDiplomasPage() {
  await requirePermission("higher.diploma.read");
  return <DiplomasScreen />;
}
