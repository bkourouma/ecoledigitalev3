"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
} from "@ecoledigitale/ui";
import {
  Layers,
  Search,
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
<<<<<<< HEAD
=======
  Hash,
>>>>>>> 030-pedagogie-ue-ecue
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProfessionalUeSessionsList } from "@/lib/hooks/use-professional-catalog-admin";
import { useStudents } from "@/lib/hooks/use-students";
<<<<<<< HEAD
import { useAdminEnrollBulk, useAllAdminEnrollments } from "@/lib/hooks/use-professional-suivi";
=======
import { useAdminEnrollBulk } from "@/lib/hooks/use-professional-suivi";
>>>>>>> 030-pedagogie-ue-ecue

/**
 * Inscriptions — Module Professionnel (admin).
 * Inscription en lot : sélection de plusieurs étudiants ET plusieurs sessions,
 * enregistrés en une fois (sans paiement).
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

function studentName(s: any): string {
  return `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || s.user?.email || "—";
}

/**
 * Libellé de « session » servant de regroupement : on retire le suffixe
 * « — <code UE> » du libellé pour n'afficher qu'une seule fois l'intitulé de la
 * session, les UE étant listées en dessous.
 */
function sessionGroupLabel(s: any): string {
  const lib = String(s.libelle ?? "").trim();
  const code = String(s.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return s.semestre_libelle ? String(s.semestre_libelle) : lib;
}

const STUDENT_VISIBLE_CAP = 120;

<<<<<<< HEAD
// Statuts de session considérés comme NON actifs (terminée / annulée) : une
// inscription sur une telle session ne « bloque » plus l'étudiant, qui peut
// donc réapparaître dans la liste.
const INACTIVE_SESSION_STATUTS = new Set(["termine", "annule"]);

export default function ProfessionalInscriptionsPage() {
  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 } as any);
  const studentsQuery = useStudents({ limit: 1000 } as any);
  const enrollmentsQuery = useAllAdminEnrollments();
=======
export default function ProfessionalInscriptionsPage() {
  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 } as any);
  const studentsQuery = useStudents({ limit: 1000 } as any);
>>>>>>> 030-pedagogie-ue-ecue
  const bulkMut = useAdminEnrollBulk();

  const sessions: any[] = (sessionsQuery.data as any)?.items ?? [];
  const students: any[] = (studentsQuery.data as any)?.data ?? [];
<<<<<<< HEAD
  const enrollments: any[] = (enrollmentsQuery.data as any)?.items ?? [];

  // Étudiants déjà inscrits dans une session ENCORE ACTIVE (inscription non
  // annulée + session ni terminée ni annulée) : ils sont masqués de la liste.
  // Dès que leurs sessions sont terminées, ils réapparaissent automatiquement.
  const blockedStudentIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of enrollments) {
      if (e.statut === "annulee") continue;
      if (INACTIVE_SESSION_STATUTS.has(String(e.session_statut))) continue;
      if (e.student_id != null) set.add(String(e.student_id));
    }
    return set;
  }, [enrollments]);
=======
>>>>>>> 030-pedagogie-ue-ecue

  const [filiere, setFiliere] = useState("");
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.filiere_code) {
        map.set(s.filiere_code, `${s.filiere_nom ?? s.filiere_code} (${s.filiere_code})`);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  const visibleSessions = useMemo(
    () =>
      filiere === ""
        ? []
        : sessions
            .filter((s) => s.filiere_code === filiere)
            .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle))),
    [sessions, filiere]
  );

  // Sessions regroupées par libellé de session (affiché une seule fois),
  // chaque groupe listant ses UE par intitulé (sans le code).
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const s of visibleSessions) {
      const key = sessionGroupLabel(s);
      const arr = groups.get(key);
      if (arr) arr.push(s);
      else groups.set(key, [s]);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [visibleSessions]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students.filter((s) => {
<<<<<<< HEAD
      // Masque les étudiants déjà inscrits dans une session encore active.
      if (blockedStudentIds.has(String(s.id))) return false;
=======
>>>>>>> 030-pedagogie-ue-ecue
      if (!q) return true;
      const name = studentName(s).toLowerCase();
      const mat = String(s.studentNumber ?? s.establishmentMatricule ?? "").toLowerCase();
      return name.includes(q) || mat.includes(q);
    });
<<<<<<< HEAD
  }, [students, studentSearch, blockedStudentIds]);
=======
  }, [students, studentSearch]);
>>>>>>> 030-pedagogie-ue-ecue

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const total = sessionIds.length * studentIds.length;

  async function handleSubmit() {
    setError(null);
    setResult(null);
    if (sessionIds.length === 0) return setError("Sélectionnez au moins une session.");
    if (studentIds.length === 0) return setError("Sélectionnez au moins un étudiant.");
    try {
      const res: any = await bulkMut.mutateAsync({ ueSessionIds: sessionIds, studentIds });
      setResult(res);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement des inscriptions.");
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <UserPlus className="h-7 w-7 text-indigo-500" />
          Inscriptions
        </h1>
        <p className="text-muted-foreground mt-2">
          Inscrivez un ou plusieurs étudiants dans une ou plusieurs sessions en une fois, même
          sans paiement.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Résultat */}
      {result && (
        <Card className="border-green-300">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle2 className="h-5 w-5" />
              {result.created} inscription{result.created > 1 ? "s" : ""} créée
              {result.created > 1 ? "s" : ""}
              {result.skipped > 0 && (
                <span className="text-amber-600 font-normal">
                  · {result.skipped} déjà inscrit{result.skipped > 1 ? "s" : ""} (ignoré
                  {result.skipped > 1 ? "s" : ""})
                </span>
              )}
            </div>
            {result.errors?.length > 0 && (
              <div className="text-sm text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {result.errors.length} échec(s) :{" "}
                  {result.errors
                    .slice(0, 3)
                    .map((e: any) => e.message)
                    .join(" · ")}
                  {result.errors.length > 3 ? "…" : ""}
                </span>
              </div>
            )}
<<<<<<< HEAD
=======
            {result.matricules?.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Matricules de la filière
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  {result.matricules.map((m: any) => (
                    <li key={m.student_id} className="flex items-center justify-between gap-3">
                      <span className="text-foreground truncate">
                        {`${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "—"}
                      </span>
                      <span className="font-mono font-semibold text-indigo-600 whitespace-nowrap">
                        {m.matricule}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
>>>>>>> 030-pedagogie-ue-ecue
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-base">
              Sessions {sessionIds.length > 0 && `(${sessionIds.length})`}
            </CardTitle>
            <CardDescription>Cochez une ou plusieurs sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={filiere}
                  onChange={(v) => setFiliere(v)}
                  icon={<Layers className="h-4 w-4 text-gray-400" />}
                  placeholder="Sélectionner une filière"
                  options={filiereOptions}
                />
              </div>
              <button
                type="button"
                className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
                onClick={() =>
                  setSessionIds(
                    sessionIds.length === visibleSessions.length
                      ? []
                      : visibleSessions.map((s) => s.id)
                  )
                }
              >
                {sessionIds.length === visibleSessions.length && visibleSessions.length > 0
                  ? "Tout décocher"
                  : "Tout cocher"}
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
              {filiere === "" ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Sélectionnez une filière pour afficher ses sessions.
                </p>
              ) : sessionGroups.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {sessionsQuery.isLoading ? "Chargement…" : "Aucune session"}
                </p>
              ) : (
                sessionGroups.map((group) => (
                  <div key={group.label}>
                    <div className="sticky top-0 z-10 bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="divide-y">
                      {group.items.map((s) => {
                        const checked = sessionIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-start gap-2 px-3 py-2 cursor-pointer text-sm ${
                              checked ? "bg-primary/15" : "hover:bg-accent"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggle(sessionIds, setSessionIds, s.id)}
                            />
                            <span>
                              <span className="font-medium">{s.ue_libelle ?? s.libelle}</span>
                              <span className="block text-xs text-muted-foreground">
                                Du {fmtDate(s.date_debut)} au {fmtDate(s.date_fin)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Étudiants */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-base">
              Étudiants {studentIds.length > 0 && `(${studentIds.length})`}
            </CardTitle>
            <CardDescription>
<<<<<<< HEAD
              Recherchez et cochez un ou plusieurs étudiants. Les étudiants déjà inscrits dans une
              session encore active sont masqués
              {blockedStudentIds.size > 0 ? ` (${blockedStudentIds.size} masqué${
                blockedStudentIds.size > 1 ? "s" : ""
              })` : ""}
              .
=======
              Recherchez et cochez un ou plusieurs étudiants. Tous les étudiants sont affichés.
>>>>>>> 030-pedagogie-ue-ecue
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Nom ou matricule…"
                  className="pl-9"
                />
              </div>
              {studentIds.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
                  onClick={() => setStudentIds([])}
                >
                  Tout désélectionner
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
              {filteredStudents.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {studentsQuery.isLoading ? "Chargement…" : "Aucun étudiant"}
                </p>
              ) : (
                <>
                  {filteredStudents.slice(0, STUDENT_VISIBLE_CAP).map((s) => {
                    const checked = studentIds.includes(s.id);
<<<<<<< HEAD
                    const mat = s.studentNumber || s.establishmentMatricule;
=======
>>>>>>> 030-pedagogie-ue-ecue
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
                          checked ? "bg-primary/15" : "hover:bg-accent"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(studentIds, setStudentIds, s.id)}
                        />
                        <span>
                          <span className="font-medium">{studentName(s)}</span>
<<<<<<< HEAD
                          {mat && <span className="text-muted-foreground"> — {mat}</span>}
=======
>>>>>>> 030-pedagogie-ue-ecue
                        </span>
                      </label>
                    );
                  })}
                  {filteredStudents.length > STUDENT_VISIBLE_CAP && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {filteredStudents.length - STUDENT_VISIBLE_CAP} de plus… affinez la recherche.
                    </p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barre de validation */}
      <Card className="shadow-lg">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm">
            <span className="font-medium text-foreground">{studentIds.length}</span> étudiant(s) ×{" "}
            <span className="font-medium text-foreground">{sessionIds.length}</span> session(s) ={" "}
            <span className="font-semibold text-indigo-600">{total}</span> inscription(s)
          </p>
          <Button
            onClick={handleSubmit}
            disabled={bulkMut.isPending || total === 0}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            {bulkMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-2" />
            )}
            Enregistrer les inscriptions
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
