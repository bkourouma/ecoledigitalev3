'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Loader2,
  Reply,
  User,
} from 'lucide-react';
import {
  RECIPIENT_TYPE_LABELS,
  RECIPIENT_TYPE_SINGULAR,
  useAdminEmailInbox,
  type InboxMessage,
  type RecipientType,
} from '@/lib/hooks/use-admin-email';

const TYPE_BADGE: Record<RecipientType, string> = {
  parent: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  teacher: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  student: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

const FILTERS: Array<{ value: 'all' | RecipientType; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'parent', label: RECIPIENT_TYPE_LABELS.parent },
  { value: 'teacher', label: RECIPIENT_TYPE_LABELS.teacher },
  { value: 'student', label: RECIPIENT_TYPE_LABELS.student },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

interface Props {
  /** Bascule vers l'onglet de composition, expéditeur et objet pré-remplis. */
  onReply?: (message: InboxMessage) => void;
}

export function EmailInbox({ onReply }: Props) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | RecipientType>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useAdminEmailInbox(page, 20, filter === 'all' ? undefined : filter);
  const messages = data?.messages ?? [];
  const pagination = data?.pagination;
  const counts = data?.counts ?? {};
  const totalAll = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-primary" />
          Boîte de réception
        </CardTitle>
        <CardDescription>
          Messages adressés à l&apos;établissement depuis les espaces parent, enseignant et étudiant.
          Consultation seule : la réponse se fait par email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => {
            const count = entry.value === 'all' ? totalAll : counts[entry.value] ?? 0;
            const isActive = filter === entry.value;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => {
                  setFilter(entry.value);
                  setPage(1);
                  setOpenId(null);
                }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {entry.label} ({count})
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des messages reçus…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Aucun message reçu</p>
            <p className="text-sm text-muted-foreground">
              Les messages envoyés à l&apos;établissement par les parents, les enseignants et les
              étudiants apparaîtront ici.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => {
              const isOpen = openId === message.id;
              return (
                <div
                  key={message.id}
                  className={`rounded-lg border transition-colors ${
                    isOpen ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : message.id)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{message.subject}</h3>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {message.senderName || 'Expéditeur inconnu'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(message.sentAt)}
                          </span>
                          {message.childName && <span>Élève : {message.childName}</span>}
                        </p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${TYPE_BADGE[message.senderRole]}`}>
                        {RECIPIENT_TYPE_SINGULAR[message.senderRole]}
                      </Badge>
                    </div>
                    {!isOpen && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{message.content}</p>
                    )}
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-border p-4">
                      <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">
                        {message.content}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {message.senderEmail || 'Aucune adresse email connue'}
                        </span>
                        {onReply && message.senderEmail && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onReply(message)}
                            className="gap-2"
                          >
                            <Reply className="h-4 w-4" />
                            Répondre par email
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border pt-4">
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
              Page {pagination.page} sur {pagination.totalPages} · {pagination.total} message(s)
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
  );
}
