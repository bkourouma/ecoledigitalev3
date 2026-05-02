"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2, UserCheck, ArrowLeft, Download } from "lucide-react";
import { useFormateurSessionInscrits, useFormateurSessionDetail } from "@/lib/hooks/use-formateur-sessions";
import { FormateurInscritsList } from "@/components/formateur/FormateurInscritsList";
import { useExportAttendance } from "@/lib/hooks/use-formateur-attendance";
import Link from "next/link";
import { Button } from "@ecoledigitale/ui";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Badge } from "@ecoledigitale/ui";

function InscritsContent() {
  const params = useParams();
  const sessionId = params.id as string;

  const { data, isLoading, error } = useFormateurSessionInscrits(sessionId);
  const { data: sessionDetail } = useFormateurSessionDetail(sessionId);
  const exportAttendance = useExportAttendance();

  const sessionStatus = sessionDetail?.data?.session?.statut;
  const canMarkAttendance = sessionStatus === "en_cours" || sessionStatus === "terminee";
  const canExport = sessionStatus === "terminee";

  const handleExport = () => {
    if (sessionId) {
      exportAttendance.mutate({ sessionId, format: "csv" });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement des apprenants...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-4">
                {error instanceof Error ? error.message : "Erreur lors du chargement"}
              </p>
              <Link href={`/formateur/sessions/${sessionId}/details`}>
                <Button variant="outline">Retour aux détails</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data?.data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">Aucune donnée disponible</p>
              <Link href={`/formateur/sessions/${sessionId}/details`}>
                <Button variant="outline">Retour aux détails</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { inscrits, stats } = data.data;

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>Statistiques</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total inscrits</p>
              <p className="text-2xl font-bold">{stats.total_inscrits}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Confirmées</p>
              <p className="text-2xl font-bold text-green-600">{stats.confirmees}</p>
            </div>
            {stats.presents !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Présents</p>
                <p className="text-2xl font-bold text-green-600">{stats.presents}</p>
              </div>
            )}
            {stats.absents !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Absents</p>
                <p className="text-2xl font-bold text-red-600">{stats.absents}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inscrits List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Liste des apprenants ({inscrits.length})
            </CardTitle>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exportAttendance.isPending}
              >
                {exportAttendance.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Export en cours...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Exporter l'émargement
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <FormateurInscritsList
            inscrits={inscrits}
            showAll={true}
            sessionId={sessionId}
            sessionStatus={sessionStatus}
            canMarkAttendance={canMarkAttendance}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function FormateurInscritsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Link href="/formateur/sessions">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div className="flex items-center gap-3 flex-1">
                <div className="rounded-lg bg-primary/10 p-3">
                  <UserCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Apprenants Inscrits</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">
                    Liste complète des apprenants inscrits à la session
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      <ErrorBoundary>
        <Suspense
          fallback={
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </CardContent>
            </Card>
          }
        >
          <InscritsContent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

