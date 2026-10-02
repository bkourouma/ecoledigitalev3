import { requirePermission } from "@/platform/auth/server";
import { OnlinePaymentScreen } from "../../_components/PaymentForm";

export default async function OnlinePaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance.payment.create");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <OnlinePaymentScreen initialLearnerId={one("learnerId")} />;
}
