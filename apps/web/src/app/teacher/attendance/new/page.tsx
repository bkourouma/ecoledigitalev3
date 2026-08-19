"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  UserCheck,
  BookOpen,
  Layers,
  Info,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { TeacherSeancesPanel } from "@/components/professional/TeacherSeancesPanel";
import { useTeacherSessions } from "@/lib/hooks/use-professional-teacher";
import { isSessionActive, sessionLabel } from "@/lib/professional-sessions";

/**
 * Nouvelle présence — Espace enseignant (Module Professionnel).
 * Ouverte depuis le bouton « Nouvelle présence » : choix de la filière puis de
 * la session (seules les sessions actives sont proposées), puis planification
 * des séances et saisie de l'appel.
 */

const STATUT_LABEL: Record<string, string> = {
  ouvert: "Ouverte",
  en_cours: "En cours",
  termine: "Terminée",
  complet: "Complète",
  annule: "Annulée",
  brouillon: "Brouillon",
};

export default function TeacherNewAttendancePage() {
  const router = useRouter();
  const sessionsQuery = useTeacherSessions();
  const [filiere, setFiliere] = useState("all");
  const [sessionId, setSessionId] = useState("");

  const sessions: any[] = (sessionsQuery.data as any[]) ?? [];

  // L'appel ne se fait que sur des sessions encore actives.
  const activeSessions = useMemo(() => sessions.filter(isSessionActive), [sessions]);

  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSessions) {
      if (s.filiere_id) {
        map.set(s.filiere_id, `${s.filiere_nom ?? s.filiere_code} (${s.filiere_code})`);
      }
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [activeSessions]);

  const visibleSessions = useMemo(
    () =>
      filiere === "all"
        ? activeSessions
        : activeSessions.filter((s) => s.filiere_id === filiere),
    [activeSessions, filiere]
  );

  const selected = useMemo(
    () => visibleSessions.find((s) => s.id === sessionId) ?? null,
    [visibleSessions, sessionId]
  );

  // Changer de filière invalide la session choisie : on repart d'une liste vierge.
  function changeFiliere(value: string) {
    setFiliere(value);
    setSessionId("");
  }

  if (sessionsQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/teacher/attendance")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux présences
        </Button>
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(sessionsQuery.error as Error)?.message ?? "Impossible de charger vos sessions."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/teacher/attendance")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux présences
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
            <UserCheck className="h-7 w-7 text-indigo-500" />
            Nouvelle présence
          </h1>
          <p className="text-muted-foreground mt-2">
            Choisissez la session, planifiez la séance, puis faites l'appel.
          </p>
        </div>
      </div>

      {/* Choix de la session */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Filière</label>
              <div className="mt-1.5">
                <SearchableSelect
                  value={filiere}
                  onChange={changeFiliere}
                  icon={<Layers className="h-4 w-4 text-gray-400" />}
                  placeholder="Toutes les filières"
                  searchPlaceholder="Rechercher une filière…"
                  options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Session</label>
              <div className="mt-1.5">
                <SearchableSelect
                  value={sessionId}
                  onChange={setSessionId}
                  icon={<BookOpen className="h-4 w-4 text-gray-400" />}
                  placeholder="Sélectionner une session"
                  searchPlaceholder="Rechercher…"
                  options={visibleSessions.map((s) => ({ value: s.id, label: sessionLabel(s) }))}
                />
              </div>
            </div>
          </div>

          {visibleSessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune session active{filiere === "all" ? "" : " pour cette filière"} : l'appel ne
              peut se faire que sur une session en cours.
            </p>
          )}

          {selected && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span className="font-medium text-foreground">
                {selected.ue_code} — {selected.ue_libelle}
              </span>
              <span>· {selected.filiere_code}</span>
              <span>· {STATUT_LABEL[selected.statut] ?? selected.statut}</span>
              <span>
                · {selected.nb_inscrits ?? 0} inscrit{(selected.nb_inscrits ?? 0) > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Saisie de la séance puis séances déjà planifiées */}
      {selected ? (
        <TeacherSeancesPanel sessionId={selected.id} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <UserCheck className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une session pour planifier ses séances et faire l'appel.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
