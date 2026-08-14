"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  GraduationCap,
  Layers,
  CalendarRange,
  Loader2,
  RefreshCw,
  Eye,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Award,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProfessionalSemestres } from "@/lib/hooks/use-professional-semestres";
import {
  useNotesFilieres,
  useBulletinRoster,
  useRecomputeBulletins,
  useGenerateBulletins,
  fetchFullBulletins,
  fetchBulletin,
  fetchBulletinBts,
} from "@/lib/hooks/use-professional-bulletins";
import { openAllBulletinsPdf, openBulletinPdf } from "@/lib/bulletin-pdf";
import { openBulletinBtsPdf } from "@/lib/bulletin-pdf-bts";
import { isLicenceUnOuDeux } from "@/lib/bulletin-format";

const DECISION: Record<string, { label: string; cls: string; Icon: any }> = {
  admis: { label: "Admis", cls: "bg-green-100 text-green-700", Icon: CheckCircle2 },
  rattrapage: { label: "Rattrapage", cls: "bg-amber-100 text-amber-700", Icon: AlertTriangle },
  ajourne: { label: "Ajourné", cls: "bg-red-100 text-red-700", Icon: XCircle },
};

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : x.toFixed(2).replace(".", ",");
}

export default function BulletinsPage() {
  const [filiereId, setFiliereId] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [genInfo, setGenInfo] = useState<string | null>(null);
  const [openingAll, setOpeningAll] = useState(false);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [busyBtsStudentId, setBusyBtsStudentId] = useState<string | null>(null);
  const filieresQuery = useNotesFilieres();
  const semestresQuery = useProfessionalSemestres(filiereId ? { filiere_id: filiereId } : {});
  const rosterQuery = useBulletinRoster(semestreId || null);
  const recomputeMut = useRecomputeBulletins();
  const generateMut = useGenerateBulletins();

  // Filières restreintes à celles ayant au moins un étudiant inscrit
  // (confirmé/terminé) dans une session — même source que la page Notes.
  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any)?.data ?? (semestresQuery.data as any[]) ?? [];
    // Uniquement les semestres ayant au moins une session créée.
    return filiereId ? list.filter((s: any) => (s.nb_sessions ?? 0) > 0) : [];
  }, [semestresQuery.data, filiereId]);

  const roster: any = rosterQuery.data ?? null;
  const students: any[] = roster?.students ?? [];

  // Bulletin BTS : réservé aux filières Licence 1 et Licence 2.
  const selectedFiliere = filieres.find((f) => f.id === filiereId);
  const isBtsEligible = isLicenceUnOuDeux(selectedFiliere?.name);

  // Étudiants dont la décision n'est pas arrêtée : ni bulletin consultable, ni
  // bulletin généré, tant que le rattrapage n'a pas été saisi.
  const nbSession2 = students.filter((s) => s.statut_etudiant === "session2").length;

  const stats = useMemo(() => {
    const admis = students.filter((s) => s.decision === "admis").length;
    const rattr = students.filter((s) => s.decision === "rattrapage").length;
    const ajour = students.filter((s) => s.decision === "ajourne").length;
    return { total: students.length, admis, rattr, ajour };
  }, [students]);

  async function handleRecompute() {
    if (!semestreId) return;
    setError(null);
    try {
      await recomputeMut.mutateAsync(semestreId);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors du recalcul.");
    }
  }

  async function handleGenerate() {
    if (!semestreId) return;
    setError(null);
    setGenInfo(null);
    try {
      const r: any = await generateMut.mutateAsync(semestreId);
      const ignores = Number(r.ignores ?? 0);
      setGenInfo(
        `${r.generated} bulletin(s) généré(s) — ${r.definitifs} définitif(s), ${r.provisoires} provisoire(s).` +
          (ignores > 0
            ? ` ${ignores} étudiant(s) en attente de Session 2 non généré(s) : leur décision n'est pas arrêtée.`
            : "")
      );
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la génération des bulletins.");
    }
  }

  // Ouvre le PDF combiné de tous les bulletins du semestre dans le navigateur.
  async function handleOpenAll() {
    if (!semestreId) return;
    setError(null);
    // Onglet ouvert de façon synchrone (évite le blocage popup après le fetch).
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) {
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      return;
    }
    setOpeningAll(true);
    try {
      const list = await fetchFullBulletins(semestreId);
      if (!list || list.length === 0) {
        win?.close();
        setError(
          nbSession2 > 0
            ? "Aucun bulletin à ouvrir : les étudiants en attente de Session 2 en sont exclus tant que leur décision n'est pas arrêtée."
            : "Aucun bulletin à ouvrir pour ce semestre."
        );
        return;
      }
      await openAllBulletinsPdf(list, win);
    } catch (err: any) {
      win?.close();
      setError(err?.message ?? "Impossible d'ouvrir les bulletins.");
    } finally {
      setOpeningAll(false);
    }
  }

  /**
   * Ouvre le relevé de notes d'un étudiant comme document PDF dans un nouvel
   * onglet du navigateur (visionneuse native), à l'identique de la page
   * Diplômes — plus de page applicative intermédiaire.
   */
  async function handleConsulter(studentId: string) {
    if (!semestreId || busyStudentId) return;
    setError(null);
    setBusyStudentId(studentId);
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) {
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setBusyStudentId(null);
      return;
    }
    try {
      const bulletin = await fetchBulletin(semestreId, studentId);
      await openBulletinPdf(bulletin, win);
    } catch (err: any) {
      win?.close();
      setError(err?.message ?? "Impossible d'ouvrir le bulletin.");
    } finally {
      setBusyStudentId(null);
    }
  }

  /** Ouvre le bulletin de style BTS d'un étudiant (Licence 1/2 uniquement). */
  async function handleConsulterBts(studentId: string) {
    if (!semestreId || busyBtsStudentId) return;
    setError(null);
    setBusyBtsStudentId(studentId);
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) {
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setBusyBtsStudentId(null);
      return;
    }
    try {
      const data = await fetchBulletinBts(semestreId, studentId);
      await openBulletinBtsPdf(data, win);
    } catch (err: any) {
      win?.close();
      setError(err?.message ?? "Impossible d'ouvrir le bulletin BTS.");
    } finally {
      setBusyBtsStudentId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-indigo-500" />
            Bulletins & moyennes
          </h1>
          <p className="text-muted-foreground mt-2">
            Sélectionnez une filière et un semestre pour consulter les bulletins des étudiants.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/professionnel/admin/bulletins/historique">
            <Button variant="outline">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Historique
            </Button>
          </Link>
          <Button
            onClick={handleOpenAll}
            disabled={!semestreId || openingAll}
            variant="outline"
            title={!semestreId ? "Sélectionnez une filière et un semestre" : undefined}
          >
            {openingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 mr-2" />
            )}
            Tous les bulletins
          </Button>
          <Link href="/professionnel/admin/notes">
            <Button variant="outline">
              <GraduationCap className="h-4 w-4 mr-2" />
              Saisie des notes
            </Button>
          </Link>
          <Button
            onClick={handleRecompute}
            disabled={!semestreId || recomputeMut.isPending}
            variant="outline"
          >
            {recomputeMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Recalculer
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!semestreId || generateMut.isPending}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            {generateMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 mr-2" />
            )}
            Générer les bulletins
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {genInfo && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-700">
          {genInfo}
        </div>
      )}

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={filieresQuery.isLoading ? "Chargement…" : "Sélectionner une filière"}
              searchPlaceholder="Rechercher une filière…"
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
          </div>
          <div className="lg:w-72">
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={
                !filiereId
                  ? "Choisir d'abord une filière"
                  : semestresQuery.isLoading
                  ? "Chargement…"
                  : semestres.length === 0
                  ? "Aucun semestre"
                  : "Sélectionner un semestre"
              }
              options={semestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {semestreId && !rosterQuery.isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Étudiants" value={stats.total} color="from-indigo-500 to-blue-600" />
          <StatCard label="Admis" value={stats.admis} color="from-green-500 to-emerald-600" />
          <StatCard label="Rattrapage" value={stats.rattr} color="from-amber-500 to-orange-600" />
          <StatCard label="Ajournés" value={stats.ajour} color="from-red-500 to-rose-600" />
        </div>
      )}

      {/* Tableau */}
      {!semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <FileSpreadsheet className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière puis un semestre pour afficher la liste des bulletins.
            </p>
          </CardContent>
        </Card>
      ) : rosterQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant inscrit sur ce semestre.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Étudiant</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Matricule</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">Moyenne</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">Crédits</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">Décision</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">Statut bulletin</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">Généré le</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-right">Bulletin</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const dec = DECISION[s.decision] ?? DECISION.ajourne;
                  const Icon = dec.Icon;
                  return (
                    <tr key={s.student_id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 whitespace-nowrap font-medium">
                        {s.first_name} {s.last_name}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {s.matricule ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center font-mono font-semibold">
                        {fmt(s.moyenne_session)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center font-mono">
                        {s.credits_valides}/{s.credits_total}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${dec.cls}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {dec.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center">
                        {(() => {
                          // Statut LMD : validé / non validé — session 2 / en dette.
                          const st = s.statut_etudiant;
                          const cls =
                            st === "valide"
                              ? "bg-green-100 text-green-700"
                              : st === "session2"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700";
                          const label =
                            st === "valide"
                              ? "Validé"
                              : st === "session2"
                              ? "Non validé — Session 2"
                              : "En dette";
                          return (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">
                        {s.generated_at
                          ? new Date(s.generated_at).toLocaleDateString("fr-FR")
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        {s.statut_etudiant === "session2" ? (
                          // Décision non arrêtée : aucun bulletin n'est encore
                          // consultable ni généré (l'API refuse également).
                          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            <span>En attente de Session 2</span>
                            <Link
                              href="/professionnel/admin/notes/rattrapages"
                              className="font-medium text-amber-700 underline underline-offset-2"
                              title="Saisir la note de rattrapage pour arrêter la décision"
                            >
                              Rattrapages
                            </Link>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={busyStudentId === s.student_id}
                              onClick={() => handleConsulter(s.student_id)}
                            >
                              {busyStudentId === s.student_id ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <Eye className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              Consulter
                            </Button>
                            {isBtsEligible && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={busyBtsStudentId === s.student_id}
                                onClick={() => handleConsulterBts(s.student_id)}
                                title="Bulletin de style BTS"
                              >
                                {busyBtsStudentId === s.student_id ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                ) : (
                                  <Award className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                Bulletin BTS
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
