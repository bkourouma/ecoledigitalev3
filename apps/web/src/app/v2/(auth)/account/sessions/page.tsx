import { AuthV2Gate } from "@/platform/auth/ui/AuthV2Gate";
import { SessionsPage } from "@/platform/auth/ui/SessionsPage";

export const metadata = { title: "Mes sessions — EcoleDigitale" };

export default function V2SessionsPage() {
  return (
    <AuthV2Gate>
      <SessionsPage />
    </AuthV2Gate>
  );
}
