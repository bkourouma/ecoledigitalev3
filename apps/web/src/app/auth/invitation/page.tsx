import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { SetPasswordPage } from "@/platform/auth/ui/PasswordPages";

// Lien d'invitation envoyé par l'API (`V2_APP_BASE_URL` + `/auth/invitation?token=…`) : définit le premier mot de passe.
export const metadata = { title: "Activer votre compte — EcoleDigitale", referrer: "no-referrer" };

export default function InvitationLinkPage() {
  return (
    <AuthV2Gate>
      <SetPasswordPage mode="invitation" />
    </AuthV2Gate>
  );
}
