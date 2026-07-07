"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks pour les évaluations professionnelles (création, liste, soumissions,
 * correction). Système parallèle au système académique d'assignments.
 */

const BASE = "/api/v1/professional";

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

export function useAssignments(filters: { ecue_id?: string; ue_session_id?: string }) {
  const qs = new URLSearchParams();
  if (filters.ecue_id) qs.set("ecue_id", filters.ecue_id);
  if (filters.ue_session_id) qs.set("ue_session_id", filters.ue_session_id);
  return useQuery({
    queryKey: ["professional-assignments", filters],
    queryFn: () => apiFetch(`${BASE}/assignments?${qs.toString()}`),
    enabled: !!filters.ecue_id || !!filters.ue_session_id,
  });
}

/**
 * Rafraîchit les deux vues qui listent les évaluations : la vue par ECUE
 * (onglet Évaluations d'une session) et la vue globale enseignant
 * (page « Mes évaluations »).
 */
function invalidateAssignmentLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["professional-assignments"] });
  qc.invalidateQueries({ queryKey: ["professional-teacher-assignments"] });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch(`${BASE}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAssignmentLists(qc),
  });
}

export function useUpdateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiFetch(`${BASE}/assignments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAssignmentLists(qc),
  });
}

export function useDeleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`${BASE}/assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAssignmentLists(qc),
  });
}

export interface DuplicateAssignmentResult {
  created: any[];
  skipped: Array<{
    ecue_id: string;
    ue_session_id: string | null;
    reason: string;
    message: string;
  }>;
}

/**
 * Duplique (« assigne ») une évaluation existante vers d'autres cibles
 * ECUE × cohorte affectées à l'enseignant (autres filières). Renvoie le détail
 * des duplicatas créés et des cibles ignorées.
 */
export function useDuplicateAssignment() {
  const qc = useQueryClient();
  return useMutation<
    DuplicateAssignmentResult,
    Error,
    {
      sourceId: string;
      targets: Array<{ ecue_id: string; ue_session_id?: string | null }>;
      due_at?: string | null;
      starts_at?: string | null;
      statut?: string | null;
    }
  >({
    mutationFn: ({ sourceId, targets, due_at, starts_at, statut }) =>
      apiFetch(`${BASE}/assignments/${sourceId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets, due_at, starts_at, statut }),
      }),
    onSuccess: () => invalidateAssignmentLists(qc),
  });
}

export function useUploadAssignmentSubjectDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, file }: { assignmentId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);

      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"];

      const res = await fetch(`${BASE}/assignments/${assignmentId}/subject-document/upload`, {
        method: "POST",
        headers,
        body: formData,
      });
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
      return json?.data ?? json;
    },
    onSuccess: () => invalidateAssignmentLists(qc),
  });
}

export function useAssignmentSubmissions(assignmentId: string | null) {
  return useQuery({
    queryKey: ["professional-assignment-submissions", assignmentId],
    queryFn: () => apiFetch(`${BASE}/assignments/${assignmentId}/submissions`),
    enabled: !!assignmentId,
  });
}

export function useGradeSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      studentId,
      note,
      appreciation,
    }: {
      assignmentId: string;
      studentId: string;
      note: number;
      appreciation?: string;
    }) =>
      apiFetch(`${BASE}/assignments/${assignmentId}/submissions/${studentId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, appreciation }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({
        queryKey: ["professional-assignment-submissions", vars.assignmentId],
      });
      // Le nombre de copies notées change → rafraîchir les listes d'évaluations.
      qc.invalidateQueries({ queryKey: ["professional-teacher-assignments"] });
    },
  });
}

export function useStudentAssignments() {
  return useQuery({
    queryKey: ["professional-student-assignments"],
    queryFn: () => apiFetch(`${BASE}/student/assignments`),
  });
}

export function useSubmitAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      contenu,
      file_url,
    }: {
      assignmentId: string;
      contenu?: string;
      file_url?: string;
    }) =>
      apiFetch(`${BASE}/assignments/${assignmentId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenu, file_url }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-assignments"] });
    },
  });
}

/** Soumission étudiante avec upload de fichier (multipart). */
export function useSubmitAssignmentWithFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      file,
      contenu,
    }: {
      assignmentId: string;
      file: File;
      contenu?: string;
    }) => {
      const formData = new FormData();
      if (contenu) formData.append("contenu", contenu);
      formData.append("file", file);

      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"];

      const res = await fetch(`${BASE}/assignments/${assignmentId}/submit-upload`, {
        method: "POST",
        headers,
        body: formData,
      });
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
      return json?.data ?? json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-assignments"] });
      qc.invalidateQueries({ queryKey: ["professional-assignment-submissions"] });
    },
  });
}

/** Ouvre le fichier de soumission d'un étudiant via blob URL authentifié. */
export async function openSubmissionFile(url: string): Promise<void> {
  const headers = createApiHeaders();
  delete (headers as any)["Content-Type"];
  delete (headers as any)["content-type"];
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let msg = `Erreur HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/* ------------------------- Questions interactives ----------------------- */

export function useAssignmentQuestions(assignmentId: string | null) {
  return useQuery({
    queryKey: ["professional-assignment-questions", assignmentId],
    queryFn: () => apiFetch(`${BASE}/assignments/${assignmentId}/questions`),
    enabled: !!assignmentId,
  });
}

export function useCreateAssignmentQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      data,
    }: {
      assignmentId: string;
      data: any;
    }) =>
      apiFetch(`${BASE}/assignments/${assignmentId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({
        queryKey: ["professional-assignment-questions", vars.assignmentId],
      }),
  });
}

export function useUpdateAssignmentQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiFetch(`${BASE}/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-assignment-questions"] }),
  });
}

export function useDeleteAssignmentQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`${BASE}/questions/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-assignment-questions"] }),
  });
}

export function useSubmitAssignmentAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      answers,
    }: {
      assignmentId: string;
      answers: Array<{
        question_id: string;
        answer_text?: string | null;
        selected_option_ids?: string[] | null;
      }>;
    }) =>
      apiFetch(`${BASE}/assignments/${assignmentId}/submit-answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-student-assignments"] });
      qc.invalidateQueries({ queryKey: ["professional-assignment-questions"] });
    },
  });
}

export function useMyAnswers(assignmentId: string | null) {
  return useQuery({
    queryKey: ["professional-assignment-my-answers", assignmentId],
    queryFn: () => apiFetch(`${BASE}/assignments/${assignmentId}/my-answers`),
    enabled: !!assignmentId,
  });
}

/** Détail enseignant d'une soumission en ligne : questions + réponses étudiant. */
export function useSubmissionDetail(submissionId: string | null) {
  return useQuery({
    queryKey: ["professional-submission-detail", submissionId],
    queryFn: () => apiFetch(`${BASE}/submissions/${submissionId}/detail`),
    enabled: !!submissionId,
  });
}

/** Correction manuelle d'une réponse à une question (short/long). */
export function useGradeQuestionAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      answerId,
      points,
      feedback,
    }: {
      answerId: string;
      points: number;
      feedback?: string;
    }) =>
      apiFetch(`${BASE}/answers/${answerId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points, feedback }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professional-submission-detail"] });
      qc.invalidateQueries({ queryKey: ["professional-assignment-submissions"] });
    },
  });
}

/* ----------------------------- Séances visio --------------------------- */

export function useProfessionalLiveSessions(sessionId: string | null) {
  return useQuery({
    queryKey: ["professional-live-sessions", sessionId],
    queryFn: () => apiFetch(`${BASE}/seances/${sessionId}/live-sessions`),
    enabled: !!sessionId,
  });
}

export function useCreateProfessionalLiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      titre,
      scheduledAt,
      recordingEnabled,
    }: {
      sessionId: string;
      titre?: string;
      scheduledAt?: string;
      recordingEnabled?: boolean;
    }) =>
      apiFetch(`${BASE}/seances/${sessionId}/live-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titre,
          scheduled_at: scheduledAt,
          recording_enabled: recordingEnabled,
        }),
      }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["professional-live-sessions", vars.sessionId] }),
  });
}

export function useEndProfessionalLiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (liveSessionId: string) =>
      apiFetch(`${BASE}/live-sessions/${liveSessionId}/end`, {
        method: "POST",
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["professional-live-sessions"] }),
  });
}

/**
 * Ouvre le sujet d'une évaluation dans un nouvel onglet via un blob URL
 * (l'endpoint exige une authentification — un simple <a href> ne marche pas
 * puisque le navigateur n'envoie pas le JWT sur un clic ordinaire).
 */
export async function openAssignmentSubjectDocument(url: string): Promise<void> {
  const headers = createApiHeaders();
  delete (headers as any)["Content-Type"];
  delete (headers as any)["content-type"];
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let msg = `Erreur HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export async function getProfessionalLiveSessionJoinToken(
  liveSessionId: string
): Promise<{ url: string; token: string; roomName: string }> {
  return apiFetch(`${BASE}/live-sessions/${liveSessionId}/join-token`, {
    method: "POST",
  });
}
