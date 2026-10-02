import { PublicTrackScreen } from "../../_components/PublicTrackScreen";

export default async function ApplyTrackPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return <PublicTrackScreen school={decodeURIComponent(school)} />;
}
