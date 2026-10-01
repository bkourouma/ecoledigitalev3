import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { LoginFlow } from "@/platform/auth/ui/LoginFlow";

export const metadata = { title: "Connexion — EcoleDigitale" };

export default function V2LoginPage() {
  return (
    <AuthV2Gate>
      <LoginFlow />
    </AuthV2Gate>
  );
}
