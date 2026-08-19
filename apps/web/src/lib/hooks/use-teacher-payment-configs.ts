"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreateTeacherPaymentConfig,
  TeacherPaymentConfig,
  UpdateTeacherPaymentConfig,
} from "@ecoledigitale/contracts";

/**
 * Configurations de paiement des enseignants.
 *
 * Aucune fonction ci-dessous ne pose `X-Tenant` ni `X-User-Id` : c'est
 * `fetch-interceptor` qui les dérive du JWT. Les valeurs étaient auparavant
 * écrites en dur dans ce fichier (tenant « imhotepacademy », un identifiant
 * utilisateur fixe) — l'intercepteur ne remplace `X-User-Id` que s'il est
 * ABSENT, donc chaque requête partait sous une identité étrangère.
 */

const BASE = "/api/v1/teacher-payment-configs";

/**
 * Ce que la liste renvoie RÉELLEMENT, jointures comprises. Le contrat
 * `TeacherPaymentConfig` décrit la table seule (et type les dates en `Date`,
 * alors que l'API sérialise des chaînes) : s'en servir ici mentirait sur
 * `teacherName` / `teacherEmail`, qui viennent d'un JOIN.
 */
export interface TeacherPaymentConfigRow {
  id: string;
  tenantId: string;
  academicYearId?: string | null;
  teacherId: string;
  configType: "salary" | "hourly" | "mixed";
  monthlySalary?: number;
  annualSalary?: number;
  defaultHourlyRate?: number;
  overtimeThreshold: number;
  overtimeMultiplier: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  teacherName: string;
  teacherEmail: string;
}

export interface TeacherPaymentConfigsPage {
  data: TeacherPaymentConfigRow[];
  pagination: { cursor?: string; hasMore: boolean; total: number };
}

/**
 * Plafond accepté par l'API. Le défaut serveur est de 20, ce qui tronquait
 * silencieusement la liste dès la 21e configuration : on demande le maximum et
 * l'écran signale explicitement s'il en reste au-delà.
 */
const LIST_LIMIT = 100;

async function readError(response: Response, fallback: string): Promise<never> {
  const body: { message?: string; error?: string } = await response.json().catch(() => ({}));
  throw new Error(body.message || body.error || fallback);
}

async function fetchTeacherPaymentConfigs(): Promise<TeacherPaymentConfigsPage> {
  const response = await fetch(`${BASE}?limit=${LIST_LIMIT}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) await readError(response, "Impossible de charger les configurations");
  const payload = await response.json();
  return {
    data: payload.data ?? [],
    pagination: payload.pagination ?? { hasMore: false, total: payload.data?.length ?? 0 },
  };
}

async function fetchTeacherPaymentConfig(id: string): Promise<TeacherPaymentConfig> {
  const response = await fetch(`${BASE}/${id}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) await readError(response, "Impossible de charger la configuration");
  const payload = await response.json();
  // L'API renvoie { data: TeacherPaymentConfig }.
  return payload.data || payload;
}

/** L'API attend des dates au format YYYY-MM-DD. */
function toApiDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.toISOString().split("T")[0];
}

async function createTeacherPaymentConfig(
  data: CreateTeacherPaymentConfig
): Promise<TeacherPaymentConfig> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...data,
      effectiveFrom: toApiDate(data.effectiveFrom),
      effectiveTo: toApiDate(data.effectiveTo),
    }),
  });
  if (!response.ok) await readError(response, "Impossible de créer la configuration");
  return response.json();
}

async function updateTeacherPaymentConfig(
  id: string,
  data: UpdateTeacherPaymentConfig
): Promise<TeacherPaymentConfig> {
  const payload: Record<string, unknown> = { ...data };
  if (data.effectiveFrom) payload.effectiveFrom = toApiDate(data.effectiveFrom);
  if (data.effectiveTo) payload.effectiveTo = toApiDate(data.effectiveTo);

  const response = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await readError(response, "Impossible de mettre à jour la configuration");
  return response.json();
}

async function deleteTeacherPaymentConfig(id: string): Promise<void> {
  const response = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!response.ok) await readError(response, "Impossible de supprimer la configuration");
}

/**
 * La liste complète, non filtrée. Le filtrage par enseignant se fait côté
 * écran : l'API sait le faire (`?teacherId=`), mais l'appliquer au serveur
 * réduirait aussi le jeu dont on tire les options du sélecteur, qui se
 * retrouverait à ne plus proposer que l'enseignant déjà choisi.
 */
export function useTeacherPaymentConfigs() {
  return useQuery({
    queryKey: ["teacher-payment-configs"],
    queryFn: fetchTeacherPaymentConfigs,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeacherPaymentConfig(id: string) {
  return useQuery({
    queryKey: ["teacher-payment-configs", id],
    queryFn: () => fetchTeacherPaymentConfig(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTeacherPaymentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTeacherPaymentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
    },
  });
}

export function useUpdateTeacherPaymentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTeacherPaymentConfig }) =>
      updateTeacherPaymentConfig(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs", id] });
    },
  });
}

export function useDeleteTeacherPaymentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTeacherPaymentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-payment-configs"] });
    },
  });
}
