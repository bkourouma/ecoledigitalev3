'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Loader2,
  Mail,
  Paperclip,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {
  RECIPIENT_TYPE_SINGULAR,
  formatFileSize,
  useAdminEmailDetail,
  useAdminEmailHistory,
  type RecipientType,
} from '@/lib/hooks/use-admin-email';

const TYPE_BADGE: Record<RecipientType, string> = {
  parent: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  teacher: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  student: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

export function EmailHistory() {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useAdminEmailHistory(page);
  const messages = data?.messages ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Emails envoyés
          </CardTitle>
          <CardDescription>
            Trace conservée dans l&apos;application de tout ce qui a été envoyé depuis cette page :
            contenu, destinataires et résultat de chaque envoi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Chargement de l&apos;historique…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{(error as Error).message}</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Mail className="h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium">Aucun email envoyé</p>
              <p className="text-sm text-muted-foreground">
                Les envois effectués depuis l&apos;onglet « Nouveau message » apparaîtront ici.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((message) => {
                const isOpen = openId === message.id;
                return (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : message.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      isOpen ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{message.subject}</h3>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {message.senderName || 'Administration'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(message.createdAt)}
                          </span>
                          {message.attachments.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Paperclip className="h-3 w-3" />
                              {message.attachments.length} pièce(s) jointe(s)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                          {message.sentCount} envoyé(s)
                        </Badge>
                        {message.failedCount > 0 && (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">
                            {message.failedCount} échec(s)
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{message.body}</p>
                  </button>
                );
              })}
            </div>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages} · {pagination.total} envoi(s)
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= pagination.totalPages}
                className="gap-1"
              >
                Suivant
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {openId && <EmailDetail messageId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function EmailDetail({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { data, isLoading, error } = useAdminEmailDetail(messageId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{data?.message.subject || 'Détail de l’envoi'}</CardTitle>
            <CardDescription>Statut de chaque destinataire</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer le détail">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : error || !data ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(error as Error)?.message || 'Détail indisponible'}</span>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm">
              {data.message.body}
            </div>

            {data.message.attachments.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pièces jointes</p>
                <ul className="space-y-1">
                  {data.message.attachments.map((file, index) => (
                    <li
                      key={`${file.filename}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.filename}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Seules les métadonnées sont conservées : le fichier est parti avec l&apos;email, il
                  n&apos;est pas archivé.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Destinataires ({data.recipients.length})
              </p>
              <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {data.recipients.map((recipient, index) => (
                  <div
                    key={`${recipient.email}-${index}`}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5"
                  >
                    {recipient.status === 'sent' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm">{recipient.name || recipient.email}</span>
                        <Badge variant="outline" className={`shrink-0 text-[10px] ${TYPE_BADGE[recipient.type]}`}>
                          {RECIPIENT_TYPE_SINGULAR[recipient.type]}
                        </Badge>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{recipient.email}</p>
                      {recipient.errorMessage && (
                        <p className="text-xs text-destructive">{recipient.errorMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
