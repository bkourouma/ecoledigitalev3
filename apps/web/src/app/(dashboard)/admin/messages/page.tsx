'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  History,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  PenLine,
} from 'lucide-react';
import { EmailComposer, type ComposerPrefill } from '../components/messages/EmailComposer';
import { EmailHistory } from '../components/messages/EmailHistory';
import { EmailInbox } from '../components/messages/EmailInbox';
import { useMessagingEmailConfig } from '@/lib/hooks/use-messaging-email-config';
import type { InboxMessage } from '@/lib/hooks/use-admin-email';

type MessagesTab = 'compose' | 'inbox' | 'history';

const TABS: Array<{ value: MessagesTab; label: string; icon: React.ElementType }> = [
  { value: 'compose', label: 'Nouveau message', icon: PenLine },
  { value: 'inbox', label: 'Boîte de réception', icon: Inbox },
  { value: 'history', label: 'Historique', icon: History },
];

export default function AdminMessagesPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<MessagesTab>('compose');
  const [prefill, setPrefill] = useState<ComposerPrefill | null>(null);
  const { data: emailConfig } = useMessagingEmailConfig();

  /** « Répondre par email » : bascule sur la composition, expéditeur pré-choisi. */
  const handleReply = (message: InboxMessage) => {
    if (!message.senderId) return;
    setPrefill({
      recipientId: message.senderId,
      subject: message.subject.startsWith('Re :') ? message.subject : `Re : ${message.subject}`,
      // Un jeton distinct à chaque clic, pour rejouer l'effet sur le même message.
      token: Date.now(),
    });
    setActiveTab('compose');
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const roles = (session as any)?.roles ?? [];
  const isAdmin =
    Array.isArray(roles) &&
    roles.some((role: string) => ['admin', 'super_admin', 'Administrateur'].includes(role));

  if (!isAdmin) {
    redirect('/');
  }

  const emailConfigured = emailConfig?.emailConfigured;

  return (
    <div className="space-y-6 p-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Mail className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Composez et envoyez des emails aux parents, enseignants et étudiants de
              l&apos;établissement, et consultez les messages qui vous sont adressés. Chaque envoi
              est tracé dans l&apos;application.
            </p>
          </div>
        </div>

        {emailConfigured !== undefined && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              emailConfigured
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            {emailConfigured ? (
              <MailCheck className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">
              {emailConfigured ? 'Serveur SMTP configuré' : 'Serveur SMTP non configuré'}
            </span>
          </div>
        )}
      </div>

      {emailConfigured === false && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-muted-foreground">
              Aucun email ne peut partir tant que les variables serveur{' '}
              <code className="font-mono">SMTP_HOST</code>,{' '}
              <code className="font-mono">SMTP_USER</code> et{' '}
              <code className="font-mono">SMTP_PASSWORD</code> ne sont pas renseignées. La rédaction et la
              boîte de réception restent accessibles.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MessagesTab)} className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex items-center gap-2">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="compose">
          <EmailComposer prefill={prefill} />
        </TabsContent>

        <TabsContent value="inbox">
          <EmailInbox onReply={handleReply} />
        </TabsContent>

        <TabsContent value="history">
          <EmailHistory />
        </TabsContent>

      </Tabs>
    </div>
  );
}
