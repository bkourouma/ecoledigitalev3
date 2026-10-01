import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { SecurityPage } from "@/platform/auth/ui/SecurityPage";

export const metadata = { title: "Sécurité du compte — EcoleDigitale" };

export default function V2SecurityPage() {
  return (
    <AuthV2Gate>
      <SecurityPage />
    </AuthV2Gate>
  );
}
