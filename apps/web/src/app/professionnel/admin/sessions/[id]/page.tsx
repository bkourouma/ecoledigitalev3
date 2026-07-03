"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  Edit,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Users,
  UserCog,
  Info,
  CalendarDays,
  GraduationCap,
  ClipboardList,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import {
  useProfessionalUeSession,
  useProfessionalUeList,
  useProfessionalUeEcue,
  useProfessionalSeances,
  useCreateProfessionalSeance,
  useDeleteProfessionalSeance,
  useSeanceAttendance,
  useMarkSeanceAttendance,
  useSessionEcueTeachers,
  useSessionResults,
  useRecomputeSessionResults,
  useValidateEcueResult,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useTeachers } from "@/lib/hooks/use-teachers";
import { useClassrooms } from "@/lib/hooks/use-classrooms";
import { useAdminEnrollments, useAdminEnrollStudent } from "@/lib/hooks/use-professional-suivi";
import { useStudents } from "@/lib/hooks/use-students";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SessionEnrollmentsPanel } from "@/components/professional/SessionEnrollmentsPanel";
import { ProfessionalAssignmentsPanel } from "@/components/professional/ProfessionalAssignmentsPanel";

const LIST_URL = "/professionnel/admin/sessions";

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}
function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString("fr-FR");
}
function teacherLabel(t: any): string {
  const name = `${t.firstName ?? t.first_name ?? ""} ${t.lastName ?? t.last_name ?? ""}`.trim();
  return name || t.email || t.id;
}

const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  complet: "Complet",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

const ENROLLMENT_STATUT_LABEL: Record<string, string> = {
  en_attente_paiement: "En attente paiement",
  confirmee: "Confirmée",
  terminee: "Terminée",
  annulee: "Annulée",
};

const ATTENDANCE = ["present", "absent", "retard", "excuse"];

type Tab = "details" | "inscrits" | "enseignants" | "seances" | "evaluations" | "resultats";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

export default function ProfessionalSessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = String(params?.id ?? "");
  const [activeTab, setActiveTab] = useState<Tab>("details");

  const sessionQuery = useProfessionalUeSession(sessionId || null);
  const ueListQuery = useProfessionalUeList({});
  const teachersQuery = useTeachers({ limit: 100 });
  const classroomsQuery = useClassrooms({ limit: 100 } as any);

  const session: any = sessionQuery.data;
  const ues: any[] = ueListQuery.data?.items ?? [];
  const teachers: any[] = (teachersQuery.data as any)?.data ?? [];
  const classrooms: any[] = (classroomsQuery.data as any)?.data ?? [];

  const ue = useMemo(() => ues.find((u) => u.id === session?.ue_id), [ues, session?.ue_id]);

  if (sessionQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-3">Chargement de la session…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-3">
              {(sessionQuery.error as Error)?.message ?? "Session introuvable."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ueName = ue ? `${ue.code} — ${ue.libelle}` : session.ue_id;
  const teacher = teachers.find((t) => t.id === session.enseignant_id);
  const classroom = classrooms.find((c) => c.id === session.classroom_id);
  const places =
    session.capacite_max != null
      ? `${session.nb_inscriptions_actives ?? 0} / ${session.capacite_max}`
      : `${session.nb_inscriptions_actives ?? 0} (capacité illimitée)`;

  const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "details", label: "Détails", icon: Info },
    { id: "inscrits", label: "Inscrits", icon: Users },
    { id: "enseignants", label: "Enseignants", icon: UserCog },
    { id: "seances", label: "Séances & présence", icon: CalendarDays },
    { id: "evaluations", label: "Évaluations", icon: ClipboardList },
    { id: "resultats", label: "Résultats & UV", icon: GraduationCap },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
              {session.libelle}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">{ueName}</p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`${LIST_URL}/${sessionId}/edit`)}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Cette session fait partie d'un semestre : lien vers toutes ses UE. */}
      {session.semestre_id && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm text-indigo-900">
            Cette session fait partie du{" "}
            <span className="font-semibold">{session.semestre_libelle}</span>
            {session.filiere_nom ? (
              <>
                {" "}
                — {session.filiere_nom}
                {session.filiere_code ? ` (${session.filiere_code})` : ""}
              </>
            ) : null}
            . Pour voir toutes les UE du semestre :
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
            onClick={() =>
              router.push(`${LIST_URL}/semestre/${session.semestre_id}`)
            }
          >
            Voir toutes les UE du semestre
          </Button>
        </div>
      )}

      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
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

      {activeTab === "details" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de la session</CardTitle>
            <CardDescription>Occurrence datée et inscriptible d'une UE.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="UE" value={ueName} />
              <Field label="Libellé" value={session.libelle} />
              <Field label="Date de début" value={fmtDate(session.date_debut)} />
              <Field label="Date de fin" value={fmtDate(session.date_fin)} />
              <Field label="Salle" value={classroom ? classroom.name ?? classroom.code : session.classroom_id ?? null} />
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "inscrits" && <SessionEnrollmentsPanel sessionId={sessionId} />}
      {activeTab === "enseignants" && <EcueTeachersTab sessionId={sessionId} />}
      {activeTab === "seances" && <SeancesTab sessionId={sessionId} ueId={session.ue_id} />}
      {activeTab === "evaluations" && (
        <EvaluationsTab sessionId={sessionId} ueId={session.ue_id} />
      )}
      {activeTab === "resultats" && <ResultsTab sessionId={sessionId} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EvaluationsTab({ sessionId, ueId }: { sessionId: string; ueId: string }) {
  const ecueQuery = useProfessionalUeEcue(ueId || null);
  const ecues: any[] = (ecueQuery.data as any[]) ?? [];
  const [selectedEcueId, setSelectedEcueId] = useState<string>("");

  // Sélectionne le premier ECUE par défaut dès qu'ils sont chargés.
  useEffect(() => {
    if (!selectedEcueId && ecues.length > 0) setSelectedEcueId(ecues[0].ecue_id);
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
            Aucun ECUE n'est rattaché à l'UE de cette session. Composez l'UE pour ajouter des ECUE.
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
                  <SelectItem key={e.ecue_id} value={e.ecue_id}>
                    {e.ecue_code} — {e.ecue_libelle}
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

function EcueTeachersTab({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const rowsQuery = useSessionEcueTeachers(sessionId);
  const teachersQuery = useTeachers({ limit: 100 });

  const rows: any[] = (rowsQuery.data as any[]) ?? [];
  const teachers: any[] = (teachersQuery.data as any)?.data ?? [];

  // Index id → nom d'enseignant pour l'affichage en lecture seule.
  const teacherNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teachers) map[t.id] = teacherLabel(t);
    return map;
  }, [teachers]);

  // La Conduite est une note de semestre : pas d'enseignant requis.
  const missingObligatoire = rows.filter(
    (r) => r.est_obligatoire && !r.enseignant_id && !r.is_conduite
  );
  const missingOptional = rows.filter(
    (r) => !r.est_obligatoire && !r.enseignant_id && !r.is_conduite
  );

  if (rowsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <CardTitle>Enseignants par ECUE</CardTitle>
          <CardDescription>
            Enseignant affecté à chaque ECUE de l'UE (lecture seule). La modification se fait via
            « Modifier les affectations » ou à la création de la session.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => router.push(`${LIST_URL}/${sessionId}/edit`)}
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier les affectations
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bandeau de synthèse */}
        {rows.length > 0 &&
          (missingObligatoire.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {missingObligatoire.length} ECUE obligatoire(s) sans enseignant
                </p>
                <p>
                  La session <span className="font-medium">ne pourra pas être ouverte</span> tant
                  que chaque ECUE obligatoire n'a pas d'enseignant affecté.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <p>
                Tous les ECUE obligatoires ont un enseignant. La session peut être ouverte
                {missingOptional.length > 0
                  ? ` (${missingOptional.length} ECUE optionnel(s) encore sans enseignant).`
                  : "."}
              </p>
            </div>
          ))}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun ECUE rattaché à l'UE de cette session. Composez l'UE pour ajouter des ECUE.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">ECUE</th>
                  <th className="py-2 pr-3">Obligatoire</th>
                  <th className="py-2 pr-3 w-72">Enseignant</th>
                  <th className="py-2 pr-3">État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const unassigned = !r.enseignant_id;
                  if (r.is_conduite) {
                    return (
                      <tr key={r.ecue_id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-mono text-xs">{r.ecue_code}</span> {r.ecue_libelle}
                        </td>
                        <td className="py-2 pr-3">{r.est_obligatoire ? "Oui" : "Non"}</td>
                        <td className="py-2 pr-3 text-muted-foreground italic">Pas d'enseignant</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            Note de conduite (semestre)
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.ecue_id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{r.ecue_code}</span> {r.ecue_libelle}
                      </td>
                      <td className="py-2 pr-3">{r.est_obligatoire ? "Oui" : "Non"}</td>
                      <td className="py-2 pr-3">
                        {unassigned ? (
                          <span className="text-muted-foreground">— Non affecté —</span>
                        ) : (
                          teacherNameById[r.enseignant_id] ?? "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {unassigned ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.est_obligatoire
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Non affecté
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Affecté
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function SeancesTab({ sessionId, ueId }: { sessionId: string; ueId: string }) {
  const seancesQuery = useProfessionalSeances(sessionId);
  // Seuls les ECUE rattachés à l'UE de cette session peuvent recevoir une séance.
  const ecueQuery = useProfessionalUeEcue(ueId || null);
  const createMut = useCreateProfessionalSeance();
  const deleteMut = useDeleteProfessionalSeance();
  const [selectedSeance, setSelectedSeance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ecue_id: "", date: "", heure_debut: "", heure_fin: "", libelle: "" });

  const seances: any[] = seancesQuery.data ?? [];
  const ecueOptions: any[] = (ecueQuery.data as any[]) ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createMut.mutateAsync({
        ueSessionId: sessionId,
        data: {
          ecue_id: form.ecue_id,
          date: form.date,
          heure_debut: form.heure_debut || null,
          heure_fin: form.heure_fin || null,
          libelle: form.libelle || null,
        } as any,
      });
      setForm({ ecue_id: "", date: "", heure_debut: "", heure_fin: "", libelle: "" });
      seancesQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création de la séance.");
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Séances planifiées</CardTitle>
          <CardDescription>Créneaux par ECUE ; cliquez « Appel » pour la présence.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {seances.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune séance planifiée.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Horaire</th>
                    <th className="py-2 pr-3">ECUE</th>
                    <th className="py-2 pr-3">Libellé</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {seances.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{fmtDate(s.date)}</td>
                      <td className="py-2 pr-3">
                        {s.heure_debut ? `${s.heure_debut}${s.heure_fin ? `–${s.heure_fin}` : ""}` : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{s.ecue_code}</span> {s.ecue_libelle}
                      </td>
                      <td className="py-2 pr-3">{s.libelle ?? "—"}</td>
                      <td className="py-2 text-right space-x-2 whitespace-nowrap">
                        <Button variant="outline" size="sm" onClick={() => setSelectedSeance(s.id)}>
                          Appel
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteMut.mutateAsync(s.id).then(() => seancesQuery.refetch())}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={create} className="rounded-lg border p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-sm font-medium">ECUE</label>
              <Select value={form.ecue_id} onValueChange={(v) => setForm({ ...form, ecue_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une ECUE" />
                </SelectTrigger>
                <SelectContent>
                  {ecueOptions.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      Aucun ECUE rattaché à cette UE
                    </SelectItem>
                  ) : (
                    ecueOptions.map((e) => (
                      <SelectItem key={e.ecue_id} value={e.ecue_id}>
                        {e.ecue_code} — {e.ecue_libelle}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Début</label>
              <Input type="time" value={form.heure_debut} onChange={(e) => setForm({ ...form, heure_debut: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fin</label>
              <Input type="time" value={form.heure_fin} onChange={(e) => setForm({ ...form, heure_fin: e.target.value })} />
            </div>
            <div className="md:col-span-5 flex justify-end">
              <Button type="submit" disabled={createMut.isPending || !form.ecue_id || !form.date}>
                <Plus className="h-4 w-4 mr-2" />
                Planifier la séance
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {selectedSeance && <AttendanceEditor seanceId={selectedSeance} onClose={() => setSelectedSeance(null)} />}
    </div>
  );
}

function AttendanceEditor({ seanceId, onClose }: { seanceId: string; onClose: () => void }) {
  const query = useSeanceAttendance(seanceId);
  const markMut = useMarkSeanceAttendance();
  const [statuts, setStatuts] = useState<Record<string, string>>({});
  const data: any = query.data;
  const items: any[] = data?.items ?? [];

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const it of items) init[it.student_id] = it.attendance_statut ?? "present";
    setStatuts(init);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const entries = Object.entries(statuts).map(([student_id, statut]) => ({ student_id, statut }));
    await markMut.mutateAsync({ seanceId, data: { entries } as any });
    query.refetch();
  }

  return (
    <Card className="border-blue-300">
      <CardHeader>
        <CardTitle className="text-lg">Appel — {fmtDate(data?.seance?.date)}</CardTitle>
        <CardDescription>
          {data?.seance?.ecue_code} {data?.seance?.ecue_libelle}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun étudiant inscrit confirmé.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.student_id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {it.first_name} {it.last_name}
                </span>
                <Select
                  value={statuts[it.student_id] ?? "present"}
                  onValueChange={(v) => setStatuts((p) => ({ ...p, [it.student_id]: v }))}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={save} disabled={markMut.isPending || items.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Enregistrer l'appel
          </Button>
        </div>
      </CardContent>
    </Card>
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
            Moyennes par ECUE ; validation auto ≥ 10/20 ou manuelle. La validation de toutes les
            ECUE obligatoires octroie les UV de l'UE.
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
            Aucun résultat pour le moment. Cliquez « Recalculer » après avoir noté les copies.
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
