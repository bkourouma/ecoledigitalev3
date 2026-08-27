"use client";

import { useMemo, type ReactNode } from "react";
import { Card, CardContent, Badge } from "@ecoledigitale/ui";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Timer,
  ShieldCheck,
} from "lucide-react";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Vue « présences & absences » d'UN étudiant, en lecture seule.
 *
 * Partagée par l'espace étudiant (`/professionnel/etudiant/presences`) et
 * l'espace parent (`/parent/presences`) : les deux affichent exactement les
 * mêmes séances, servies par la même requête côté API.
 *
 * Une séance sans pointage n'apparaît pas dans l'historique (l'enseignant n'a
 * pas encore fait l'appel) mais reste dans le total des séances de la
 * sélection : c'est ce qui distingue « pas encore pointé » d'« absent ». Un
 * retard compte comme une présence dans le taux.
 */

const ATT_STATUT: Record<string, { label: string; cls: string; Icon: any }> = {
  present: {
    label: "Présent",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    Icon: CheckCircle2,
  },
  absent: {
    label: "Absent",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
    Icon: XCircle,
  },
  retard: {
    label: "Retard",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    Icon: Timer,
  },
  excuse: {
    label: "Excusé",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
    Icon: ShieldCheck,
  },
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export function PresencesView({
  toutes,
  isLoading,
  isError,
  errorMessage,
}: {
  toutes: any[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}) {
  // Chaque séance porte le contexte de sa cohorte : année, nom de classe et
  // semestre. Statistiques ET historique portent sur la sélection.
  const { visibles: records, barre } = useFiltresScolaires(toutes);

  const stats = useMemo(() => {
    let present = 0,
      absent = 0,
      retard = 0,
      excuse = 0,
      pointes = 0;
    for (const r of records) {
      if (r.statut === "present") present += 1;
      else if (r.statut === "absent") absent += 1;
      else if (r.statut === "retard") retard += 1;
      else if (r.statut === "excuse") excuse += 1;
      if (r.statut) pointes += 1;
    }
    const taux = pointes > 0 ? Math.round(((present + retard) / pointes) * 100) : null;
    return { present, absent, retard, excuse, pointes, taux, total: records.length };
  }, [records]);

  // N'affiche que les séances effectivement pointées dans l'historique.
  const pointed = records.filter((r) => !!r.statut);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{errorMessage ?? "Impossible de charger les présences."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {toutes.length > 0 && barre}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AttStat
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          label="Présences"
          value={stats.present}
        />
        <AttStat
          icon={<XCircle className="h-5 w-5 text-red-400" />}
          label="Absences"
          value={stats.absent}
        />
        <AttStat
          icon={<Timer className="h-5 w-5 text-amber-400" />}
          label="Retards"
          value={stats.retard}
        />
        <AttStat
          icon={<ShieldCheck className="h-5 w-5 text-sky-400" />}
          label="Excusés"
          value={stats.excuse}
        />
      </div>

      {stats.taux != null && (
        <p className="text-sm text-muted-foreground">
          Taux de présence : <span className="font-semibold text-foreground">{stats.taux}%</span>{" "}
          sur {stats.pointes} séance{stats.pointes > 1 ? "s" : ""} pointée
          {stats.pointes > 1 ? "s" : ""}.
        </p>
      )}

      {pointed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {toutes.length === 0
              ? "Aucun pointage de présence pour le moment."
              : records.length === 0
                ? "Aucune séance pour les filtres sélectionnés."
                : "Aucun pointage de présence sur cette sélection."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Matière (ECUE)</th>
                    <th className="px-3 py-2.5 text-left font-medium">Unité (UE)</th>
                    <th className="px-3 py-2.5 text-center font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {pointed.map((r) => {
                    const st = ATT_STATUT[r.statut] ?? null;
                    return (
                      <tr key={r.seance_id} className="border-b border-border/60 hover:bg-muted/20">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-foreground">{fmtDate(r.date)}</div>
                          {(r.heure_debut || r.heure_fin) && (
                            <div className="text-xs text-muted-foreground">
                              {(r.heure_debut ?? "").slice(0, 5)}
                              {r.heure_fin ? ` – ${String(r.heure_fin).slice(0, 5)}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-foreground">
                          {r.ecue_libelle ?? r.ecue_code ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {r.ue_libelle ?? r.ue_code ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {st ? (
                            <Badge variant="outline" className={st.cls}>
                              <st.Icon className="h-3 w-3 mr-1" />
                              {st.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AttStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
