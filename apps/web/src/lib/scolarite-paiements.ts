import type { ReceiptData } from "@/lib/receipt-pdf";
import {
  LIGNES,
  type LigneKey,
  type LotDetail,
  type LotPayment,
} from "@/lib/hooks/use-scolarite-paiements";

/**
 * Mécanique d'encaissement du barème de scolarité, pour
 * /admin/finances/student-payments : regroupement des lignes de paiement en
 * transactions, numéro de reçu affiché, et construction du reçu PDF.
 *
 * Ces fonctions vivent à part de la page : la construction d'un reçu n'a pas sa
 * place dans le corps d'un composant.
 */

export function fmtFCFA(v?: number | null): string {
  return `${Math.round(Number(v ?? 0)).toLocaleString("fr-FR")} FCFA`;
}

export function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}

export function nomComplet(p: { firstName?: string | null; lastName?: string | null }): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Étudiant";
}

export function libelleLigne(ligne: LigneKey | string): string {
  return LIGNES.find((l) => l.key === ligne)?.label ?? String(ligne);
}

/**
 * Une transaction = les lignes de paiement partageant le même horodatage. Un
 * règlement réparti sur plusieurs commandes reste UNE opération, donc un reçu.
 */
export interface Transaction {
  key: string;
  rows: LotPayment[];
  montant: number;
  /** Cumul réglé jusqu'à cette transaction incluse — imprimé sur le reçu. */
  totalPaye: number;
  mode: string;
  reference: string | null;
  paidAt: string;
  /** Ligne du barème réglée : les commandes d'UE nourrissent la scolarité. */
  ligne: LigneKey;
}

export function buildTransactions(payments: LotPayment[]): Transaction[] {
  const map = new Map<string, LotPayment[]>();
  for (const p of payments) {
    if (p.statut !== "confirme") continue;
    const key = String(p.paid_at ?? p.created_at ?? p.id);
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }

  const list: Transaction[] = [...map.entries()].map(([key, rows]) => ({
    key,
    rows,
    montant: rows.reduce((a, r) => a + Number(r.montant), 0),
    totalPaye: 0,
    mode: rows[0]?.mode,
    reference: rows.find((r) => r.reference_transaction)?.reference_transaction ?? null,
    paidAt: key,
    ligne: (rows[0]?.nature === "ue" ? "scolarite" : rows[0]?.nature) as LigneKey,
  }));

  list.sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
  let cumul = 0;
  for (const t of list) {
    cumul += t.montant;
    t.totalPaye = cumul;
  }
  return list;
}

/** N° de reçu affiché : le premier, avec « (+N) » si la transaction en couvre plusieurs. */
export function numeroRecu(t: Transaction): string {
  const nums = t.rows.map((r) => r.receipt_number).filter(Boolean) as string[];
  if (nums.length <= 1) return nums[0] ?? "—";
  return `${nums[0]} (+${nums.length - 1})`;
}

/**
 * Tous les numéros couverts par une transaction, pour le REÇU IMPRIMÉ.
 *
 * L'abréviation « (+N) » convient à une liste à l'écran ; elle ne convient pas à
 * une pièce comptable. Un règlement réparti sur deux UE produit deux numéros
 * de reçu en base : le document remis doit porter les deux, sinon le second
 * n'a aucune trace papier et ne peut pas être rapproché.
 */
export function numerosRecu(t: Transaction): string {
  const nums = t.rows.map((r) => r.receipt_number).filter(Boolean) as string[];
  return nums.length === 0 ? "—" : nums.join(" · ");
}

/**
 * Reçu d'une transaction. Un règlement de scolarité détaille les UE suivies ;
 * les trois autres lignes détaillent le frais lui-même.
 */
export function buildReceipt(lot: LotDetail, t: Transaction): ReceiptData {
  const estScolarite = t.ligne === "scolarite";

  return {
    receipt_number: numerosRecu(t),
    reference_transaction: t.reference,
    montant: t.montant,
    mode: t.mode,
    paid_at: t.paidAt,
    student: {
      first_name: lot.firstName ?? undefined,
      last_name: lot.lastName ?? undefined,
      matricule: lot.matricule,
    },
    classe: { nom: lot.classeNom, code: lot.classeCode },
    filiere: { nom: lot.filiereNom },
    total_du: lot.du,
    total_paye: t.totalPaye,
    objet: estScolarite
      ? { titre: "OBJET DU PAIEMENT — UNITÉS D'ENSEIGNEMENT", colonne: "Unité d'enseignement (UE)" }
      : { titre: "OBJET DU PAIEMENT — FRAIS DE SCOLARITÉ", colonne: "Frais" },
    ues:
      estScolarite && lot.ues.length > 0
        ? lot.ues.map((u) => ({ libelle: u.ue_libelle, code: u.ue_code, montant: u.montant }))
        : [
            {
              libelle: libelleLigne(t.ligne),
              code: null,
              montant: lot.lignes[t.ligne]?.du ?? t.montant,
            },
          ],
  };
}
