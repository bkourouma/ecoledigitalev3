"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  Star,
  Layers,
  CalendarRange,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Search,
  GraduationCap,
  Clock,
  UserRound,
  CheckCircle2,
  PlayCircle,
  ClipboardList,
  Trash2,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useConduiteFilieres,
  useConduiteSemestres,
  usePresencesHistory,
  useSemestreConduite,
  useUpsertManualNote,
  useDeleteManualNote,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Saisie des conduites — Module Professionnel (admin).
 *
 * Reprend le « Récapitulatif par étudiant » de la page Présences (pointages,
 * absences, heures, taux) et y ajoute une colonne de saisie : la note de
 * conduite du semestre, /20, enregistrée automatiquement dès que le curseur
 * quitte le champ.
 *
 * Filières et semestres proposés (voir `listConduiteSemestres` côté API) :
 * ceux qui ont encore une cohorte active, OU dont au moins une conduite reste
 * à saisir — un semestre terminé ne disparaît qu'une fois toutes ses conduites
 * enregistrées. Un semestre sans aucune session n'est jamais proposé, et une
 * filière dont aucun semestre n'est retenu n'apparaît pas du tout.
 *
 * La note est portée par l'ECUE « Conduite » du semestre (une note unique par
 * étudiant, nature « examen ») : c'est elle qui s'affiche, en lecture seule,
 * dans la colonne « Conduite (/20) » de la page Notes.
 */

/** 4.5 → « 4h30 » ; 2 → « 2h » ; 0 → « 0h ». */
function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

export default function AdminConduitePage() {
  const [filiereId, setFiliereId] = useState("");
  const [semestreId, setSemestreId] = useState("");
  // Libellés mémorisés : une fois la dernière conduite saisie, la filière et le
  // semestre sortent des listes de l'API. On garde leur nom affiché plutôt que
  // de vider l'écran sous les yeux de l'utilisateur.
  const [filiereLabel, setFiliereLabel] = useState("");
  const [semestreLabel, setSemestreLabel] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filières et semestres « à finaliser » : restriction faite côté API, d'où
  // l'absence de filtre par année scolaire ou par statut de session ici.
  const filieresQuery = useConduiteFilieres();
  const semestresQuery = useConduiteSemestres(filiereId || null);
  // Récapitulatif de présence de TOUT le semestre : un semestre retenu peut
  // n'avoir que des sessions terminées, dont les pointages restent la base du
  // jugement de conduite.
  const historyQuery = usePresencesHistory({
    filiereId: filiereId || null,
    semestreId: semestreId || undefined,
  });
  const conduiteQuery = useSemestreConduite(semestreId || null);

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];

  const visibleSemestres: any[] = useMemo(
    () => (filiereId ? ((semestresQuery.data as any[]) ?? []) : []),
    [semestresQuery.data, filiereId]
  );

  /** Options d'un select, en y réinjectant la sélection courante si l'API ne la renvoie plus. */
  function withSelection(
    options: { value: string; label: string }[],
    value: string,
    label: string
  ) {
    if (!value || options.some((o) => o.value === value)) return options;
    return [...options, { value, label: label || "Sélection en cours" }];
  }

  const filiereOptions = withSelection(
    filieres.map((f) => ({
      value: f.id,
      label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
    })),
    filiereId,
    filiereLabel
  );
  const semestreOptions = withSelection(
    visibleSemestres.map((s) => ({ value: s.id, label: s.libelle })),
    semestreId,
    semestreLabel
  );

  // Conduites restant à saisir sur le semestre, d'après l'API (sert au bandeau).
  const semestreRow = visibleSemestres.find((s) => s.id === semestreId) ?? null;

  const conduite: any = (conduiteQuery.data as any)?.conduite ?? null;
  const conduiteStudents: any[] = (conduiteQuery.data as any)?.students ?? [];
  const presenceStudents: any[] = (historyQuery.data as any)?.students ?? [];

  const presenceByStudent = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of presenceStudents) m.set(s.student_id, s);
    return m;
  }, [presenceStudents]);

  /**
   * Cohorte du semestre (source : conduite) enrichie du récapitulatif de
   * présence des sessions en cours. Un étudiant sans pointage reste listé,
   * avec des compteurs à zéro : il doit quand même recevoir une conduite.
   */
  const rows = useMemo(
    () =>
      conduiteStudents.map((s) => {
        const p = presenceByStudent.get(s.student_id);
        const nbAppels = Number(p?.nb_appels ?? 0);
        const nbPresent = Number(p?.nb_present ?? 0);
        return {
          ...s,
          nb_appels: nbAppels,
          nb_present: nbPresent,
          nb_absent: Number(p?.nb_absent ?? 0),
          nb_retard: Number(p?.nb_retard ?? 0),
          nb_excuse: Number(p?.nb_excuse ?? 0),
          heures_absence: Number(p?.heures_absence ?? 0),
          heures_excusees: Number(p?.heures_excusees ?? 0),
          taux: nbAppels > 0 ? Math.round((nbPresent / nbAppels) * 100) : null,
        };
      }),
    [conduiteStudents, presenceByStudent]
  );

  const q = search.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      q
        ? rows.filter((s) =>
            `${s.first_name} ${s.last_name} ${s.matricule ?? ""}`.toLowerCase().includes(q)
          )
        : rows,
    [rows, q]
  );

  const stats = useMemo(() => {
    const saisies = rows.filter((s) => s.note != null);
    const somme = saisies.reduce((a, s) => a + Number(s.note), 0);
    return {
      total: rows.length,
      saisies: saisies.length,
      manquantes: rows.length - saisies.length,
      moyenne: saisies.length > 0 ? somme / saisies.length : null,
    };
  }, [rows]);

  const loading = conduiteQuery.isLoading || historyQuery.isLoading;

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
            <Star className="h-7 w-7 text-amber-500" />
            Saisie des conduites
          </h1>
          <p className="text-muted-foreground mt-2">
            Une note de conduite /20 par étudiant et par semestre, attribuée au vu des présences
            des sessions en cours. La saisie est enregistrée dès que le curseur quitte le champ.
          </p>
        </div>
        <Link href="/professionnel/admin/notes">
          <Button variant="outline">
            <ClipboardList className="h-4 w-4 mr-2" />
            Notes
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filtres — filière puis semestre, restreints aux conduites à finaliser */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
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
              placeholder={
                filieresQuery.isLoading
                  ? "Chargement…"
                  : filiereOptions.length === 0
                  ? "Aucune filière à finaliser"
                  : "Filière"
              }
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
                  : semestresQuery.isLoading
                  ? "Chargement…"
                  : semestreOptions.length === 0
                  ? "Aucun semestre à finaliser"
                  : "Semestre"
              }
              searchPlaceholder="Rechercher un semestre…"
              options={semestreOptions}
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PlayCircle className="h-3.5 w-3.5 text-emerald-500" />
            Sont proposés les semestres encore en cours et ceux dont il reste au moins une conduite
            à saisir, même sessions terminées. Un semestre sans session créée n'apparaît pas.
          </p>
        </CardContent>
      </Card>

      {/* Contenu */}
      {!filiereId || !semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-amber-50 p-4">
              <GraduationCap className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              {filiereId && !semestresQuery.isLoading && semestreOptions.length === 0
                ? "Rien à finaliser pour cette filière : ses semestres sont terminés et toutes les conduites sont saisies."
                : "Choisissez une filière puis un semestre pour saisir les notes de conduite."}
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : conduiteQuery.isError || historyQuery.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(conduiteQuery.error as Error)?.message ??
                (historyQuery.error as Error)?.message ??
                "Impossible de charger les données de conduite."}
            </p>
          </CardContent>
        </Card>
      ) : !conduite ? (
        <Card className="border-amber-200">
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-amber-50 p-4">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Ce semestre n'a pas d'UE « Conduite » : impossible d'y rattacher une note. Ajoutez
              l'UE de conduite au semestre, puis revenez sur cette page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* État du semestre : en cours, ou terminé mais restant à finaliser. */}
          {semestreRow && Number(semestreRow.nb_sessions_actives ?? 0) === 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Sessions terminées pour ce semestre — il reste affiché tant que toutes les
                conduites ne sont pas saisies. Le récapitulatif porte sur l'ensemble de ses séances.
              </span>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Étudiants"
              value={stats.total}
              hint="cohorte du semestre"
              color="from-indigo-500 to-blue-600"
            />
            <StatCard
              label="Conduites saisies"
              value={`${stats.saisies}/${stats.total}`}
              hint="notes déjà enregistrées"
              color="from-emerald-500 to-green-600"
            />
            <StatCard
              label="Manquantes"
              value={stats.manquantes}
              hint="à saisir avant le calcul"
              color="from-red-500 to-rose-600"
            />
            <StatCard
              label="Moyenne conduite"
              value={stats.moyenne == null ? "—" : stats.moyenne.toFixed(2).replace(".", ",")}
              hint="sur les notes saisies"
              color="from-amber-500 to-orange-600"
            />
          </div>

          {/* Recherche */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant…"
              className="pl-9"
            />
          </div>

          {/* Récapitulatif par étudiant + saisie de la conduite */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <UserRound className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="font-semibold">Récapitulatif par étudiant</span>
              <span className="text-xs text-muted-foreground">
                · heures d'absence calculées sur la durée réelle des séances · saisie enregistrée
                à la sortie du champ
              </span>
            </div>
            <CardContent className="p-0 overflow-auto max-h-[70vh]">
              {filteredRows.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucun étudiant inscrit pour cette sélection.
                </p>
              ) : (
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Étudiant</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Pointages</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Présent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Absent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Retard</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Excusé</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">
                        Heures d'absence
                      </th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium text-right">
                        Taux de présence
                      </th>
                      <th className="sticky top-0 z-10 bg-amber-500/20 px-4 py-3 font-medium text-center border-l border-border whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-4 w-4 text-amber-500" /> Conduite (/20)
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((s) => (
                      <tr
                        key={s.student_id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="font-medium">
                            {s.first_name} {s.last_name}
                          </span>
                          {s.matricule && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {s.matricule}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">{s.nb_appels}</td>
                        <td className="px-3 py-2.5 text-center font-mono text-green-600">
                          {s.nb_present}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-red-600">
                          {s.nb_absent}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-amber-600">
                          {s.nb_retard}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-blue-600">
                          {s.nb_excuse}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              s.heures_absence > 0
                                ? "bg-red-100 text-red-700"
                                : "bg-green-100 text-green-700"
                            }`}
                            title={
                              s.heures_excusees > 0
                                ? `+ ${fmtHeures(s.heures_excusees)} excusées`
                                : undefined
                            }
                          >
                            <Clock className="h-3 w-3" />
                            {fmtHeures(s.heures_absence)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.taux == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={`font-mono font-semibold ${
                                s.taux >= 80
                                  ? "text-green-600"
                                  : s.taux >= 60
                                  ? "text-amber-600"
                                  : "text-red-600"
                              }`}
                            >
                              {s.taux}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 bg-amber-500/10 border-l border-border text-center">
                          <ConduiteInput
                            student={s}
                            ecueId={conduite.ecue_id}
                            ueSessionId={conduite.ue_session_id}
                            onError={setError}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            La note saisie ici est celle qui s'affiche, en lecture seule, dans la colonne
            « Conduite (/20) » de la page{" "}
            <Link href="/professionnel/admin/notes" className="underline">
              Notes
            </Link>{" "}
            et qui entre dans le calcul des moyennes du semestre.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Champ de saisie de la conduite d'un étudiant : enregistrement automatique
 * au `blur` (sortie du champ). Vider le champ supprime la note existante.
 */
function ConduiteInput({
  student,
  ecueId,
  ueSessionId,
  onError,
}: {
  student: any;
  ecueId: string;
  ueSessionId: string;
  onError: (m: string | null) => void;
}) {
  const [val, setVal] = useState(student.note != null ? String(student.note) : "");
  const [saved, setSaved] = useState(false);
  const upsert = useUpsertManualNote();
  const del = useDeleteManualNote();

  useEffect(() => {
    setVal(student.note != null ? String(student.note) : "");
  }, [student.note, student.note_id, student.student_id]);

  const pending = upsert.isPending || del.isPending;

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function save() {
    const raw = val.trim();

    // Champ vidé : on supprime la note existante (sinon rien à faire).
    if (raw === "") {
      if (!student.note_id) return;
      onError(null);
      try {
        await del.mutateAsync(student.note_id);
        flashSaved();
      } catch (e: any) {
        onError(e?.message ?? "Erreur lors de la suppression de la conduite.");
      }
      return;
    }

    const v = parseFloat(raw.replace(",", "."));
    if (isNaN(v) || v < 0 || v > 20) {
      onError("La note de conduite doit être comprise entre 0 et 20.");
      setVal(student.note != null ? String(student.note) : "");
      return;
    }
    if (student.note != null && Number(student.note) === v) return; // inchangé

    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: student.student_id,
        ue_session_id: ueSessionId,
        nature: "examen",
        note: v,
        note_max: 20,
      });
      flashSaved();
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement de la conduite.");
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={20}
        step="0.25"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="—"
        className="h-9 w-24"
      />
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
      ) : saved ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : student.note_id ? (
        <button
          type="button"
          onClick={async () => {
            onError(null);
            try {
              await del.mutateAsync(student.note_id);
              setVal("");
              flashSaved();
            } catch (e: any) {
              onError(e?.message ?? "Erreur lors de la suppression de la conduite.");
            }
          }}
          className="text-gray-400 hover:text-red-600"
          title="Supprimer la note de conduite"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="h-4 w-4" />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-white/70 text-xs mt-0.5">{hint}</p>
    </div>
  );
}
