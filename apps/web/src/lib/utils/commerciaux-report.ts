/**
 * Export PDF de la liste des commerciaux — Module Professionnel.
 *
 * Le document reprend la liste telle qu'elle est affichée, actifs et inactifs
 * confondus : c'est l'annuaire des commerciaux, avec le taux proposé par défaut
 * et le nombre d'étudiants déjà rattachés à chacun.
 *
 * Le taux imprimé ici est celui PROPOSÉ à la saisie d'une nouvelle provenance,
 * pas celui qui s'applique aux étudiants déjà enregistrés : ceux-là portent
 * chacun leur propre taux, figé le jour de leur inscription.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import type { CommercialDto } from "@ecoledigitale/contracts";

export function buildCommerciauxReportSpec(commerciaux: CommercialDto[]): ReportSpec {
  const actifs = commerciaux.filter((c) => c.actif).length;
  const etudiants = commerciaux.reduce((s, c) => s + c.etudiants, 0);

  return {
    title: "Commerciaux",
    filename: `commerciaux-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(commerciaux.length, "commercial", "commerciaux"),
    blocks: [
      {
        kind: "keyValues",
        columns: 2,
        items: [
          ["Commerciaux", String(commerciaux.length)],
          ["Dont actifs", `${actifs} / ${commerciaux.length}`],
          ["Étudiants rattachés", effectif(etudiants, "étudiant")],
        ],
      },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            { header: "Nom" },
            { header: "Téléphone", width: 34, align: "center" },
            { header: "Email", width: 60 },
            { header: "Taux par défaut", width: 30, align: "center" },
            { header: "Étudiants", width: 24, align: "center" },
            { header: "Statut", width: 24, align: "center" },
          ],
          rows: commerciaux.map((c, i) => [
            String(i + 1),
            String(c.nom || "—"),
            c.telephone || "—",
            c.email || "—",
            `${c.taux_commission} %`,
            String(c.etudiants),
            c.actif ? "Actif" : "Inactif",
          ]),
          footer: [
            "",
            `TOTAL — ${effectif(commerciaux.length, "commercial", "commerciaux")}`,
            "",
            "",
            "",
            String(etudiants),
            `${actifs} actif${actifs > 1 ? "s" : ""}`,
          ],
        },
      },
      {
        kind: "note",
        text:
          "Le taux indiqué est celui proposé par défaut lors d'une nouvelle inscription. " +
          "Les étudiants déjà rattachés conservent le taux figé sur leur fiche le jour de " +
          "leur inscription, même s'il a été renégocié depuis.",
      },
    ],
  };
}

export const openCommerciauxPdf = (commerciaux: CommercialDto[], win?: Window | null) =>
  openReportPdf(buildCommerciauxReportSpec(commerciaux), win);
