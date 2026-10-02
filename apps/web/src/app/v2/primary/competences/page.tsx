import { CompetenciesScreen } from "../_components/CompetenciesScreen";

/** Page mince : la garde est dans `layout.tsx`. `?classe=` pré-sélectionne une classe (lien de « Ma classe »). */
export default async function Page({ searchParams }: { searchParams: Promise<{ classe?: string | string[] }> }) {
  const { classe } = await searchParams;
  return <CompetenciesScreen initialClassroomId={typeof classe === "string" ? classe : null} />;
}
