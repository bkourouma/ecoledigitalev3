"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Hash,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  ProvenanceEnLot,
  emptyProvenanceLot,
  lotToEntrees,
  type ProvenanceLotState,
} from "@/components/prospection/ProvenanceEnLot";
import { useProfessionalUeSessionsList } from "@/lib/hooks/use-professional-catalog-admin";
import { useStudents } from "@/lib/hooks/use-students";
import { useAdminEnrollBulk } from "@/lib/hooks/use-professional-suivi";
import {
  useCommerciaux,
  useCreateCommercial,
  useSetProvenancesBulk,
} from "@/lib/hooks/use-prospection";

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

/**
 * « Conduite » est la seule matière transversale : elle est déclinée dans toutes
 * les filières et à tous les semestres, et ne s'inscrit pas ici. On l'écarte de
 * la liste des sessions, y compris pour les filières encore en cours.
 */
function isTransversale(s: any): boolean {
  return /^conduite\b/i.test(String(s.ue_libelle ?? s.libelle ?? "").trim());
}

/** Date du jour au format AAAA-MM-JJ, en heure locale (pas en UTC). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Session encore active : ni terminée ni annulée, et dont la date de fin n'est
 * pas dépassée. La date est testée en plus du statut car la finalisation
 * automatique (statut → « termine ») n'a lieu qu'au chargement de la liste des
 * sessions : le statut stocké peut être en retard. Même règle que la liste des
 * filières de la page Planning.
 */
function isSessionActive(s: any): boolean {
  const statut = String(s.statut ?? "");
  if (statut === "termine" || statut === "annule") return false;
  const fin = String(s.date_fin ?? "").slice(0, 10);
  return fin !== "" && fin >= todayISO();
}

const STUDENT_VISIBLE_CAP = 120;

export default function ProfessionalInscriptionsPage() {
  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 } as any);
  // Seuls les étudiants réellement inscriptibles sont proposés : ceux qui ont déjà
  // une inscription non annulée sur une session encore active sont écartés côté
  // API. Une session terminée ne bloque pas — l'étudiant réapparaît.
  const studentsQuery = useStudents({
    limit: 1000,
    withoutActiveProfessionalEnrollment: true,
  } as any);
  const bulkMut = useAdminEnrollBulk();
  const commerciauxQuery = useCommerciaux();
  const createCommercial = useCreateCommercial();
  const provenanceBulkMut = useSetProvenancesBulk();

  // Le référent « Un étudiant » se choisit parmi TOUS les étudiants : celui qui
  // parraine est presque toujours déjà inscrit, donc absent de la liste
  // ci-dessus (filtrée sur les inscriptibles).
  const tousLesEtudiantsQuery = useStudents({ limit: 1000 } as any);

  const sessions: any[] = (sessionsQuery.data as any)?.items ?? [];
  const students: any[] = (studentsQuery.data as any)?.data ?? [];

  // Sélection : « code de la classe|nom de la classe ». On inscrit dans un nom
  // de classe précis, pas dans une classe entière.
  const [nomKey, setNomKey] = useState("");
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceLotState>(emptyProvenanceLot());

  const nomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (isTransversale(s)) continue; // la Conduite ne s'inscrit pas ici
      if (!isSessionActive(s)) continue; // seulement si une session est encore active
      if (!s.filiere_code) continue;
      map.set(`${s.filiere_code}|${sessionGroupLabel(s)}`, sessionGroupLabel(s));
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [sessions]);

  const visibleSessions = useMemo(
    () =>
      nomKey === ""
        ? []
        : sessions
            .filter(
              (s) =>
                `${s.filiere_code}|${sessionGroupLabel(s)}` === nomKey &&
                !isTransversale(s)
            )
            .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle))),
    [sessions, nomKey]
  );

  /*
   * UE regroupées par SEMESTRE. Toutes les sessions visibles appartiennent déjà
   * au même nom de classe : le semestre est donc le seul découpage qui apporte
   * quelque chose ici — grouper par libellé de session ne donnait qu'un bloc.
   *
   * Une cohorte sans semestre rattaché atterrit dans un groupe à part, en fin
   * de liste, plutôt que d'être escamotée.
   */
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: any[] }>();
    for (const s of visibleSessions) {
      const key = s.semestre_id ?? "__sans_semestre";
      let g = groups.get(key);
      if (!g) {
        g = { label: s.semestre_libelle ?? "Hors semestre", items: [] };
        groups.set(key, g);
      }
      g.items.push(s);
    }
    return Array.from(groups.entries())
      .map(([key, g]) => ({
        key,
        label: g.label,
        items: g.items.sort((a, b) =>
          String(a.ue_libelle ?? a.libelle).localeCompare(String(b.ue_libelle ?? b.libelle), "fr")
        ),
      }))
      .sort((a, b) => {
        if (a.key === "__sans_semestre") return 1;
        if (b.key === "__sans_semestre") return -1;
        return a.label.localeCompare(b.label, "fr", { numeric: true });
      });
  }, [visibleSessions]);

  /*
   * Liste triée par ordre alphabétique du nom affiché. Le tri précède le
   * plafond d'affichage : sans lui, les 120 premiers seraient ceux que l'API a
   * renvoyés en premier, c'est-à-dire un échantillon arbitraire.
   *
   * `localeCompare` en français avec `sensitivity: "base"` range les accents et
   * les majuscules à leur place — « Émile » voisine « Emile » au lieu d'être
   * rejeté en fin de liste.
   */
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students
      .filter((s) => {
        if (!q) return true;
        const name = studentName(s).toLowerCase();
        const mat = String(s.studentNumber ?? s.establishmentMatricule ?? "").toLowerCase();
        return name.includes(q) || mat.includes(q);
      })
      .sort((a, b) =>
        studentName(a).localeCompare(studentName(b), "fr", {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [students, studentSearch]);

  const studentOptions = useMemo(
    () =>
      ((tousLesEtudiantsQuery.data as any)?.data ?? []).map((s: any) => ({
        id: s.id,
        nom: studentName(s),
      })),
    [tousLesEtudiantsQuery.data]
  );

  const selectionOptions = useMemo(
    () =>
      studentIds.map((id) => {
        const trouve = students.find((s) => s.id === id);
        return { id, nom: trouve ? studentName(trouve) : "Étudiant" };
      }),
    [studentIds, students]
  );

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const total = sessionIds.length * studentIds.length;

  async function handleSubmit() {
    setError(null);
    setResult(null);
    if (sessionIds.length === 0) return setError("Sélectionnez au moins une session.");
    if (studentIds.length === 0) return setError("Sélectionnez au moins un étudiant.");

    // La provenance est facultative, mais si elle est commencée elle doit être
    // complète : on le dit AVANT d'inscrire, pour ne pas laisser des
    // inscriptions créées derrière un formulaire en erreur.
    const lot = lotToEntrees(provenance, studentIds);
    if ("erreur" in lot) return setError(lot.erreur);

    try {
      const res: any = await bulkMut.mutateAsync({ ueSessionIds: sessionIds, studentIds });

      let provenanceResultat: any = null;
      if (lot.entrees.length > 0) {
        try {
          provenanceResultat = await provenanceBulkMut.mutateAsync(lot.entrees);
        } catch (err: any) {
          // Les inscriptions, elles, sont bien créées : on le signale sans les
          // faire passer pour un échec.
          provenanceResultat = {
            enregistrees: 0,
            erreurs: [{ student_id: "", message: err?.message ?? "Provenance non enregistrée." }],
          };
        }
      }

      setResult({ ...res, provenance: provenanceResultat });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement des inscriptions.");
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <UserPlus className="h-7 w-7 text-indigo-500" />
          Inscriptions
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
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
            {result.provenance && (
              <div className="text-sm">
                {result.provenance.enregistrees > 0 && (
                  <span className="text-green-700">
                    {result.provenance.enregistrees} provenance
                    {result.provenance.enregistrees > 1 ? "s" : ""} enregistrée
                    {result.provenance.enregistrees > 1 ? "s" : ""}
                  </span>
                )}
                {result.provenance.erreurs?.length > 0 && (
                  <span className="text-amber-700">
                    {result.provenance.enregistrees > 0 ? " · " : ""}
                    Provenance non enregistrée :{" "}
                    {result.provenance.erreurs
                      .slice(0, 2)
                      .map((e: any) => e.message)
                      .join(" · ")}
                  </span>
                )}
              </div>
            )}
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
            {result.matricules?.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Matricules de la classe
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
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-base">
              Nom de classe {sessionIds.length > 0 && `(${sessionIds.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Le select occupe toute la largeur : la sélection en masse se fait
                désormais semestre par semestre, dans l'en-tête de chaque groupe. */}
            <SearchableSelect
              value={nomKey}
              onChange={(v) => setNomKey(v)}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Sélectionner un nom de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              options={nomOptions}
            />
            <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
              {nomKey === "" ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Sélectionnez un nom de classe pour afficher ses sessions.
                </p>
              ) : sessionGroups.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {sessionsQuery.isLoading ? "Chargement…" : "Aucune session"}
                </p>
              ) : (
                sessionGroups.map((group) => {
                  const idsDuGroupe = group.items.map((s: any) => s.id);
                  const toutCoche = idsDuGroupe.every((id: string) => sessionIds.includes(id));
                  // Partiellement cochée : l'état indéterminé dit « une partie
                  // seulement », ce qu'une case à deux états ne sait pas montrer.
                  const partiel =
                    !toutCoche && idsDuGroupe.some((id: string) => sessionIds.includes(id));

                  return (
                  <div key={group.key}>
                    <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/80">
                      <input
                        type="checkbox"
                        checked={toutCoche}
                        ref={(el) => {
                          if (el) el.indeterminate = partiel;
                        }}
                        onChange={() =>
                          setSessionIds(
                            toutCoche
                              ? sessionIds.filter((id) => !idsDuGroupe.includes(id))
                              : [...new Set([...sessionIds, ...idsDuGroupe])]
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="shrink-0 font-normal normal-case">
                        {group.items.length} UE
                      </span>
                    </label>
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
                  );
                })
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
                  {studentsQuery.isLoading
                    ? "Chargement…"
                    : studentSearch.trim()
                      ? "Aucun étudiant ne correspond à cette recherche."
                      : "Aucun étudiant inscriptible : tous ont déjà une inscription en cours."}
                </p>
              ) : (
                <>
                  {filteredStudents.slice(0, STUDENT_VISIBLE_CAP).map((s) => {
                    const checked = studentIds.includes(s.id);
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

      {/* Provenance des étudiants sélectionnés */}
      <ProvenanceEnLot
        value={provenance}
        onChange={setProvenance}
        selection={selectionOptions}
        students={studentOptions}
        commerciaux={commerciauxQuery.data ?? []}
        onCreateCommercial={(nom, taux) =>
          createCommercial.mutateAsync({ nom, taux_commission: taux })
        }
      />

      {/* Retour d'enregistrement, AU NIVEAU DU BOUTON.
          Il vivait en haut de page, hors de l'ecran au moment du clic. Un
          defilement automatique vers le haut a d'abord servi de palliatif ;
          il a ete retire : une fois ce bloc place ici, il arrachait
          l'utilisateur a la confirmation qu'il venait de voir apparaitre. */}
      {(error || result) && (
        <div
          className={
            error
              ? "rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700"
              : "rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800"
          }
        >
          {error ? (
            error
          ) : (
            <>
              <span className="font-medium">
                {result.created} inscription{result.created > 1 ? "s" : ""} créée
                {result.created > 1 ? "s" : ""}
              </span>
              {result.skipped > 0
                ? ` · ${result.skipped} déjà inscrit${result.skipped > 1 ? "s" : ""} (ignoré${
                    result.skipped > 1 ? "s" : ""
                  })`
                : ""}
              {" — le détail figure en haut de page."}
            </>
          )}
        </div>
      )}

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
