"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  Layers,
  CalendarRange,
  Loader2,
  RotateCcw,
  ArrowLeft,
  History,
  Search,
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useRattrapageFilieres,
  useRattrapageSemestres,
  useSemestreRattrapages,
  useUpsertManualNote,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Rattrapages (Session 2) — Module Professionnel (admin / enseignant).
 *
 * Liste, pour un semestre, TOUS les étudiants ayant au moins une ECUE non
 * validée en Session 1 : ce sont exactement les lignes qui apparaissent en
 * rouge / ambre dans l'historique des notes. La note d'examen saisie ici est
 * enregistrée en Session 2 et remplace celle de Session 1 dans le calcul ; le
 * résultat de l'ECUE est recalculé immédiatement côté API.
 *
 * Conséquence directe : dès qu'une ECUE repasse à ≥ 10, elle disparaît de la
 * liste (et l'étudiant avec, s'il ne lui reste rien à rattraper), tandis que la
 * nouvelle note s'affiche dans
 * `/professionnel/admin/notes/historique` avec le badge « S2 ».
 *
 * La saisie de la Session 1 reste sur `/professionnel/admin/notes`, qui ne
 * traite plus du tout le rattrapage.
 *
 * Les deux sélecteurs ne proposent QUE ce qui a effectivement un rattrapage en
 * attente (API `/rattrapages/filieres` et `/rattrapages/semestres`) : pas de
 * filtre d'année, et aucun choix qui mènerait à un écran vide.
 */

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : Number(x).toFixed(2).replace(".", ",");
}

interface RattrapageRow {
  result_id: string;
  student_id: string;
  ecue_id: string;
  ue_session_id: string;
  session_statut: string | null;
  ue_code: string | null;
  ue_libelle: string | null;
  ecue_code: string | null;
  ecue_libelle: string | null;
  credits: number | null;
  moyenne: number | null;
  moyenne_devoirs: number | null;
  note_examen: number | null;
  eliminee: boolean | null;
  first_name: string;
  last_name: string;
  matricule: string | null;
  note_examen_s1: number | null;
  note_s2_id: string | null;
  note_examen_s2: number | null;
}

export default function RattrapagesPage() {
  const [filiereId, setFiliereId] = useState("");
  const [semestreId, setSemestreId] = useState("");
  // Libellés du choix courant : une filière (ou un semestre) sort de la liste
  // dès son dernier rattrapage validé, or l'utilisateur est encore dessus.
  const [filiereLabel, setFiliereLabel] = useState("");
  const [semestreLabel, setSemestreLabel] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filieresQuery = useRattrapageFilieres();
  const semestresQuery = useRattrapageSemestres(filiereId || null);
  const rattrapagesQuery = useSemestreRattrapages(semestreId || null);

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  const semestres: any[] = filiereId ? ((semestresQuery.data as any[]) ?? []) : [];

  /**
   * Options du sélecteur, en y réinjectant le choix courant s'il vient d'en
   * sortir : sans cela, valider le dernier rattrapage viderait le sélecteur
   * sous les doigts de l'utilisateur au moment précis où il finit sa saisie.
   */
  const filiereOptions = useMemo(() => {
    const opts = filieres.map((f) => ({
      value: f.id as string,
      label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
    }));
    if (filiereId && !opts.some((o) => o.value === filiereId) && filiereLabel) {
      opts.push({ value: filiereId, label: filiereLabel });
    }
    return opts;
  }, [filieres, filiereId, filiereLabel]);

  const semestreOptions = useMemo(() => {
    const opts = semestres.map((s) => ({
      value: s.id as string,
      label: `${s.libelle}${s.nb_rattrapages ? ` · ${s.nb_rattrapages}` : ""}`,
    }));
    if (semestreId && !opts.some((o) => o.value === semestreId) && semestreLabel) {
      opts.push({ value: semestreId, label: semestreLabel });
    }
    return opts;
  }, [semestres, semestreId, semestreLabel]);

  const rows: RattrapageRow[] = (rattrapagesQuery.data as RattrapageRow[]) ?? [];
  // Plus aucune filière concernée = plus rien à afficher, sélecteurs compris.
  // Conditionné à `isSuccess` : une requête en échec, en attente ou en pause
  // n'est pas une preuve qu'il n'y a rien à rattraper.
  const aucunRattrapage = filieresQuery.isSuccess && filiereOptions.length === 0;

  // Regroupement par étudiant : une carte par étudiant, ses ECUE à repasser.
  const groupes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = new Map<string, { student: RattrapageRow; rows: RattrapageRow[] }>();
    for (const r of rows) {
      if (q) {
        const hay = `${r.first_name} ${r.last_name} ${r.matricule ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const g = m.get(r.student_id);
      if (g) g.rows.push(r);
      else m.set(r.student_id, { student: r, rows: [r] });
    }
    return Array.from(m.values());
  }, [rows, search]);

  const nbEcues = groupes.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
            <RotateCcw className="h-7 w-7 text-amber-500" />
            Rattrapages — Session 2
          </h1>
          <p className="text-muted-foreground mt-2">
            Tous les étudiants ayant au moins une ECUE non validée en Session 1. La note d&apos;examen
            saisie ici remplace celle de Session 1 : dès que l&apos;ECUE repasse à 10/20, elle
            disparaît de cette liste.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/professionnel/admin/notes">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Saisie des notes
            </Button>
          </Link>
          <Link href="/professionnel/admin/notes/historique">
            <Button variant="outline">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Sélecteurs — filière puis semestre, restreints à ce qui a un rattrapage */}
      {!aucunRattrapage && (
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setFiliereLabel(filiereOptions.find((o) => o.value === v)?.label ?? "");
                setSemestreId("");
                setSemestreLabel("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={filieresQuery.isLoading ? "Chargement…" : "Filière"}
              searchPlaceholder="Rechercher une filière…"
              options={filiereOptions}
            />
            <SearchableSelect
              value={semestreId}
              onChange={(v) => {
                setSemestreId(v);
                setSemestreLabel(semestreOptions.find((o) => o.value === v)?.label ?? "");
              }}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={
                !filiereId
                  ? "Choisir une filière"
                  : semestresQuery.isError
                  ? "Erreur de chargement"
                  : semestresQuery.isSuccess && semestreOptions.length === 0
                  ? "Aucun semestre concerné"
                  : semestresQuery.isSuccess
                  ? "Semestre"
                  : "Chargement…"
              }
              searchPlaceholder="Rechercher un semestre…"
              options={semestreOptions}
            />
          </div>
          {semestreId && rows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
                <Users className="h-4 w-4" />
                {groupes.length} étudiant{groupes.length > 1 ? "s" : ""} en rattrapage
              </span>
              <span className="text-sm text-muted-foreground">
                · {nbEcues} ECUE à repasser
              </span>
              <div className="relative ml-auto w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un étudiant…"
                  className="pl-9"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Liste des rattrapages */}
      {filieresQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-red-50 p-4">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <p className="text-red-700 max-w-md">
              Impossible de charger les filières concernées :{" "}
              {(filieresQuery.error as any)?.message ?? "erreur inconnue"}
            </p>
            <Button variant="outline" onClick={() => filieresQuery.refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : aucunRattrapage ? (
        // Plus rien à rattraper nulle part : ni sélecteur, ni liste.
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-green-50 p-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Aucun rattrapage en attente : toutes les ECUE notées sont validées.
            </p>
          </CardContent>
        </Card>
      ) : !semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-amber-50 p-4">
              <RotateCcw className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière puis un semestre pour voir les étudiants concernés par la
              Session 2 (rattrapage).
            </p>
          </CardContent>
        </Card>
      ) : rattrapagesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : rattrapagesQuery.isError ? (
        // Sans ce cas, une requête en échec afficherait « aucun rattrapage »,
        // c'est-à-dire l'exact contraire d'une liste simplement non chargée.
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-red-50 p-4">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <p className="text-red-700 max-w-md">
              Impossible de charger les rattrapages :{" "}
              {(rattrapagesQuery.error as any)?.message ?? "erreur inconnue"}
            </p>
            <Button variant="outline" onClick={() => rattrapagesQuery.refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-green-50 p-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Aucun rattrapage sur ce semestre : toutes les ECUE notées sont validées.
            </p>
          </CardContent>
        </Card>
      ) : groupes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant ne correspond à « {search} ».
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupes.map((g) => (
            <Card key={g.student.student_id} className="shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <span className="font-semibold">
                  {g.student.first_name} {g.student.last_name}
                </span>
                {g.student.matricule && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {g.student.matricule}
                  </span>
                )}
                <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {g.rows.length} ECUE à rattraper
                </span>
              </div>
              <CardContent className="p-0 overflow-x-auto">
                <table className="min-w-full text-[15px] border-collapse">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">UE</th>
                      <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">ECUE</th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        Devoirs (/20)
                      </th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        Examen S1 (/20)
                      </th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        Note actuelle
                      </th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        Examen S2 (/20)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <RattrapageLine key={r.result_id} row={r} onError={setError} />
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {semestreId && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          La note saisie est enregistrée comme note d&apos;examen de{" "}
          <span className="font-medium">Session 2</span> : elle remplace celle de Session 1 dans le
          calcul de l&apos;ECUE. L&apos;étudiant sort de la liste dès que toutes ses ECUE sont
          validées, et la note apparaît alors avec le badge{" "}
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            S2
          </span>{" "}
          dans l&apos;
          <Link
            href="/professionnel/admin/notes/historique"
            className="font-medium underline underline-offset-2"
          >
            historique des notes
          </Link>
          . Une note &lt; 5/20 reste éliminatoire pour l&apos;UE.
        </p>
      )}
    </div>
  );
}

/**
 * Une ECUE à rattraper : rappel des notes de Session 1 + saisie de l'examen de
 * Session 2. L'API recalcule le résultat dans la foulée, donc la ligne
 * disparaît d'elle-même si la nouvelle note valide l'ECUE.
 */
function RattrapageLine({
  row,
  onError,
}: {
  row: RattrapageRow;
  onError: (m: string | null) => void;
}) {
  const [value, setValue] = useState(row.note_examen_s2 != null ? String(row.note_examen_s2) : "");
  const [saved, setSaved] = useState(false);
  const upsert = useUpsertManualNote();

  useEffect(() => {
    setValue(row.note_examen_s2 != null ? String(row.note_examen_s2) : "");
  }, [row.note_examen_s2]);

  async function save() {
    const raw = value.trim();
    if (raw === "") return;
    const v = parseFloat(raw.replace(",", "."));
    if (isNaN(v)) return;
    if (v < 0 || v > 20) {
      onError("La note de rattrapage doit être comprise entre 0 et 20.");
      return;
    }
    if (row.note_examen_s2 != null && Number(row.note_examen_s2) === v) return;
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId: row.ecue_id,
        student_id: row.student_id,
        ue_session_id: row.ue_session_id,
        nature: "examen",
        note: v,
        note_max: 20,
        session: 2,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement de la note de rattrapage.");
    }
  }

  return (
    <tr className="border-b border-border/60 align-middle hover:bg-muted/20">
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-xs opacity-70">{row.ue_code}</span> {row.ue_libelle}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-xs opacity-70">{row.ecue_code}</span> {row.ecue_libelle}
        {row.credits != null && (
          <span className="text-xs text-muted-foreground"> · {row.credits} cr.</span>
        )}
      </td>
      <td className="px-4 py-3 text-center font-mono whitespace-nowrap">
        {fmt(row.moyenne_devoirs)}
      </td>
      <td className="px-4 py-3 text-center font-mono whitespace-nowrap">
        {fmt(row.note_examen_s1 ?? (row.note_examen_s2 == null ? row.note_examen : null))}
      </td>
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <span
          className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${
            row.eliminee ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
          }`}
          title={row.eliminee ? "Éliminatoire (< 5/20)" : "Insuffisant (< 10/20)"}
        >
          {fmt(row.moyenne)}
        </span>
      </td>
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <div className="flex items-center justify-center gap-2">
          <Input
            type="number"
            min={0}
            max={20}
            step="0.25"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={save}
            placeholder="—"
            className="h-9 w-24"
            disabled={upsert.isPending}
          />
          {upsert.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          ) : saved ? (
            // La ligne n'est encore là que si l'ECUE reste non validée : la
            // « Note actuelle » ci-contre montre le nouveau calcul.
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-green-600"
              title="Note de rattrapage enregistrée et ECUE recalculée."
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Enregistré
            </span>
          ) : row.note_examen_s2 != null ? (
            <span
              className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700"
              title="Note de rattrapage enregistrée — elle remplace celle de Session 1."
            >
              S2
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
