'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

export type RecipientType = 'parent' | 'teacher' | 'student';

export interface EmailRecipient {
  userId: string;
  type: RecipientType;
  name: string;
  email: string;
  /** Enfants pour un parent, matricule pour un enseignant, classe pour un étudiant. */
  detail: string | null;
}

export interface RecipientDirectory {
  recipients: EmailRecipient[];
  counts: Partial<Record<RecipientType, number>>;
  total: number;
}

export interface SentAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export interface SentEmail {
  id: string;
  senderName: string | null;
  subject: string;
  body: string;
  attachments: SentAttachment[];
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export interface SentEmailRecipient {
  type: RecipientType;
  name: string | null;
  email: string;
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentAt: string;
}

const BASE = '/api/v1/admin/email';

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || payload.error || fallback);
}

/** Annuaire complet des destinataires joignables par email. */
export function useEmailRecipients() {
  const { data: session } = useSession();

  return useQuery<RecipientDirectory>({
    queryKey: ['admin-email-recipients'],
    queryFn: async () => {
      const response = await fetch(`${BASE}/recipients`, { headers: createApiHeaders(session) });
      if (!response.ok) await readError(response, 'Impossible de charger les destinataires');
      const payload = await response.json();
      return payload.data as RecipientDirectory;
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  });
}

export interface SendEmailResult {
  id: string;
  recipientCount: number;
  sent: number;
  failed: number;
  attachmentCount: number;
}

/**
 * Envoi du message composé. Le corps part en `multipart/form-data` pour porter
 * les pièces jointes ; les en-têtes d'authentification sont conservés mais le
 * `Content-Type` est laissé au navigateur, qui doit y placer la frontière.
 */
export function useSendAdminEmail() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  return useMutation<
    SendEmailResult,
    Error,
    { subject: string; body: string; recipientIds: string[]; attachments: File[] }
  >({
    mutationFn: async ({ subject, body, recipientIds, attachments }) => {
      const form = new FormData();
      form.append('subject', subject);
      form.append('body', body);
      form.append('recipientIds', JSON.stringify(recipientIds));
      attachments.forEach((file) => form.append('attachments', file, file.name));

      const headers = createApiHeaders(session) as Record<string, string>;
      delete headers['Content-Type'];

      const response = await fetch(`${BASE}/send`, { method: 'POST', headers, body: form });
      if (!response.ok) await readError(response, "Échec de l'envoi");
      const payload = await response.json();
      return payload.data as SendEmailResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-email-history'] });
    },
  });
}

/** Historique des envois — la traçabilité conservée dans l'application. */
export function useAdminEmailHistory(page = 1, limit = 20) {
  const { data: session } = useSession();

  return useQuery<{
    messages: SentEmail[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['admin-email-history', page, limit],
    queryFn: async () => {
      const response = await fetch(`${BASE}/history?page=${page}&limit=${limit}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) await readError(response, "Impossible de charger l'historique");
      const payload = await response.json();
      return payload.data;
    },
    enabled: !!session,
    staleTime: 30 * 1000,
  });
}

/** Détail d'un envoi : statut destinataire par destinataire. */
export function useAdminEmailDetail(messageId: string | null) {
  const { data: session } = useSession();

  return useQuery<{ message: SentEmail; recipients: SentEmailRecipient[] }>({
    queryKey: ['admin-email-detail', messageId],
    queryFn: async () => {
      const response = await fetch(`${BASE}/history/${messageId}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) await readError(response, "Impossible de charger le détail de l'envoi");
      const payload = await response.json();
      return payload.data;
    },
    enabled: !!session && !!messageId,
  });
}

export const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  parent: 'Parents',
  teacher: 'Enseignants',
  student: 'Étudiants',
};

export const RECIPIENT_TYPE_SINGULAR: Record<RecipientType, string> = {
  parent: 'Parent',
  teacher: 'Enseignant',
  student: 'Étudiant',
};

/** Taille lisible d'une pièce jointe. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/* --------------------------------------------------------------------------
 * Boîte de réception : messages adressés à l'établissement
 * ------------------------------------------------------------------------ */

export interface InboxMessage {
  id: string;
  /** Table d'origine : message direct, ou message d'une conversation parent. */
  source: 'establishment' | 'parent_conversation';
  senderId: string | null;
  senderName: string | null;
  senderRole: RecipientType;
  senderEmail: string | null;
  subject: string;
  content: string;
  /** Élève concerné, quand le message en désigne un. */
  childName: string | null;
  sentAt: string;
}

/**
 * Messages reçus par l'établissement, toutes provenances confondues. En lecture
 * seule : la réponse se fait par email depuis l'onglet de composition.
 */
export function useAdminEmailInbox(page = 1, limit = 20, from?: RecipientType) {
  const { data: session } = useSession();

  return useQuery<{
    messages: InboxMessage[];
    counts: Partial<Record<RecipientType, number>>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['admin-email-inbox', page, limit, from ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (from) params.set('from', from);
      const response = await fetch(`${BASE}/inbox?${params}`, { headers: createApiHeaders(session) });
      if (!response.ok) await readError(response, 'Impossible de charger la boîte de réception');
      const payload = await response.json();
      return payload.data;
    },
    enabled: !!session,
    staleTime: 30 * 1000,
  });
}
