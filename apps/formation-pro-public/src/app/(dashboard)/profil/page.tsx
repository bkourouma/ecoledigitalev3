import { getServerSession } from "next-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authOptions } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";

export default async function ProfilPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-3xl">Profil</CardTitle>
            <Badge tone={session?.user?.emailVerified ? "success" : "warning"}>
              {session?.user?.emailVerified ? "Email vérifié" : "Email à vérifier"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Nom : {[session?.user?.prenom, session?.user?.nom].filter(Boolean).join(" ") || "Non renseigné"}</p>
          <p>Email : {session?.user?.email || "Non renseigné"}</p>
          <p>Téléphone : {session?.user?.telephone || "Non renseigné"}</p>
          <p>Type de compte : {session?.user?.isAdmin ? "Administrateur" : "Visiteur apprenant"}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Accès du compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Google OAuth : disponible si le provider est configuré sur cet environnement.</p>
          <p>Compte email local : disponible avec vérification email avant la première connexion.</p>
          <p>Vos commandes, vidéos et contenus achetés sont liés au même compte utilisateur.</p>
        </CardContent>
      </Card>
    </div>
  );
}
