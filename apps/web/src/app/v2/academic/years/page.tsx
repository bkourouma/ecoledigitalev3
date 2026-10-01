import { requirePermission } from "@/platform/auth/server";
import { YearsScreen } from "../_components/YearsScreen";

export default async function YearsPage() {
  await requirePermission("academic.year.read");
  return <YearsScreen />;
}
