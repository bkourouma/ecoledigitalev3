/**
 * Export PDF d'une ouverture de classe — une fiche par semestre de la classe,
 * jamais un bloc pour plusieurs : c'est semestre par semestre que l'information
 * est exploitable (liste d'émargement, remise au responsable de filière…).
 *
 * L'écran regroupe les sessions d'UE d'un même semestre en un « lot » ; le
 * document en donne les informations en tête, puis la liste COMPLÈTE des
 * étudiants du semestre — une ligne par étudiant, sans détail UE par UE.
 *
 * Attention au vocabulaire du module professionnel : ce qu'il appelle
 * `filiere_nom` est en réalité le nom de la CLASSE (table `programmes`). La
 * vraie filière — celle de /academic/programmes — est rattachée à la classe et
 * arrive ici par `classe_filiere_nom`.
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

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

/**
 * Niveau d'une classe : le préfixe de cycle de son nom
 * (« MASTER 2 INTELLIGENCE ARTIFICIELLE » → « MASTER 2 »).
 *
 * Même découpage que la migration 0116, qui a dérivé la filière en retirant
 * précisément ce préfixe : niveau et filière recomposent donc exactement le nom
 * de la classe.
 */
function niveauDeClasse(nomClasse?: string | null): string {
  const m = /^\s*(LICENCE|MASTER|BTS|CERTIFICAT|DUT|BAC)\s*([0-9]*)/i.exec(nomClasse ?? "");
  if (!m) return "—";
  return [m[1].toUpperCase(), m[2]].filter(Boolean).join(" ");
}

/** Le lot tel que l'écran le construit (voir la page Sessions). */
export interface SessionLot {
  title: string;
  semestre_libelle?: string | null;
  /** Nom de la CLASSE (le module professionnel l'appelle « filière »). */
  filiere_nom?: string | null;
  filiere_code?: string | null;
  /** Filière académique de la classe, telle que gérée dans /academic/programmes. */
  classe_filiere_nom?: string | null;
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
 * Liste complète des étudiants du semestre : une ligne par étudiant, pas de
 * découpage par UE.
 *
 * Un même étudiant étant inscrit à plusieurs UE du lot, ses inscriptions sont
 * fusionnées : montant dû et montant réglé sont ses cumuls sur le semestre.
 */
function tableauInscrits(listes: Array<any[] | null>): ReportBlock[] {
  const manquantes = listes.filter((l) => l === null).length;
  const blocs: ReportBlock[] = [];

  const parEtudiant = new Map<string, any>();
  for (const liste of listes) {
    for (const e of liste ?? []) {
      const cle = String(e.student_id ?? e.matricule ?? e.id);
      const deja = parEtudiant.get(cle);
      if (!deja) {
        parEtudiant.set(cle, {
          matricule: e.matricule ?? null,
          last_name: e.last_name ?? null,
          first_name: e.first_name ?? null,
          // `telephone` vient de student_profiles.phone, exposé par l'API des
          // inscriptions ; `phone` couvre les charges utiles plus anciennes.
          telephone: e.telephone ?? e.phone ?? null,
          prix_unitaire: Number(e.prix_unitaire ?? 0),
          montant_paye: Number(e.montant_paye ?? 0),
        });
        continue;
      }
      deja.prix_unitaire += Number(e.prix_unitaire ?? 0);
      deja.montant_paye += Number(e.montant_paye ?? 0);
      deja.telephone = deja.telephone ?? e.telephone ?? e.phone ?? null;
    }
  }

  if (manquantes > 0) {
    blocs.push({
      kind: "note",
      text: `${effectif(manquantes, "UE", "UE")} n'${
        manquantes === 1 ? "a" : "ont"
      } pas pu être interrogée${manquantes === 1 ? "" : "s"} : ${
        manquantes === 1 ? "ses inscrits ne figurent pas" : "leurs inscrits ne figurent pas"
      } dans la liste.`,
    });
  }
  if (parEtudiant.size === 0) {
    blocs.push({ kind: "note", text: "Aucun étudiant inscrit sur ce semestre." });
    return blocs;
  }

  // Tri alphabétique : la liste sert de feuille d'émargement.
  const tries = Array.from(parEtudiant.values()).sort((a, b) =>
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
        // Assez large pour que « IPAM-L1GL-9009 » tienne sur une seule ligne :
        // coupé, le matricule n'est plus lisible d'un coup d'œil.
        { header: "Matricule", width: 42, align: "center" },
        { header: "Nom & Prénom(s)", width: 90 },
        { header: "Téléphone" },
        { header: "Montant dû", width: 28, align: "right" },
        { header: "Réglé", width: 28, align: "right" },
      ],
      rows: tries.map((e, i) => [
        String(i + 1),
        e.matricule || "—",
        `${(e.last_name || "—").toUpperCase()} ${e.first_name || ""}`.trim(),
        e.telephone || "—",
        fmtMontant(e.prix_unitaire),
        fmtMontant(e.montant_paye),
      ]),
      footer: [
        "",
        "",
        `TOTAL — ${effectif(tries.length, "inscrit")}`,
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
    ["Classe", lot.title || lot.filiere_nom || "—"],
    ["Niveau", niveauDeClasse(lot.filiere_nom)],
    ["Filière", lot.classe_filiere_nom || "—"],
    ["Semestre", lot.semestre_libelle || "—"],
    ["Période", `${fmtDate(lot.date_debut)} → ${fmtDate(lot.date_fin)}`],
    ["Année scolaire", lot.annee_scolaire || "—"],
    ["Unités d'enseignement", effectif(sessions.length, "UE", "UE")],
    ["Crédits cumulés", String(totalCredits)],
    ["Étudiants inscrits", effectif(etudiants, "étudiant")],
  ];

  // Le nom porte le semestre quand la fiche n'en couvre qu'un : deux fiches de
  // la même classe éditées le même jour se distinguent ainsi.
  const nomFichier = `fiche-classe-${slugFichier(
    [lot.title, lot.semestre_libelle].filter(Boolean).join(" ")
  )}-${stampFichier()}`;

  return {
    title: "Fiche de classe",
    // Pas de sous-titre : la classe et le semestre sont rappelés dans le
    // tableau d'informations, juste en dessous.
    filename: nomFichier,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(etudiants, "inscrit"),
    blocks: [{ kind: "keyValues", items: infos, columns: 2 }, ...tableauInscrits(inscrits)],
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
