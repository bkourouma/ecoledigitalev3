'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';

export type MessageTemplateProfile = 'admin' | 'teacher' | 'parent' | 'student';

export type MessageTemplateKind =
  // Administration
  | 'admin_parent_new'
  | 'admin_parent_reply'
  | 'admin_parent_bulk'
  | 'admin_teacher'
  | 'admin_student'
  // Enseignant
  | 'teacher_parent'
  | 'teacher_parent_bulk'
  | 'teacher_establishment'
  | 'teacher_student'
  // Parent
  | 'parent_teacher_new'
  | 'parent_teacher_reply'
  | 'parent_school_new'
  | 'parent_school_reply'
  // Étudiant
  | 'student_teacher_new'
  | 'student_teacher_reply'
  | 'student_school';

export interface MessageTemplateVariable {
  key: string;
  label: string;
}

export interface MessageTemplate {
  kind: MessageTemplateKind;
  profile: MessageTemplateProfile;
  label: string;
  description: string;
  accent: string;
  variables: MessageTemplateVariable[];
  defaults: { subject: string; body: string };
  subject: string;
  body: string;
  isCustomized: boolean;
}

export interface MessageTemplatesResponse {
  emailConfigured: boolean;
  schoolName: string;
  portalUrl: string;
  logoUrl: string;
  templates: MessageTemplate[];
}

const BASE = '/api/v1/admin/messages/email-templates';

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || payload.error || fallback);
}

/** Les 5 modèles d'email du tenant + l'état de la configuration SMTP. */
export function useMessageEmailTemplates() {
  const { data: session } = useSession();

  return useQuery<MessageTemplatesResponse>({
    queryKey: ['admin-message-email-templates'],
    queryFn: async () => {
      const response = await fetch(BASE, { headers: createApiHeaders(session) });
      if (!response.ok) await readError(response, "Impossible de charger les modèles d'email");
      const payload = await response.json();
      return payload.data as MessageTemplatesResponse;
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveMessageEmailTemplate() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  return useMutation<
    MessageTemplate,
    Error,
    { kind: MessageTemplateKind; subject: string; body: string }
  >({
    mutationFn: async ({ kind, subject, body }) => {
      const response = await fetch(`${BASE}/${kind}`, {
        method: 'PUT',
        headers: { ...createApiHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      if (!response.ok) await readError(response, "Impossible d'enregistrer le modèle");
      const payload = await response.json();
      return payload.data as MessageTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-message-email-templates'] });
    },
  });
}

export function useResetMessageEmailTemplate() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  return useMutation<MessageTemplate, Error, { kind: MessageTemplateKind }>({
    mutationFn: async ({ kind }) => {
      const response = await fetch(`${BASE}/${kind}`, {
        method: 'DELETE',
        headers: createApiHeaders(session),
      });
      if (!response.ok) await readError(response, 'Impossible de réinitialiser le modèle');
      const payload = await response.json();
      return payload.data as MessageTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-message-email-templates'] });
    },
  });
}

/** Aperçu HTML du brouillon en cours d'édition (jeu de données de démonstration). */
export function usePreviewMessageEmailTemplate() {
  const { data: session } = useSession();

  return useMutation<
    { subject: string; html: string; text: string },
    Error,
    { kind: MessageTemplateKind; template?: { subject: string; body: string } }
  >({
    mutationFn: async ({ kind, template }) => {
      const response = await fetch(`${BASE}/${kind}/preview`, {
        method: 'POST',
        headers: { ...createApiHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify(template ? { template } : {}),
      });
      if (!response.ok) await readError(response, "Impossible de générer l'aperçu");
      const payload = await response.json();
      return payload.data;
    },
  });
}

export function useSendTestMessageEmail() {
  const { data: session } = useSession();

  return useMutation<
    { sentTo: string },
    Error,
    { kind: MessageTemplateKind; to: string; template?: { subject: string; body: string } }
  >({
    mutationFn: async ({ kind, to, template }) => {
      const response = await fetch(`${BASE}/${kind}/test`, {
        method: 'POST',
        headers: { ...createApiHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify(template ? { to, template } : { to }),
      });
      if (!response.ok) await readError(response, "Échec de l'envoi de l'email de test");
      const payload = await response.json();
      return payload.data;
    },
  });
}

export interface DeliveryLogEntry {
  id: string;
  channel: 'whatsapp' | 'email';
  sourceType: string;
  status: string;
  preview: string | null;
  recipientName: string | null;
  recipientAddress: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Journal des relais WhatsApp / email des derniers envois. */
export function useMessageDeliveryLog(channel?: 'whatsapp' | 'email', limit = 25) {
  const { data: session } = useSession();

  return useQuery<DeliveryLogEntry[]>({
    queryKey: ['admin-message-delivery-log', channel, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (channel) params.set('channel', channel);
      params.set('limit', String(limit));
      const response = await fetch(`/api/v1/admin/messages/delivery-log?${params}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) await readError(response, "Impossible de charger le journal d'envoi");
      const payload = await response.json();
      return (payload.data || []) as DeliveryLogEntry[];
    },
    enabled: !!session,
    staleTime: 30 * 1000,
  });
}
