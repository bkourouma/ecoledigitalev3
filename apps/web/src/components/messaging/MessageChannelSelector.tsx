'use client';

import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Bell, Mail, MessageCircle, AlertTriangle, Settings2 } from 'lucide-react';
import { useMessagingEmailConfig } from '@/lib/hooks/use-messaging-email-config';
import type { MessageTemplateKind } from '@/lib/hooks/use-admin-message-templates';

export interface MessageChannels {
  whatsapp: boolean;
  email: boolean;
}

interface Props {
  channels: MessageChannels;
  onChange: (channels: MessageChannels) => void;
  disabled?: boolean;
  /** Préfixe d'identifiant : plusieurs sélecteurs coexistent sur la page. */
  idPrefix: string;
  /** SMTP configuré côté serveur — sinon le canal email est désactivé. */
  emailConfigured?: boolean;
  /** Nom du modèle d'email appliqué, affiché à titre indicatif. */
  templateLabel?: string;
  /** Ouvre l'onglet « Modèles d'email » sur le modèle concerné. */
  onEditTemplate?: () => void;
}

/**
 * Choix des canaux de diffusion d'un message.
 *
 * L'application est un canal implicite et non désactivable : le message est
 * toujours consultable dans l'espace du destinataire. WhatsApp et Email sont
 * des relais additionnels, chacun avec ses prérequis.
 */
export function MessageChannelSelector({
  channels,
  onChange,
  disabled,
  idPrefix,
  emailConfigured = true,
  templateLabel,
  onEditTemplate,
}: Props) {
  const emailId = `${idPrefix}-email`;
  const whatsappId = `${idPrefix}-whatsapp`;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">Canaux de diffusion</span>
        <span className="text-xs text-slate-500">— le message reste consultable dans l&apos;application</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Canal applicatif : toujours actif, présenté en lecture seule. */}
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-emerald-900">Application</p>
            <p className="mt-0.5 text-xs text-emerald-700">Toujours actif</p>
          </div>
        </div>

        {/* WhatsApp */}
        <div
          className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
            channels.whatsapp
              ? 'border-amber-300 bg-amber-50'
              : 'border-slate-200 bg-white hover:border-amber-200'
          } ${disabled ? 'opacity-60' : ''}`}
        >
          <Checkbox
            id={whatsappId}
            checked={channels.whatsapp}
            disabled={disabled}
            onCheckedChange={(value) => onChange({ ...channels, whatsapp: value === true })}
            className="mt-0.5"
          />
          <Label htmlFor={whatsappId} className={`min-w-0 flex-1 ${disabled ? '' : 'cursor-pointer'}`}>
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <MessageCircle className="h-4 w-4 text-amber-600" />
              WhatsApp
            </span>
            <span className="mt-0.5 block text-xs font-normal text-slate-600">
              Nécessite un numéro renseigné pour le destinataire.
            </span>
          </Label>
        </div>

        {/* Email */}
        <div
          className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
            channels.email ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-200'
          } ${disabled || !emailConfigured ? 'opacity-60' : ''}`}
        >
          <Checkbox
            id={emailId}
            checked={channels.email}
            disabled={disabled || !emailConfigured}
            onCheckedChange={(value) => onChange({ ...channels, email: value === true })}
            className="mt-0.5"
          />
          <Label
            htmlFor={emailId}
            className={`min-w-0 flex-1 ${disabled || !emailConfigured ? '' : 'cursor-pointer'}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <Mail className="h-4 w-4 text-blue-600" />
              Email
            </span>
            <span className="mt-0.5 block text-xs font-normal text-slate-600">
              Mise en page aux couleurs de l&apos;IPAM, avec logo.
            </span>
          </Label>
        </div>
      </div>

      {!emailConfigured && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            L&apos;envoi par email est indisponible : le serveur SMTP n&apos;est pas configuré
            (variables <code className="font-mono">SMTP_HOST</code>,{' '}
            <code className="font-mono">SMTP_USER</code>, <code className="font-mono">SMTP_PASSWORD</code>).
          </p>
        </div>
      )}

      {channels.email && emailConfigured && templateLabel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>Modèle appliqué :</span>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            {templateLabel}
          </Badge>
          {onEditTemplate && (
            <button
              type="button"
              onClick={onEditTemplate}
              className="inline-flex items-center gap-1 font-medium text-blue-700 underline-offset-2 hover:underline"
            >
              <Settings2 className="h-3 w-3" />
              Personnaliser
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Chaque relai est tracé dans le journal d&apos;envoi, qu&apos;il aboutisse ou non.
      </p>
    </div>
  );
}

/**
 * Variante autonome : lit elle-même l'état du canal email et le libellé du
 * modèle appliqué. C'est la forme utilisée par les écrans enseignant, parent
 * et étudiant, qui n'ont pas accès aux modèles complets.
 */
export function MessageChannelsField(props: {
  channels: MessageChannels;
  onChange: (channels: MessageChannels) => void;
  idPrefix: string;
  /** Cas d'envoi : détermine le modèle d'email appliqué. */
  templateKind: MessageTemplateKind;
  disabled?: boolean;
}) {
  const { data } = useMessagingEmailConfig();
  const template = data?.templates.find((entry) => entry.kind === props.templateKind);

  return (
    <MessageChannelSelector
      idPrefix={props.idPrefix}
      channels={props.channels}
      onChange={props.onChange}
      disabled={props.disabled}
      // Tant que la configuration n'est pas chargée, on suppose l'email
      // disponible : l'API refusera proprement si le SMTP manque.
      emailConfigured={data?.emailConfigured ?? true}
      templateLabel={template?.label}
    />
  );
}

/** Résumé lisible des statuts d'envoi email retournés par l'API. */
export const EMAIL_STATUS_LABELS: Record<string, string> = {
  sent: 'envoyé',
  failed: 'en échec',
  skipped: 'non demandé',
  skipped_no_email: 'sans adresse email',
  skipped_not_configured: 'SMTP non configuré',
};

export function formatEmailSummary(summary?: Record<string, number> | null): string | null {
  if (!summary) return null;
  const parts = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${EMAIL_STATUS_LABELS[status] || status}`);
  return parts.length > 0 ? `Email : ${parts.join(', ')}` : null;
}
