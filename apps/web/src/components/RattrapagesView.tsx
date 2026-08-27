"use client";

import { useMemo } from "react";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { RotateCcw, Loader2, AlertTriangle, CheckCircle2, CalendarRange } from "lucide-react";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Vue « rattrapages » (Session 2) d'UN étudiant, en lecture seule.
 *
 * Partagée par l'espace étudiant (`/professionnel/etudiant/rattrapages`) et
 * l'espace parent (`/parent/rattrapages`) : les deux affichent exactement les
 * mêmes lignes, servies par la même requête côté API — seule la formulation
 * change (« vous » / « votre enfant »), d'où le paramètre `sujet`.
 *
 * Trois états possibles par ECUE (calculés par l'API) :
 *   - `a_repasser`  : ECUE non validée, examen de Session 2 pas encore noté ;
 *   - `non_validee` : examen de Session 2 noté, ECUE toujours sous 10 ;
 *   - `validee`     : rattrapage réussi (l'ECUE est acquise).
 *
 * Les ECUE validées sortent de la liste : ce n'est plus un rattrapage. L'API
 * continue de les renvoyer pour les écrans qui suivent l'issue d'une Session 2.
 *
 * La saisie des notes reste exclusivement côté administration.
 */

export interface RattrapageRow {
  result_id: string;
  ue_code: string | null;
  ue_libelle: string | null;
  ecue_code: string | null;
  ecue_libelle: string | null;
  credits: number | null;
  moyenne: number | null;
  moyenne_devoirs: number | null;
  note_examen: number | null;
  eliminee: boolean | null;
  validee: boolean;
  note_examen_s1: number | null;
  note_examen_s2: number | null;
  semestre_id: string | null;
  semestre_libelle: string | null;
  filiere_nom: string | null;
  classe_nom: string | null;
  annee_scolaire: string | null;
  etat: "a_repasser" | "non_validee" | "validee";
}

const ETATS: Record<string, { label: string; cls: string }> = {
  a_repasser: { label: "À repasser", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  non_validee: {
    label: "Toujours non validée",
    cls: "bg-red-500/15 text-red-500 border-red-500/40",
  },
  validee: { label: "Rattrapée", cls: "bg-green-500/15 text-green-600 border-green-500/40" },
};

/** Formulations dépendant de qui regarde : l'étudiant, ou son parent. */
const MOTS = {
  moi: {
    erreur: "Impossible de charger vos rattrapages",
    aucunTitre: "Vous n'êtes pas en session de rattrapage.",
    aucunDetail:
      "Toutes vos ECUE notées sont validées. Si un examen n'est pas encore corrigé, il n'apparaît pas ici tant que la note n'est pas saisie.",
    convoque: "Vous êtes convoqué(e) en Session 2",
  },
  enfant: {
    erreur: "Impossible de charger les rattrapages de votre enfant",
    aucunTitre: "Votre enfant n'est pas en session de rattrapage.",
    aucunDetail:
      "Toutes ses ECUE notées sont validées. Si un examen n'est pas encore corrigé, il n'apparaît pas ici tant que la note n'est pas saisie.",
    convoque: "Votre enfant est convoqué(e) en Session 2",
  },
} as const;

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : Number(x).toFixed(2).replace(".", ",");
}

function noteColor(x: number | null | undefined): string {
  if (x == null) return "text-muted-foreground";
  if (x >= 10) return "text-green-600";
  if (x >= 5) return "text-amber-500";
  return "text-red-500";
}

export function RattrapagesView({
  toutes,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  sujet,
}: {
  toutes: RattrapageRow[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  sujet: "moi" | "enfant";
}) {
  const mots = MOTS[sujet];

  // Une ECUE validée n'est plus un rattrapage : elle quitte la liste.
  const rows = useMemo(() => toutes.filter((r) => r.etat !== "validee"), [toutes]);

  // Chaque ligne porte déjà son contexte (année, nom de classe, semestre) :
  // elle alimente directement la cascade de filtres.
  const { visibles, barre } = useFiltresScolaires(rows);

  /** Une carte par semestre, dans l'ordre renvoyé par l'API. */
  const groupes = useMemo(() => {
    const map = new Map<
      string,
      { key: string; titre: string; contexte: string; rows: RattrapageRow[] }
    >();
    for (const r of visibles) {
      const key = `${r.semestre_id ?? "sans-semestre"}|${r.annee_scolaire ?? ""}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          titre: r.semestre_libelle ?? "Semestre non rattaché",
          contexte: [r.classe_nom || r.filiere_nom, r.annee_scolaire].filter(Boolean).join(" · "),
          rows: [],
        };
        map.set(key, g);
      }
      g.rows.push(r);
    }
    return Array.from(map.values());
  }, [visibles]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  // Sans ce cas, une requête en échec afficherait « aucun rattrapage »,
  // c'est-à-dire l'exact contraire d'une liste simplement non chargée.
  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="rounded-full bg-red-50 p-4">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <p className="text-red-700 max-w-md">
            {mots.erreur} : {errorMessage ?? "erreur inconnue"}
          </p>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              Réessayer
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="rounded-full bg-green-50 p-4">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <p className="font-medium text-foreground">{mots.aucunTitre}</p>
          <p className="text-muted-foreground max-w-md">{mots.aucunDetail}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Réponse directe à « suis-je concerné ? ». Le compte porte sur TOUTES
          les ECUE restantes, filtres compris : masquer un semestre ne doit pas
          faire disparaître une convocation bien réelle. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-600">
        <RotateCcw className="h-5 w-5 shrink-0 mt-0.5" />
        <p>
          <strong>{mots.convoque}</strong> pour{" "}
          <strong>{rows.length} ECUE à repasser</strong>. Les dates d&apos;examen sont communiquées
          par l&apos;administration.
        </p>
      </div>

      {barre}

      {groupes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun rattrapage pour les filtres sélectionnés.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupes.map((g) => (
            <Card key={g.key} className="shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <CalendarRange className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{g.titre}</span>
                {g.contexte && <span className="text-xs text-muted-foreground">{g.contexte}</span>}
                <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {g.rows.length} ECUE à repasser
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
                        Examen S2 (/20)
                      </th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        Note ECUE
                      </th>
                      <th className="px-4 py-2.5 text-center font-medium whitespace-nowrap">
                        État
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const etat = ETATS[r.etat] ?? ETATS.a_repasser;
                      return (
                        <tr key={r.result_id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="font-mono text-xs text-muted-foreground">
                              {r.ue_code}
                            </span>{" "}
                            {r.ue_libelle}
                          </td>
                          {/* Code au-dessus, intitulé en dessous : les libellés
                              d'ECUE sont longs et écrasaient les colonnes de
                              notes quand tout tenait sur une seule ligne. */}
                          <td className="px-4 py-2.5 min-w-[16rem]">
                            <div className="font-mono text-xs text-muted-foreground">
                              {r.ecue_code}
                              {r.credits != null && <span className="ml-1">· {r.credits} cr.</span>}
                            </div>
                            <div className="text-foreground">{r.ecue_libelle}</div>
                          </td>
                          <td className="px-4 py-2.5 text-center tabular-nums">
                            {fmt(r.moyenne_devoirs)}
                          </td>
                          {/* La note d'examen de S1 peut venir d'une copie
                              notée plutôt que d'une saisie manuelle : on
                              retombe alors sur celle retenue au calcul, tant
                              qu'aucune note de S2 ne l'a remplacée (même règle
                              que la page admin). */}
                          <td className="px-4 py-2.5 text-center tabular-nums">
                            {fmt(
                              r.note_examen_s1 ??
                                (r.note_examen_s2 == null ? r.note_examen : null),
                            )}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-center tabular-nums font-medium ${noteColor(
                              r.note_examen_s2,
                            )}`}
                          >
                            {r.note_examen_s2 == null ? "En attente" : fmt(r.note_examen_s2)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-center tabular-nums font-semibold ${noteColor(
                              r.moyenne,
                            )}`}
                          >
                            {fmt(r.moyenne)}
                            {r.eliminee && (
                              <span className="ml-1 text-[10px] font-medium text-red-500">
                                éliminatoire
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center whitespace-nowrap">
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${etat.cls}`}
                            >
                              {etat.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        La note de <span className="font-medium">Session 2</span> remplace celle de Session 1 dans
        le calcul de l&apos;ECUE : une ECUE est acquise à partir de 10/20, et une note &lt; 5/20
        reste éliminatoire pour l&apos;UE. Les notes sont saisies par l&apos;administration ; cette
        page est en lecture seule.
      </p>
    </div>
  );
}
