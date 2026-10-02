import { CouncilScreen } from "../_components/CouncilScreen";

/** Page mince : la garde est dans `layout.tsx`. `?classe=` pré-sélectionne une classe (lien de « Ma classe »). */
export default async function Page({ searchParams }: { searchParams: Promise<{ classe?: string | string[] }> }) {
  const { classe } = await searchParams;
  return <CouncilScreen initialClassroomId={typeof classe === "string" ? classe : null} />;
}
