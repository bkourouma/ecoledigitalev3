import { requirePermission } from "@/platform/auth/server";
import { GeneratorLaunchScreen } from "../../_components/GeneratorLaunchScreen";

export default async function GeneratorLaunchPage() {
  await requirePermission("schedule.manage");
  return <GeneratorLaunchScreen />;
}
