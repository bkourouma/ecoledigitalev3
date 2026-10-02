import { PublicFormScreen } from "../_components/PublicFormScreen";

export default async function ApplyPage({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  return <PublicFormScreen school={decodeURIComponent(school)} />;
}
