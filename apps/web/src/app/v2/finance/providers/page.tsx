import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ProvidersScreen } from "./_components/Providers";

export default async function ProvidersPage() {
  await requireAnyPermission("finance.provider.manage");
  return <ProvidersScreen />;
}
