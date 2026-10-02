import { VerifyScreen } from "../../_components/VerifyScreen";

/**
 * Alias de la forme imprimée par l'API : le QR encode `<REPORTCARDS_VERIFICATION_BASE_URL>/v/<code>`. Avec
 * `REPORTCARDS_VERIFICATION_BASE_URL=https://<domaine>/v2/verify`, le QR ouvre cette page.
 */
export default async function VerifyShortCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyScreen initialCode={decodeURIComponent(code)} />;
}
