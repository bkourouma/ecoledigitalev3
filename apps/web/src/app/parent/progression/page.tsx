"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import {
  Users,
  Loader2,
  AlertCircle,
  TrendingUp,
  GraduationCap,
  CalendarRange,
  Award,
  CheckCircle2,
  UserCheck,
} from "lucide-react";
import {
  useProfessionalChildren,
  useChildBulletinSemestres,
  useChildBulletin,
  useChildAttendanceHistory,
} from "@/lib/hooks/use-professional-parent";
import {
  fmtNote,
  appreciation,
  decisionLabel,
  semestreLabelShort,
  semShort,
} from "@/lib/bulletin-format";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Progression de mon enfant — espace parent (Module Professionnel).
 *
 * Retrace le PARCOURS plutôt qu'un document isolé : une section par année
 * scolaire, la classe suivie cette année-là, puis ses semestres avec moyenne,
 * crédits et décision. Les chiffres viennent des mêmes bulletins que
 * /parent/documents ; ici on les met bout à bout pour voir l'évolution.
 *
 * Lecture seule, et sans téléchargement : les documents officiels restent sur
 * /parent/documents.
 */

function fmtPct(x: number): string {
  return `${Math.round(x)} %`;
}

/** Couleur d'une moyenne /20, du rouge à l'émeraude. */
function couleurNote(m: number | null | undefined): string {
  if (m == null) return "text-muted-foreground";
  if (m >= 14) return "text-emerald-400";
  if (m >= 12) return "text-sky-400";
  if (m >= 10) return "text-amber-400";
  return "text-red-400";
}

/**
 * Présences d'un lot de séances. Seules les séances POINTÉES comptent :
 * un appel non fait ne vaut pas une absence. Un retard reste une présence.
 */
function compterAssiduite(seances: any[]) {
  const pointees = seances.filter((s) => s.statut);
  const presents = pointees.filter((s) => s.statut === "present" || s.statut === "retard");
  const absents = pointees.filter((s) => s.statut === "absent").length;
  const excuses = pointees.filter((s) => s.statut === "excuse").length;
  return {
    total: pointees.length,
    presents: presents.length,
    absents,
    excuses,
    prevues: seances.length,
    taux: pointees.length > 0 ? (presents.length / pointees.length) * 100 : null,
  };
}

/**
 * Cumule plusieurs mesures d'assiduité. Le taux se recalcule sur les totaux :
 * faire la moyenne des taux donnerait le même poids à un semestre de 10
 * séances qu'à un semestre de 200.
 */
function cumulerAssiduite(mesures: ReturnType<typeof compterAssiduite>[]) {
  const somme = mesures.reduce(
    (a, m) => ({
      total: a.total + m.total,
      presents: a.presents + m.presents,
      absents: a.absents + m.absents,
      excuses: a.excuses + m.excuses,
      prevues: a.prevues + m.prevues,
    }),
    { total: 0, presents: 0, absents: 0, excuses: 0, prevues: 0 }
  );
  return {
    ...somme,
    taux: somme.total > 0 ? (somme.presents / somme.total) * 100 : null,
  };
}

export default function ParentProgressionPage() {
  const [childId, setChildId] = useState("");

  const childrenQuery = useProfessionalChildren();
  const semestresQuery = useChildBulletinSemestres(childId || null);
  const attendanceQuery = useChildAttendanceHistory(childId || null);

  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const tousSemestres: any[] = (semestresQuery.data as any[]) ?? [];
  const seances: any[] = (attendanceQuery.data as any[]) ?? [];

  // Un semestre porte déjà son contexte : il sert directement de ligne aux
  // filtres. Tout l'écran — repères compris — décrit la sélection.
  const { visibles: semestres, barre } = useFiltresScolaires(
    tousSemestres.map((s) => ({ ...s, semestre_id: s.id, semestre_libelle: s.libelle }))
  );

  /**
   * Le parcours : une section par année scolaire, chacune portant sa classe et
   * ses semestres. L'ordre est chronologique — on lit une scolarité du début
   * vers la fin, pas l'inverse.
   */
  const parcours = useMemo(() => {
    const parAnnee = new Map<string, { annee: string; classes: Set<string>; semestres: any[] }>();
    for (const s of semestres) {
      const annee = s.annee_scolaire ?? "—";
      let a = parAnnee.get(annee);
      if (!a) {
        a = { annee, classes: new Set<string>(), semestres: [] };
        parAnnee.set(annee, a);
      }
      if (s.classe_nom ?? s.filiere_nom) a.classes.add(s.classe_nom ?? s.filiere_nom);
      a.semestres.push(s);
    }
    return Array.from(parAnnee.values())
      .map((a) => ({
        ...a,
        classes: Array.from(a.classes),
        semestres: a.semestres.sort((x, y) =>
          String(x.libelle).localeCompare(String(y.libelle), "fr", { numeric: true })
        ),
      }))
      .sort((a, b) => a.annee.localeCompare(b.annee));
  }, [semestres]);

  // Assiduité semestre par semestre. Une séance non pointée n'est ni une
  // présence ni une absence : elle sort du calcul.
  const assiduiteParSemestre = useMemo(() => {
    const parSem = new Map<string, any[]>();
    for (const s of seances) {
      if (!s.semestre_id) continue;
      const liste = parSem.get(s.semestre_id);
      if (liste) liste.push(s);
      else parSem.set(s.semestre_id, [s]);
    }
    const m = new Map<string, ReturnType<typeof compterAssiduite>>();
    for (const [id, liste] of parSem) m.set(id, compterAssiduite(liste));
    return m;
  }, [seances]);

  // Assiduité de la sélection : on cumule les semestres affichés plutôt que
  // toutes les séances, sinon le repère contredirait les cartes.
  const assiduite = useMemo(
    () =>
      cumulerAssiduite(
        semestres
          .map((s: any) => assiduiteParSemestre.get(s.id))
          .filter(Boolean) as ReturnType<typeof compterAssiduite>[]
      ),
    [semestres, assiduiteParSemestre]
  );

  // Et par année scolaire, en cumulant ses semestres : la séance ne porte
  // que son semestre, c'est le parcours qui le rattache à une année.
  const assiduiteParAnnee = useMemo(() => {
    const m = new Map<string, ReturnType<typeof cumulerAssiduite>>();
    for (const a of parcours) {
      const mesures = a.semestres
        .map((s: any) => assiduiteParSemestre.get(s.id))
        .filter(Boolean) as ReturnType<typeof compterAssiduite>[];
      if (mesures.length > 0) m.set(a.annee, cumulerAssiduite(mesures));
    }
    return m;
  }, [parcours, assiduiteParSemestre]);

  const enCours = childrenQuery.isLoading;

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="font-bold bg-gradient-to-r from-emerald-500 to-sky-500 bg-clip-text text-transparent flex items-center gap-3 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <TrendingUp className="h-8 w-8 text-emerald-400 shrink-0" />
          Progression de mon enfant
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Le parcours scolaire année par année : classes suivies, résultats de
          chaque semestre et assiduité.
        </p>
      </div>

      {/* Sélection de l'enfant */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[32rem]">
            <label className="text-sm font-medium text-foreground mb-1.5 block">Enfant</label>
            <Select value={childId || undefined} onValueChange={setChildId}>
              <SelectTrigger className="h-11">
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder={enCours ? "Chargement…" : "Choisir un enfant"} />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!childId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-emerald-500/15 p-4">
              <GraduationCap className="h-8 w-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold">Choisissez un enfant</h3>
            <p className="text-muted-foreground max-w-md">
              Sélectionnez un enfant ci-dessus pour afficher son parcours scolaire.
            </p>
          </CardContent>
        </Card>
      ) : semestresQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
        </div>
      ) : semestresQuery.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(semestresQuery.error as Error)?.message ??
                "Impossible de charger le parcours."}
            </p>
          </CardContent>
        </Card>
      ) : tousSemestres.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-muted p-4">
              <GraduationCap className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Aucun parcours enregistré pour le moment.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {barre}

          {parcours.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Aucun semestre pour les filtres sélectionnés.
              </CardContent>
            </Card>
          ) : (
          <>
          {/* Repères du parcours */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Repere
              icone={<CalendarRange className="h-5 w-5 text-sky-400" />}
              fond="bg-sky-500/15"
              label="Années suivies"
              valeur={String(parcours.length)}
              detail={`${parcours[0].annee} → ${parcours[parcours.length - 1].annee}`}
            />
            <Repere
              icone={<Award className="h-5 w-5 text-emerald-400" />}
              fond="bg-emerald-500/15"
              label="Semestres"
              valeur={String(semestres.length)}
              detail="relevés disponibles"
            />
            <Repere
              icone={<UserCheck className="h-5 w-5 text-amber-400" />}
              fond="bg-amber-500/15"
              label="Assiduité"
              valeur={assiduite.taux == null ? "—" : fmtPct(assiduite.taux)}
              detail={
                assiduite.total === 0
                  ? "aucune séance pointée"
                  : `${assiduite.presents}/${assiduite.total} séances`
              }
            />
          </div>

          {/* Le parcours, année par année */}
          <div className="space-y-6">
            {parcours.map((a) => (
              <section key={a.annee} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-sky-500/15 px-2.5 py-1 text-sm font-semibold text-sky-300">
                    {a.annee}
                  </span>
                  {a.classes.map((c) => (
                    <span key={c} className="text-sm font-medium text-foreground">
                      {c}
                    </span>
                  ))}
                  <TauxAnnee mesure={assiduiteParAnnee.get(a.annee) ?? null} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {a.semestres.map((s) => (
                    <SemestreCarte
                      key={s.id}
                      childId={childId}
                      semestre={s}
                      assiduite={assiduiteParSemestre.get(s.id) ?? null}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          </>
          )}

          <p className="text-xs text-muted-foreground">
            Les relevés officiels et les reçus se consultent depuis « Bulletins &
            Reçus ».
          </p>
        </>
      )}
    </div>
  );
}

/** Résultats d'un semestre : moyenne, crédits, décision, présences. */
function SemestreCarte({
  childId,
  semestre,
  assiduite,
}: {
  childId: string;
  semestre: any;
  assiduite: ReturnType<typeof compterAssiduite> | null;
}) {
  const query = useChildBulletin(childId || null, semestre.id);
  const bulletin: any = query.data;

  const credits = bulletin
    ? { valides: Number(bulletin.credits_valides ?? 0), total: Number(bulletin.credits_total ?? 0) }
    : null;
  const part =
    credits && credits.total > 0 ? Math.min(100, (credits.valides / credits.total) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-emerald-500/20 px-2 text-sm font-bold text-emerald-300">
            {semShort(semestre.libelle)}
          </span>
          <span className="font-semibold text-foreground">
            {semestreLabelShort(semestre.libelle)}
          </span>
        </div>

        {query.isLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : query.isError || !bulletin ? (
          <p className="py-3 text-sm text-muted-foreground">Résultats indisponibles.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Moyenne</p>
                <p className={`text-2xl font-bold ${couleurNote(bulletin.moyenne_session)}`}>
                  {fmtNote(bulletin.moyenne_session)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {appreciation(bulletin.moyenne_session)}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium">
                {bulletin.decision === "admis" && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                )}
                {decisionLabel(bulletin.decision)}
              </span>
            </div>

            {/* Crédits : la part validée dit la progression mieux qu'un total. */}
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Crédits validés</span>
                <span className="font-mono">
                  {credits?.valides ?? 0}/{credits?.total ?? 0}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
                  style={{ width: `${part}%` }}
                />
              </div>
            </div>

            <Presences assiduite={assiduite} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Taux de présence d'une année scolaire, à droite de son bandeau. */
function TauxAnnee({
  mesure,
}: {
  mesure: ReturnType<typeof cumulerAssiduite> | null;
}) {
  if (!mesure || mesure.taux == null) return null;
  const couleur =
    mesure.taux >= 90
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : mesure.taux >= 75
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-red-500/40 bg-red-500/10 text-red-300";
  return (
    <span
      className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${couleur}`}
      title={`${mesure.presents}/${mesure.total} séance(s) pointée(s) sur l'année`}
    >
      <UserCheck className="h-3.5 w-3.5" />
      Présence {Math.round(mesure.taux)} %
      <span className="font-normal opacity-80">
        ({mesure.presents}/{mesure.total})
      </span>
    </span>
  );
}

/** Présences d'un semestre : taux, puis le détail des pointages. */
function Presences({
  assiduite,
}: {
  assiduite: ReturnType<typeof compterAssiduite> | null;
}) {
  if (!assiduite || assiduite.prevues === 0) {
    return (
      <div className="border-t border-border pt-3 text-xs text-muted-foreground">
        Présences · aucune séance programmée
      </div>
    );
  }
  if (assiduite.taux == null) {
    return (
      <div className="border-t border-border pt-3 text-xs text-muted-foreground">
        Présences · {assiduite.prevues} séance(s), aucun appel effectué
      </div>
    );
  }
  const couleur =
    assiduite.taux >= 90
      ? "text-emerald-400"
      : assiduite.taux >= 75
        ? "text-amber-400"
        : "text-red-400";
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Présences</span>
        <span className={`font-semibold ${couleur}`}>
          {Math.round(assiduite.taux)} %
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {assiduite.presents}/{assiduite.total} séance(s) pointée(s)
        {assiduite.absents > 0 && ` · ${assiduite.absents} absence(s)`}
        {assiduite.excuses > 0 && ` · ${assiduite.excuses} excusée(s)`}
      </p>
    </div>
  );
}

function Repere({
  icone,
  fond,
  label,
  valeur,
  detail,
}: {
  icone: React.ReactNode;
  fond: string;
  label: string;
  valeur: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{valeur}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
          </div>
          <div className={`rounded-full p-3 shrink-0 ${fond}`}>{icone}</div>
        </div>
      </CardContent>
    </Card>
  );
}
