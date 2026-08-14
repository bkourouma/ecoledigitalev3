'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Check,
  Eye,
  FileCode2,
  Loader2,
  Mail,
  MailCheck,
  RotateCcw,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useMessageEmailTemplates,
  usePreviewMessageEmailTemplate,
  useResetMessageEmailTemplate,
  useSaveMessageEmailTemplate,
  useSendTestMessageEmail,
  type MessageTemplate,
  type MessageTemplateKind,
  type MessageTemplateProfile,
} from '@/lib/hooks/use-admin-message-templates';
import { LIGHT_TEXTAREA } from './message-ui';

/** Ordre et libellés des groupes de la liste des modèles. */
const PROFILE_GROUPS: Array<{ profile: MessageTemplateProfile; label: string; hint: string }> = [
  { profile: 'admin', label: 'Administration', hint: "Messages envoyés par l'établissement" },
  { profile: 'teacher', label: 'Enseignant', hint: 'Messages envoyés par les enseignants' },
  { profile: 'parent', label: 'Parent', hint: 'Messages envoyés par les parents' },
  { profile: 'student', label: 'Étudiant', hint: 'Messages envoyés par les étudiants' },
];

interface Props {
  /** Modèle à ouvrir d'emblée (lien « Personnaliser » d'un formulaire d'envoi). */
  focusKind?: MessageTemplateKind | null;
}

type Draft = { subject: string; body: string };

/** Insère `{{variable}}` à la position du curseur du champ ciblé. */
function insertAtCursor(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  token: string
): string {
  if (!element) return `${current}${token}`;
  const start = element.selectionStart ?? current.length;
  const end = element.selectionEnd ?? start;
  return `${current.slice(0, start)}${token}${current.slice(end)}`;
}

export function EmailTemplatesManager({ focusKind }: Props) {
  const { data, isLoading, error } = useMessageEmailTemplates();
  const saveMutation = useSaveMessageEmailTemplate();
  const resetMutation = useResetMessageEmailTemplate();
  const previewMutation = usePreviewMessageEmailTemplate();
  const testMutation = useSendTestMessageEmail();

  const templates = useMemo(() => data?.templates ?? [], [data]);
  const [selectedKind, setSelectedKind] = useState<MessageTemplateKind | null>(null);
  const [draft, setDraft] = useState<Draft>({ subject: '', body: '' });
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [testAddress, setTestAddress] = useState('');
  const [lastFocusedField, setLastFocusedField] = useState<'subject' | 'body'>('body');

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selected: MessageTemplate | undefined = useMemo(
    () => templates.find((t) => t.kind === selectedKind),
    [templates, selectedKind]
  );

  // Sélection initiale : le modèle demandé par l'appelant, sinon le premier.
  useEffect(() => {
    if (templates.length === 0) return;
    setSelectedKind((current) => current ?? focusKind ?? templates[0].kind);
  }, [templates, focusKind]);

  // Un focusKind explicite (clic « Personnaliser ») force la sélection.
  useEffect(() => {
    if (focusKind) setSelectedKind(focusKind);
  }, [focusKind]);

  // Charge le brouillon dès qu'on change de modèle.
  useEffect(() => {
    if (!selected) return;
    setDraft({ subject: selected.subject, body: selected.body });
    setPreviewHtml(null);
  }, [selected?.kind, selected?.subject, selected?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    !!selected && (draft.subject !== selected.subject || draft.body !== selected.body);
  const isDefault =
    !!selected &&
    draft.subject === selected.defaults.subject &&
    draft.body === selected.defaults.body;

  const handleInsertVariable = (key: string) => {
    const token = `{{${key}}}`;
    if (lastFocusedField === 'subject') {
      setDraft((d) => ({ ...d, subject: insertAtCursor(subjectRef.current, d.subject, token) }));
      subjectRef.current?.focus();
    } else {
      setDraft((d) => ({ ...d, body: insertAtCursor(bodyRef.current, d.body, token) }));
      bodyRef.current?.focus();
    }
  };

  const handlePreview = async () => {
    if (!selectedKind) return;
    try {
      const result = await previewMutation.mutateAsync({ kind: selectedKind, template: draft });
      setPreviewHtml(result.html);
    } catch (err: any) {
      toast.error(err?.message || "Impossible de générer l'aperçu");
    }
  };

  const handleSave = async () => {
    if (!selectedKind) return;
    try {
      await saveMutation.mutateAsync({ kind: selectedKind, ...draft });
      toast.success('Modèle enregistré');
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'enregistrer le modèle");
    }
  };

  const handleReset = async () => {
    if (!selectedKind || !selected) return;
    try {
      await resetMutation.mutateAsync({ kind: selectedKind });
      setDraft({ subject: selected.defaults.subject, body: selected.defaults.body });
      setPreviewHtml(null);
      toast.success('Modèle réinitialisé');
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de réinitialiser le modèle');
    }
  };

  const handleTest = async () => {
    if (!selectedKind) return;
    if (!testAddress.trim()) {
      toast.error('Renseignez une adresse email de test');
      return;
    }
    try {
      const result = await testMutation.mutateAsync({
        kind: selectedKind,
        to: testAddress.trim(),
        template: draft,
      });
      toast.success(`Email de test envoyé à ${result.sentTo}`);
    } catch (err: any) {
      toast.error(err?.message || "Échec de l'envoi de l'email de test");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-3 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Chargement des modèles d&apos;email…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-red-500" />
          <p className="font-medium text-red-600">Impossible de charger les modèles d&apos;email</p>
          <p className="text-sm text-slate-500">{(error as Error)?.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* État de la configuration SMTP */}
      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${
          data.emailConfigured
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}
      >
        {data.emailConfigured ? (
          <MailCheck className="h-5 w-5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {data.emailConfigured
              ? 'Serveur SMTP configuré — les envois par email sont opérationnels.'
              : 'Serveur SMTP non configuré — les modèles restent modifiables, mais aucun email ne partira.'}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            Établissement : {data.schoolName} · Variables serveur : SMTP_HOST, SMTP_PORT, SMTP_USER,
            SMTP_PASSWORD, SMTP_FROM_EMAIL
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Liste des modèles */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCode2 className="h-4 w-4 text-emerald-600" />
              Types d&apos;envoi
            </CardTitle>
            <CardDescription className="text-xs">
              Un modèle par cas d&apos;envoi, pour les quatre profils. Ils s&apos;appliquent à tout
              l&apos;établissement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-3 pt-0">
            {PROFILE_GROUPS.map((group) => {
              const groupTemplates = templates.filter((t) => t.profile === group.profile);
              if (groupTemplates.length === 0) return null;
              return (
                <div key={group.profile} className="space-y-2">
                  <div className="px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group.label}
                    </p>
                    <p className="text-[11px] text-slate-400">{group.hint}</p>
                  </div>
                  {groupTemplates.map((template) => {
                    const isActive = template.kind === selectedKind;
                    return (
                      <button
                        key={template.kind}
                        type="button"
                        onClick={() => setSelectedKind(template.kind)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          isActive
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: template.accent }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug text-slate-900">
                              {template.label}
                            </p>
                            {template.isCustomized && (
                              <Badge
                                variant="secondary"
                                className="mt-1.5 bg-emerald-100 text-[10px] text-emerald-800"
                              >
                                Personnalisé
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Éditeur */}
        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                <Mail className="h-5 w-5" style={{ color: selected.accent }} />
                {selected.label}
                <Badge variant="secondary" className="bg-slate-100 text-xs text-slate-700">
                  {PROFILE_GROUPS.find((group) => group.profile === selected.profile)?.label}
                </Badge>
              </CardTitle>
              <CardDescription>{selected.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Variables disponibles */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  Variables disponibles
                </Label>
                <p className="text-xs text-slate-500">
                  Cliquez pour insérer dans le champ {lastFocusedField === 'subject' ? '« Sujet »' : '« Corps »'}.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.variables.map((variable) => (
                    <button
                      key={variable.key}
                      type="button"
                      title={variable.label}
                      onClick={() => handleInsertVariable(variable.key)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                    >
                      {`{{${variable.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sujet */}
              <div className="space-y-2">
                <Label htmlFor="template-subject">Sujet de l&apos;email *</Label>
                <Input
                  id="template-subject"
                  ref={subjectRef}
                  value={draft.subject}
                  onFocus={() => setLastFocusedField('subject')}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="font-mono text-sm"
                />
              </div>

              {/* Corps */}
              <div className="space-y-2">
                <Label htmlFor="template-body">Corps de l&apos;email (HTML) *</Label>
                <Textarea
                  id="template-body"
                  ref={bodyRef}
                  value={draft.body}
                  onFocus={() => setLastFocusedField('body')}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={14}
                  className={`${LIGHT_TEXTAREA} font-mono text-xs leading-relaxed`}
                />
                <p className="text-xs text-slate-500">
                  Le corps est automatiquement enveloppé dans l&apos;en-tête IPAM (logo, sigle,
                  nom de l&apos;institut) et le pied de page institutionnel.
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || saveMutation.isPending}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Enregistrer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePreview}
                  disabled={previewMutation.isPending}
                  className="gap-2"
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  Aperçu
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleReset}
                  disabled={resetMutation.isPending || (!selected.isCustomized && isDefault)}
                  className="gap-2 text-slate-600"
                >
                  {resetMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Modèle par défaut
                </Button>
                {isDirty ? (
                  <span className="ml-auto text-xs font-medium text-amber-600">
                    Modifications non enregistrées
                  </span>
                ) : (
                  <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="h-3 w-3" />À jour
                  </span>
                )}
              </div>

              {/* Envoi de test */}
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <Label htmlFor="test-address" className="text-sm">
                  Envoyer un email de test
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="test-address"
                    type="email"
                    placeholder="adresse@exemple.com"
                    value={testAddress}
                    onChange={(e) => setTestAddress(e.target.value)}
                    disabled={!data.emailConfigured}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTest}
                    disabled={!data.emailConfigured || testMutation.isPending}
                    className="gap-2 sm:w-auto"
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Envoyer le test
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Le test utilise le brouillon affiché — inutile d&apos;enregistrer d&apos;abord — et
                  un jeu de données de démonstration.
                </p>
              </div>

              {/* Aperçu rendu */}
              {previewHtml && (
                <div className="space-y-2">
                  <Label>Aperçu du rendu</Label>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    <iframe
                      title="Aperçu de l'email"
                      srcDoc={previewHtml}
                      sandbox=""
                      className="h-[520px] w-full border-0 bg-white"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
