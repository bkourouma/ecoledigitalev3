"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProfessionalPayment } from "@ecoledigitale/contracts";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks de l'espace étudiant — Module Professionnel (feature 028, US2).
 * Catalogue, panier, commande, paiement, inscriptions — via le proxy
 * Next.js `/api/v1/professional/student/*`.
 */

const BASE = "/api/v1/professional/student";

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

/* ----------------------------- Catalogue ----------------------------- */

export function useProfessionalProgrammes() {
  return useQuery({
    queryKey: ["professional-student-programmes"],
    queryFn: () => apiFetch(`${BASE}/programmes`),
    staleTime: 60 * 1000,
  });
}

export function useProfessionalCatalog(filiereId: string | null) {
  return useQuery({
    queryKey: ["professional-student-catalog", filiereId],
    queryFn: () => apiFetch(`${BASE}/catalog?filiere_id=${filiereId}`),
    enabled: !!filiereId,
  });
}

/** ECUE débloquées par une inscription confirmée à une session (UE). */
export function useStudentSessionEcue(ueSessionId: string | null) {
  return useQuery({
    queryKey: ["professional-student-session-ecue", ueSessionId],
    queryFn: () => apiFetch(`${BASE}/ue/${ueSessionId}/ecue`),
    enabled: !!ueSessionId,
  });
}

/* ------------------------------ Panier ------------------------------- */

export function useProfessionalCart() {
  return useQuery({
    queryKey: ["professional-student-cart"],
    queryFn: () => apiFetch(`${BASE}/cart`),
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ueSessionId: string) =>
      apiFetch(`${BASE}/cart/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ue_session_id: ueSessionId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-cart"] });
      qc.invalidateQueries({ queryKey: ["professional-student-catalog"], exact: false });
    },
  });
}

/** Auto-inscription directe à une session (sans panier). */
export function useStudentSelfEnroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ueSessionId: string) =>
      apiFetch(`${BASE}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ue_session_id: ueSessionId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-enrollments"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-student-catalog"], exact: false });
    },
  });
}

export function useRemoveFromCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string) =>
      apiFetch(`${BASE}/cart/items/${enrollmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-cart"] });
      qc.invalidateQueries({ queryKey: ["professional-student-catalog"], exact: false });
    },
  });
}

/* -------------------------- Commande / Paiement ---------------------- */

export function useValidateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`${BASE}/orders`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-cart"] });
      qc.invalidateQueries({ queryKey: ["professional-student-orders"], exact: false });
    },
  });
}

export function useProfessionalOrders() {
  return useQuery({
    queryKey: ["professional-student-orders"],
    queryFn: () => apiFetch(`${BASE}/orders`),
  });
}

export function useProfessionalOrder(id: string | null) {
  return useQuery({
    queryKey: ["professional-student-order", id],
    queryFn: () => apiFetch(`${BASE}/orders/${id}`),
    enabled: !!id,
  });
}

export function usePayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: CreateProfessionalPayment }) =>
      apiFetch(`${BASE}/orders/${orderId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-orders"], exact: false });
      qc.invalidateQueries({ queryKey: ["professional-student-enrollments"] });
    },
  });
}

/* ---------------------------- Inscriptions --------------------------- */

export function useMyProfessionalEnrollments() {
  return useQuery({
    queryKey: ["professional-student-enrollments"],
    queryFn: () => apiFetch(`${BASE}/enrollments`),
  });
}

/* ------------------------ Présences & absences ----------------------- */

/**
 * Séances des cohortes de l'étudiant connecté avec son pointage éventuel —
 * mêmes lignes que celles servies au parent. Alimente
 * `/professionnel/etudiant/presences`.
 */
export function useMyAttendanceHistory() {
  return useQuery({
    queryKey: ["professional-student-attendance"],
    queryFn: () => apiFetch(`${BASE}/attendance`),
  });
}

/* ------------------------- Suivi des versements ---------------------- */

/**
 * Versements de l'étudiant connecté : la traçabilité de « Mes paiements ».
 *
 * La charge utile ne porte NI numéro NI lien de reçu — l'espace étudiant suit
 * ses règlements, il ne délivre pas de reçus.
 */
export function useMyProfessionalPayments() {
  return useQuery<{ payments: any[]; total_verse: number }>({
    queryKey: ["professional-student-payments"],
    queryFn: () => apiFetch(`${BASE}/payments`),
  });
}

/**
 * Reçus de l'étudiant connecté : mêmes lignes que celles servies au parent
 * (numéro de reçu, matricule, filière, UE réglées, contexte scolaire), pour
 * regénérer le reçu PDF. Alimente « Bulletins & Reçus » de l'espace étudiant.
 */
export function useMyProfessionalReceipts() {
  return useQuery<any[]>({
    queryKey: ["professional-student-receipts"],
    queryFn: () => apiFetch(`${BASE}/receipts`),
  });
}
