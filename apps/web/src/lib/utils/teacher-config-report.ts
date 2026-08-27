/**
 * Export PDF de la configuration des rémunérations — une ligne par
 * configuration, dans le périmètre affiché à l'écran (filtre enseignant).
 *
 * Les colonnes propres aux heures (seuil, majoration) restent vides pour un
 * salaire fixe : le calculateur ne les lit pas, les remplir laisserait croire
 * qu'elles pèsent sur le montant.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import type { TeacherPaymentConfigRow } from "@/lib/hooks/use-teacher-payment-configs";

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte",
};

/**
 * Montant en FCFA. `nombreFr` et non `Intl.NumberFormat` : ce dernier sépare
 * les milliers par une espace insécable étroite que jsPDF n'encode pas (voir
 * `texteImprimable`).
 */
const fmtMontant = (v?: number | null): string =>
  v == null ? "—" : `${nombreFr(Math.round(Number(v)))} FCFA`;

const fmtDate = (d?: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toLocaleDateString("fr-FR");
};

/** Une configuration court encore si elle n'a pas de fin, ou une fin à venir. */
const estActive = (c: TeacherPaymentConfigRow, aujourdhui: string): boolean =>
  !c.effectiveTo || c.effectiveTo.slice(0, 10) >= aujourdhui;

export interface TeacherConfigExportOptions {
  /** Enseignant sélectionné, ou « Tous les enseignants ». */
  enseignant: string;
  /** Date du jour, pour le décompte des configurations en vigueur. */
  aujourdhui?: string;
  /**
   * Mention à porter au document quand l'API a plafonné la liste : sans elle,
   * un enseignant absent passerait pour non configuré.
   */
  tronquee?: string;
}

export function buildTeacherConfigsReportSpec(
  configs: TeacherPaymentConfigRow[],
  o: TeacherConfigExportOptions
): ReportSpec {
  const aujourdhui = o.aujourdhui ?? new Date().toISOString().slice(0, 10);

  // Ordre alphabétique, puis par prise d'effet : le document sert de référence.
  const triees = [...configs].sort(
    (a, b) =>
      (a.teacherName ?? "").localeCompare(b.teacherName ?? "", "fr") ||
      String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))
  );

  const enseignants = new Set(triees.map((c) => c.teacherId)).size;
  const actives = triees.filter((c) => estActive(c, aujourdhui)).length;

  const perimetre: Array<[string, string]> = [
    ["Enseignant", o.enseignant || "—"],
    ["Configurations", String(triees.length)],
    ["Enseignants concernés", effectif(enseignants, "enseignant")],
    ["En vigueur aujourd'hui", String(actives)],
  ];

  const parType = triees.reduce<Record<string, number>>((acc, c) => {
    const k = TYPE_LABELS[c.configType] ?? String(c.configType);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const blocks: ReportSpec["blocks"] = [
    { kind: "keyValues", items: perimetre, columns: 2 },
    {
      kind: "table",
      table: {
        columns: [
          { header: "N°", width: 12, align: "center" },
          { header: "Enseignant" },
          { header: "Type", width: 28, align: "center" },
          { header: "Salaire mensuel", width: 34, align: "right" },
          { header: "Taux horaire", width: 32, align: "right" },
          { header: "Seuil h. sup.", width: 24, align: "center" },
          { header: "Majoration", width: 24, align: "center" },
          { header: "Prise d'effet", width: 26, align: "center" },
          { header: "Fin", width: 26, align: "center" },
        ],
        rows: triees.map((c, i) => {
          // Un salaire fixe ignore les heures : ni seuil, ni majoration.
          const heuresComptent = c.configType !== "salary";
          return [
            String(i + 1),
            c.teacherName ?? "Enseignant",
            TYPE_LABELS[c.configType] ?? String(c.configType),
            fmtMontant(c.monthlySalary),
            c.defaultHourlyRate == null ? "—" : `${fmtMontant(c.defaultHourlyRate)}/h`,
            heuresComptent && c.overtimeThreshold != null ? `${c.overtimeThreshold} h` : "—",
            heuresComptent && c.overtimeMultiplier != null ? `×${c.overtimeMultiplier}` : "—",
            fmtDate(c.effectiveFrom),
            c.effectiveTo ? fmtDate(c.effectiveTo) : "Sans fin",
          ];
        }),
        footer: [
          "",
          `TOTAL — ${effectif(triees.length, "configuration")}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ],
      },
    },
    {
      kind: "note",
      text: `Répartition par type : ${
        Object.entries(parType)
          .sort((a, b) => a[0].localeCompare(b[0], "fr"))
          .map(([k, n]) => `${k} : ${n}`)
          .join("  ·  ") || "—"
      }`,
    },
  ];

  if (o.tronquee) blocks.push({ kind: "note", text: o.tronquee });

  return {
    title: "Configuration des rémunérations",
    subtitle: o.enseignant,
    filename: `configurations-remuneration-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "configuration"),
    blocks,
  };
}

export const openTeacherConfigsPdf = (
  configs: TeacherPaymentConfigRow[],
  o: TeacherConfigExportOptions,
  win?: Window | null
) => openReportPdf(buildTeacherConfigsReportSpec(configs, o), win);
