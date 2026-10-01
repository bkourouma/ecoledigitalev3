import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { TenantPage } from "@/platform/auth/ui/TenantPage";

export const metadata = { title: "Mes établissements — EcoleDigitale" };

export default function V2TenantsPage() {
  return (
    <AuthV2Gate>
      <TenantPage />
    </AuthV2Gate>
  );
}
