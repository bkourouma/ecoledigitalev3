import { PublicOfferScreen } from "../../_components/PublicOfferScreen";

export default async function ApplyOfferPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return <PublicOfferScreen school={decodeURIComponent(school)} />;
}
