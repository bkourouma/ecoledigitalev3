import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { SupportReader } from "@/components/dashboard/SupportReader";
import { authOptions } from "@/lib/auth";
import { getLearningSupport } from "@/lib/learning";

export default async function LearningSupportPage({
  params,
}: {
  params: Promise<{ slug: string; supportId: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?next=/mes-formations");
  }

  const { slug, supportId } = await params;
  const payload = await getLearningSupport(session.user.id, slug, supportId);

  if (!payload) {
    notFound();
  }

  return (
    <SupportReader
      formationSlug={payload.workspace.formation.slug}
      formationTitle={payload.workspace.formation.titre}
      support={payload.support}
    />
  );
}
