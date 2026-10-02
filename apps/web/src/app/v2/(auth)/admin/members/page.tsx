import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { MembersPage } from "@/platform/auth/ui/MembersPage";

export const metadata = { title: "Membres — EcoleDigitale" };

export default function V2MembersPage() {
  return (
    <AuthV2Gate>
      <MembersPage />
    </AuthV2Gate>
  );
}
