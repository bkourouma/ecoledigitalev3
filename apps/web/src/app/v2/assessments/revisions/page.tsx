import { requireAnyPermission } from "@/platform/auth/any-permission";
import { RevisionsScreen } from "../_components/RevisionsScreen";

export default async function RevisionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAnyPermission("grade.revise.request", "grade.revise.approve");
  const { status } = await searchParams;
  return <RevisionsScreen initialStatus={status ?? "REQUESTED"} />;
}
