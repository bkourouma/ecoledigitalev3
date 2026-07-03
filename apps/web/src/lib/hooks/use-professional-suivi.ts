"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hooks de suivi admin — Module Professionnel (feature 028, US4).
 * Inscriptions, paiements, achèvement — via `/api/v1/professional/*`.
 */

const BASE = "/api/v1/professional";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  // Pas de Content-Type sur une requête sans corps : sinon le backend Fastify
  // rejette le corps vide (FST_ERR_CTP_EMPTY_JSON_BODY) — ex. POST sans body.
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

export interface AdminEnrollmentsQuery {
  filiere_id?: string;
  ue_session_id?: string;
  ue_id?: string;
  student_id?: string;
  statut?: string;
  page?: number;
  pageSize?: number;
}

export function useAdminEnrollments(query: AdminEnrollmentsQuery = {}) {
  return useQuery({
    queryKey: ["professional-admin-enrollments", query],
    queryFn: () => apiFetch(`${BASE}/enrollments${buildQueryString(query as any)}`),
  });
}

/**
 * Récupère l'INTÉGRALITÉ des inscriptions (admin) en bouclant sur les pages
 * (lots de 500), afin de contourner le plafond de pagination de l'API. Sert par
 * ex. à masquer les étudiants déjà inscrits dans une session encore active.
 * Renvoie { items, total }. La clé partage le préfixe « professional-admin-
 * enrollments » pour être invalidée par les mutations d'inscription.
 */
export function useAllAdminEnrollments(
  query: Omit<AdminEnrollmentsQuery, "page" | "pageSize"> = {}
) {
  return useQuery({
    queryKey: ["professional-admin-enrollments", "all", query],
    queryFn: async () => {
      const pageSize = 500;
      const all: any[] = [];
      let page = 1;
      for (;;) {
        const res: any = await apiFetch(
          `${BASE}/enrollments${buildQueryString({ ...query, page, pageSize } as any)}`
        );
        const batch: any[] = res?.items ?? [];
        all.push(...batch);
        const total: number = res?.total ?? all.length;
        if (batch.length === 0 || all.length >= total || page > 100) break;
        page += 1;
      }
      return { items: all, total: all.length };
    },
    staleTime: 30 * 1000,
  });
}

export function useAdminPayments(query: { statut?: string; order_id?: string } = {}) {
  return useQuery({
    queryKey: ["professional-admin-payments", query],
    queryFn: () => apiFetch(`${BASE}/payments${buildQueryString(query as any)}`),
  });
}

export function useCompleteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string) =>
      apiFetch(`${BASE}/enrollments/${enrollmentId}/complete`, { method: "POST" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false }),
  });
}

/** Détail enrichi d'une inscription (admin). */
export function useEnrollment(id: string | null) {
  return useQuery({
    queryKey: ["professional-enrollment", id],
    queryFn: () => apiFetch(`${BASE}/enrollments/${id}`),
    enabled: !!id,
  });
}
// (recompilation forcée — export useEnrollment)

/** Met à jour le statut d'une inscription. */
export function useUpdateEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: string }) =>
      apiFetch(`${BASE}/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false }),
  });
}

/** Paiement d'un étudiant réparti sur plusieurs inscriptions (lot). */
export function useRecordStudentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      enrollmentIds,
      montant,
      mode,
      reference_transaction,
    }: {
      enrollmentIds: string[];
      montant: number;
      mode: string;
      reference_transaction?: string;
    }) =>
      apiFetch(`${BASE}/enrollments/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollment_ids: enrollmentIds, montant, mode, reference_transaction }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-enrollments-payments"], exact: false });
    },
  });
}

/** Historique fusionné des paiements d'un lot (plusieurs inscriptions). */
export function useEnrollmentsPaymentsHistory(enrollmentIds: string[]) {
  const key = [...enrollmentIds].sort().join(",");
  return useQuery({
    queryKey: ["professional-enrollments-payments", key],
    queryFn: () =>
      apiFetch(`${BASE}/enrollments/payments-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollment_ids: enrollmentIds }),
      }),
    enabled: enrollmentIds.length > 0,
  });
}

/** Historique des paiements d'une inscription. */
export function useEnrollmentPayments(enrollmentId: string | null) {
  return useQuery({
    queryKey: ["professional-enrollment-payments", enrollmentId],
    queryFn: () => apiFetch(`${BASE}/enrollments/${enrollmentId}/payments`),
    enabled: !!enrollmentId,
  });
}

/** Enregistre un paiement (partiel possible) sur une inscription. */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      montant,
      mode,
      reference_transaction,
    }: {
      id: string;
      montant: number;
      mode: string;
      reference_transaction?: string;
    }) =>
      apiFetch(`${BASE}/enrollments/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ montant, mode, reference_transaction }),
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-enrollment-payments", v.id] });
      qc.invalidateQueries({ queryKey: ["professional-enrollment"], exact: false });
    },
  });
}

/** Supprime une inscription. */
export function useDeleteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/enrollments/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false }),
  });
}

/** Inscription en lot : N étudiants × M sessions. */
export function useAdminEnrollBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ueSessionIds,
      studentIds,
    }: {
      ueSessionIds: string[];
      studentIds: string[];
    }) =>
      apiFetch(`${BASE}/enrollments/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ue_session_ids: ueSessionIds, student_ids: studentIds }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false }),
  });
}

/** Inscription directe d'un étudiant à une session par un administrateur. */
export function useAdminEnrollStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ueSessionId, studentId }: { ueSessionId: string; studentId: string }) =>
      apiFetch(`${BASE}/ue-sessions/${ueSessionId}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-admin-enrollments"], exact: false }),
  });
}
