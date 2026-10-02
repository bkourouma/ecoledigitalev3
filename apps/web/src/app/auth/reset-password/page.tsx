import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { SetPasswordPage } from "@/platform/auth/ui/PasswordPages";

// Lien envoyé par e-mail par l'API (`V2_APP_BASE_URL` + `/auth/reset-password?token=…`, voir platform/account-notifier.ts).
export const metadata = { title: "Nouveau mot de passe — EcoleDigitale", referrer: "no-referrer" };

export default function ResetPasswordLinkPage() {
  return (
    <AuthV2Gate>
      <SetPasswordPage mode="reset" />
    </AuthV2Gate>
  );
}
