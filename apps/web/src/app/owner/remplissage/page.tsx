"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, DoorOpen, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { VIZ_STATUS } from "@/components/owner/charts/palette";
import { useOwnerRemplissage } from "@/lib/hooks/use-owner-remplissage";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import type { OwnerCohorteRow } from "@ecoledigitale/contracts";

/**
 * Remplissage & planning.
 *
 * L'écran met en tête ce qui se décide encore : les cohortes qui démarrent
 * bientôt et qui ne se rempliront plus. Viennent ensuite les conflits de
 * planning (rien ne les détecte à la saisie), la complétude de la grille et le
 * respect du programme.
 */

/* --------------------------------- Outils --------------------------------- */

/**
 * Un taux `null` signifie « capacité non renseignée », pas « 0 % ». Le confondre
 * ferait passer une donnée manquante pour un échec commercial.
 */
function fillColor(taux: number | null): string | undefined {
  if (taux === null) return undefined;
  if (taux > 100) return VIZ_STATUS.warning; // surbooking : salle trop petite
  if (taux < 50) return VIZ_STATUS.critical;
  if (taux < 70) return VIZ_STATUS.warning;
  return VIZ_STATUS.good;
}

function fillLabel(taux: number | null): string {
  if (taux === null) return "capacité non renseignée";
  if (taux > 100) return "surbooking";
  if (taux < 50) return "à arbitrer";
  if (taux < 70) return "sous la cible";
  return "dans la cible";
}

function FillCell({ taux }: { taux: number | null }) {
  const color = fillColor(taux);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">{fillLabel(taux)}</span>
      <span className="font-medium tabular-nums" style={color ? { color } : undefined}>
        {taux === null ? "—" : `${taux} %`}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className="mt-1 text-2xl font-semibold tabular-nums"
          style={tone ? { color: tone } : undefined}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Cohortes qu'il est encore temps d'arbitrer : démarrage proche, mal remplies. */
function isUrgent(c: OwnerCohorteRow): boolean {
  const soon = c.joursAvantDebut !== null && c.joursAvantDebut >= 0 && c.joursAvantDebut <= 14;
  return soon && (c.inscrits === 0 || (c.tauxRemplissage !== null && c.tauxRemplissage < 50));
}

/* --------------------------------- Page ----------------------------------- */

export default function OwnerRemplissagePage() {
  // Périmètre pris dans le filtre global de l'espace propriétaire (barre du
  // layout), pas dans un état local : la sélection suit d'un écran à l'autre.
  const { filiereIds } = useOwnerFilters();
  const { data, isLoading, isError, error, refetch } = useOwnerRemplissage(filiereIds);
  const [showAllCohortes, setShowAllCohortes] = useState(false);

  const urgentes = useMemo(() => (data?.cohortes ?? []).filter(isUrgent), [data]);
  const cohortesAffichees = useMemo(() => {
    const list = data?.cohortes ?? [];
    return showAllCohortes ? list : list.slice(0, 15);
  }, [data, showAllCohortes]);

  if (isError) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Remplissage indisponible</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-red-700">
          <p>{error instanceof Error ? error.message : "Chargement impossible."}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Remplissage &amp; planning</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Capacités, cohortes à arbitrer, conflits de salle et d&apos;enseignant. Une capacité non
            renseignée n&apos;est jamais comptée comme un taux de zéro.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/remplissage"
          queryString={
            filiereIds.length ? `format=csv&filiereIds=${filiereIds.join(",")}` : "format=csv"
          }
          filename="remplissage.csv"
          label="Exporter"
        />
      </div>

      {/* Ce qui se décide encore : en tête, avant les tableaux. */}
      {urgentes.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                {urgentes.length} cohorte(s) démarrent sous 14 jours et ne se rempliront plus.
              </p>
              <ul className="mt-1 space-y-0.5">
                {urgentes.slice(0, 5).map((c) => (
                  <li key={c.sessionId}>
                    {c.ueCode} · {c.libelle} — {c.inscrits} inscrit(s)
                    {c.capacite ? ` sur ${c.capacite}` : ""}, démarrage dans{" "}
                    {c.joursAvantDebut} jour(s)
                  </li>
                ))}
                {urgentes.length > 5 && <li>… et {urgentes.length - 5} autre(s)</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Indicateurs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Remplissage cohortes"
          value={
            isLoading && !data
              ? "…"
              : k?.tauxRemplissageCohortes === null || k === undefined
                ? "—"
                : `${k.tauxRemplissageCohortes} %`
          }
          tone={fillColor(k?.tauxRemplissageCohortes ?? null)}
          hint={
            k
              ? `${k.cohortesActives} cohorte(s) en cours${
                  k.cohortesSansCapacite > 0
                    ? ` · ${k.cohortesSansCapacite} hors calcul, sans capacité`
                    : ""
                }`
              : undefined
          }
        />
        <Stat
          label="Remplissage classes"
          value={
            isLoading && !data
              ? "…"
              : k?.tauxRemplissageClasses === null || k === undefined
                ? "—"
                : `${k.tauxRemplissageClasses} %`
          }
          tone={fillColor(k?.tauxRemplissageClasses ?? null)}
          hint={k ? `${k.classesActives} classe(s) sur l'année active` : undefined}
        />
        <Stat
          label="Cohortes sans inscrit"
          value={isLoading && !data ? "…" : String(k?.cohortesVides ?? 0)}
          tone={(k?.cohortesVides ?? 0) > 0 ? VIZ_STATUS.critical : VIZ_STATUS.good}
          hint="Salle et enseignant immobilisés pour rien"
        />
        <Stat
          label="Conflits de planning"
          value={isLoading && !data ? "…" : String(k?.conflitsPlanning ?? 0)}
          tone={(k?.conflitsPlanning ?? 0) > 0 ? VIZ_STATUS.critical : VIZ_STATUS.good}
          hint="Même salle ou même enseignant, deux fois"
        />
      </div>

      {/* Complétude du planning */}
      {k && k.creneauxTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Complétude du planning
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Créneaux sans salle
              </div>
              <div
                className="text-xl font-semibold tabular-nums"
                style={k.creneauxSansSalle > 0 ? { color: VIZ_STATUS.warning } : undefined}
              >
                {k.creneauxSansSalle} <span className="text-sm font-normal">/ {k.creneauxTotal}</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Créneaux sans enseignant
              </div>
              <div
                className="text-xl font-semibold tabular-nums"
                style={k.creneauxSansEnseignant > 0 ? { color: VIZ_STATUS.critical } : undefined}
              >
                {k.creneauxSansEnseignant}{" "}
                <span className="text-sm font-normal">/ {k.creneauxTotal}</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Respect du planning (30 j)
              </div>
              <div className="text-xl font-semibold tabular-nums">
                {k.tauxRespectPlanning === null ? "—" : `${k.tauxRespectPlanning} %`}
              </div>
              <div className="text-xs text-muted-foreground">
                {k.heuresTenues30j} h tenues sur {k.heuresPlanifiees30j} h planifiées
                {k.seancesSansHoraire30j > 0 && (
                  <>
                    {" "}
                    · {k.seancesSansHoraire30j} séance(s) sans horaire saisi, exclues du calcul
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conflits */}
      {data && data.conflits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conflits de planning</CardTitle>
            <p className="text-sm text-muted-foreground">
              Deux créneaux qui se chevauchent le même jour sur la même salle ou le même enseignant,
              avec des périodes de validité qui se recouvrent. Aucun contrôle n&apos;existe à la
              saisie : ces conflits se découvrent en salle.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Ressource</TableHead>
                  <TableHead>Jour</TableHead>
                  <TableHead>Premier cours</TableHead>
                  <TableHead>Second cours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.conflits.map((c, i) => (
                  <TableRow key={`${c.ressource}-${c.jour}-${i}`}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        {c.type === "salle" ? (
                          <DoorOpen className="h-3.5 w-3.5" />
                        ) : (
                          <Users className="h-3.5 w-3.5" />
                        )}
                        {c.type === "salle" ? "Salle" : "Enseignant"}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{c.ressource}</TableCell>
                    <TableCell>{c.jour}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-mono text-xs">{c.plageA}</div>
                      <div className="text-muted-foreground">{c.coursA}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-mono text-xs">{c.plageB}</div>
                      <div className="text-muted-foreground">{c.coursB}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Cohortes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cohortes professionnelles</CardTitle>
          <p className="text-sm text-muted-foreground">
            Classées par remplissage croissant : ce qu&apos;il faut arbitrer d&apos;abord.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filière</TableHead>
                <TableHead>UE / session</TableHead>
                <TableHead>Début</TableHead>
                <TableHead className="text-right">Inscrits</TableHead>
                <TableHead className="text-right">Remplissage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cohortesAffichees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Aucune cohorte en cours ou à venir."}
                  </TableCell>
                </TableRow>
              ) : (
                cohortesAffichees.map((c) => (
                  <TableRow key={c.sessionId}>
                    <TableCell className="text-muted-foreground">{c.filiereName ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{c.ueCode}</div>
                      <div className="text-xs text-muted-foreground">{c.libelle}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {c.dateDebut ? new Date(c.dateDebut).toLocaleDateString("fr-FR") : "—"}
                      {c.joursAvantDebut !== null && c.joursAvantDebut >= 0 && (
                        <div className="text-xs text-muted-foreground">
                          dans {c.joursAvantDebut} j
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.inscrits}
                      {c.capacite !== null && (
                        <span className="text-muted-foreground"> / {c.capacite}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <FillCell taux={c.tauxRemplissage} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Aucune troncature silencieuse : on dit ce qui n'est pas montré. */}
          {data && data.cohortes.length > cohortesAffichees.length && (
            <Button variant="outline" size="sm" onClick={() => setShowAllCohortes(true)}>
              Afficher les {data.cohortes.length - cohortesAffichees.length} cohortes restantes
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Classes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classes de l&apos;année active</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Filière</TableHead>
                <TableHead className="text-right">Effectif</TableHead>
                <TableHead className="text-right">Remplissage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data || data.classes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Aucune classe sur l'année active."}
                  </TableCell>
                </TableRow>
              ) : (
                data.classes.map((c) => (
                  <TableRow key={c.classId}>
                    <TableCell className="text-muted-foreground">{c.cycleName ?? "—"}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.filiereName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.effectif}
                      {c.capacite !== null && (
                        <span className="text-muted-foreground"> / {c.capacite}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <FillCell taux={c.tauxRemplissage} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Couverture du planning par semestre */}
      {data && data.couverture.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Couverture du planning</CardTitle>
            <p className="text-sm text-muted-foreground">
              Part des ECUE d&apos;un semestre qui ont effectivement un horaire. Doit atteindre
              100 % avant la rentrée.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filière</TableHead>
                  <TableHead>Semestre</TableHead>
                  <TableHead className="text-right">ECUE programmées</TableHead>
                  <TableHead className="text-right">Couverture</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.couverture.map((c) => (
                  <TableRow key={c.semestreId}>
                    <TableCell className="text-muted-foreground">{c.filiereName ?? "—"}</TableCell>
                    <TableCell className="font-medium">{c.libelle}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.ecueProgrammees} / {c.ecueTotal}
                    </TableCell>
                    <TableCell className="text-right">
                      <FillCell taux={c.taux} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Données au {new Date(data.computedAt).toLocaleString("fr-FR")}.
        </p>
      )}
    </div>
  );
}
