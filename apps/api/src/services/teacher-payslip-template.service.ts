/**
 * Bulletin de paie enseignant au format PDF — feature 031.
 *
 * CHARTE
 * Reprend celle du RELEVÉ DE NOTES remis aux étudiants
 * (`apps/web/src/lib/bulletin-pdf.ts` et `bulletin-format.ts`) : vert IPAM
 * #14532D, police Times, en-tête à trois zones — tutelle et blason à gauche,
 * titre encadré au centre, République et armoiries à droite — nom de l'institut
 * centré, filigrane du blason à 6 %, bandeaux de section pleins et pied
 * réglementaire. Un établissement qui émet deux documents dans deux chartes
 * différentes donne l'impression que l'un des deux est un faux.
 *
 * La mise en page, elle, est PROPRE À LA PAIE. Un relevé aligne des notes ;
 * un bulletin de paie justifie un montant. Les deux n'ont ni la même hiérarchie
 * de lecture ni les mêmes obligations : ici le net à payer domine, et tout le
 * reste existe pour l'expliquer.
 *
 * PAS DE TABLEAU DE DÉTAIL DES HEURES
 * Un vacataire peut cumuler trois cents séances sur une période : la liste
 * s'étalait sur plusieurs pages et noyait le montant. Le bulletin présente
 * désormais la BASE DE CALCUL — volume, taux, prorata — c'est-à-dire ce qui
 * permet de refaire l'opération, pas de la réciter.
 *
 * LE CONTENU S'ADAPTE À LA CONFIGURATION
 * Un salarié n'a pas de taux horaire, un vacataire n'a pas de salaire mensuel.
 * Afficher les deux avec des tirets ferait passer une donnée sans objet pour
 * une donnée manquante — première cause de réclamation sur un bulletin.
 *
 * Le service ne CALCULE rien : il met en page ce que `payment-calculator.ts` a
 * produit. Recalculer ici ferait diverger le PDF du montant approuvé.
 */

import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer";

/* ============ Charte IPAM, reprise du relevé de notes ================== */

/**
 * Valeurs reprises de `apps/web/src/lib/bulletin-format.ts`, qui fait
 * référence : c'est ce fichier qui habille le relevé de notes remis aux
 * étudiants. Les redéclarer ici est un pis-aller — le relevé est rendu côté
 * navigateur (jsPDF), le bulletin de paie côté serveur (Puppeteer), et les deux
 * ne peuvent pas partager le même module.
 */
const IPAM_VERT = "#14532D";
const IPAM_VERT_CLAIR = "#E8F0EB";
const VERT_OK = "#15803D";
const ROUGE = "#B91C1C";
const NOIR = "#000000";
const GRIS = "#555555";

const MINISTERE = "Ministère de l'Enseignement Supérieur\net de la Recherche Scientifique";
const REPUBLIQUE = "République de Côte d'Ivoire\nUnion – Discipline – Travail";
const INSTITUT = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT";

const PIED_MENTION =
  "Il ne peut être délivré qu'un seul exemplaire du présent bulletin de paie. " +
  "En cas de perte, un duplicata doit être justifié auprès du service comptable IPAM.";
const PIED_ADRESSE =
  "Siège : Abidjan – Cocody, II Plateaux.  Tél. : (225) 27 22-25-49-31  Fax (225) 07-04-63-83-36\n" +
  "06 BP 2708 Abidjan 06 Côte d'Ivoire   www.ipam.ci / e-mail : info@ipam.ci";

export interface PayslipLigne {
  date: string | null;
  origine: "academique" | "professionnel" | string;
  intitule: string | null;
  cohorte: string | null;
  heures: number;
  taux: number;
  montant: number;
  heures_sup?: boolean;
}

export interface PayslipConfig {
  type: "salary" | "hourly" | "mixed";
  salaireMensuel: number | null;
  salaireAnnuel: number | null;
  tauxHoraire: number | null;
  seuilHeuresSup: number | null;
  multiplicateurHeuresSup: number | null;
}

export interface PayslipData {
  paiementId: string;
  statut: string;
  devise: string;

  enseignantNom: string;
  enseignantEmail: string | null;
  enseignantMatricule: string | null;

  periodeNom: string;
  periodeDebut: string;
  periodeFin: string;

  typePaiement: string;
  montantBase: number;
  montantHeuresSup: number;
  primes: number;
  retenues: number;
  montantTotal: number;

  heuresNormales: number;
  heuresSup: number;
  tauxNormal: number | null;

  /** Configuration en vigueur sur la période — dicte ce qui est affiché. */
  config: PayslipConfig | null;
  joursOuvres: number;
  joursPeriode: number;

  /** Conservées pour l'agrégation ; plus affichées ligne à ligne. */
  lignes: PayslipLigne[];

  etablissementNom: string;
  etablissementContact: string | null;
  anneeScolaire: string | null;
  genereLe: string;

  /**
   * En-tête institutionnel, identique à celui des bulletins de notes.
   * Paramétrable par tenant (`settings_json`) avec repli sur les mentions en
   * vigueur : un établissement ivoirien n'émet pas un document officiel sans
   * la tutelle et la devise de la République.
   */
  tutelleMinistere: string;
  tutelleDirection: string;
  republique: string;
  devise_republique: string;
  /** Ville de signature — « Fait à ABIDJAN, le … ». */
  villeSignature: string;
}

/* ============================== Utilitaires =========================== */

const echappe = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const nombre = (v: number, decimales = 0): string =>
  new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v || 0);

const montant = (v: number, devise: string): string => `${nombre(Math.round(v || 0))} ${devise}`;

const heures = (v: number): string => {
  const n = Number(v || 0);
  return Number.isInteger(n) ? `${nombre(n)} h` : `${nombre(n, 2)} h`;
};

const jour = (v: string | null): string => {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("fr-FR");
};

/* ------------------------- Montant en toutes lettres ------------------- */

const UNITES = [
  "", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const DIZAINES = [
  "", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt",
];

function centaineEnLettres(n: number): string {
  if (n === 0) return "";
  if (n < 20) return UNITES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    // 70 et 90 se construisent sur soixante-dix et quatre-vingt-dix.
    if (d === 7 || d === 9) {
      const base = DIZAINES[d];
      const reste = UNITES[10 + u];
      return u === 1 && d === 7 ? "soixante et onze" : `${base}-${reste}`;
    }
    if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`;
    if (u === 0 && d === 8) return "quatre-vingts";
    return u === 0 ? DIZAINES[d] : `${DIZAINES[d]}-${UNITES[u]}`;
  }
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const prefixe = c === 1 ? "cent" : `${UNITES[c]} cent`;
  if (reste === 0) return c === 1 ? "cent" : `${prefixe}s`;
  return `${prefixe} ${centaineEnLettres(reste)}`;
}

/**
 * Montant en toutes lettres — mention d'usage sur un bulletin de paie : elle
 * lève l'ambiguïté d'un chiffre mal imprimé ou raturé.
 */
export function enLettres(v: number): string {
  const n = Math.round(Math.abs(v || 0));
  if (n === 0) return "zéro";

  const millions = Math.floor(n / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;

  const morceaux: string[] = [];
  if (millions > 0) {
    morceaux.push(millions === 1 ? "un million" : `${centaineEnLettres(millions)} millions`);
  }
  if (milliers > 0) {
    morceaux.push(milliers === 1 ? "mille" : `${centaineEnLettres(milliers)} mille`);
  }
  if (reste > 0) morceaux.push(centaineEnLettres(reste));

  const texte = morceaux.join(" ");
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/* ------------------------------ Ressources ----------------------------- */

/**
 * Logo institutionnel en data-URI : Puppeteer n'a pas de serveur à interroger.
 * On cherche d'abord celui des bulletins scolaires, pour que les trois
 * documents portent la même image.
 */
function imageDataUri(fichier: string): string | null {
  const candidats = [
    path.resolve(process.cwd(), "../web/public", fichier),
    path.resolve(process.cwd(), "apps/web/public", fichier),
    path.resolve(process.cwd(), "assets", fichier),
    path.resolve(__dirname, "../../../web/public", fichier),
    path.resolve(__dirname, "../../assets", fichier),
  ];

  for (const c of candidats) {
    try {
      if (fs.existsSync(c)) {
        const type = c.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        return `data:${type};base64,${fs.readFileSync(c).toString("base64")}`;
      }
    } catch {
      // Chemin illisible : on essaie le suivant.
    }
  }
  // Un logo introuvable ne doit jamais empêcher l'émission du bulletin.
  return null;
}

/** Blason IPAM — colonne de gauche, et filigrane de fond. */
const logoInstitut = () => imageDataUri("logo-ipam.jpeg");
/** Armoiries de Côte d'Ivoire — colonne de droite. */
const logoEmbleme = () => imageDataUri("embleme.png");

function chromiumExecutable(): string | null {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Binaire non installé pour ce runtime.
  }

  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR || (home ? path.join(home, ".cache", "puppeteer") : null);
  if (cacheRoot && fs.existsSync(path.join(cacheRoot, "chrome"))) {
    const chromeDir = path.join(cacheRoot, "chrome");
    for (const version of fs.readdirSync(chromeDir)) {
      for (const rel of [
        path.join("chrome-win64", "chrome.exe"),
        path.join("chrome-linux64", "chrome"),
        path.join("chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      ]) {
        const candidat = path.join(chromeDir, version, rel);
        if (fs.existsSync(candidat)) return candidat;
      }
    }
  }

  for (const systeme of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]) {
    if (fs.existsSync(systeme)) return systeme;
  }
  return null;
}

/* ============================== Gabarit HTML ========================== */

const STATUT_LABELS: Record<string, string> = {
  calculated: "Calculé",
  approved: "Approuvé",
  paid: "Payé",
  disputed: "Contesté",
  cancelled: "Annulé",
};

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Rémunération horaire",
  mixed: "Rémunération mixte",
};

/**
 * Lignes de la BASE DE CALCUL, choisies selon le mode de rémunération.
 *
 * C'est le cœur du document : ce qui permet à l'enseignant de refaire
 * l'opération. Chaque mode a ses grandeurs propres et n'affiche que les
 * siennes.
 */
function basesDeCalcul(d: PayslipData): Array<{ libelle: string; valeur: string; note?: string }> {
  const type = d.config?.type ?? (d.typePaiement === "Salaire" ? "salary" : "hourly");
  const lignes: Array<{ libelle: string; valeur: string; note?: string }> = [];

  if (type === "salary" || type === "mixed") {
    const mensuel = d.config?.salaireMensuel ?? null;
    if (mensuel != null) {
      lignes.push({
        libelle: "Salaire mensuel de référence",
        valeur: montant(mensuel, d.devise),
        note:
          d.config?.salaireAnnuel != null
            ? `soit ${montant(d.config.salaireAnnuel, d.devise)} annuels`
            : undefined,
      });
    }
    if (d.joursOuvres > 0) {
      lignes.push({
        libelle: "Jours ouvrés de la période",
        valeur: `${d.joursOuvres} jour(s)`,
        note: d.joursPeriode > 0 ? `sur ${d.joursPeriode} jours calendaires` : undefined,
      });
    }
  }

  if (type === "hourly" || type === "mixed") {
    lignes.push({
      libelle: "Heures normales retenues",
      valeur: heures(d.heuresNormales),
      note:
        d.tauxNormal != null
          ? `au taux de ${montant(d.tauxNormal, d.devise)} de l'heure`
          : undefined,
    });

    // Les heures supplémentaires ne sont mentionnées QUE s'il y en a : une
    // ligne à zéro suggère un oubli plutôt qu'une absence.
    if (d.heuresSup > 0) {
      const taux =
        d.tauxNormal != null && d.config?.multiplicateurHeuresSup != null
          ? d.tauxNormal * d.config.multiplicateurHeuresSup
          : null;
      lignes.push({
        libelle: "Heures supplémentaires",
        valeur: heures(d.heuresSup),
        note: taux != null ? `au taux majoré de ${montant(taux, d.devise)}` : undefined,
      });
    }

    if (d.config?.seuilHeuresSup != null && d.config?.multiplicateurHeuresSup != null) {
      lignes.push({
        libelle: "Seuil d'heures supplémentaires",
        valeur: `${d.config.seuilHeuresSup} h / semaine`,
        note: `majoration ×${nombre(d.config.multiplicateurHeuresSup, 2)}`,
      });
    }
  }

  return lignes;
}

export function buildPayslipHtml(d: PayslipData): string {
  const blason = logoInstitut();
  const embleme = logoEmbleme();
  const type = d.config?.type ?? "hourly";
  const bases = basesDeCalcul(d);

  const ligneRecap = (libelle: string, valeur: string, negatif = false) => `
      <tr>
        <td class="lib">${echappe(libelle)}</td>
        <td class="val${negatif ? " negatif" : ""}">${negatif ? "&minus; " : ""}${echappe(valeur)}</td>
      </tr>`;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Bulletin de paie — ${echappe(d.enseignantNom)}</title>
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        /* Times, comme le relevé de notes — jsPDF y utilise la police times. */
        font-family: "Times New Roman", Times, serif;
        color: ${NOIR};
        background: #fff;
        font-size: 10.5pt;
      }

      /* Filigrane : blason IPAM au centre, opacité 0.06 — même valeur que le
         relevé de notes, qui l'obtient via GState. */
      .filigrane {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 120mm; opacity: 0.06;
        z-index: 0; pointer-events: none;
      }
      .page { position: relative; z-index: 1; padding: 12mm 14mm 10mm; }

      /* ---------------- En-tête : trois zones ----------------
         Gauche  : tutelle + blason IPAM
         Centre  : titre encadré vert + année scolaire
         Droite  : République + armoiries
         Disposition reprise du relevé de notes (bulletin-pdf.ts). */
      .entete { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8mm; align-items: start; }
      .mentions { font-size: 8.5pt; line-height: 1.25; white-space: pre-line; }
      .mentions.droite { text-align: right; }
      .blason { display: block; height: 22mm; margin-top: 4mm; }
      .armoiries { display: block; height: 19mm; margin: 4mm 0 0 auto; }

      .titre-encadre {
        border: 0.5mm solid ${IPAM_VERT};
        color: ${IPAM_VERT};
        font-weight: 700; font-size: 12pt;
        padding: 2mm 5mm; text-align: center; white-space: nowrap;
      }
      .annee { text-align: center; font-size: 10pt; margin-top: 3mm; }

      .institut {
        margin: 6mm 0 0;
        text-align: center; font-weight: 700; font-size: 13pt;
        color: ${IPAM_VERT};
      }

      /* ---------------- Corps ---------------- */
      .intro { margin-top: 7mm; font-size: 10.5pt; }
      .identite { margin-top: 3mm; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; }
      .champ { font-size: 10.5pt; }
      .champ .cle {
        font-weight: 700; color: ${IPAM_VERT};
        text-decoration: underline; text-underline-offset: 2px;
        margin-right: 3mm;
      }
      .rappel { margin-top: 4mm; font-size: 10.5pt; }

      /* Bandeau de section — vert plein, comme les catégories d'UE. */
      .bandeau {
        margin: 6mm 0 0;
        background: ${IPAM_VERT}; color: #fff;
        font-weight: 700; font-size: 10pt; letter-spacing: .04em;
        padding: 1.8mm 3mm; text-transform: uppercase;
      }

      table { width: 100%; border-collapse: collapse; }
      .grille td {
        border: 0.3mm solid ${IPAM_VERT};
        padding: 1.8mm 3mm; font-size: 10pt;
      }
      .grille tbody tr:nth-child(even) td { background: ${IPAM_VERT_CLAIR}; }
      .grille .val { text-align: right; font-weight: 700; white-space: nowrap; }
      .grille .note { display: block; font-size: 8pt; font-weight: 400; color: ${GRIS}; }
      .grille .negatif { color: ${ROUGE}; }
      .grille tr.net td {
        background: ${IPAM_VERT_CLAIR};
        font-weight: 700; font-size: 12.5pt; color: ${IPAM_VERT};
      }

      .lettres {
        margin-top: 4mm; padding: 2.5mm 3mm;
        border: 0.3mm solid ${IPAM_VERT}; background: ${IPAM_VERT_CLAIR};
        font-size: 10pt;
      }
      .lettres .cle { font-weight: 700; color: ${IPAM_VERT}; }

      .decision { margin-top: 4mm; font-size: 10.5pt; }
      .decision .cle {
        font-weight: 700; color: ${IPAM_VERT};
        text-decoration: underline; text-underline-offset: 2px;
      }
      .decision .valeur { font-weight: 700; color: ${VERT_OK}; }

      /* ---------------- Signatures et pied ---------------- */
      .fait-a { margin-top: 8mm; text-align: right; font-size: 10.5pt; }
      .signatures {
        margin-top: 4mm; display: grid; grid-template-columns: 1fr 1fr; gap: 20mm;
        page-break-inside: avoid;
      }
      .signature { text-align: center; font-size: 10pt; }
      .signature .role { font-weight: 700; color: ${IPAM_VERT}; }
      .signature .trait { margin-top: 18mm; border-top: 0.3mm solid ${NOIR}; }

      .pied {
        margin-top: 8mm; padding-top: 2.5mm;
        border-top: 0.3mm solid ${IPAM_VERT};
        text-align: center; font-size: 7.5pt; line-height: 1.4; color: ${GRIS};
        white-space: pre-line;
      }
      .pied .mention { font-style: italic; }
      .pied .adresse { margin-top: 1.5mm; color: ${IPAM_VERT}; }
    </style>
  </head>
  <body>
    ${blason ? `<img class="filigrane" src="${blason}" alt="" />` : ""}
    <div class="page">

      <div class="entete">
        <div>
          <div class="mentions">${echappe(MINISTERE)}</div>
          ${blason ? `<img class="blason" src="${blason}" alt="" />` : ""}
        </div>
        <div>
          <div class="titre-encadre">BULLETIN DE PAIE</div>
          <div class="annee">Année scolaire : ${echappe(d.anneeScolaire ?? "—")}</div>
        </div>
        <div>
          <div class="mentions droite">${echappe(REPUBLIQUE)}</div>
          ${embleme ? `<img class="armoiries" src="${embleme}" alt="" />` : ""}
        </div>
      </div>

      <div class="institut">${echappe(INSTITUT)}</div>

      <div class="intro">
        La Direction, vu les services faits sur la période du
        <strong>${echappe(jour(d.periodeDebut))}</strong> au
        <strong>${echappe(jour(d.periodeFin))}</strong>, arrête la rémunération de :
      </div>

      <div class="identite">
        <div class="champ"><span class="cle">Nom et prénoms</span>${echappe(d.enseignantNom)}</div>
        <div class="champ"><span class="cle">Matricule</span>${echappe(d.enseignantMatricule ?? "—")}</div>
        <div class="champ"><span class="cle">Courriel</span>${echappe(d.enseignantEmail ?? "—")}</div>
        <div class="champ"><span class="cle">Statut</span>${echappe(TYPE_LABELS[type] ?? d.typePaiement)}</div>
        <div class="champ"><span class="cle">Période</span>${echappe(d.periodeNom)}</div>
        <div class="champ"><span class="cle">Référence</span>${echappe(d.paiementId.slice(0, 8).toUpperCase())}</div>
      </div>

      <div class="rappel">
        au titre des prestations d'enseignement de la période, selon les bases de calcul suivantes.<br />
        <strong>NB :</strong> ${echappe(
          type === "salary"
            ? "la rémunération est forfaitaire ; le volume horaire n'entre pas dans le montant."
            : "le montant est établi sur le volume horaire validé et le tarif en vigueur."
        )}
      </div>

      ${
        bases.length > 0
          ? `<div class="bandeau">Base de calcul</div>
      <table class="grille">
        <tbody>
          ${bases
            .map(
              (b) => `<tr>
                <td>${echappe(b.libelle)}</td>
                <td class="val">${echappe(b.valeur)}
                  ${b.note ? `<span class="note">${echappe(b.note)}</span>` : ""}
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`
          : ""
      }

      <div class="bandeau">Rémunération</div>
      <table class="grille">
        <tbody>
          ${ligneRecap(
            type === "salary"
              ? "Rémunération de base (prorata de la période)"
              : "Rémunération de base",
            montant(d.montantBase, d.devise)
          )}
          ${d.montantHeuresSup > 0 ? ligneRecap("Heures supplémentaires", montant(d.montantHeuresSup, d.devise)) : ""}
          ${d.primes > 0 ? ligneRecap("Primes et indemnités", montant(d.primes, d.devise)) : ""}
          ${d.retenues > 0 ? ligneRecap("Retenues", montant(d.retenues, d.devise), true) : ""}
          <tr class="net">
            <td>NET À PAYER</td>
            <td class="val">${echappe(montant(d.montantTotal, d.devise))}</td>
          </tr>
        </tbody>
      </table>

      <div class="lettres">
        <span class="cle">Arrêté à la somme de :</span>
        ${echappe(enLettres(d.montantTotal))} ${echappe(d.devise)}
      </div>

      <div class="decision">
        <span class="cle">État du versement</span>
        &nbsp;<span class="valeur">${echappe(STATUT_LABELS[d.statut] ?? d.statut)}</span>
      </div>

      <div class="fait-a">Fait à ${echappe(d.villeSignature)}, le ${echappe(jour(d.genereLe))}</div>

      <div class="signatures">
        <div class="signature">
          <div class="role">Le bénéficiaire</div>
          <div class="trait"></div>
        </div>
        <div class="signature">
          <div class="role">Visa le Directeur Administratif et Financier</div>
          <div class="trait"></div>
        </div>
      </div>

      <div class="pied">
        <div class="mention">${echappe(PIED_MENTION)}</div>
        <div class="adresse">${echappe(PIED_ADRESSE)}</div>
      </div>

    </div>
  </body>
</html>`;
}

/* ============================== Rendu PDF ============================= */

export async function renderPayslipPdf(data: PayslipData): Promise<Buffer> {
  const html = buildPayslipHtml(data);

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: "new" as any,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  const chrome = chromiumExecutable();
  if (chrome) launchOptions.executablePath = chrome;

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Le cadre décoratif fait office de marge visuelle : les marges papier
      // restent faibles pour que le document tienne sur une page.
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
