"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Progress,
  Input,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  GraduationCap,
  Loader2,
  Layers,
  Search,
  Users,
  Award,
  CheckCircle2,
  Download,
  AlertCircle,
  Settings2,
  CalendarDays,
  ShieldCheck,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openDiplomeListePdf } from "@/lib/utils/diplome-report";
import {
  useCycleGroups,
  useEnsureCycleDiploma,
  useDiplomaCandidates,
  useAwardDiploma,
  fetchDiplomaAttestation,
} from "@/lib/hooks/use-professional-diplomas";
import { fetchStudent } from "@/lib/hooks/use-students";
import { fetchSignataires, indexSignataires } from "@/lib/hooks/use-professional-signataires";
import { openDiplomePdf, type DiplomePdfInput } from "@/lib/diplome-pdf";
import { openAttestationAuthenticitePdf } from "@/lib/attestation-authenticite-pdf";
import {
  academicYearFromDate,
  intituleDiplomeComplet,
  specialiteOf,
  anneeObtentionLabel,
} from "@/lib/diplome-format";

type StatutFilter = "tous" | "eligibles" | "obtenus";

const GRADE_ORDER = ["LICENCE", "MASTER"] as const;
const GRADE_LABEL: Record<string, string> = { LICENCE: "Licence", MASTER: "Master" };

export default function DiplomesPage() {
  const router = useRouter();
  const [grade, setGrade] = useState<string>(""); // "" = tous
  const [groupId, setGroupId] = useState("");
  const [statut, setStatut] = useState<StatutFilter>("tous");
  const [annee, setAnnee] = useState(""); // "" = toutes les années d'obtention
  const [search, setSearch] = useState("");
  const [diplomaId, setDiplomaId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groupsQuery = useCycleGroups();
  const groups: any[] = (groupsQuery.data as any[]) ?? [];
  const ensureMut = useEnsureCycleDiploma();
  const awardMut = useAwardDiploma();

  const candidatesQuery = useDiplomaCandidates(diplomaId);
  const candidates: any[] = (candidatesQuery.data as any[]) ?? [];

  const selectedGroup = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);

  // Cycles (grades) présents pour les onglets.
  const gradesPresents = useMemo(() => {
    const set = new Set(groups.map((g) => g.grade));
    return GRADE_ORDER.filter((g) => set.has(g));
  }, [groups]);

  // Options de cycle (spécialité) filtrées par grade.
  const groupOptions = useMemo(() => {
    return groups
      .filter((g) => !grade || g.grade === grade)
      .slice()
      .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle), "fr"))
      .map((g) => ({ value: g.id, label: g.libelle }));
  }, [groups, grade]);

  // Désélectionne le cycle s'il sort du grade filtré.
  useEffect(() => {
    if (groupId && !groupOptions.some((o) => o.value === groupId)) setGroupId("");
  }, [groupOptions, groupId]);

  // Prépare (crée/resynchronise) le diplôme du cycle sélectionné → id.
  useEffect(() => {
    if (!groupId) {
      setDiplomaId(null);
      return;
    }
    let cancelled = false;
    setDiplomaId(null);
    setError(null);
    ensureMut
      .mutateAsync(groupId)
      .then((d: any) => {
        if (!cancelled) setDiplomaId(d.id);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Erreur lors de la préparation du diplôme.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Années d'obtention disponibles parmi les diplômés (dérivées de la date d'octroi).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) {
      if (c.statut_octroi === "obtenu" && c.date_obtention) {
        const a = academicYearFromDate(c.date_obtention);
        if (a) set.add(a);
      }
    }
    const arr = [...set].sort((a, b) => b.localeCompare(a));
    return [{ value: "", label: "Toutes les années" }, ...arr.map((a) => ({ value: a, label: a }))];
  }, [candidates]);

  // Réinitialise le filtre année quand on change de cycle.
  useEffect(() => {
    setAnnee("");
  }, [groupId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      const obtenu = c.statut_octroi === "obtenu";
      if (statut === "eligibles" && !(c.eligible && !obtenu)) return false;
      if (statut === "obtenus" && !obtenu) return false;
      // Filtre par année d'obtention : ne concerne que les diplômés.
      if (annee) {
        if (!obtenu || !c.date_obtention || academicYearFromDate(c.date_obtention) !== annee)
          return false;
      }
      if (q) {
        const hay = `${c.nom_complet ?? ""} ${c.student_number ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, statut, annee, search]);

  const stats = useMemo(() => {
    const obtenu = candidates.filter((c) => c.statut_octroi === "obtenu").length;
    const eligible = candidates.filter((c) => c.statut_octroi !== "obtenu" && c.eligible).length;
    return { total: candidates.length, eligible, obtenu, shown: filtered.length };
  }, [candidates, filtered]);

  /** Périmètre exporté : le tableau tel qu'il est filtré à l'écran. */
  const exportContexte = useMemo(
    () => ({
      grade: grade ? (GRADE_LABEL[grade] ?? grade) : "Tous les cycles",
      cycle: selectedGroup?.libelle ?? "—",
      annees: (selectedGroup?.filieres ?? []).map((f: any) => f.code).join(", "),
      annee: annee || "Toutes les années",
      statut:
        statut === "eligibles"
          ? "Éligibles uniquement"
          : statut === "obtenus"
            ? "Diplômés uniquement"
            : "Tous les étudiants du cycle",
      recherche: search.trim() || undefined,
    }),
    [grade, selectedGroup, annee, statut, search]
  );

  /**
   * Génère le diplôme et l'ouvre dans un nouvel onglet du navigateur
   * (visionneuse PDF native : imprimer / télécharger). Onglet ouvert de façon
   * synchrone pour ne pas être bloqué, PDF injecté une fois prêt. Si l'étudiant
   * est éligible mais pas encore diplômé, le diplôme lui est octroyé
   * automatiquement au préalable (la génération l'exige côté serveur).
   */
  async function handleGenerate(c: any, kind: "diplome" | "authenticite" = "diplome") {
    if (!diplomaId || busyId) return;
    const studentId = c.student_id as string;
    const matricule = (c.student_number ?? null) as string | null;
    setError(null);
    setBusyId(`${kind}:${studentId}`);
    const win = window.open("", "_blank");
    if (!win) {
      // Le navigateur a bloqué l'ouverture du nouvel onglet (popup) : sans ce
      // check, le PDF serait généré pour rien puisqu'il n'y aurait nulle part
      // où l'afficher — et l'échec passerait inaperçu (pas d'exception ici).
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setBusyId(null);
      return;
    }
    try {
      // Octroi automatique si l'étudiant n'a pas encore le diplôme.
      if (c.statut_octroi !== "obtenu") {
        await awardMut.mutateAsync({ id: diplomaId, student_id: studentId, force: false });
        candidatesQuery.refetch();
      }
      const [attestation, student, signatairesList] = await Promise.all([
        fetchDiplomaAttestation(diplomaId, studentId) as Promise<any>,
        fetchStudent(studentId).catch(() => null) as Promise<any>,
        fetchSignataires().catch(() => []),
      ]);
      const sig = indexSignataires(signatairesList);
      const anneeAcademique =
        attestation.annee_academique ?? academicYearFromDate(attestation.date_obtention);

      if (kind === "authenticite") {
        const annee = anneeObtentionLabel(anneeAcademique, attestation.date_obtention);
        await openAttestationAuthenticitePdf(
          {
            reference: attestation.authenticite_reference,
            titulaire: attestation.etudiant.nom_complet,
            nature_document: "Diplôme",
            intitule: intituleDiplomeComplet(attestation.diplome.filiere_libelle),
            filiere:
              specialiteOf(attestation.diplome.filiere_libelle) ||
              attestation.diplome.filiere_libelle,
            annee_obtention: annee || academicYearFromDate(attestation.date_obtention),
            signataire: sig.authenticite ?? null,
          },
          win
        );
      } else {
        const input: DiplomePdfInput = {
          reference: attestation.reference,
          diplome: attestation.diplome,
          etudiant: {
            nom_complet: attestation.etudiant.nom_complet,
            matricule,
            date_naissance: student?.dateOfBirth ? String(student.dateOfBirth) : null,
            lieu_naissance: student?.placeOfBirth ?? null,
          },
          date_obtention: attestation.date_obtention,
          annee_academique: anneeAcademique,
          mention: attestation.mention ?? null,
          signataire_gauche: sig.diplome_gauche ?? null,
          signataire_droite: sig.diplome_droite ?? null,
        };
        await openDiplomePdf(input, win);
      }
    } catch (e: any) {
      if (win && !win.closed) win.close();
      setError(
        e?.message ??
          `Erreur lors de la génération de ${kind === "authenticite" ? "l'attestation d'authenticité" : "du diplôme"}.`
      );
    } finally {
      setBusyId(null);
    }
  }

  const preparing = !!groupId && !diplomaId && !error;

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      {/* En-tête */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-emerald-500" />
          Diplômes
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Le diplôme couvre tout le cycle : il est délivrable une fois que l'étudiant a validé
          toutes les UE de chaque année (toutes ses attestations de réussite) — les 3 années de
          Licence ou les 2 de Master d'une même spécialité.
        </p>
        {/* Export de la LISTE — le diplôme et son attestation d'authenticité,
            eux, se génèrent ligne par ligne dans le tableau. */}
        <div className="flex flex-wrap gap-2 mt-3">
          <ExportButtons
            formats={["pdf"]}
            disabled={!diplomaId || candidatesQuery.isLoading || filtered.length === 0}
            onExportPdf={(win) =>
              openDiplomeListePdf(filtered, exportContexte, academicYearFromDate, win)
            }
            onError={setError}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Barre de filtres */}
      <Card className="shadow-sm border-emerald-100">
        <CardContent className="p-4 space-y-4">
          {gradesPresents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill active={grade === ""} onClick={() => setGrade("")}>
                Tous les cycles
              </FilterPill>
              {gradesPresents.map((g) => (
                <FilterPill key={g} active={grade === g} onClick={() => setGrade(g)}>
                  {GRADE_LABEL[g] ?? g}
                </FilterPill>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Cycle (spécialité)
              </label>
              <SearchableSelect
                value={groupId}
                onChange={setGroupId}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={
                  groupsQuery.isLoading ? "Chargement…" : "Sélectionner un cycle (Licence ou Master)"
                }
                searchPlaceholder="Rechercher une spécialité…"
                options={groupOptions}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Année d'obtention
              </label>
              <SearchableSelect
                value={annee}
                onChange={setAnnee}
                icon={<CalendarDays className="h-4 w-4 text-gray-400" />}
                placeholder="Toutes les années"
                searchPlaceholder="Rechercher une année…"
                options={anneeOptions}
              />
            </div>
          </div>

          {/* La recherche occupe sa propre ligne, pleine largeur, sous les deux sélecteurs. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Rechercher un étudiant
            </label>
            <div className="relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom ou matricule…"
                className="pl-9"
                disabled={!diplomaId}
              />
            </div>
          </div>

          {diplomaId && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Afficher :</span>
              <FilterPill active={statut === "tous"} onClick={() => setStatut("tous")}>
                Tous les candidats
              </FilterPill>
              <FilterPill active={statut === "eligibles"} onClick={() => setStatut("eligibles")}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Éligibles
              </FilterPill>
              <FilterPill active={statut === "obtenus"} onClick={() => setStatut("obtenus")}>
                <Award className="h-3.5 w-3.5" />
                Diplômés
              </FilterPill>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistiques */}
      {diplomaId && !candidatesQuery.isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Candidats du cycle"
            value={stats.total}
            gradient="from-emerald-500 to-teal-600"
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Éligibles (non octroyés)"
            value={stats.eligible}
            gradient="from-blue-500 to-indigo-600"
          />
          <StatCard
            icon={<Award className="h-5 w-5" />}
            label="Diplômes obtenus"
            value={stats.obtenu}
            gradient="from-amber-500 to-orange-600"
          />
          <StatCard
            icon={<GraduationCap className="h-5 w-5" />}
            label="Résultats affichés"
            value={stats.shown}
            gradient="from-sky-500 to-cyan-600"
          />
        </div>
      )}

      {/* Contenu */}
      {!groupId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="rounded-full bg-emerald-50 p-4">
              <GraduationCap className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez un cycle (Licence ou Master) pour afficher ses candidats et générer leurs
              diplômes.
            </p>
          </CardContent>
        </Card>
      ) : preparing || candidatesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
        </div>
      ) : (
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-emerald-500" />
                  {selectedGroup?.libelle}
                </CardTitle>
                <CardDescription>
                  {selectedGroup?.filieres?.length ?? 0} année
                  {(selectedGroup?.filieres?.length ?? 0) > 1 ? "s" : ""} du cycle ·{" "}
                  {(selectedGroup?.filieres ?? [])
                    .map((f: any) => f.code)
                    .join(", ")}
                </CardDescription>
              </div>
              {diplomaId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/professionnel/admin/diplomes/${diplomaId}`)}
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  Gestion détaillée
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                Aucun étudiant ne correspond aux filtres sélectionnés.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b bg-muted/30">
                    <th className="px-4 py-3 whitespace-nowrap">Étudiant</th>
                    <th className="px-4 py-3 whitespace-nowrap">Matricule</th>
                    <th className="px-4 py-3 whitespace-nowrap">Année d'obtention</th>
                    <th className="px-4 py-3 text-center">Progression du cycle</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const obtenu = c.statut_octroi === "obtenu";
                    const revoque = c.statut_octroi === "revoque";
                    const busyGen = busyId === `diplome:${c.student_id}`;
                    const busyAuth = busyId === `authenticite:${c.student_id}`;
                    const canGenerate = obtenu || c.eligible;
                    const badge = obtenu
                      ? { label: "Diplômé", cls: "bg-green-100 text-green-700" }
                      : revoque
                        ? { label: "Révoqué", cls: "bg-red-100 text-red-700" }
                        : c.eligible
                          ? { label: "Éligible", cls: "bg-blue-100 text-blue-700" }
                          : { label: "En cours", cls: "bg-gray-100 text-gray-600" };
                    return (
                      <tr key={c.student_id} className="border-b last:border-0 hover:bg-emerald-50/40">
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{c.nom_complet}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {c.student_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {obtenu && c.date_obtention ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              <CalendarDays className="h-3 w-3" />
                              {academicYearFromDate(c.date_obtention) || "—"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <Progress value={c.pourcentage} className="h-2 flex-1" />
                            <span className="text-xs font-mono w-10 text-right">{c.pourcentage}%</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground text-center mt-0.5">
                            {c.uv_validees} UV validées
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                          >
                            {obtenu && <Award className="h-3.5 w-3.5" />}
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex justify-end items-center gap-1.5 flex-nowrap">
                            {revoque ? (
                              <span className="text-xs text-muted-foreground">Diplôme révoqué</span>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 whitespace-nowrap border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={busyAuth || !canGenerate}
                                  title={
                                    !canGenerate
                                      ? "Disponible une fois l'étudiant éligible (toutes les UE du cycle validées)."
                                      : "Générer l'attestation d'authenticité du diplôme."
                                  }
                                  onClick={() => handleGenerate(c, "authenticite")}
                                >
                                  {busyAuth ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                                  )}
                                  Authenticité
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-8 whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={busyGen || !canGenerate}
                                  title={
                                    !canGenerate
                                      ? "L'étudiant doit valider toutes les UE du cycle (toutes ses attestations) avant de pouvoir générer le diplôme."
                                      : undefined
                                  }
                                  onClick={() => handleGenerate(c, "diplome")}
                                >
                                  {busyGen ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                  )}
                                  Générer le diplôme
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* --------------------------- Sous-composants --------------------------- */

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-emerald-500 text-white shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  icon,
  label,
  value,
  gradient,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  gradient: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${gradient} shadow`}>
      <div className="flex items-center justify-between">
        <p className="text-white/80 text-xs font-medium">{label}</p>
        <span className="text-white/70">{icon}</span>
      </div>
      <p className="text-2xl sm:text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
