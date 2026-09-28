"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Paiements étudiants — le barème complet d'un LOT (un étudiant × une classe).
 *
 * Le dû d'un lot est le barème de sa classe (`cycles_frais`, écran
 * /admin/finances/scolarite) : inscription, scolarité, frais annexes et autres
 * frais. Les inscriptions aux UE du module professionnel alimentent la ligne
 * « scolarité ». L'encaissement reprend le modèle du module professionnel :
 * règlement partiel possible, mode, référence, et un reçu par commande servie.
 */

const BASE = "/api/v1/professional/scolarite";

/** Les quatre lignes du barème, dans l'ordre d'affichage. */
export const LIGNES = [
  { key: "inscription", label: "Inscription" },
  { key: "scolarite", label: "Scolarité" },
  { key: "annexes", label: "Frais annexes" },
  { key: "autres", label: "Autres frais" },
] as const;

export type LigneKey = (typeof LIGNES)[number]["key"];

/** Modes de règlement — repris du module professionnel. */
export const MODES = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement bancaire" },
  { value: "autre", label: "Autre" },
] as const;

export const MODE_LABEL: Record<string, string> = Object.fromEntries(
  MODES.map((m) => [m.value, m.label])
);

export interface MontantLigne {
  du: number;
  paye: number;
  reste: number;
}

export interface Lot {
  studentId: string;
  programmeId: string;
  firstName: string | null;
  lastName: string | null;
  matricule: string | null;
  classeNom: string;
  classeCode: string | null;
  filiereId: string | null;
  filiereNom: string | null;
  cycleNom: string | null;
  devise: string;
  lignes: Record<LigneKey, MontantLigne>;
  du: number;
  paye: number;
  reste: number;
  etat: "non_regle" | "partiel" | "solde";
  /**
   * La classe a-t-elle encore une ouverture active sur l'écran Sessions
   * (ni brouillon, ni terminée, ni annulée) ? Sert à ne proposer au filtre que
   * les classes en cours.
   */
  classeOuverte: boolean;
}

export interface LotPayment {
  id: string;
  order_id: string;
  montant: number;
  mode: string;
  reference_transaction: string | null;
  statut: string;
  paid_at: string | null;
  receipt_number: string | null;
  created_at: string;
  nature: string;
}

export interface LotDetail extends Lot {
  ues: {
    id: string;
    ue_code: string;
    ue_libelle: string;
    session_libelle: string | null;
    /** Semestre de la cohorte, `null` si elle n'est rattachée à aucun. */
    semestre_id: string | null;
    semestre_libelle: string | null;
    montant: number;
  }[];
  payments: LotPayment[];
}

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (init?.body == null) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

/** Situation financière de tous les lots, filtrable par filière ou par classe. */
export function useScolariteLots(filters: { filiere_id?: string; programme_id?: string } = {}) {
  return useQuery({
    queryKey: ["scolarite-lots", filters],
    queryFn: async () => {
      const data = await apiFetch<{ items: Lot[] }>(
        `${BASE}/lots${buildQueryString(filters as any)}`
      );
      return data.items ?? [];
    },
    staleTime: 30 * 1000,
  });
}

/** Détail d'un lot : lignes du barème, UE et historique des paiements. */
export function useScolariteLot(studentId: string | null, programmeId: string | null) {
  return useQuery({
    queryKey: ["scolarite-lot", studentId, programmeId],
    enabled: Boolean(studentId && programmeId),
    queryFn: () => apiFetch<LotDetail>(`${BASE}/lots/${studentId}/${programmeId}`),
  });
}

/** Encaisse un règlement sur une ligne du barème. */
export function useRecordLotPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      studentId,
      programmeId,
      ...body
    }: {
      studentId: string;
      programmeId: string;
      ligne: LigneKey;
      montant: number;
      mode: string;
      reference_transaction?: string;
    }) =>
      apiFetch(`${BASE}/lots/${studentId}/${programmeId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scolarite-lots"], exact: false });
      qc.invalidateQueries({ queryKey: ["scolarite-lot"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false });
    },
  });
}
