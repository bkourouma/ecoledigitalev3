'use client';

import React, { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Mail, MailWarning, MessageSquare, Megaphone, Settings2, Users } from 'lucide-react';
import { AdminParentConversations } from '../components/messages/AdminParentConversations';
import { AdminTeacherMessages } from '../components/messages/AdminTeacherMessages';
import { AdminStudentAnnouncements } from '../components/messages/AdminStudentAnnouncements';
import { EmailTemplatesManager } from '../components/messages/EmailTemplatesManager';
import { useAllTeachers } from '@/lib/hooks/use-teachers';
import {
  useMessageEmailTemplates,
  type MessageTemplateKind,
} from '@/lib/hooks/use-admin-message-templates';

type MessageTab = 'parent-conversations' | 'teacher-messages' | 'student-announcements' | 'email-templates';

const TABS: Array<{ value: MessageTab; label: string; shortLabel: string; icon: React.ElementType }> = [
  { value: 'parent-conversations', label: 'Parents', shortLabel: 'Parents', icon: Users },
  { value: 'teacher-messages', label: 'Enseignants', shortLabel: 'Enseig.', icon: MessageSquare },
  { value: 'student-announcements', label: 'Étudiants', shortLabel: 'Étud.', icon: Megaphone },
  { value: 'email-templates', label: "Modèles d'email", shortLabel: 'Modèles', icon: Settings2 },
];

export default function AdminMessagesPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<MessageTab>('parent-conversations');
  // Modèle à ouvrir quand on arrive depuis le lien « Personnaliser » d'un formulaire.
  const [focusTemplate, setFocusTemplate] = useState<MessageTemplateKind | null>(null);

  const { data: teachersData, isLoading: isLoadingTeachers, error: teachersError } = useAllTeachers();
  const { data: templatesData } = useMessageEmailTemplates();

  // Seuls les enseignants dotés d'un compte utilisateur peuvent être destinataires.
  const teachers = useMemo(() => {
    const rows = teachersData?.data ?? [];
    return rows
      .filter((teacher) => !!teacher.userId)
      .map((teacher) => ({
        id: teacher.userId!,
        name:
          `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() ||
          teacher.email ||
          'Enseignant sans nom',
      }));
  }, [teachersData]);

  const openTemplate = (kind: MessageTemplateKind) => {
    setFocusTemplate(kind);
    setActiveTab('email-templates');
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const roles = (session as any)?.roles ?? [];
  const isAdmin =
    Array.isArray(roles) && roles.some((role: string) => ['admin', 'super_admin', 'Administrateur'].includes(role));

  if (!isAdmin) {
    redirect('/');
  }

  const emailConfigured = templatesData?.emailConfigured;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* En-tête */}
      <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Messages</h1>
              <p className="mt-2 max-w-2xl text-sm text-emerald-50 sm:text-base">
                Communiquez avec les parents, les enseignants et les étudiants. Chaque message reste
                consultable dans l&apos;application et peut être relayé par WhatsApp ou par email.
                L&apos;onglet « Modèles d&apos;email » régit aussi les envois faits depuis les
                espaces enseignant, parent et étudiant.
              </p>
            </div>

            {/* État du canal email, visible dès l'arrivée sur la page */}
            {emailConfigured !== undefined && (
              <button
                type="button"
                onClick={() => setActiveTab('email-templates')}
                className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-3 text-left backdrop-blur-sm transition-colors hover:bg-white/25"
              >
                {emailConfigured ? (
                  <Mail className="h-5 w-5 shrink-0" />
                ) : (
                  <MailWarning className="h-5 w-5 shrink-0 text-amber-200" />
                )}
                <div>
                  <p className="text-sm font-semibold">Canal email</p>
                  <p className="text-xs text-emerald-50">
                    {emailConfigured ? 'SMTP configuré' : 'SMTP non configuré'}
                  </p>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as MessageTab);
            if (value !== 'email-templates') setFocusTemplate(null);
          }}
          className="space-y-6"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-white p-2 shadow-sm sm:grid-cols-4">
            {TABS.map(({ value, label, shortLabel, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{shortLabel}</span>
                {value === 'teacher-messages' && teachers.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 hidden bg-slate-100 text-[10px] text-slate-700 lg:inline-flex"
                  >
                    {teachers.length}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="parent-conversations" className="space-y-6">
            <AdminParentConversations onOpenTemplate={openTemplate} />
          </TabsContent>

          <TabsContent value="teacher-messages" className="space-y-6">
            <AdminTeacherMessages
              teachers={teachers}
              isLoading={isLoadingTeachers}
              error={teachersError as Error | null}
              onOpenTemplate={openTemplate}
            />
          </TabsContent>

          <TabsContent value="student-announcements" className="space-y-6">
            <AdminStudentAnnouncements onOpenTemplate={openTemplate} />
          </TabsContent>

          <TabsContent value="email-templates" className="space-y-6">
            <EmailTemplatesManager focusKind={focusTemplate} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
