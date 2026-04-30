'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageSquare, Megaphone, Users, Bell, Calendar, Building2 } from 'lucide-react';
import { useParentTeacherConversations } from '@/lib/hooks/use-parent-messages';
import { useParentChildren } from '@/lib/hooks/use-parent-children';
import { ParentTeacherMessages } from '../components/messages/ParentTeacherMessages';
import { SchoolMessageForm } from '../components/messages/SchoolMessageForm';
import { ConversationFilter } from '@ecoledigitale/contracts';

export default function ParentMessagesPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'conversations' | 'school-message' | 'notifications' | 'invitations'>('conversations');
  const [conversationFilters, setConversationFilters] = useState<ConversationFilter>({});
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(undefined);
  const [conversationPage, setConversationPage] = useState(1);
  const limit = 20;

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has parent role
  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));

  if (!isParent) {
    redirect('/');
  }

  // Fetch children list for filter
  const { data: childrenData, isLoading: isLoadingChildren } = useParentChildren();
  const children = childrenData?.data?.children || [];

  // Fetch parent-teacher conversations
  const { data: conversationsData, isLoading: isLoadingConversations, error: conversationsError } = useParentTeacherConversations(
    selectedChildId,
    conversationFilters,
    conversationPage,
    limit
  );
  const conversations = conversationsData?.data?.conversations || null;
  const conversationPagination = conversationsData?.data?.pagination || null;

  // Handle conversation filters change
  const handleConversationFiltersChange = (newFilters: ConversationFilter) => {
    setConversationFilters(newFilters);
    setConversationPage(1); // Reset to first page when filters change
  };

  // Handle conversation page change
  const handleConversationPageChange = (newPage: number) => {
    setConversationPage(newPage);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle conversation click
  const handleConversationClick = (conversation: any) => {
    // Conversation detail view is handled in the component
    console.log('Conversation clicked:', conversation);
  };


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Messages</h1>
              <p className="text-sm sm:text-base text-emerald-100">
                Consultez les messages des enseignants pour vos enfants
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm" role="region" aria-label="Statistiques des messages">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm font-medium">Messages</span>
                </div>
                <div className="text-2xl font-bold" aria-live="polite">
                  {conversationPagination?.total || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'conversations' | 'school-message' | 'notifications' | 'invitations')} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-2">
            <TabsTrigger value="conversations" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Messages des Enseignants
            </TabsTrigger>
            <TabsTrigger value="school-message" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Annonces de l'École
            </TabsTrigger>
            {/* <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Invitations
            </TabsTrigger> */}
          </TabsList>

          <TabsContent value="conversations" className="space-y-6">
            {/* Parent-Teacher Conversations */}
            <ParentTeacherMessages
              conversations={conversations}
              isLoading={isLoadingConversations}
              error={conversationsError as Error | null}
              children={children}
              filters={conversationFilters}
              onFiltersChange={handleConversationFiltersChange}
              pagination={conversationPagination || undefined}
              onPageChange={handleConversationPageChange}
              onConversationClick={handleConversationClick}
            />
          </TabsContent>

          <TabsContent value="school-message" className="space-y-6">
            {/* School Message Form */}
            <SchoolMessageForm children={children} />
          </TabsContent>

          {/* <TabsContent value="notifications" className="space-y-6">
            <Notifications
              notifications={notifications}
              isLoading={isLoadingNotifications}
              error={notificationsError as Error | null}
              filters={notificationFilters}
              onFiltersChange={handleNotificationFiltersChange}
              pagination={notificationPagination || undefined}
              onPageChange={handleNotificationPageChange}
              onNotificationClick={handleNotificationClick}
              onMarkAsRead={handleMarkNotificationAsRead}
            />
          </TabsContent> */}

          {/* <TabsContent value="invitations" className="space-y-6">
            <EventInvitations
              invitations={invitations}
              isLoading={isLoadingInvitations}
              error={invitationsError as Error | null}
              children={children}
              filters={invitationFilters}
              onFiltersChange={handleInvitationFiltersChange}
              pagination={invitationPagination || undefined}
              onPageChange={handleInvitationPageChange}
              onInvitationClick={handleInvitationClick}
            />
          </TabsContent> */}
        </Tabs>
      </div>
    </div>
  );
}

