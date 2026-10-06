import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { LoginWithTechnicalAccounts } from "@/platform/auth/ui/LoginWithTechnicalAccounts";

export const metadata = { title: "Connexion — EcoleDigitale" };

export default function V2LoginPage() {
  return (
    <AuthV2Gate>
      <LoginWithTechnicalAccounts />
    </AuthV2Gate>
  );
}
