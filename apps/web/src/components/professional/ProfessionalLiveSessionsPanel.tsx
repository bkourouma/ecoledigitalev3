"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@ecoledigitale/ui";
import {
  Video,
  Loader2,
  Plus,
  StopCircle,
  ExternalLink,
  X,
} from "lucide-react";
import {
  useCreateProfessionalLiveSession,
  useEndProfessionalLiveSession,
  useProfessionalLiveSessions,
} from "@/lib/hooks/use-professional-assignments";

interface Props {
  sessionId: string;
  canManage?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  created: "Programmée",
  live: "En direct",
  ended: "Terminée",
};

export function ProfessionalLiveSessionsPanel({ sessionId, canManage = false }: Props) {
  const router = useRouter();
  const listQuery = useProfessionalLiveSessions(sessionId);
  const createMut = useCreateProfessionalLiveSession();
  const endMut = useEndProfessionalLiveSession();

  const [showCreate, setShowCreate] = useState(false);
  const [titre, setTitre] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const items: any[] = listQuery.data ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created: any = await createMut.mutateAsync({
        sessionId,
        titre: titre || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        recordingEnabled,
      });
      setShowCreate(false);
      setTitre("");
      setScheduledAt("");
      // Aller direct dans la room pour démarrer
      if (created?.id) router.push(`/live/${created.id}`);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création.");
    }
  }

  async function handleEnd(id: string) {
    if (!window.confirm("Terminer définitivement cette séance ?")) return;
    setError(null);
    try {
      await endMut.mutateAsync(id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la clôture.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Séances visio (LiveKit)</CardTitle>
            <CardDescription>
              Réunions en direct rattachées à cette session — partage d'écran, audio/vidéo, enregistrement.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle séance
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Aucune séance visio programmée pour cette session.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((s) => {
              const isEnded = s.status === "ended";
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-opacity ${
                    isEnded ? "bg-muted/20 opacity-70" : "bg-muted/40"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Video
                      className={`h-5 w-5 mt-0.5 ${
                        s.status === "live"
                          ? "text-red-500"
                          : isEnded
                            ? "text-muted-foreground"
                            : "text-blue-500"
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium ${
                          isEnded ? "line-through text-muted-foreground" : ""
                        }`}
                      >
                        Séance du {new Date(s.created_at).toLocaleString("fr-FR")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.status === "live"
                              ? "bg-red-500/15 text-red-500 border border-red-500/40"
                              : isEnded
                                ? "bg-muted text-foreground/70 border border-border"
                                : "bg-blue-500/15 text-blue-500 border border-blue-500/40"
                          }`}
                        >
                          {s.status === "live" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          )}
                          {STATUS_LABEL[s.status] ?? s.status}
                        </span>
                        {s.recording_enabled && (
                          <span className="text-[11px]">⏺ enregistrée</span>
                        )}
                        {s.creator_first_name && (
                          <span>
                            par {s.creator_first_name} {s.creator_last_name}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isEnded ? (
                      <Button
                        size="sm"
                        onClick={() => router.push(`/live/${s.id}`)}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Rejoindre
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        className="cursor-not-allowed opacity-60"
                        title="Cette séance est terminée"
                      >
                        <StopCircle className="h-4 w-4 mr-1" />
                        Séance terminée
                      </Button>
                    )}
                    {canManage && !isEnded && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEnd(s.id)}
                        disabled={endMut.isPending}
                        className="text-red-600"
                      >
                        {endMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <StopCircle className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreate}
            className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-md"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">Programmer une séance visio</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowCreate(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Titre (optionnel)</label>
                <Input
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  placeholder="Cours du 12 juin — Comptabilité"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Date prévue (info, optionnel)</label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recordingEnabled}
                  onChange={(e) => setRecordingEnabled(e.target.checked)}
                />
                Activer l'enregistrement
              </label>
              <p className="text-xs text-muted-foreground">
                Cliquer « Créer & démarrer » provisionne la salle LiveKit puis vous emmène
                directement dans la room.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/40">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Créer & démarrer
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}
