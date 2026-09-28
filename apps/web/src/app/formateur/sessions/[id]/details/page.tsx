"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2, BookOpen, ArrowLeft } from "lucide-react";
import { useFormateurSessionDetail } from "@/lib/hooks/use-formateur-sessions";
import { FormateurSessionDetailContent } from "@/components/formateur/FormateurSessionDetailContent";
import Link from "next/link";
import { Button } from "@ecoledigitale/ui";
import ErrorBoundary from "@/components/ErrorBoundary";
import { AddLiveSessionButton } from "@/components/live-sessions/AddLiveSessionButton";

function SessionDetailContent() {
  const params = useParams();
  const sessionId = params.id as string;

  const { data, isLoading, error } = useFormateurSessionDetail(sessionId);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement des détails de la session...</span>
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
                {error instanceof Error ? error.message : "Erreur lors du chargement des détails"}
              </p>
              <Link href="/formateur/sessions">
                <Button variant="outline">Retour à la liste</Button>
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
              <p className="text-muted-foreground mb-4">Session non trouvée</p>
              <Link href="/formateur/sessions">
                <Button variant="outline">Retour à la liste</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <FormateurSessionDetailContent sessionData={data.data} />;
}

export default function FormateurSessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
              <Link href="/formateur/sessions">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div className="flex items-center gap-3 flex-1">
                <div className="rounded-lg bg-primary/10 p-3">
                  <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="whitespace-nowrap text-2xl leading-tight md:text-3xl">Détails de la Session</CardTitle>
                  <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                    Informations complètes sur la session et les apprenants inscrits
                  </p>
                </div>
              </div>
              {sessionId && (
                <AddLiveSessionButton parentType="professionnelle" parentId={sessionId} />
              )}
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
          <SessionDetailContent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

