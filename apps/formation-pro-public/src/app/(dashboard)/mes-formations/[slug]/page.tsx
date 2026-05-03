import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { LearningSupportCard } from "@/components/dashboard/LearningSupportCard";
import { ProgressBar } from "@/components/dashboard/ProgressBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authOptions } from "@/lib/auth";
import { getLearningWorkspace } from "@/lib/learning";
import { formatDate } from "@/lib/utils";

export default async function LearningWorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?next=/mes-formations");
  }

  const { slug } = await params;
  const workspace = await getLearningWorkspace(session.user.id, slug);

  if (!workspace) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Lecture apprenant
          </p>
          <h1 className="font-display text-4xl font-semibold">
            {workspace.formation.titre}
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href={`/catalogue/${workspace.formation.slug}`}>Voir la fiche publique</Link>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Votre accès est débloqué</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paiement confirmé. Vous pouvez maintenant parcourir les ressources
              de votre formation et ouvrir chaque contenu depuis cet espace.
            </p>
            <ProgressBar value={100} />
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p>Ressources disponibles : {workspace.supports.length}</p>
              <p>
                Session :
                {" "}
                {workspace.session
                  ? `${workspace.session.codeSession || "À venir"} - ${formatDate(workspace.session.dateDebut)}`
                  : "Parcours général"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avant de commencer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Commencez par les ressources de contexte, puis avancez vers les vidéos et ateliers.</p>
            <p>Pour les formats PDF ou bureautiques, les contenus s&apos;ouvrent dans un nouvel onglet.</p>
            <p>Si une ressource n&apos;est pas lisible, vérifiez simplement le lien source ou contactez le support.</p>
          </CardContent>
        </Card>
      </div>

      {workspace.supports.length ? (
        <div className="grid gap-5">
          {workspace.supports.map((support) => (
            <LearningSupportCard
              key={support.id}
              formationSlug={workspace.formation.slug}
              support={support}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Aucune ressource apprenant pour le moment"
          description="Votre accès est bien actif, mais aucun support visible n'a encore été publié."
        />
      )}
    </div>
  );
}
