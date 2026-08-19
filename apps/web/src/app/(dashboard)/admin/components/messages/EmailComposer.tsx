'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Paperclip,
  PenLine,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  RECIPIENT_TYPE_LABELS,
  RECIPIENT_TYPE_SINGULAR,
  formatFileSize,
  useEmailRecipients,
  useSendAdminEmail,
  type EmailRecipient,
  type RecipientType,
} from '@/lib/hooks/use-admin-email';

type TypeFilter = 'all' | RecipientType;

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'parent', label: RECIPIENT_TYPE_LABELS.parent },
  { value: 'teacher', label: RECIPIENT_TYPE_LABELS.teacher },
  { value: 'student', label: RECIPIENT_TYPE_LABELS.student },
];

const TYPE_BADGE: Record<RecipientType, string> = {
  parent: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  teacher: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  student: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

/** Limite serveur : au-delà, l'API refuse l'envoi (413). */
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Pré-remplissage venant de la boîte de réception (bouton « Répondre »). */
export interface ComposerPrefill {
  recipientId: string;
  subject: string;
  /** Change à chaque clic pour rejouer le pré-remplissage sur le même message. */
  token: number;
}

export function EmailComposer({ prefill }: { prefill?: ComposerPrefill | null }) {
  const { data: directory, isLoading, error } = useEmailRecipients();
  const sendMutation = useSendAdminEmail();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recipients = useMemo(() => directory?.recipients ?? [], [directory]);

  // Réponse depuis la boîte de réception : on ajoute l'expéditeur aux
  // destinataires et on préfixe l'objet, sans écraser une rédaction en cours.
  useEffect(() => {
    if (!prefill) return;
    setSelectedIds((previous) =>
      previous.includes(prefill.recipientId) ? previous : [...previous, prefill.recipientId]
    );
    setSubject((previous) => (previous.trim() ? previous : prefill.subject));
  }, [prefill?.token]); // eslint-disable-line react-hooks/exhaustive-deps


  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return recipients.filter((recipient) => {
      if (typeFilter !== 'all' && recipient.type !== typeFilter) return false;
      if (!needle) return true;
      return (
        recipient.name.toLowerCase().includes(needle) ||
        recipient.email.toLowerCase().includes(needle) ||
        (recipient.detail || '').toLowerCase().includes(needle)
      );
    });
  }, [recipients, search, typeFilter]);

  const selectedRecipients = useMemo(
    () => recipients.filter((recipient) => selectedIds.includes(recipient.userId)),
    [recipients, selectedIds]
  );

  const attachmentsBytes = attachments.reduce((total, file) => total + file.size, 0);
  const attachmentsTooLarge = attachmentsBytes > MAX_TOTAL_ATTACHMENT_BYTES;

  const toggleRecipient = (userId: string) => {
    setSelectedIds((previous) =>
      previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId]
    );
  };

  const selectAllFiltered = () => {
    setSelectedIds((previous) => Array.from(new Set([...previous, ...filtered.map((r) => r.userId)])));
  };

  const handleFilesPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length === 0) return;
    // Un même fichier peut être choisi deux fois : on déduplique sur nom+taille.
    setAttachments((previous) => {
      const seen = new Set(previous.map((file) => `${file.name}:${file.size}`));
      return [...previous, ...picked.filter((file) => !seen.has(`${file.name}:${file.size}`))];
    });
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((previous) => previous.filter((_, position) => position !== index));
  };

  const resetForm = () => {
    setSubject('');
    setBody('');
    setAttachments([]);
    setSelectedIds([]);
    setSearch('');
    setTypeFilter('all');
  };

  const canSend =
    !sendMutation.isPending &&
    selectedIds.length > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !attachmentsTooLarge;

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedIds.length === 0) {
      toast.error('Sélectionnez au moins un destinataire');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("L'objet et le corps du message sont requis");
      return;
    }
    if (attachmentsTooLarge) {
      toast.error('Les pièces jointes dépassent 15 Mo au total');
      return;
    }

    try {
      const result = await sendMutation.mutateAsync({
        subject: subject.trim(),
        body: body.trim(),
        recipientIds: selectedIds,
        attachments,
      });
      toast.success(
        result.failed > 0
          ? `${result.sent} email(s) envoyé(s), ${result.failed} en échec`
          : `${result.sent} email(s) envoyé(s)`
      );
      resetForm();
    } catch (sendError: any) {
      toast.error(sendError?.message || "Échec de l'envoi");
    }
  };

  return (
    <form onSubmit={handleSend} className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      {/* Destinataires */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Destinataires
          </CardTitle>
          <CardDescription className="text-xs">
            Les adresses proviennent des fiches parents, enseignants et étudiants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un nom, un email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              disabled={sendMutation.isPending}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map((filter) => {
              const count =
                filter.value === 'all'
                  ? directory?.total ?? 0
                  : directory?.counts?.[filter.value] ?? 0;
              const isActive = typeFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setTypeFilter(filter.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {filter.label} ({count})
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement de l&apos;annuaire…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{(error as Error).message}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{filtered.length} résultat(s)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    disabled={filtered.length === 0}
                    className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Tout sélectionner
                  </button>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="hover:text-foreground"
                    >
                      Vider
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[22rem] space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucun destinataire ne correspond
                  </p>
                ) : (
                  filtered.map((recipient) => (
                    <RecipientRow
                      key={recipient.userId}
                      recipient={recipient}
                      checked={selectedIds.includes(recipient.userId)}
                      disabled={sendMutation.isPending}
                      onToggle={() => toggleRecipient(recipient.userId)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Composition */}
      <Card className="flex h-fit flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-4 w-4 text-primary" />
            Nouveau message
          </CardTitle>
          <CardDescription className="text-xs">
            Un email par destinataire, aux couleurs de l&apos;établissement. Les autres destinataires
            ne sont jamais visibles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* À */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">À</Label>
            <div className="min-h-[2.75rem] rounded-lg border border-border bg-background/50 p-2">
              {selectedRecipients.length === 0 ? (
                <p className="px-1 py-1 text-sm text-muted-foreground">
                  Choisissez des destinataires dans l&apos;annuaire
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedRecipients.map((recipient) => (
                    <Badge
                      key={recipient.userId}
                      variant="outline"
                      className={`cursor-pointer gap-1 font-normal ${TYPE_BADGE[recipient.type]}`}
                      onClick={() => toggleRecipient(recipient.userId)}
                    >
                      {recipient.name}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {selectedRecipients.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedRecipients.length} destinataire(s) sélectionné(s)
              </p>
            )}
          </div>

          {/* Objet */}
          <div className="space-y-2">
            <Label htmlFor="email-subject" className="text-xs uppercase tracking-wide text-muted-foreground">
              Objet
            </Label>
            <Input
              id="email-subject"
              placeholder="Objet du message"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={sendMutation.isPending}
              maxLength={255}
            />
          </div>

          {/* Corps */}
          <div className="space-y-2">
            <Label htmlFor="email-body" className="text-xs uppercase tracking-wide text-muted-foreground">
              Message
            </Label>
            <Textarea
              id="email-body"
              placeholder="Rédigez votre message…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={sendMutation.isPending}
              rows={12}
              className="resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Astuce : <code className="font-mono">{'{{recipientName}}'}</code> est remplacé par le nom
              de chaque destinataire, <code className="font-mono">{'{{schoolName}}'}</code> par celui de
              l&apos;établissement.
            </p>
          </div>

          {/* Pièces jointes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Pièces jointes
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendMutation.isPending}
                className="gap-2"
              >
                <Paperclip className="h-4 w-4" />
                Joindre un fichier
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFilesPicked}
              className="hidden"
            />

            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      disabled={sendMutation.isPending}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Retirer ${file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {attachments.length > 0 && (
              <p className={`text-xs ${attachmentsTooLarge ? 'text-destructive' : 'text-muted-foreground'}`}>
                {formatFileSize(attachmentsBytes)} au total
                {attachmentsTooLarge ? ' — au-delà de la limite de 15 Mo' : ' (limite : 15 Mo)'}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={resetForm}
              disabled={sendMutation.isPending}
            >
              Effacer
            </Button>
            <Button type="submit" disabled={!canSend} className="gap-2">
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Envoi…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Envoyer
                  {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
                </>
              )}
            </Button>
          </div>

          {sendMutation.isSuccess && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {sendMutation.data?.sent} email(s) envoyé(s)
                {sendMutation.data?.failed ? `, ${sendMutation.data.failed} en échec` : ''} — consultable
                dans l&apos;onglet « Historique ».
              </span>
            </div>
          )}

          {sendMutation.isError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <Mail className="h-4 w-4 shrink-0" />
              <span>{sendMutation.error?.message}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}

function RecipientRow({
  recipient,
  checked,
  disabled,
  onToggle,
}: {
  recipient: EmailRecipient;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const id = `recipient-${recipient.userId}`;
  return (
    <div
      className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
        checked ? 'bg-primary/10' : 'hover:bg-muted/60'
      }`}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} disabled={disabled} className="mt-1" />
      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-normal">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{recipient.name}</span>
          <Badge variant="outline" className={`shrink-0 text-[10px] ${TYPE_BADGE[recipient.type]}`}>
            {RECIPIENT_TYPE_SINGULAR[recipient.type]}
          </Badge>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{recipient.email}</span>
        {recipient.detail && (
          <span className="block truncate text-xs text-muted-foreground/80">{recipient.detail}</span>
        )}
      </Label>
    </div>
  );
}
