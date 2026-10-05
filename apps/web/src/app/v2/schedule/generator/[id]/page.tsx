import { requirePermission } from "@/platform/auth/server";
import { GeneratorRunScreen } from "../../_components/GeneratorRunScreen";

export default async function GeneratorRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("schedule.read");
  const { id } = await params;
  return <GeneratorRunScreen id={id} />;
}
