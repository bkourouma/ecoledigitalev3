"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, Button, Badge } from "@ecoledigitale/ui";
import {
  Award,
  GraduationCap,
  CalendarRange,
  Layers,
  Loader2,
  AlertCircle,
  BookOpen,
  FileSpreadsheet,
  TrendingUp,
  CheckCircle2,
  Star,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useMyBulletin,
  useMyBulletinNotes,
  useMyBulletinSemestres,
} from "@/lib/hooks/use-professional-bulletins";
import {
  fmtNote,
  appreciation,
  ueEtatLabel,
  ueEtatColor,
  sessionLabel,
  decisionLabel,
  semShort,
  semestreLabelShort,
} from "@/lib/bulletin-format";

/**
 * Mes notes — espace étudiant (Module Professionnel, feature 030).
 *
 * Reprend la présentation de la saisie enseignant (/professionnel/admin/notes) :
 * filtres Filière + Semestre (SearchableSelect), puis, par UE, le détail des
 * matières (ECUE) en colonnes Devoirs / Examen / Note avec badge de statut
 * coloré. Une synthèse (moyenne, crédits, décision) clôt chaque semestre.
 *
 * Source : bulletin de l'étudiant connecté, calculé à partir des mêmes notes
 * que celles saisies par l'enseignant (hooks useMyBulletin*).
 */

const ALL = "__all__";

/** Statut d'un ECUE → badge coloré (thème sombre), comme la grille enseignant. */
const ECUE_STATUT: Record<string, { label: string; cls: string }> = {
  valide: {
    label: "Validé",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  compense: {
    label: "Compensé",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
  insuffisant: {
    label: "Insuffisant",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  eliminatoire: {
    label: "Éliminatoire",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
  },
  en_cours: {
    label: "En attente",
    cls: "border-slate-500/40 bg-slate-500/15 text-slate-300",
  },
};

/** Couleur du texte d'une note /20. */
function noteColor(x: number | null | undefined): string {
  if (x == null) return "text-muted-foreground";
  if (x >= 16) return "text-emerald-400";
  if (x >= 14) return "text-emerald-300";
  if (x >= 12) return "text-sky-400";
  if (x >= 10) return "text-amber-400";
  if (x >= 8) return "text-amber-500/90";
  return "text-red-400";
}

/** Numéro de semestre extrait du libellé (« Semestre 2 » → 2). */
function semNum(libelle: string | null | undefined): number {
  const m = String(libelle ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

/** Clé filière (code si présent, sinon nom). */
function filiereKey(s: any): string {
  return String(s?.filiere_code ?? s?.filiere_nom ?? "—");
}

export default function StudentGradesPage() {
  const { data: session, status } = useSession();
  const semestresQuery = useMyBulletinSemestres();
  const [filiereFilter, setFiliereFilter] = useState<string>(ALL);
  const [semestreFilter, setSemestreFilter] = useState<string>(ALL);

  const semestres: any[] = (semestresQuery.data as any[]) ?? [];

  // Filières distinctes présentes dans les inscriptions (pour le filtre).
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of semestres) {
      map.set(filiereKey(s), s.filiere_nom ?? filiereKey(s));
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [semestres]);

  // Semestres proposés au filtre (restreints à la filière choisie), triés.
  const semestreOptions = useMemo(() => {
    const list =
      filiereFilter === ALL
        ? semestres
        : semestres.filter((s) => filiereKey(s) === filiereFilter);
    return [...list]
      .sort(
        (a, b) =>
          (a.filiere_nom ?? "").localeCompare(b.filiere_nom ?? "", "fr") ||
          semNum(a.libelle) - semNum(b.libelle)
      )
      .map((s) => ({
        value: s.id,
        label: `${semestreLabelShort(s.libelle)}${
          s.filiere_code ? ` · ${s.filiere_code}` : ""
        }`,
      }));
  }, [semestres, filiereFilter]);

  // Semestres visibles après application des filtres.
  const visibleSemestres = useMemo(() => {
    let list = semestres;
    if (filiereFilter !== ALL) list = list.filter((s) => filiereKey(s) === filiereFilter);
    if (semestreFilter !== ALL) list = list.filter((s) => s.id === semestreFilter);
    return list;
  }, [semestres, filiereFilter, semestreFilter]);

  // Regroupement : filière → semestres triés (S1, S2, S3…).
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; nom: string; code: string | null; semestres: any[] }
    >();
    for (const s of visibleSemestres) {
      const key = filiereKey(s);
      let g = map.get(key);
      if (!g) {
        g = { key, nom: s.filiere_nom ?? key, code: s.filiere_code ?? null, semestres: [] };
        map.set(key, g);
      }
      g.semestres.push(s);
    }
    for (const g of map.values()) {
      g.semestres.sort((a, b) => semNum(a.libelle) - semNum(b.libelle));
    }
    return Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [visibleSemestres]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!session) {
    redirect("/login");
  }

  const hasData = semestres.length > 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent flex items-center gap-3">
            <Award className="h-8 w-8 text-purple-400 shrink-0" />
            Mes notes
          </h1>
          <p className="text-muted-foreground mt-2">
            Le détail de vos notes par filière et par semestre — unités
            d'enseignement et matières (Devoirs, Examen, Note), tel que saisi par
            vos enseignants.
          </p>
        </div>
        <Link href="/student/bulletin">
          <Button
            variant="outline"
            className="border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Mon bulletin officiel
          </Button>
        </Link>
      </div>

      {/* Statistiques rapides */}
      {!semestresQuery.isLoading && !semestresQuery.isError && hasData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <StatCard
            icon={<Layers className="h-6 w-6 text-indigo-400" />}
            iconBg="bg-indigo-500/15"
            label="Filières"
            value={filiereOptions.length}
          />
          <StatCard
            icon={<CalendarRange className="h-6 w-6 text-purple-400" />}
            iconBg="bg-purple-500/15"
            label="Semestres"
            value={semestres.length}
          />
          <StatCard
            icon={<GraduationCap className="h-6 w-6 text-emerald-400" />}
            iconBg="bg-emerald-500/15"
            label="Relevés disponibles"
            value={semestres.length}
          />
        </div>
      )}

      {/* Filtres (Filière + Semestre) — comme la saisie enseignant */}
      {hasData && (
        <Card className="shadow-sm">
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiereFilter}
              onChange={(v) => {
                setFiliereFilter(v);
                setSemestreFilter(ALL);
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Filière"
              searchPlaceholder="Rechercher une filière…"
              options={[
                { value: ALL, label: "Toutes les filières" },
                ...filiereOptions,
              ]}
            />
            <SearchableSelect
              value={semestreFilter}
              onChange={setSemestreFilter}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder="Semestre"
              searchPlaceholder="Rechercher un semestre…"
              options={[
                { value: ALL, label: "Tous les semestres" },
                ...semestreOptions,
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Chargement */}
      {semestresQuery.isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <span className="ml-2 text-lg text-muted-foreground">
            Chargement de vos notes…
          </span>
        </div>
      )}

      {/* Erreur */}
      {semestresQuery.isError && (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Erreur</h3>
            <p className="text-muted-foreground mb-4">
              {(semestresQuery.error as Error)?.message ??
                "Impossible de charger vos notes."}
            </p>
            <Button onClick={() => semestresQuery.refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      )}

      {/* Vide */}
      {!semestresQuery.isLoading && !semestresQuery.isError && !hasData && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-full w-20 h-20 flex items-center justify-center">
              <Award className="h-10 w-10 text-purple-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Aucune note pour le moment
              </h3>
              <p className="text-muted-foreground">
                Vos notes apparaîtront ici dès que vous serez inscrit à une unité
                d'enseignement et que vos enseignants auront saisi les résultats.
              </p>
            </div>
            <Link href="/student/courses">
              <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white">
                <BookOpen className="h-4 w-4 mr-2" />
                Voir mes cours
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Aucun résultat pour les filtres */}
      {hasData && groups.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun semestre ne correspond aux filtres sélectionnés.
          </CardContent>
        </Card>
      )}

      {/* Notes par filière → semestre */}
      {!semestresQuery.isLoading &&
        !semestresQuery.isError &&
        groups.map((g) => (
          <section key={g.key} className="space-y-4">
            {groups.length > 1 && (
              <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <GraduationCap className="h-5 w-5 text-indigo-400 shrink-0" />
                <span>{g.nom}</span>
                {g.code && (
                  <span className="font-mono text-xs text-muted-foreground">
                    ({g.code})
                  </span>
                )}
              </div>
            )}
            <div className="space-y-6">
              {g.semestres.map((s) => (
                <SemesterGrades key={s.id} semestre={s} />
              ))}
            </div>
          </section>
        ))}

      {/* Légende */}
      {hasData && groups.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Chaque matière (ECUE) : <span className="font-medium">Devoirs</span>{" "}
          (une pastille par devoir — gris : saisi par l'enseignant, bleu : issu
          d'une évaluation) · <span className="font-medium">Examen</span> ·{" "}
          <span className="font-medium">Note</span> = moyenne des devoirs × 0,4 +
          examen × 0,6. La couleur de la Note indique le statut (validé /
          insuffisant / éliminatoire).
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */

function StatCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: ReactNode;
  iconBg: string;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center">
          <div className={`p-2 rounded-lg shrink-0 ${iconBg}`}>{icon}</div>
          <div className="ml-4 min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Section « notes » d'un semestre : détail UE → ECUE + synthèse.
 * Charge son propre bulletin (mêmes données que la saisie enseignant).
 */
function SemesterGrades({ semestre }: { semestre: any }) {
  const query = useMyBulletin(semestre.id);
  const notesQuery = useMyBulletinNotes(semestre.id);
  const bulletin: any = query.data;
  const ues: any[] = bulletin?.ues ?? [];
  const sem = semShort(semestre.libelle);
  const nbEcues = ues.reduce((n, u) => n + (u.ecues?.length ?? 0), 0);

  // Devoirs individuels par ECUE (clé « ue_session_id::ecue_id ») : notes
  // manuelles (nature « devoir ») + copies d'évaluation (hors examen).
  const devoirsByEcue = useMemo(() => {
    const m = new Map<string, any[]>();
    const push = (ueSessionId: string, ecueId: string, d: any) => {
      const k = `${ueSessionId}::${ecueId}`;
      const list = m.get(k) ?? [];
      list.push(d);
      m.set(k, list);
    };
    const data: any = notesQuery.data;
    for (const n of data?.notes ?? []) {
      if (n.nature !== "devoir") continue;
      push(n.ue_session_id, n.ecue_id, {
        note: n.note,
        note_max: n.note_max,
        label: n.libelle,
        kind: "manuel",
      });
    }
    for (const s of data?.submissions ?? []) {
      if (s.type === "examen") continue;
      push(s.ue_session_id, s.ecue_id, {
        note: s.note,
        note_max: s.note_max,
        label: s.titre,
        kind: "eval",
      });
    }
    return m;
  }, [notesQuery.data]);

  return (
    <Card className="overflow-hidden shadow-sm">
      {/* En-tête du semestre */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-indigo-500/10 to-purple-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-indigo-500/20 px-2 text-sm font-bold text-indigo-300">
            {sem}
          </span>
          <div>
            <p className="font-semibold text-foreground leading-tight">
              {semestreLabelShort(semestre.libelle)}
            </p>
            <p className="text-xs text-muted-foreground">
              {bulletin?.annee_academique ? `Année ${bulletin.annee_academique} · ` : ""}
              {ues.length} UE · {nbEcues} matière{nbEcues > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {bulletin && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-purple-500/40 bg-purple-500/15 text-purple-200"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1" />
              Moyenne {fmtNote(bulletin.moyenne_session)}
            </Badge>
            <Badge
              variant="outline"
              className="border-sky-500/40 bg-sky-500/15 text-sky-200"
            >
              {bulletin.credits_valides ?? 0}/{bulletin.credits_total ?? 0} crédits
            </Badge>
            <DecisionBadge decision={bulletin.decision} />
          </div>
        )}
      </div>

      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
          </div>
        ) : query.isError ? (
          <div className="flex items-center gap-3 px-4 py-8 text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">
              {(query.error as Error)?.message ??
                "Impossible de charger ce semestre."}
            </p>
          </div>
        ) : ues.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            Aucune note disponible pour ce semestre pour l'instant.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">
                    Unité d'enseignement / Matière
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                    Devoirs&nbsp;/20
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                    Examen&nbsp;/20
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                    Note&nbsp;/20
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                    Crédits
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody>
                {ues.map((ue) => (
                  <UeRows
                    key={ue.ue_session_id ?? ue.ue_id}
                    ue={ue}
                    devoirsByEcue={devoirsByEcue}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Synthèse du semestre */}
        {bulletin && ues.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-muted/20 px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              UE validées :{" "}
              <span className="font-semibold text-foreground">
                {bulletin.nb_ue_validees ?? 0}/{bulletin.nb_ue_total ?? 0}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Star className="h-4 w-4 text-amber-400" />
              Moyenne :{" "}
              <span className={`font-semibold ${noteColor(bulletin.moyenne_session)}`}>
                {fmtNote(bulletin.moyenne_session)}
              </span>
              <span className="text-muted-foreground">
                · {appreciation(bulletin.moyenne_session)}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarRange className="h-4 w-4 text-sky-400" />
              {sessionLabel(bulletin.session_globale ?? 1)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Pastille de note simple (Examen), style de la grille enseignant. */
function NotePill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2.5 py-1 text-[13px] font-mono text-slate-200">
      {fmtNote(value)}
    </span>
  );
}

/**
 * Cellule Devoirs : une pastille par devoir individuel (note manuelle ou copie
 * d'évaluation). Repli sur la moyenne si le détail n'est pas disponible.
 */
function DevoirsCell({
  devoirs,
  moyenne,
}: {
  devoirs: any[];
  moyenne: number | null | undefined;
}) {
  if (devoirs.length === 0) {
    // Pas de détail : on montre la moyenne des devoirs (si calculée).
    return <NotePill value={moyenne} />;
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {devoirs.map((d, i) => (
        <span
          key={i}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-mono ${
            d.kind === "eval"
              ? "bg-sky-500/15 text-sky-200"
              : "bg-slate-500/15 text-slate-200"
          }`}
          title={`${d.label ?? (d.kind === "eval" ? "Évaluation" : "Devoir")}${
            d.note_max && Number(d.note_max) !== 20 ? ` — noté sur ${d.note_max}` : ""
          }`}
        >
          {fmtNote(d.note)}
        </span>
      ))}
    </div>
  );
}

/** Lignes d'une UE : la ligne UE (moyenne) puis ses ECUE (détail des notes). */
function UeRows({
  ue,
  devoirsByEcue,
}: {
  ue: any;
  devoirsByEcue: Map<string, any[]>;
}) {
  const ecues: any[] = ue?.ecues ?? [];
  return (
    <>
      <tr className="border-b border-border bg-muted/20 font-semibold">
        <td className="px-4 py-2.5 uppercase text-foreground">
          {ue.libelle ?? ue.code ?? "—"}
        </td>
        <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
        <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
        <td className={`px-3 py-2.5 text-center font-bold ${noteColor(ue.moyenne_ue)}`}>
          {fmtNote(ue.moyenne_ue)}
        </td>
        <td className="px-3 py-2.5 text-center text-foreground">{ue.credits ?? "—"}</td>
        <td className="px-3 py-2.5 text-center">
          <span
            className="text-xs font-semibold"
            style={{ color: ueEtatColor(ue.etat) }}
          >
            {ueEtatLabel(ue.etat)}
          </span>
        </td>
      </tr>
      {ecues.map((e) => {
        const st = ECUE_STATUT[e.statut] ?? ECUE_STATUT.en_cours;
        const devoirs = devoirsByEcue.get(`${ue.ue_session_id}::${e.ecue_id}`) ?? [];
        return (
          <tr
            key={e.ecue_id}
            className="border-b border-border/60 hover:bg-muted/20"
          >
            <td className="px-4 py-2 pl-8 text-muted-foreground">
              {e.libelle ?? e.code ?? "—"}
            </td>
            <td className="px-3 py-2 text-center">
              <DevoirsCell devoirs={devoirs} moyenne={e.moyenne_devoirs} />
            </td>
            <td className="px-3 py-2 text-center">
              <NotePill value={e.note_examen} />
            </td>
            <td className="px-3 py-2 text-center">
              <span
                className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold border ${st.cls}`}
                title={st.label}
              >
                {fmtNote(e.note_ecue)}
              </span>
            </td>
            <td className="px-3 py-2 text-center text-muted-foreground">
              {e.credits ?? "—"}
            </td>
            <td className="px-3 py-2 text-center">
              <Badge variant="outline" className={st.cls}>
                {st.label}
              </Badge>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** Badge de décision du semestre. */
function DecisionBadge({ decision }: { decision: string | null | undefined }) {
  const cls =
    decision === "admis"
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
      : decision === "rattrapage"
      ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
      : "border-red-500/40 bg-red-500/15 text-red-300";
  return (
    <Badge variant="outline" className={cls}>
      {decisionLabel(decision)}
    </Badge>
  );
}
