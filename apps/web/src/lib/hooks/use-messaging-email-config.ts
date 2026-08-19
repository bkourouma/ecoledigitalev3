'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
/** Profil de l'expéditeur d'un modèle d'email. */
export type MessageTemplateProfile = 'admin' | 'teacher' | 'parent' | 'student';

/**
 * Cas d'envoi couvert par un modèle d'email. Les modèles ne sont plus
 * modifiables depuis l'application — ce sont les valeurs par défaut du serveur
 * qui s'appliquent — mais le type sert encore à désigner le modèle utilisé par
 * un formulaire d'envoi.
 */
export type MessageTemplateKind =
  | 'admin_parent_new'
  | 'admin_parent_reply'
  | 'admin_parent_bulk'
  | 'admin_teacher'
  | 'admin_student'
  | 'teacher_parent'
  | 'teacher_parent_bulk'
  | 'teacher_establishment'
  | 'teacher_student'
  | 'parent_teacher_new'
  | 'parent_teacher_reply'
  | 'parent_school_new'
  | 'parent_school_reply'
  | 'student_teacher_new'
  | 'student_teacher_reply'
  | 'student_school';

export interface MessagingTemplateInfo {
  kind: MessageTemplateKind;
  label: string;
  profile: MessageTemplateProfile;
  profileLabel: string;
}

export interface MessagingEmailConfig {
  emailConfigured: boolean;
  /** L'utilisateur peut-il éditer les modèles (administration uniquement) ? */
  canManageTemplates: boolean;
  templates: MessagingTemplateInfo[];
}

/**
 * État du canal email, partagé par les écrans d'envoi des quatre profils.
 *
 * Contrairement à `useMessageEmailTemplates` (réservé à l'administration), cet
 * appel ne renvoie que des libellés : un enseignant, un parent ou un étudiant
 * peut le consulter pour savoir si l'option « Email » est disponible et quel
 * modèle sera appliqué à son envoi.
 */
export function useMessagingEmailConfig() {
  const { data: session } = useSession();

  return useQuery<MessagingEmailConfig>({
    queryKey: ['messaging-email-config'],
    queryFn: async () => {
      const response = await fetch('/api/v1/messaging/email-config', {
        headers: createApiHeaders(session),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Impossible de lire la configuration email");
      }
      const payload = await response.json();
      return payload.data as MessagingEmailConfig;
    },
    enabled: !!session,
    staleTime: 10 * 60 * 1000,
  });
}

/** Libellé du modèle appliqué à un cas d'envoi, ou `undefined` si inconnu. */
export function useMessageTemplateLabel(kind: MessageTemplateKind): string | undefined {
  const { data } = useMessagingEmailConfig();
  return data?.templates.find((template) => template.kind === kind)?.label;
}
