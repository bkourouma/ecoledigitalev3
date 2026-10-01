import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { ForgotPasswordPage } from "@/platform/auth/ui/PasswordPages";

export const metadata = { title: "Mot de passe oublié — EcoleDigitale" };

export default function V2ForgotPasswordPage() {
  return (
    <AuthV2Gate>
      <ForgotPasswordPage />
    </AuthV2Gate>
  );
}
