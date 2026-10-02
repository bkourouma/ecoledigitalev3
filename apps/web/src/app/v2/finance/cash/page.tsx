import { requirePermission } from "@/platform/auth/server";
import { CashScreen } from "../_components/Cash";

export default async function CashPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance.cashregister.open");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <CashScreen initialSessionId={one("session")} />;
}
