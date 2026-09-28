"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Plus, Eye, EyeOff, Edit, Trash2, Loader2 } from "lucide-react";
import {
  useFormateurs,
  useDeleteFormateur,
  useResetFormateurPassword,
} from "@/lib/hooks/use-sessions-pro";
import toast from "react-hot-toast";

export default function AdminFormateursPage() {
  const PASSWORDS_STORAGE_KEY = "sessions-pro:formateurs:generated-passwords";
  const router = useRouter();
  const { data, isLoading, error } = useFormateurs();
  const deleteFormateur = useDeleteFormateur();
  const resetFormateurPassword = useResetFormateurPassword();

  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [generatedPasswords, setGeneratedPasswords] = useState<Record<string, string>>({});
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);

  const formateurs = data?.data || [];

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(PASSWORDS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Record<string, string>;
      if (!parsed || typeof parsed !== "object") return;

      setGeneratedPasswords(parsed);

      const visibleMap: Record<string, boolean> = {};
      Object.keys(parsed).forEach((formateurId) => {
        visibleMap[formateurId] = true;
      });
      setRevealedPasswords(visibleMap);
    } catch (storageError) {
      console.error("Erreur lecture stockage local des mots de passe formateurs:", storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(generatedPasswords));
    } catch (storageError) {
      console.error("Erreur sauvegarde stockage local des mots de passe formateurs:", storageError);
    }
  }, [generatedPasswords]);

  const handleDelete = async (formateurId: string, prenom: string, nom: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le formateur ${prenom} ${nom} ?`)) {
      return;
    }

    try {
      await deleteFormateur.mutateAsync(formateurId);
      setGeneratedPasswords((prev) => {
        const next = { ...prev };
        delete next[formateurId];
        return next;
      });
      setRevealedPasswords((prev) => {
        const next = { ...prev };
        delete next[formateurId];
        return next;
      });
      toast.success("Formateur supprimé avec succès");
    } catch (deleteError: any) {
      console.error("Error deleting formateur:", deleteError);
      toast.error(deleteError.message || "Erreur lors de la suppression du formateur");
    }
  };

  const togglePasswordVisibility = (formateurId: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [formateurId]: !(prev[formateurId] ?? true) }));
  };

  const getFormateurPassword = (formateurId: string, fallbackFromApi?: string | null): string | null => {
    return generatedPasswords[formateurId] || fallbackFromApi || null;
  };

  const handlePasswordAction = async (formateurId: string) => {
    const currentPassword = getFormateurPassword(formateurId);
    if (currentPassword) {
      togglePasswordVisibility(formateurId);
      return;
    }

    try {
      setResettingPasswordFor(formateurId);
      const result = await resetFormateurPassword.mutateAsync(formateurId);
      const newPassword = result.data.initialPassword;
      setGeneratedPasswords((prev) => ({ ...prev, [formateurId]: newPassword }));
      setRevealedPasswords((prev) => ({ ...prev, [formateurId]: true }));
      toast.success("Mot de passe temporaire généré");
    } catch (resetError: any) {
      toast.error(resetError.message || "Impossible de générer le mot de passe");
    } finally {
      setResettingPasswordFor(null);
    }
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8 max-w-7xl w-full">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Formateurs" },
        ]}
        className="mb-4 sm:mb-6"
      />

      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Gestion des Formateurs</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez les formateurs pour les formations professionnelles
          </p>
        </div>
        <Button
          onClick={() => router.push("/formations-professionnelles/admin/formateurs/creer")}
          className="w-full sm:w-auto"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Créer un formateur</span>
          <span className="sm:hidden">Créer</span>
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement des formateurs...</span>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">Erreur lors du chargement des formateurs</p>
              <p className="text-sm text-muted-foreground mb-4">
                {error instanceof Error ? error.message : "Une erreur inattendue s'est produite"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : formateurs.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-foreground mb-2">Aucun formateur enregistré</p>
              <p className="text-sm text-muted-foreground mb-4">Commencez par créer votre premier formateur</p>
              <Button onClick={() => router.push("/formations-professionnelles/admin/formateurs/creer")}> 
                <Plus className="w-4 h-4 mr-2" />
                Créer un formateur
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {formateurs.map((formateur) => {
            if (!formateur || !formateur.id) {
              return null;
            }

            const formateurId = formateur.id;
            const nom = formateur.nom || "Nom non renseigné";
            const prenom = formateur.prenom || "Prénom non renseigné";
            const email = formateur.email || "Email non renseigné";
            const specialites = formateur.specialites || [];
            const actif = formateur.actif !== undefined ? formateur.actif : true;
            const formateurPassword = getFormateurPassword(
              formateurId,
              formateur.initialPassword || null
            );
            const isPasswordVisible = formateurPassword ? (revealedPasswords[formateurId] ?? true) : false;

            return (
              <Card key={formateurId} className="hover:shadow-lg transition-all duration-200 h-full flex flex-col">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {prenom} {nom}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 flex-1 flex flex-col">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Email:</span>
                    <p className="text-sm mt-1">{email}</p>
                  </div>

                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Mot de passe:</span>
                    <p className="text-sm mt-1 font-mono">
                      {formateurPassword
                        ? (isPasswordVisible ? formateurPassword : "********")
                        : "Non disponible"}
                    </p>
                  </div>

                  {specialites.length > 0 && (
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Spécialités:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {specialites.slice(0, 3).map((spec: string) => (
                          <span
                            key={`${formateurId}-${spec}`}
                            className="text-xs bg-primary/10 text-primary px-2 py-1 rounded"
                          >
                            {spec}
                          </span>
                        ))}
                        {specialites.length > 3 && (
                          <span className="text-xs text-muted-foreground">+{specialites.length - 3}</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <span
                      className={`text-xs px-2 py-1 rounded font-medium ${
                        actif
                          ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {actif ? "Actif" : "Inactif"}
                    </span>
                  </div>

                  <div className="flex gap-2 pt-3 border-t mt-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/details`);
                      }}
                      aria-label={`Voir les détails de ${prenom} ${nom}`}
                      title="Voir les détails"
                    >
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/modifier`);
                      }}
                      aria-label={`Modifier ${prenom} ${nom}`}
                      title="Modifier"
                    >
                      <Edit className="w-4 h-4" aria-hidden="true" />
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-background hover:bg-accent text-foreground border-border hover:border-accent-foreground transition-all duration-200"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        void handlePasswordAction(formateurId);
                      }}
                      disabled={resettingPasswordFor === formateurId}
                      aria-label={
                        formateurPassword
                          ? (isPasswordVisible ? "Masquer le mot de passe" : "Voir le mot de passe")
                          : "Générer le mot de passe"
                      }
                      title={
                        formateurPassword
                          ? (isPasswordVisible ? "Masquer le mot de passe" : "Voir le mot de passe")
                          : "Générer le mot de passe"
                      }
                    >
                      {resettingPasswordFor === formateurId ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : isPasswordVisible ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-background hover:bg-red-50 text-red-600 border-red-200 hover:border-red-300 transition-all duration-200"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleDelete(formateurId, prenom, nom);
                      }}
                      disabled={deleteFormateur.isPending}
                      aria-label={`Supprimer ${prenom} ${nom}`}
                      title="Supprimer"
                    >
                      {deleteFormateur.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
