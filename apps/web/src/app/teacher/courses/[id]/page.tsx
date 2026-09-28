"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Info,
  CalendarDays,
  GraduationCap,
  ClipboardList,
  FolderOpen,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import {
  useTeacherSessions,
  useTeacherSessionEcue,
  useTeacherSessionSeances,
  useCreateTeacherSeance,
  useDeleteTeacherSeance,
  useTeacherSeanceAttendance,
  useMarkTeacherSeanceAttendance,
} from "@/lib/hooks/use-professional-teacher";
import {
  useSessionResults,
  useRecomputeSessionResults,
  useValidateEcueResult,
} from "@/lib/hooks/use-professional-catalog-admin";
import { ProfessionalAssignmentsPanel } from "@/components/professional/ProfessionalAssignmentsPanel";
import { SubjectMaterialsPanel } from "@/components/professional/SubjectMaterialsPanel";
import { TeacherSeancesPanel } from "@/components/professional/TeacherSeancesPanel";

const ATTENDANCE = ["present", "absent", "retard", "excuse"];

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

type Tab = "details" | "seances" | "supports" | "evaluations" | "resultats";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

export default function TeacherSessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const sessionId = String(params?.id ?? "");
  // Retour vers la liste parente (déduite de l'URL, ex. /teacher/courses).
  const LIST_URL = (pathname || "/teacher/courses").replace(/\/[^/]+$/, "") || "/teacher/courses";
  const [tab, setTab] = useState<Tab>("details");

  const sessionsQuery = useTeacherSessions();
  const sessions: any[] = (sessionsQuery.data as any[]) ?? [];
  const session = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);

  if (sessionsQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-3">
              Session introuvable ou non affectée à votre compte.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ueName = `${session.ue_code} — ${session.ue_libelle}`;

  const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "details", label: "Détails", icon: Info },
    { id: "seances", label: "Séances & présence", icon: CalendarDays },
    { id: "supports", label: "Supports de cours", icon: FolderOpen },
    { id: "evaluations", label: "Évaluations", icon: ClipboardList },
    { id: "resultats", label: "Résultats & UV", icon: GraduationCap },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            {session.libelle}
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">{ueName}</p>
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "details" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de la session</CardTitle>
            <CardDescription>Session que vous animez.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="UE" value={ueName} />
              <Field label="Libellé" value={session.libelle} />
              <Field label="Date de début" value={fmtDate(session.date_debut)} />
              <Field label="Date de fin" value={fmtDate(session.date_fin)} />
              <Field label="Étudiants inscrits" value={session.nb_inscrits ?? 0} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "seances" && <TeacherSeancesPanel sessionId={sessionId} />}
      {tab === "supports" && <SupportsTab sessionId={sessionId} />}
      {tab === "evaluations" && <EvaluationsTab sessionId={sessionId} />}
      {tab === "resultats" && <ResultsTab sessionId={sessionId} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SupportsTab({ sessionId }: { sessionId: string }) {
  const ecueQuery = useTeacherSessionEcue(sessionId);
  const ecues: any[] = (ecueQuery.data as any[]) ?? [];
  const [selectedEcueId, setSelectedEcueId] = useState<string>("");

  useEffect(() => {
    if (!selectedEcueId && ecues.length > 0) setSelectedEcueId(ecues[0].id);
  }, [ecues]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ecueQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (ecues.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">
            Aucun ECUE n'est rattaché à l'UE de cette session.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Supports par ECUE</CardTitle>
          <CardDescription>
            Choisissez l'ECUE pour ajouter ou consulter ses supports de cours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-1.5">
            <label className="text-sm font-medium">ECUE</label>
            <Select value={selectedEcueId} onValueChange={setSelectedEcueId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un ECUE" />
              </SelectTrigger>
              <SelectContent>
                {ecues.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedEcueId && (
        <SubjectMaterialsPanel subjectId={selectedEcueId} canManage canViewStats />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EvaluationsTab({ sessionId }: { sessionId: string }) {
  const ecueQuery = useTeacherSessionEcue(sessionId);
  const ecues: any[] = (ecueQuery.data as any[]) ?? [];
  const [selectedEcueId, setSelectedEcueId] = useState<string>("");

  // Sélectionne le premier ECUE par défaut dès qu'ils sont chargés.
  useEffect(() => {
    if (!selectedEcueId && ecues.length > 0) setSelectedEcueId(ecues[0].id);
  }, [ecues]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ecueQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (ecues.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">
            Aucun ECUE n'est rattaché à l'UE de cette session.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Évaluations par ECUE</CardTitle>
          <CardDescription>
            Choisissez l'ECUE pour gérer ses devoirs, contrôles et corrections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-1.5">
            <label className="text-sm font-medium">ECUE</label>
            <Select value={selectedEcueId} onValueChange={setSelectedEcueId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un ECUE" />
              </SelectTrigger>
              <SelectContent>
                {ecues.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedEcueId && (
        <ProfessionalAssignmentsPanel
          subjectId={selectedEcueId}
          sessionId={sessionId}
          canManage
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ResultsTab({ sessionId }: { sessionId: string }) {
  const resultsQuery = useSessionResults(sessionId);
  const recomputeMut = useRecomputeSessionResults();
  const validateMut = useValidateEcueResult();
  const rows: any[] = resultsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Résultats ECUE & validation UV</CardTitle>
          <CardDescription>
            Moyennes par ECUE ; validation auto ≥ 10/20 ou manuelle.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          onClick={() => recomputeMut.mutateAsync(sessionId).then(() => resultsQuery.refetch())}
          disabled={recomputeMut.isPending}
        >
          {recomputeMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Recalculer
        </Button>
      </CardHeader>
      <CardContent>
        {resultsQuery.isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun résultat. Cliquez « Recalculer » après avoir noté les copies.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">Étudiant</th>
                  <th className="py-2 pr-3">ECUE</th>
                  <th className="py-2 pr-3">Moyenne</th>
                  <th className="py-2 pr-3">Validée</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {r.first_name} {r.last_name}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{r.ecue_code}</span> {r.ecue_libelle}
                    </td>
                    <td className="py-2 pr-3">{r.moyenne != null ? r.moyenne : "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={r.validee ? "text-green-700" : "text-amber-700"}>
                        {r.validee ? "Oui" : "Non"}
                        {r.validee_manuellement ? " (manuelle)" : ""}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          validateMut
                            .mutateAsync({ resultId: r.id, validee: !r.validee })
                            .then(() => resultsQuery.refetch())
                        }
                      >
                        {r.validee ? "Invalider" : "Valider"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
