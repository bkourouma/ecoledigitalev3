"use client";

import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Loader2, User, ArrowLeft } from "lucide-react";
import { useFormateurProfile } from "@/lib/hooks/use-formateur-profile";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ProfileEditForm } from "@/components/formateur/ProfileEditForm";
import { ProfileStats } from "@/components/formateur/ProfileStats";

function ProfileContent() {
  const { data, isLoading, error } = useFormateurProfile();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement du profil...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.data) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-destructive mb-4">
              {error instanceof Error ? error.message : "Erreur lors du chargement du profil"}
            </p>
            <Link href="/formateur/dashboard">
              <Button variant="outline">Retour au tableau de bord</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { formateur, formations_assignees, statistiques } = data.data;

  return (
    <div className="space-y-6">
      {/* Profile Edit Form */}
      <ProfileEditForm
        formateur={formateur}
        formationsAssignees={formations_assignees}
      />

      {/* Statistics */}
      <ProfileStats statistics={statistiques} />
    </div>
  );
}

export default function FormateurProfilePage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
              <Link href="/formateur/dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div className="flex items-center gap-3 flex-1">
                <div className="rounded-lg bg-primary/10 p-3">
                  <User className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="whitespace-nowrap text-2xl leading-tight md:text-3xl">Mon Profil</CardTitle>
                  <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                    Gérez vos informations professionnelles et votre profil
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
          <ProfileContent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

