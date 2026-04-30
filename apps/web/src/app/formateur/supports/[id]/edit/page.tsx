"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import { useFormateurSupportDetail, useUpdateSupport } from "@/lib/hooks/use-formateur-supports";
import { useFormateurSessions } from "@/lib/hooks/use-formateur-sessions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useState, useEffect } from "react";

function EditSupportContent() {
  const params = useParams();
  const router = useRouter();
  const supportId = params.id as string;

  const { data, isLoading, error } = useFormateurSupportDetail(supportId);
  const updateSupport = useUpdateSupport();

  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [visibleApprenants, setVisibleApprenants] = useState(true);
  const [sessionIds, setSessionIds] = useState<string[]>([]);

  // Fetch sessions for the formation if available
  const formationId = data?.data?.support?.formation?.id;
  const { data: sessionsData } = useFormateurSessions({
    page: 1,
    limit: 100,
    formation_id: formationId || undefined,
  });
  const sessions = sessionsData?.data?.sessions || [];

  // Initialize form when data loads
  useEffect(() => {
    if (data?.data?.support) {
      const support = data.data.support;
      setTitre(support.titre);
      setDescription(support.description || "");
      setVisibleApprenants(support.visible_apprenants);
      
      // Set session IDs from associations
      if (data.data.sessions_associees) {
        setSessionIds(data.data.sessions_associees.map((s: any) => s.id));
      }
    }
  }, [data]);

  const handleSessionToggle = (sessionId: string) => {
    setSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!titre.trim()) {
      alert("Le titre est requis");
      return;
    }

    try {
      await updateSupport.mutateAsync({
        supportId,
        updates: {
          titre: titre.trim(),
          description: description.trim() || undefined,
          visible_apprenants: visibleApprenants,
          session_ids: sessionIds.length > 0 ? sessionIds : [],
        },
      });

      // Redirect to materials list after success
      router.push("/formateur/supports");
    } catch (error) {
      // Error is handled by the hook (toast)
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des détails...</span>
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
              {error instanceof Error ? error.message : "Erreur lors du chargement"}
            </p>
            <Link href="/formateur/supports">
              <Button variant="outline">Retour à la liste</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const support = data.data.support;

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* File Info (read-only) */}
          <div className="space-y-2">
            <Label>Fichier (non modifiable)</Label>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">{support.titre}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Type: {support.type_fichier} • Taille: {(support.taille_fichier / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="titre">Titre *</Label>
            <Input
              id="titre"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              required
              maxLength={255}
              disabled={updateSupport.isPending}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              disabled={updateSupport.isPending}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/2000 caractères
            </p>
          </div>

          {/* Sessions (multi-select) */}
          {sessions.length > 0 && (
            <div className="space-y-2">
              <Label>Sessions associées</Label>
              <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`session-${session.id}`}
                      checked={sessionIds.includes(session.id)}
                      onCheckedChange={() => handleSessionToggle(session.id)}
                      disabled={updateSupport.isPending}
                    />
                    <Label
                      htmlFor={`session-${session.id}`}
                      className="text-sm font-normal cursor-pointer flex-1"
                    >
                      {session.code_session} - {session.formation?.titre || "Formation"}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visible to learners */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="visible_apprenants"
              checked={visibleApprenants}
              onCheckedChange={(checked) => setVisibleApprenants(checked === true)}
              disabled={updateSupport.isPending}
            />
            <Label
              htmlFor="visible_apprenants"
              className="text-sm font-normal cursor-pointer"
            >
              Visible pour les apprenants
            </Label>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Link href="/formateur/supports">
              <Button
                type="button"
                variant="outline"
                disabled={updateSupport.isPending}
              >
                Annuler
              </Button>
            </Link>
            <Button type="submit" disabled={updateSupport.isPending || !titre.trim()}>
              {updateSupport.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mise à jour...
                </>
              ) : (
                "Enregistrer les modifications"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function EditSupportPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Link href="/formateur/supports">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div className="flex items-center gap-3 flex-1">
                <div className="rounded-lg bg-primary/10 p-3">
                  <FileText className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Modifier le Support de Cours</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">
                    Modifiez les informations du support de cours
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
          <EditSupportContent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

