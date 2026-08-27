/**
 * Export PDF de la validation des séances — Module Professionnel (feature 031).
 *
 * Le document couvre TOUT le périmètre filtré, et pas seulement la page
 * affichée : la liste de l'écran est paginée (10 lignes par défaut), un export
 * limité à ces lignes ne servirait à rien. Les séances sont donc rechargées
 * page par page (le plafond de l'API est de 500) avant composition.
 *
 * Les motifs de blocage sont repris tels quels : une séance non payable sans
 * son motif obligerait à revenir à l'écran pour comprendre.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { apiGet } from "@/lib/utils/report-api";
import { openReportPdf } from "@/lib/utils/report-pdf";
import {
  BLOCKER_LABELS,
  type SeanceFilters,
  type SeancePaie,
} from "@/lib/hooks/use-professional-remuneration";

const BASE = "/api/v1/professional/remuneration";

/** Plafond accepté par l'API pour un appel. */
const PAGE = 500;
/** Garde-fou : 20 pages, soit 10 000 séances. */
const MAX_PAGES = 20;

const STATUT_LABELS: Record<string, string> = {
  planifiee: "Planifiée",
  realisee: "Réalisée",
  annulee: "Annulée",
};

/** 4.5 → « 4h30 » ; 2 → « 2h » — identique à l'affichage de l'écran. */
function fmtHeures(h: number | null | undefined): string {
  if (h == null) return "—";
  const v = Number(h);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}

/** « 08:00 → 11:00 », ou « — » si un horaire manque. */
function fmtHoraires(s: SeancePaie): string {
  const debut = (s.heure_debut ?? "").slice(0, 5);
  const fin = (s.heure_fin ?? "").slice(0, 5);
  return debut && fin ? `${debut} → ${fin}` : "—";
}

function toQuery(filters: Record<string, any>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || value === null) continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Recharge le périmètre filtré ENTIER, page par page. */
async function chargerSeances(filters: SeanceFilters): Promise<SeancePaie[]> {
  const items: SeancePaie[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await apiGet<{ items: SeancePaie[]; total: number }>(
      `${BASE}/seances${toQuery({ ...filters, limit: PAGE, offset: p * PAGE })}`
    );
    const lot = res?.items ?? [];
    items.push(...lot);
    if (lot.length < PAGE || items.length >= Number(res?.total ?? items.length)) break;
  }
  return items;
}

export interface SeancesExportContexte {
  /** Filtres de l'écran, SANS pagination : le document les applique à l'identique. */
  filters: SeanceFilters;
  /** Rappel du périmètre en tête de document (libellés lisibles des filtres). */
  perimetre: Array<[string, string]>;
}

export async function buildSeancesReportSpec(
  ctx: SeancesExportContexte
): Promise<ReportSpec> {
  const seances = await chargerSeances(ctx.filters);

  // Ordre chronologique, puis par enseignant : le document se lit comme un
  // relevé de travail à valider.
  const triees = [...seances].sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      (a.enseignant_nom ?? "").localeCompare(b.enseignant_nom ?? "", "fr") ||
      String(a.heure_debut ?? "").localeCompare(String(b.heure_debut ?? ""))
  );

  const totalHeures = triees.reduce((s, x) => s + Number(x.duree_heures ?? 0), 0);
  const pretes = triees.filter(
    (s) => s.blockers.length === 1 && s.blockers[0] === "NON_VALIDEE"
  ).length;
  const enseignants = new Set(triees.map((s) => s.enseignant_id).filter(Boolean)).size;

  const perimetre: Array<[string, string]> = [
    ...ctx.perimetre,
    ["Séances", String(triees.length)],
    ["Enseignants concernés", effectif(enseignants, "enseignant")],
    ["Prêtes à valider", String(pretes)],
    ["Volume horaire", fmtHeures(totalHeures)],
  ];

  return {
    title: "Séances à valider",
    subtitle: ctx.perimetre.map(([, v]) => v).filter(Boolean).join("  ·  "),
    filename: `seances-a-valider-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "séance"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      triees.length === 0
        ? { kind: "note", text: "Aucune séance à valider sur ce périmètre." }
        : {
            kind: "table",
            table: {
              columns: [
                { header: "N°", width: 12, align: "center" },
                { header: "Date", width: 24, align: "center" },
                { header: "Horaires", width: 30, align: "center" },
                { header: "Volume", width: 20, align: "center" },
                { header: "Enseignant", width: 52 },
                { header: "Cohorte" },
                { header: "Séance", width: 52 },
                { header: "Statut", width: 24, align: "center" },
                { header: "Motifs de blocage", width: 52 },
              ],
              rows: triees.map((s, i) => [
                String(i + 1),
                fmtDate(s.date),
                fmtHoraires(s),
                fmtHeures(s.duree_heures),
                s.enseignant_nom ?? "Aucun enseignant",
                s.cohorte_libelle ?? s.filiere_nom ?? "—",
                s.seance_libelle ||
                  [s.ecue_code, s.ecue_libelle].filter(Boolean).join(" — ") ||
                  "—",
                STATUT_LABELS[String(s.statut)] ?? String(s.statut),
                // « Non validée » seule ne bloque rien d'autre : la ligne est
                // prête, le dire vaut mieux que d'énumérer un faux obstacle.
                s.blockers.length === 1 && s.blockers[0] === "NON_VALIDEE"
                  ? "Prête à valider"
                  : s.blockers
                      .filter((b) => b !== "NON_VALIDEE")
                      .map((b) => BLOCKER_LABELS[b] ?? String(b))
                      .join(" · ") || "—",
              ]),
              footer: [
                "",
                "",
                "",
                fmtHeures(totalHeures),
                `TOTAL — ${effectif(triees.length, "séance")}`,
                "",
                "",
                "",
                "",
              ],
            },
          },
    ],
  };
}

export async function openSeancesPdf(ctx: SeancesExportContexte, win?: Window | null) {
  try {
    return await openReportPdf(await buildSeancesReportSpec(ctx), win);
  } catch (e) {
    // La construction interroge l'API : l'onglet déjà ouvert doit être refermé.
    if (win) win.close();
    throw e;
  }
}
