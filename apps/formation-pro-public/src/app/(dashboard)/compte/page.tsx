import Link from "next/link";
import { BookOpen, CreditCard, PlayCircle, UserRound } from "lucide-react";
import { getServerSession } from "next-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { getUserDashboardSummary } from "@/lib/account";

const quickLinks = [
  {
    href: "/mes-videos",
    title: "Mes vidéos",
    description: "Retrouvez les contenus vidéo déjà débloqués après achat.",
    icon: PlayCircle,
  },
  {
    href: "/mes-commandes",
    title: "Mes commandes",
    description: "Suivez vos paiements, références et confirmations.",
    icon: CreditCard,
  },
  {
    href: "/mes-formations",
    title: "Mes formations",
    description: "Accédez à vos formations achetées et à leurs supports.",
    icon: BookOpen,
  },
  {
    href: "/profil",
    title: "Mon profil",
    description: "Consultez les informations de votre compte visiteur.",
    icon: UserRound,
  },
];

export default async function ComptePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  const summary = await getUserDashboardSummary(session.user.id);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Mon compte
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Bonjour {session.user.prenom || session.user.name || "Apprenant"}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Retrouvez ici vos commandes, vos vidéos disponibles et l&apos;ensemble de vos
          accès apprenant.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Commandes</CardDescription>
            <CardTitle className="text-3xl">{summary.totalOrders}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Commandes confirmées</CardDescription>
            <CardTitle className="text-3xl">{summary.confirmedOrders}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Formations actives</CardDescription>
            <CardTitle className="text-3xl">{summary.activeFormations}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Vidéos disponibles</CardDescription>
            <CardTitle className="text-3xl">{summary.availableVideos}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {quickLinks.map((item) => {
          const Icon = item.icon;

          return (
            <Card key={item.href}>
              <CardHeader>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <Icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-2xl">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href={item.href}>Ouvrir</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
