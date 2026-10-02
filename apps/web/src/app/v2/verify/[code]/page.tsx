import { VerifyScreen } from "../_components/VerifyScreen";

/** Cible du QR code : `/v2/verify/<code>` (le code est vérifié dès l'ouverture). */
export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyScreen initialCode={decodeURIComponent(code)} />;
}
