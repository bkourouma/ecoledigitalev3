"use client";

import { useEffect, useMemo, useState } from "react";
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
  Award,
  Layers,
  Loader2,
  FileText,
  CheckCircle2,
  CalendarDays,
  Search,
  GraduationCap,
  Users,
  AlertCircle,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useNotesFilieres } from "@/lib/hooks/use-professional-bulletins";
import {
  useAttestationRoster,
  fetchFiliereAttestation,
} from "@/lib/hooks/use-professional-attestations";
import { fetchStudent } from "@/lib/hooks/use-students";
import { fetchSignataires, indexSignataires } from "@/lib/hooks/use-professional-signataires";
import { gradeOf, niveauOf } from "@/lib/bulletin-format";
import { academicYearFromDate, intituleObtention } from "@/lib/diplome-format";
import { openAttestationPdf, type AttestationPdfInput } from "@/lib/attestation-pdf";

type StatutFilter = "tous" | "eligibles";

/** Ordre d'affichage des cycles pour les onglets de filtre. */
const CYCLE_ORDER = ["LICENCE", "MASTER", "BTS", "DOCTORAT"] as const;
const CYCLE_LABEL: Record<string, string> = {
  LICENCE: "Licence",
  MASTER: "Master",
  BTS: "BTS",
  DOCTORAT: "Doctorat",
};

export default function AttestationsPage() {
  const [cycle, setCycle] = useState<string>(""); // "" = tous les cycles
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState(""); // "" = toutes les années
  const [statut, setStatut] = useState<StatutFilter>("tous");
  const [search, setSearch] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const filieresQuery = useNotesFilieres();
  const filieres: any[] = (filieresQuery.data as any[]) ?? [];

  const rosterQuery = useAttestationRoster(filiereId || null);
  const roster: any = rosterQuery.data ?? null;
  const students: any[] = roster?.students ?? [];
  const ueRequises: any[] = roster?.ue_requises ?? [];

  // Cycles présents parmi les filières (pour les onglets).
  const cyclesPresents = useMemo(() => {
    const set = new Set(filieres.map((f) => gradeOf(f.name)).filter((g) => g && g !== "—"));
    return CYCLE_ORDER.filter((c) => set.has(c));
  }, [filieres]);

  // Filières visibles selon le cycle sélectionné, triées par libellé.
  const filiereOptions = useMemo(() => {
    return filieres
      .filter((f) => !cycle || gradeOf(f.name) === cycle)
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"))
      .map((f) => ({ value: f.id, label: `${f.name}${f.code ? ` · ${f.code}` : ""}` }));
  }, [filieres, cycle]);

  // Si la filière sélectionnée sort du cycle filtré, on la désélectionne.
  useEffect(() => {
    if (filiereId && !filiereOptions.some((o) => o.value === filiereId)) {
      setFiliereId("");
    }
  }, [filiereOptions, filiereId]);

  // Années scolaires disponibles parmi les étudiants éligibles du roster.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if (s.annee_scolaire) set.add(s.annee_scolaire);
    const arr = [...set].sort((a, b) => b.localeCompare(a));
    return [{ value: "", label: "Toutes les années" }, ...arr.map((a) => ({ value: a, label: a }))];
  }, [students]);

  // Réinitialise le filtre année quand on change de filière.
  useEffect(() => {
    setAnnee("");
  }, [filiereId]);

  // Étudiants après application des filtres client (statut, année, recherche).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statut === "eligibles" && !s.eligible) return false;
      if (annee && s.annee_scolaire !== annee) return false;
      if (q) {
        const hay = `${s.nom_complet ?? ""} ${s.matricule ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [students, statut, annee, search]);

  const stats = useMemo(() => {
    const eligibleAll = students.filter((s) => s.eligible).length;
    const eligibleShown = filtered.filter((s) => s.eligible).length;
    return { total: students.length, eligibleAll, shown: filtered.length, eligibleShown };
  }, [students, filtered]);

  const diplomeLabel = roster?.filiere?.name ? intituleObtention(roster.filiere.name) : null;

  /**
   * Génère l'attestation et l'ouvre directement dans un nouvel onglet du
   * navigateur (visionneuse PDF native : boutons imprimer / télécharger). On
   * ouvre l'onglet de façon synchrone (au clic) pour ne pas être bloqué par le
   * bloqueur de pop-ups, puis on y injecte le PDF une fois généré.
   */
  async function handleGenerate(studentId: string, matricule: string | null) {
    if (!filiereId || generatingId) return;
    setGenError(null);
    setGeneratingId(studentId);
    const win = window.open("", "_blank");
    try {
      const [attestation, student, signataires] = await Promise.all([
        fetchFiliereAttestation(filiereId, studentId) as Promise<any>,
        fetchStudent(studentId).catch(() => null) as Promise<any>,
        fetchSignataires().catch(() => []),
      ]);
      const input: AttestationPdfInput = {
        reference: attestation.reference,
        diplome: attestation.diplome,
        etudiant: {
          nom_complet: attestation.etudiant.nom_complet,
          matricule: matricule ?? null,
          date_naissance: student?.dateOfBirth ? String(student.dateOfBirth) : null,
          lieu_naissance: student?.placeOfBirth ?? null,
        },
        date_obtention: attestation.date_obtention,
        annee_academique:
          attestation.annee_academique ?? academicYearFromDate(attestation.date_obtention),
        mention: attestation.mention ?? null,
        uv_total_validees: attestation.uv_total_validees,
        signataire: indexSignataires(signataires).attestation_reussite ?? null,
      };
      await openAttestationPdf(input, win);
    } catch (e: any) {
      if (win && !win.closed) win.close();
      setGenError(e?.message ?? "Erreur lors de la génération de l'attestation.");
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      {/* En-tête */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
          <Award className="h-7 w-7 text-amber-500" />
          Attestations de réussite
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Recherchez un étudiant par filière, année scolaire ou nom, puis générez son attestation.
          L'attestation est délivrable dès que l'étudiant a validé toutes les UE des semestres de sa
          filière — les années antérieures restent consultables.
        </p>
      </div>

      {genError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{genError}</AlertDescription>
        </Alert>
      )}

      {/* Barre de filtres */}
      <Card className="shadow-sm border-amber-100">
        <CardContent className="p-4 space-y-4">
          {/* Onglets de cycle */}
          {cyclesPresents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill active={cycle === ""} onClick={() => setCycle("")}>
                Tous les cycles
              </FilterPill>
              {cyclesPresents.map((c) => (
                <FilterPill key={c} active={cycle === c} onClick={() => setCycle(c)}>
                  {CYCLE_LABEL[c] ?? c}
                </FilterPill>
              ))}
            </div>
          )}

          {/* Sélecteurs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Filière</label>
              <SearchableSelect
                value={filiereId}
                onChange={setFiliereId}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={filieresQuery.isLoading ? "Chargement…" : "Sélectionner une filière"}
                searchPlaceholder="Rechercher une filière…"
                options={filiereOptions}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Année scolaire
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
                disabled={!filiereId}
              />
            </div>
          </div>

          {/* Filtre de statut */}
          {filiereId && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Afficher :</span>
              <FilterPill active={statut === "tous"} onClick={() => setStatut("tous")}>
                Tous les inscrits
              </FilterPill>
              <FilterPill active={statut === "eligibles"} onClick={() => setStatut("eligibles")}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Éligibles uniquement
              </FilterPill>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistiques */}
      {filiereId && !rosterQuery.isLoading && roster && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Étudiants inscrits"
            value={stats.total}
            gradient="from-amber-500 to-orange-600"
          />
          <StatCard
            icon={<Layers className="h-5 w-5" />}
            label="UE requises"
            value={ueRequises.length}
            gradient="from-indigo-500 to-purple-600"
          />
          <StatCard
            icon={<Award className="h-5 w-5" />}
            label="Attestations disponibles"
            value={stats.eligibleAll}
            gradient="from-green-500 to-emerald-600"
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
      {!filiereId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="rounded-full bg-amber-50 p-4">
              <Award className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière pour afficher ses étudiants inscrits et générer leurs
              attestations.
            </p>
          </CardContent>
        </Card>
      ) : rosterQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : ueRequises.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Cette filière n'a aucune UE rattachée à ses semestres. Composez d'abord ses semestres (
            <a href="/professionnel/admin/semestres" className="underline">
              Semestres
            </a>
            ) avant de pouvoir générer des attestations.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-amber-500" />
              {roster.filiere?.name}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {roster.filiere?.code}
              </span>
            </CardTitle>
            <CardDescription>
              {ueRequises.length} UE réparties sur les semestres ·{" "}
              {ueRequises.reduce((s: number, u: any) => s + u.nb_uv, 0)} UV au total
              {diplomeLabel && (
                <>
                  {" · Diplôme délivré : "}
                  <span className="font-medium text-foreground">{diplomeLabel}</span>
                </>
              )}
            </CardDescription>
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
                    <th className="px-4 py-3">Étudiant</th>
                    <th className="px-4 py-3">Matricule</th>
                    <th className="px-4 py-3">Année scolaire</th>
                    <th className="px-4 py-3 text-center">Crédits validés</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.student_id} className="border-b last:border-0 hover:bg-amber-50/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{s.nom_complet}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {niveauOf(roster.filiere?.name)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {s.matricule ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {s.annee_scolaire ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <CalendarDays className="h-3 w-3" />
                            {s.annee_scolaire}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <Progress value={s.pourcentage} className="h-2 flex-1" />
                          <span className="text-xs font-mono w-10 text-right">{s.pourcentage}%</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground text-center mt-0.5">
                          {s.uv_validees}/{s.uv_required} UV
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {s.eligible ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Validés
                          </span>
                        ) : (
                          <span
                            className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600"
                            title={
                              s.ue_manquantes?.length
                                ? `UE restantes : ${s.ue_manquantes.map((u: any) => u.code).join(", ")}`
                                : undefined
                            }
                          >
                            {s.ue_manquantes?.length ?? 0} UE restante
                            {(s.ue_manquantes?.length ?? 0) > 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {s.eligible ? (
                          <Button
                            size="sm"
                            className="h-8 bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:opacity-90"
                            onClick={() => handleGenerate(s.student_id, s.matricule ?? null)}
                            disabled={generatingId === s.student_id}
                          >
                            {generatingId === s.student_id ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Génération…
                              </>
                            ) : (
                              <>
                                <FileText className="h-3.5 w-3.5 mr-1.5" />
                                Générer
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
          ? "bg-amber-500 text-white shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
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
