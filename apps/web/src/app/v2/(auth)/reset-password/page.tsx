import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { SetPasswordPage } from "@/platform/auth/ui/PasswordPages";

export const metadata = { title: "Nouveau mot de passe — EcoleDigitale", referrer: "no-referrer" };

export default function V2ResetPasswordPage() {
  return (
    <AuthV2Gate>
      <SetPasswordPage mode="reset" />
    </AuthV2Gate>
  );
}
