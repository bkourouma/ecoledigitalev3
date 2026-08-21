/**
 * Export PDF d'une session professionnelle — une fiche par session,
 * jamais un bloc pour toutes : c'est session par session que l'information est
 * exploitable (liste d'émargement, remise au responsable de filière…).
 *
 * L'écran regroupe les sessions d'un même semestre en un « lot » ; le document
 * suit ce découpage : les informations du lot en tête, puis une section par UE
 * avec les étudiants qui y sont inscrits.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { apiGet, enParallele } from "@/lib/utils/report-api";
import { openReportPdf } from "@/lib/utils/report-pdf";
import { fmtMontant } from "@/lib/utils/ue-report";

/** Libellés accentués des statuts de session (identiques à l'écran). */
const STATUT_SESSION: Record<string, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  complet: "Complet",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

/** Libellés des statuts d'inscription. */
const STATUT_INSCRIPTION: Record<string, string> = {
  en_attente: "En attente",
  active: "Active",
  confirme: "Confirmée",
  confirmee: "Confirmée",
  annulee: "Annulée",
  terminee: "Terminée",
  complete: "Terminée",
};

const libelleStatut = (map: Record<string, string>, v: any) => map[String(v)] ?? String(v ?? "—");

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

/** Le lot tel que l'écran le construit (voir la page Sessions). */
export interface SessionLot {
  title: string;
  semestre_libelle?: string | null;
  filiere_nom?: string | null;
  filiere_code?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  annee_scolaire?: string | null;
  statut: string;
  items: any[];
}

/** Étudiants inscrits à une session d'UE. */
async function chargerInscrits(ueSessionId: string): Promise<any[]> {
  const res = await apiGet<any>(
    `/api/v1/professional/enrollments?ue_session_id=${encodeURIComponent(ueSessionId)}&pageSize=500`
  );
  const items = res?.items ?? res ?? [];
  return Array.isArray(items) ? items : [];
}

/**
 * Section d'une UE : ses inscrits, ou la mention qu'elle n'en a aucun.
 *
 * Chaque UE ouvre sa propre page (sauf la première, qui suit les informations
 * de la session) : la liste d'une UE se détache ainsi pour l'impression et
 * l'émargement. Le bandeau de la session est repris en tête de chaque page,
 * sans quoi les pages suivantes ne diraient plus de quelle session il s'agit.
 */
function sectionUe(
  lot: SessionLot,
  session: any,
  inscrits: any[] | null,
  premiere: boolean
): ReportBlock[] {
  const titre = `${session.ue_code ?? ""} — ${session.ue_libelle ?? session.libelle ?? ""}`.trim();
  const blocs: ReportBlock[] = [];
  if (!premiere) blocs.push({ kind: "pageBreak" });
  blocs.push(
    {
      kind: "heading",
      text: lot.title || "Session",
      note: libelleStatut(STATUT_SESSION, lot.statut),
    },
    {
      kind: "heading",
      level: 2,
      text: titre || "Unité d'enseignement",
      note:
        inscrits === null
          ? libelleStatut(STATUT_SESSION, session.statut)
          : `${libelleStatut(STATUT_SESSION, session.statut)}  ·  ${effectif(inscrits.length, "inscrit")}`,
    }
  );

  if (inscrits === null) {
    blocs.push({ kind: "note", text: "Liste des inscrits indisponible pour cette session." });
    return blocs;
  }
  if (inscrits.length === 0) {
    blocs.push({ kind: "note", text: "Aucun étudiant inscrit à cette session." });
    return blocs;
  }

  // Tri alphabétique : la liste sert de feuille d'émargement.
  const tries = [...inscrits].sort((a, b) =>
    `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
      `${b.last_name ?? ""} ${b.first_name ?? ""}`,
      "fr"
    )
  );
  const totalDu = tries.reduce((s, e) => s + Number(e.prix_unitaire ?? 0), 0);
  const totalPaye = tries.reduce((s, e) => s + Number(e.montant_paye ?? 0), 0);

  blocs.push({
    kind: "table",
    table: {
      columns: [
        { header: "N°", width: 10, align: "center" },
        { header: "Matricule", width: 28, align: "center" },
        { header: "Nom", width: 42 },
        { header: "Prénom(s)", width: 46 },
        { header: "Téléphone" },
        { header: "Inscription", width: 26, align: "center" },
        { header: "Montant dû", width: 28, align: "right" },
        { header: "Réglé", width: 28, align: "right" },
      ],
      rows: tries.map((e, i) => [
        String(i + 1),
        e.matricule || "—",
        (e.last_name || "—").toUpperCase(),
        e.first_name || "—",
        // `telephone` vient de student_profiles.phone, exposé par l'API des
        // inscriptions ; `phone` couvre les charges utiles plus anciennes.
        e.telephone || e.phone || "—",
        libelleStatut(STATUT_INSCRIPTION, e.statut),
        fmtMontant(e.prix_unitaire),
        fmtMontant(e.montant_paye),
      ]),
      footer: [
        "",
        "",
        `TOTAL — ${effectif(tries.length, "inscrit")}`,
        "",
        "",
        "",
        fmtMontant(totalDu),
        fmtMontant(totalPaye),
      ],
    },
  });
  return blocs;
}

/** Construit la fiche d'un lot de sessions, inscrits compris. */
export async function buildSessionReportSpec(lot: SessionLot): Promise<ReportSpec> {
  const sessions = lot.items ?? [];
  const inscrits = await enParallele(sessions, async (s) => {
    try {
      return await chargerInscrits(s.id);
    } catch {
      // Une liste illisible ne fait pas échouer la fiche entière.
      return null;
    }
  });

  /*
   * L'effectif de la session, ce sont les étudiants DISTINCTS : un même
   * étudiant est inscrit à plusieurs UE du lot. Additionner les inscrits UE
   * par UE annonçait « 90 étudiants » pour une session de 30, alors que chaque
   * UE en affichait bien 30.
   */
  const listes = inscrits.filter(Boolean) as any[][];
  const etudiants = new Set(
    listes.flat().map((e) => String(e.student_id ?? e.matricule ?? e.id))
  ).size;
  const totalCredits = sessions.reduce((n, s) => n + Number(s.ue_nb_uv ?? 0), 0);

  const infos: Array<[string, string]> = [
    [
      "Filière",
      lot.filiere_nom
        ? `${lot.filiere_nom}${lot.filiere_code ? ` (${lot.filiere_code})` : ""}`
        : "—",
    ],
    ["Semestre", lot.semestre_libelle || "—"],
    ["Période", `${fmtDate(lot.date_debut)} → ${fmtDate(lot.date_fin)}`],
    ["Année scolaire", lot.annee_scolaire || "—"],
    ["Statut", libelleStatut(STATUT_SESSION, lot.statut)],
    ["Unités d'enseignement", effectif(sessions.length, "UE", "UE")],
    ["Crédits cumulés", String(totalCredits)],
    ["Étudiants inscrits", effectif(etudiants, "étudiant")],
  ];

  const nomFichier = `session-${slugFichier(lot.title)}-${stampFichier()}`;

  return {
    title: "Fiche de session",
    subtitle: lot.title,
    filename: nomFichier,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(etudiants, "inscrit"),
    blocks: [
      { kind: "keyValues", items: infos, columns: 2 },
      ...sessions.flatMap((s, i) => sectionUe(lot, s, inscrits[i], i === 0)),
    ],
  };
}

export async function openSessionReportPdf(lot: SessionLot, win?: Window | null) {
  try {
    return await openReportPdf(await buildSessionReportSpec(lot), win);
  } catch (e) {
    // La construction interroge l'API : l'onglet déjà ouvert doit être refermé.
    if (win) win.close();
    throw e;
  }
}
