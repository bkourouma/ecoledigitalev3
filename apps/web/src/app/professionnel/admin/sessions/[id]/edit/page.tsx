"use client";

import { useEffect, useState } from "react";
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
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  useProfessionalUeSession,
  useProfessionalUeList,
  useUpdateProfessionalUeSession,
  useTransitionProfessionalUeSession,
  useSessionEcueTeachers,
  useSetSessionEcueTeacher,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useClassrooms } from "@/lib/hooks/use-classrooms";
import { useTeachers } from "@/lib/hooks/use-teachers";
import type { ProfessionalUeSessionStatut } from "@ecoledigitale/contracts";

/**
 * Édition d'une session professionnelle — Module Professionnel (feature 028, US1/US4).
 * Les affectations enseignant↔ECUE se modifient ici (ou à la création). La
 * capacité et la fenêtre d'inscription ne sont plus exposées.
 */

const LIST_URL = "/professionnel/admin/sessions";
const NONE = "none";
/**
 * Statuts proposés à la main. Une cohorte est ouverte, puis terminée : l'état
 * intermédiaire « En cours » n'est plus offert. Il reste affiché (voir
 * `STATUT_LABEL`) pour les cohortes qui le portent encore, et se clôture en
 * choisissant « Terminé ».
 */
const STATUTS: ProfessionalUeSessionStatut[] = ["brouillon", "ouvert", "termine", "annule"];

/** Libellés accentués des statuts de session. */
const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  complet: "Complet",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

function teacherLabel(t: any): string {
  const name = `${t.firstName ?? t.first_name ?? ""} ${t.lastName ?? t.last_name ?? ""}`.trim();
  return name || t.email || t.id;
}

interface SessionForm {
  libelle: string;
  date_debut: string;
  date_fin: string;
  classroom_id: string;
}

export default function EditProfessionalUeSessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = String(params?.id ?? "");

  const [form, setForm] = useState<SessionForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statut, setStatut] = useState<ProfessionalUeSessionStatut>("brouillon");
  const [statutMessage, setStatutMessage] = useState<string | null>(null);

  const sessionQuery = useProfessionalUeSession(sessionId || null);
  const subjectsQuery = useProfessionalUeList({});
  const classroomsQuery = useClassrooms({ limit: 100 } as any);
  const updateMut = useUpdateProfessionalUeSession();
  const transitionMut = useTransitionProfessionalUeSession();

  const session: any = sessionQuery.data;
  const subjects: any[] = subjectsQuery.data?.items ?? [];
  const classrooms: any[] = (classroomsQuery.data as any)?.data ?? [];

  useEffect(() => {
    if (session && !form) {
      setForm({
        libelle: session.libelle,
        date_debut: session.date_debut,
        date_fin: session.date_fin,
        classroom_id: session.classroom_id ?? NONE,
      });
      setStatut(session.statut);
    }
  }, [session, form]);

  const subject = subjects.find((s) => s.id === session?.ue_id);
  const subjectName = subject
    ? `${subject.code} — ${subject.libelle}`
    : session?.ue_id ?? "";

  function set(patch: Partial<SessionForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      await updateMut.mutateAsync({
        id: sessionId,
        data: {
          libelle: form.libelle,
          date_debut: form.date_debut,
          date_fin: form.date_fin,
          classroom_id: form.classroom_id !== NONE ? form.classroom_id : null,
        } as any,
      });
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  async function handleTransition() {
    setStatutMessage(null);
    try {
      await transitionMut.mutateAsync({ id: sessionId, statut });
      setStatutMessage("Statut mis à jour.");
    } catch (err: any) {
      setStatutMessage(err?.message ?? "Transition de statut refusée.");
    }
  }

  if (sessionQuery.isLoading || !form) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-3">Chargement de la classe…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Modifier l'ouverture de classe
          </h1>
          <p className="text-muted-foreground mt-2">{subjectName}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Formulaire */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de la classe</CardTitle>
            <CardDescription>La matière de rattachement n'est pas modifiable.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Matière</label>
                <Input value={subjectName} disabled />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Libellé</label>
                <Input
                  required
                  value={form.libelle}
                  onChange={(e) => set({ libelle: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Date de début</label>
                  <Input
                    type="date"
                    required
                    value={form.date_debut}
                    onChange={(e) => set({ date_debut: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Date de fin</label>
                  <Input
                    type="date"
                    required
                    value={form.date_fin}
                    onChange={(e) => set({ date_fin: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Salle</label>
                  <Select
                    value={form.classroom_id}
                    onValueChange={(v) => set({ classroom_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Salle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Aucune —</SelectItem>
                      {classrooms.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name ?? c.code ?? c.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(LIST_URL)}
                  disabled={updateMut.isPending}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={updateMut.isPending}>
                  {updateMut.isPending ? (
                    <span className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enregistrement…
                    </span>
                  ) : (
                    "Enregistrer"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Enseignants par ECUE (éditable) */}
        <EcueTeachersEditor sessionId={sessionId} />

        {/* Statut */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Statut de la classe</CardTitle>
            <CardDescription>
              Statut actuel :{" "}
              <strong>{STATUT_LABEL[session?.statut] ?? session?.statut}</strong>. Le passage
              à « Complet » est automatique (capacité atteinte).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {statutMessage && <div className="text-sm text-blue-700">{statutMessage}</div>}
            <div className="flex items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nouveau statut</label>
                <Select
                  value={statut}
                  onValueChange={(v) => setStatut(v as ProfessionalUeSessionStatut)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Statut" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUTS.map((st) => (
                      <SelectItem key={st} value={st}>
                        {STATUT_LABEL[st] ?? st}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={handleTransition}
                disabled={transitionMut.isPending}
              >
                Appliquer le statut
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Affectation enseignant ↔ ECUE (éditable) — sauvegarde immédiate par ligne. */
function EcueTeachersEditor({ sessionId }: { sessionId: string }) {
  const rowsQuery = useSessionEcueTeachers(sessionId);
  const teachersQuery = useTeachers({ limit: 100 });
  const setMut = useSetSessionEcueTeacher();
  const [error, setError] = useState<string | null>(null);

  const rows: any[] = (rowsQuery.data as any[]) ?? [];
  const teachers: any[] = (teachersQuery.data as any)?.data ?? [];
  const ECUE_NONE = "__none__";

  // La Conduite est une note de semestre : pas d'enseignant requis.
  const missingObligatoire = rows.filter(
    (r) => r.est_obligatoire && !r.enseignant_id && !r.is_conduite
  );

  async function assign(ecueId: string, value: string) {
    setError(null);
    try {
      await setMut.mutateAsync({
        ueSessionId: sessionId,
        ecue_id: ecueId,
        enseignant_id: value === ECUE_NONE ? null : value,
      });
      rowsQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'affectation.");
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Enseignants par ECUE</CardTitle>
        <CardDescription>
          Affectez un enseignant à chaque ECUE de l'UE. Chaque ECUE obligatoire doit avoir un
          enseignant pour que la classe puisse être ouverte.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {rowsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des ECUE…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun ECUE rattaché à l'UE de cette classe. Composez l'UE pour ajouter des ECUE.
          </p>
        ) : (
          <>
            {missingObligatoire.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <p>
                  {missingObligatoire.length} ECUE obligatoire(s) sans enseignant : la classe ne
                  pourra pas être ouverte tant qu'ils n'ont pas d'enseignant affecté.
                </p>
              </div>
            )}
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
                    // Conduite : note de semestre, jamais d'enseignant.
                    if (r.is_conduite) {
                      return (
                        <tr key={r.ecue_id} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <span className="font-mono text-xs">{r.ecue_code}</span> {r.ecue_libelle}
                          </td>
                          <td className="py-2 pr-3">{r.est_obligatoire ? "Oui" : "Non"}</td>
                          <td className="py-2 pr-3 text-muted-foreground italic">
                            Pas d'enseignant
                          </td>
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
                          <Select
                            value={r.enseignant_id ?? ECUE_NONE}
                            onValueChange={(v) => assign(r.ecue_id, v)}
                            disabled={setMut.isPending}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Non affecté" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ECUE_NONE}>— Non affecté —</SelectItem>
                              {teachers.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {teacherLabel(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
