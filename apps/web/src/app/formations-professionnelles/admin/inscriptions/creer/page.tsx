"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminSessionsList } from "@/lib/hooks/use-sessions-pro";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Input } from "@ecoledigitale/ui";
import { Loader2, Search, ArrowLeft, Calendar } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function CreerInscriptionPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useAdminSessionsList({
    page: 1,
    limit: 50,
    search: search || undefined,
    statut: "ouverte", // Only show open sessions
  });

  const sessions = data?.data?.sessions || [];

  const handleSelectSession = (sessionId: string) => {
    router.push(`/formations-professionnelles/inscription/session/${sessionId}`);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin/sessions" },
          { label: "Inscriptions", href: "/formations-professionnelles/admin/inscriptions" },
          { label: "Créer une inscription" },
        ]}
        className="mb-4 sm:mb-6"
      />

      <div className="space-y-4 sm:space-y-6 w-full min-w-0">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Créer une inscription</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Sélectionnez une session pour créer une nouvelle inscription
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/formations-professionnelles/admin/inscriptions")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour</span>
          </Button>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Rechercher une session par code, formation..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sessions List */}
        {isLoading ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-3 text-muted-foreground">Chargement des sessions...</span>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <p className="text-destructive mb-2">Erreur de chargement</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Une erreur est survenue"}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-semibold mb-2">Aucune session trouvée</p>
                <p className="text-sm text-muted-foreground">
                  {search
                    ? "Aucune session ouverte ne correspond à votre recherche."
                    : "Il n'y a pas de sessions ouvertes disponibles."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <Card key={session.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg">{session.formation.titre}</CardTitle>
                  <p className="text-sm text-muted-foreground font-mono">{session.code_session}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>
                        {format(new Date(session.date_debut), "d MMM yyyy", { locale: fr })} -{" "}
                        {format(new Date(session.date_fin), "d MMM yyyy", { locale: fr })}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Places disponibles: {session.places_disponibles} / {session.places_totales}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSelectSession(session.id)}
                    className="w-full"
                    disabled={session.places_disponibles === 0}
                  >
                    {session.places_disponibles === 0 ? "Complet" : "Sélectionner"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

