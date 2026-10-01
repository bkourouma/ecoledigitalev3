import { requirePermission } from "@/platform/auth/server";
import { FundingScreen } from "../_components/Funding";

export default async function FundingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance.invoice.read");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <FundingScreen initialLearnerId={one("learnerId")} />;
}
