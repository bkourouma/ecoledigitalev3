"use client";

import { useMemo, useState } from "react";
import { Loader2, Settings, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { type OwnerReportContent } from "@/lib/utils/owner-report";
import { VIZ_STATUS, formatFcfa } from "@/components/owner/charts/palette";
import { useOwnerPayroll } from "@/lib/hooks/use-owner-payroll";
import type { OwnerPayrollArchive } from "@ecoledigitale/contracts";

/**
 * Configuration & validation — les deux entrées du menu administrateur qui
 * n'avaient aucun pendant propriétaire.
 *
 * POURQUOI LES DEUX SONT SUR LE MÊME ONGLET
 *
 * Elles répondent à une seule question : **pourquoi rien n'est payable ?** Un
 * enseignant sans configuration ne peut pas recevoir de bulletin ; une séance
 * non validée n'est pas due ; une séance validée sans tarif résoluble n'est pas
 * chiffrable. Les séparer obligerait à visiter deux écrans pour comprendre un
 * seul blocage.
 *
 * `validated_at` GOUVERNE LA PAYABILITÉ, et c'est le premier poste de litige :
 * un enseignant qui a fait cours et dont la séance n'est pas validée n'est pas
 * payé, et personne ne le voit.
 */
export function Configuration() {
  const [archive] = useState<OwnerPayrollArchive>("toutes");

  const params = useMemo(() => ({ archive }), [archive]);
  const { data, isLoading, error } = useOwnerPayroll(params);

  const construireRapport = (): OwnerReportContent => {
    const c = data!.configuration;
    const s = data!.seances;
    return {
      filename: "configuration-paie",
      blocks: [
        { kind: "heading", text: "Configuration des enseignants", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Enseignants", String(c.enseignants)],
            ["Avec configuration de paie", String(c.avecConfiguration)],
            ["SANS configuration", String(c.sansConfiguration)],
            ["Tarifs d'ECUE", String(c.tarifsEcue)],
            ["Dont nominatifs", String(c.tarifsNominatifs)],
            ["Dont génériques", String(c.tarifsGeneriques)],
            ["Tarifs expirés", String(c.tarifsExpires)],
          ],
        },
        { kind: "heading", text: "Validation des séances", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Séances enregistrées", String(s.total)],
            ["Validées", String(s.validees)],
            ["Horodatées", String(s.horodatees)],
            ["Valorisables", String(s.valorisables)],
            [
              "Engagement non décaissé",
              s.engagementNonPaye === null ? "Non mesuré" : formatFcfa(s.engagementNonPaye),
            ],
          ],
        },
        ...(s.raisonNonValorisable
          ? [{ kind: "note" as const, text: s.raisonNonValorisable }]
          : []),
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de la configuration…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardContent className="p-6 text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les données."}
        </CardContent>
      </Card>
    );
  }

  const c = data.configuration;
  const s = data.seances;

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Configuration & validation des séances"
        question="Pourquoi un enseignant n'est-il pas payé ?"
        precision="Trois verrous se posent dans cet ordre : une configuration de paie, une séance validée, un tarif en vigueur à la date de la séance."
        pdf={data ? construireRapport : undefined}
      />

      {/* Le blocage en tête : c'est la seule chose de cet onglet sur laquelle on
          agit, et la raison est écrite plutôt que déduite d'un zéro. */}
      {s.raisonNonValorisable && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardContent className="p-4 text-sm">
            <strong>Rien n&apos;est payable en l&apos;état.</strong> {s.raisonNonValorisable}
          </CardContent>
        </Card>
      )}

      {c.sansConfiguration > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.warning }}>
          <CardContent className="p-4 text-sm">
            <strong>
              {c.sansConfiguration} enseignant(s) sans configuration de paie.
            </strong>{" "}
            Leur bulletin ne peut pas être calculé : ni salaire fixe, ni taux horaire par
            défaut ne leur est attaché.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Configuration des enseignants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Enseignants", c.enseignants, "", false],
                ["Avec configuration", c.avecConfiguration, "", false],
                ["Sans configuration", c.sansConfiguration, "bulletin incalculable", true],
                [
                  "Tarifs d'ECUE",
                  c.tarifsEcue,
                  `${c.tarifsNominatifs} nominatif(s), ${c.tarifsGeneriques} générique(s)`,
                  false,
                ],
              ] as Array<[string, number, string, boolean]>
            ).map(([label, valeur, hint, alerte]) => (
              <div key={label} className="rounded-md border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div
                  className="mt-1 text-xl font-semibold tabular-nums"
                  style={alerte && valeur > 0 ? { color: VIZ_STATUS.warning } : undefined}
                >
                  {valeur}
                </div>
                {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
              </div>
            ))}
          </div>

          {/*
            Un tarif générique convient tant qu'un enseignant ne négocie pas le
            sien. Le jour où il le fait, l'absence de nominatif se règle en
            litige — et ce fait ne se lit nulle part ailleurs.
          */}
          {c.tarifsNominatifs === 0 && c.tarifsGeneriques > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Les {c.tarifsGeneriques} tarifs sont tous <strong>génériques</strong> : aucun
              n&apos;est attaché à un enseignant nommé. Cela convient tant que personne ne
              négocie son taux ; le jour où c&apos;est le cas, le tarif appliqué sera celui de
              tout le monde.
            </p>
          )}
          {c.tarifsExpires > 0 && (
            <p className="mt-2 text-sm" style={{ color: VIZ_STATUS.warning }}>
              {c.tarifsExpires} tarif(s) expiré(s) : les séances postérieures à leur date de
              fin ne seront pas valorisées.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Validation des séances
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Une séance non validée n&apos;est pas due, quel que soit le travail fourni. C&apos;est
            le premier poste de litige.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Séances", s.total, "enregistrées", false],
                ["Validées", s.validees, "payables sur le principe", s.validees === 0],
                ["Horodatées", s.horodatees, "durée calculable", false],
                ["Valorisables", s.valorisables, "tarif résolu", s.valorisables === 0],
              ] as Array<[string, number, string, boolean]>
            ).map(([label, valeur, hint, alerte]) => (
              <div key={label} className="rounded-md border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div
                  className="mt-1 text-xl font-semibold tabular-nums"
                  style={
                    alerte && s.total > 0 ? { color: VIZ_STATUS.critical } : undefined
                  }
                >
                  {valeur}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Engagement pris et non décaissé
            </div>
            {/* « non mesuré » et non 0 FCFA : une séance sans tarif résoluble n'a
                pas un coût nul, elle n'a pas de coût connu. */}
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {s.engagementNonPaye === null ? (
                <span className="text-sm italic text-muted-foreground">non mesuré</span>
              ) : (
                formatFcfa(s.engagementNonPaye)
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Séances validées, valorisées au tarif en vigueur à leur date. Ce que
              l&apos;école doit sans l&apos;avoir encore versé.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
