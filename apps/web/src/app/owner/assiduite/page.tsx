"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  UserCheck,
  Clock,
  ClipboardCheck,
  DoorOpen,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerAssiduite, buildQueryString } from "@/lib/hooks/use-owner-assiduite";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { HeatmapGrid } from "@/components/owner/charts/HeatmapGrid";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import { VIZ_SEQUENTIAL, VIZ_STATUS, formatPct } from "@/components/owner/charts/palette";

const ALL = "__all__";

const JOURS = [
  { key: "1", label: "Lundi" },
  { key: "2", label: "Mardi" },
  { key: "3", label: "Mercredi" },
  { key: "4", label: "Jeudi" },
  { key: "5", label: "Vendredi" },
  { key: "6", label: "Samedi" },
];

/** Amplitude affichée, alignée sur l'amplitude ouvrable retenue par l'API. */
const HEURES = Array.from({ length: 12 }, (_, i) => ({
  key: String(i + 8),
  label: `${String(i + 8).padStart(2, "0")}h`,
}));

export default function OwnerAssiduitePage() {
  const [dateDebut, setDateDebut] = useState<string>("");
  const [dateFin, setDateFin] = useState<string>("");
  const [semestreId, setSemestreId] = useState<string>(ALL);

  // Filières prises dans le filtre global ; le semestre reste propre à l'écran.
  const { filiereIds, options: filters } = useOwnerFilters();

  // Un semestre choisi peut ne plus appartenir aux filières retenues.
  useEffect(() => {
    setSemestreId(ALL);
  }, [filiereIds]);

  const params = useMemo(
    () => ({
      dateDebut: dateDebut || undefined,
      dateFin: dateFin || undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      semestreId: semestreId === ALL ? undefined : semestreId,
    }),
    [dateDebut, dateFin, filiereIds, semestreId]
  );

  const { data, isLoading, error } = useOwnerAssiduite(params);

  const semestreOptions = useMemo(() => {
    const all = filters?.semestres ?? [];
    if (filiereIds.length === 0) return all;
    return all.filter((s) => filiereIds.includes(s.filiereId));
  }, [filters, filiereIds]);

  // Heatmap assiduité : lignes = filières, colonnes = semaines.
  const attendanceHeatmap = useMemo(() => {
    if (!data) return { rows: [], cols: [], cells: [] };
    const weeks: string[] = [];
    const filieres = new Map<string, string>();
    for (const c of data.attendanceByWeek) {
      if (!weeks.includes(c.weekStart)) weeks.push(c.weekStart);
      filieres.set(c.filiereId, c.filiereName);
    }
    weeks.sort();
    return {
      rows: [...filieres.entries()].map(([key, label]) => ({ key, label })),
      cols: weeks.map((w) => ({ key: w, label: w.slice(5) })),
      cells: data.attendanceByWeek.map((c) => ({
        rowKey: c.filiereId,
        colKey: c.weekStart,
        value: c.presentRate,
        hint: `${c.totalRecords} pointages`,
      })),
    };
  }, [data]);

  // Heatmap occupation : lignes = jours, colonnes = créneaux horaires.
  const occupancyHeatmap = useMemo(() => {
    if (!data) return [];
    return data.roomOccupancy.map((s) => ({
      rowKey: String(s.jour),
      colKey: String(s.hour),
      value: s.rate,
      hint: `${s.occupiedRooms} salle${s.occupiedRooms > 1 ? "s" : ""}`,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de l&apos;assiduité…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les données."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Assiduité, salles et charge enseignante
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Du {data.dateDebut} au {data.dateFin}. Les taux de présence portent sur les
            séances réellement tenues ; l&apos;occupation et la charge, sur l&apos;emploi du
            temps planifié.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/assiduite/export"
          queryString={buildQueryString(params)}
          filename="assiduite.csv"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="date-debut">Du</Label>
            <Input
              id="date-debut"
              type="date"
              value={dateDebut}
              max={dateFin || undefined}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date-fin">Au</Label>
            <Input
              id="date-fin"
              type="date"
              value={dateFin}
              min={dateDebut || undefined}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </div>
          {/* Les filières sont portées par la barre de filtre globale. */}
          <div className="space-y-2">
            <Label>Semestre</Label>
            <Select value={semestreId} onValueChange={setSemestreId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                {semestreOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Taux de présence"
          value={formatPct(data.kpis.presenceRate)}
          hint="Retards comptés présents"
          icon={UserCheck}
        />
        <StatCard
          label="Heures d'absence"
          value={`${data.kpis.absenceHours.toFixed(1)} h`}
          hint="Absences non excusées"
          icon={Clock}
          deltaPolarity="lower-is-better"
        />
        <StatCard
          label="Appels effectués"
          value={formatPct(data.kpis.callRate)}
          hint="Séances passées pointées"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Occupation des salles"
          value={formatPct(data.kpis.roomOccupancyRate)}
          hint={`Base ${data.openingHoursPerWeek} h ouvrables/semaine`}
          icon={DoorOpen}
        />
        <StatCard
          label="Heures planifiées"
          value={`${data.kpis.plannedHours.toFixed(1)} h`}
          hint="Par semaine, emploi du temps"
          icon={CalendarClock}
        />
      </div>

      {data.unassignedEcue.length > 0 ? (
        <Card className="border-red-300/70 bg-red-50/50 dark:bg-red-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
              ECUE obligatoires sans enseignant
              <span className="text-sm font-normal text-muted-foreground">
                — {data.unassignedEcue.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="text-muted-foreground mb-2">
              Ces sessions sont ouvertes aux inscriptions alors que l&apos;ECUE n&apos;a
              personne pour l&apos;assurer.
            </p>
            <ul className="space-y-1">
              {data.unassignedEcue.slice(0, 10).map((u) => (
                <li key={`${u.ueSessionId}-${u.ecueId}`} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">
                    {u.ecueCode} — {u.ecueLibelle}
                  </span>
                  <span className="text-muted-foreground">
                    · UE {u.ueCode} · {u.filiereName}
                  </span>
                </li>
              ))}
            </ul>
            {data.unassignedEcue.length > 10 ? (
              <p className="text-xs text-muted-foreground pt-1">
                … et {data.unassignedEcue.length - 10} autre
                {data.unassignedEcue.length - 10 > 1 ? "s" : ""}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <HeatmapGrid
        title="Assiduité par semaine et par filière"
        subtitle="Taux de présence hebdomadaire. Une case vide signifie qu'aucun pointage n'a été saisi cette semaine-là."
        rows={attendanceHeatmap.rows}
        cols={attendanceHeatmap.cols}
        cells={attendanceHeatmap.cells}
        scaleLabel="Présence 0 → 100 %"
      />

      <LineChartCard
        title="Évolution du taux de présence"
        subtitle="Toutes filières du périmètre confondues."
        data={data.presenceTrend.map((t) => ({
          semaine: t.weekStart.slice(5),
          presence: t.presentRate,
        }))}
        categoryKey="semaine"
        series={[{ key: "presence", label: "Présence", color: VIZ_SEQUENTIAL[2] }]}
        yDomain={[0, 100]}
        height={240}
        valueFormatter={(v) => formatPct(v)}
        axisFormatter={(v) => `${v} %`}
      />

      <HeatmapGrid
        title="Occupation des salles"
        subtitle="Part des salles actives occupées, par jour et par créneau. Source : emploi du temps planifié."
        rows={JOURS}
        cols={HEURES}
        cells={occupancyHeatmap}
        scaleLabel="Occupation 0 → 100 %"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <BarChartCard
          className="lg:col-span-2"
          title="Étudiants les plus absents"
          subtitle="Heures d'absence non excusées, cumulées sur la période."
          data={data.topAbsentStudents.map((s) => ({
            etudiant: s.studentName,
            absences: s.absenceHours,
            excusees: s.excusedHours,
          }))}
          categoryKey="etudiant"
          orientation="horizontal"
          stacked
          height={Math.max(220, data.topAbsentStudents.length * 26 + 60)}
          series={[
            { key: "absences", label: "Absences", color: VIZ_STATUS.critical },
            { key: "excusees", label: "Absences excusées", color: VIZ_STATUS.serious },
          ]}
          valueFormatter={(v) => `${v.toFixed(1)} h`}
        />

        <BarChartCard
          className="lg:col-span-2"
          title="Charge par enseignant"
          subtitle="Heures hebdomadaires issues de l'emploi du temps planifié."
          data={data.teacherLoad.map((t) => ({
            enseignant: t.teacherName,
            heures: t.weeklyHours,
          }))}
          categoryKey="enseignant"
          orientation="horizontal"
          height={Math.max(220, data.teacherLoad.length * 26 + 60)}
          series={[{ key: "heures", label: "Heures / semaine", color: VIZ_SEQUENTIAL[2] }]}
          valueFormatter={(v) => `${v.toFixed(1)} h`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enseignants</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Un enseignant peut exister sans compte de connexion : la colonne
            « Compte » le signale.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead className="text-right">Heures / semaine</TableHead>
                <TableHead className="text-right">ECUE</TableHead>
                <TableHead className="text-right">Filières</TableHead>
                <TableHead className="text-right">Compte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teacherLoad.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-sm">
                    Aucun enseignant planifié sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.teacherLoad.map((t) => (
                  <TableRow key={t.teacherId}>
                    <TableCell className="font-medium">{t.teacherName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.weeklyHours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.ecueCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.filiereCount}</TableCell>
                    <TableCell className="text-right">
                      {t.hasUserAccount ? (
                        <span className="text-muted-foreground">Oui</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Aucun
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salles sous-utilisées</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Triées par heures croissantes. Croiser la capacité et le taux permet de
            repérer les grandes salles réservées pour de petits effectifs.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salle</TableHead>
                <TableHead>Bâtiment</TableHead>
                <TableHead className="text-right">Capacité</TableHead>
                <TableHead className="text-right">Heures / semaine</TableHead>
                <TableHead className="text-right">Taux</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.roomUsage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-sm">
                    Aucune salle active.
                  </TableCell>
                </TableRow>
              ) : (
                data.roomUsage.slice(0, 20).map((r) => (
                  <TableRow key={r.classroomId}>
                    <TableCell className="font-medium">
                      {r.name} <span className="text-muted-foreground">({r.code})</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.building ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.capacity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.weeklyHours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(r.occupancyRate)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
