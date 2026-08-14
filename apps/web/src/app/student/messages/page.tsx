'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MessageSquare, Megaphone, Loader2, Send } from 'lucide-react';
import { useAdminMessagesForStudent, useTeacherMessagesForStudent } from '@/lib/hooks/use-student-messages';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createApiHeaders } from '@/lib/api-utils';
import { toast } from 'sonner';
import { StudentWriteToSchoolPanel, StudentWriteToTeacherPanel } from '../components/StudentOutgoingPanels';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';

export default function StudentMessagesPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'messages' | 'announcements'>('messages');
  const [messagePage, setMessagePage] = useState(1);
  const [announcementPage, setAnnouncementPage] = useState(1);
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

  // Check if user has student role
  const roles = (session as any)?.roles ?? [];
  const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Student', 'Étudiant'].includes(r));

  if (!isStudent) {
    redirect('/');
  }

  // Fetch admin messages for student
  const { data: adminMessagesData, isLoading: isLoadingAdminMessages, error: adminMessagesError } = useAdminMessagesForStudent({}, messagePage, limit);
  const adminMessages = adminMessagesData?.data?.messages || [];
  const adminMessagesPagination = adminMessagesData?.data?.pagination || null;

  // Fetch teacher messages for student
  const { data: teacherMessagesData, isLoading: isLoadingTeacherMessages, error: teacherMessagesError } = useTeacherMessagesForStudent({}, announcementPage, limit);
  const teacherMessages = teacherMessagesData?.data?.messages || [];
  const teacherMessagesPagination = teacherMessagesData?.data?.pagination || null;

  // State for reply
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<{ [key: string]: string }>({});
  const [replyChannels, setReplyChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const queryClient = useQueryClient();

  // Mutation for replying to teacher message
  const replyMutation = useMutation({
    mutationFn: async ({
      messageId,
      content,
      channels,
    }: {
      messageId: string;
      content: string;
      channels: MessageChannels;
    }) => {
      const headers = createApiHeaders(session);
      const userId = (session as any)?.userId || (session?.user as any)?.id;
      headers['X-User-Id'] = userId;

      // Get the message to find teacherId
      const message = teacherMessages.find((m) => m.id === messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // For now, we'll create a simple reply mechanism
      // In a real scenario, you might want to create a conversation thread
      const response = await fetch(`/api/v1/student/messages/reply-to-teacher`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageId,
          teacherId: message.teacherId,
          content: content.trim(),
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to send reply' }));
        throw new Error(error.message || 'Failed to send reply');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-teacher-messages'] });
      setReplyContent({});
      setReplyChannels({ whatsapp: false, email: false });
      setSelectedMessageId(null);
      toast.success('Réponse envoyée avec succès');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de l\'envoi de la réponse');
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Messages & Infos</h1>
              <p className="text-sm sm:text-base text-emerald-100">
                Consultez vos messages et les annonces de l'établissement
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'messages' | 'announcements')} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 gap-2">
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Annonces de l'établissement
            </TabsTrigger>
            <TabsTrigger value="announcements" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Annonces des enseignants
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-6">
            <StudentWriteToSchoolPanel />
            {/* Admin Messages Section */}
            <Card>
              <CardHeader>
                <CardTitle>Annonces de l'établissement</CardTitle>
                <CardDescription>
                  Annonces envoyées par l'administration de l'établissement
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAdminMessages ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-4">Chargement des messages...</p>
                  </div>
                ) : adminMessagesError ? (
                  <div className="text-center py-12 text-red-500">
                    <p>Erreur lors du chargement des messages</p>
                    <p className="text-sm mt-2">
                      {adminMessagesError instanceof Error ? adminMessagesError.message : 'Une erreur est survenue'}
                    </p>
                  </div>
                ) : adminMessages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>Aucun message</p>
                    <p className="text-sm mt-2">Aucun message de l'administration pour le moment</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {adminMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`border rounded-lg p-4 hover:bg-gray-50 transition-colors ${
                          !message.isRead ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">{message.subject}</h3>
                              {!message.isRead && (
                                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                                  Nouveau
                                </span>
                              )}
                              {message.priorityLevel && (
                                <span
                                  className={`text-xs px-2 py-1 rounded-full ${
                                    message.priorityLevel === 'urgent'
                                      ? 'bg-red-100 text-red-800'
                                      : message.priorityLevel === 'high'
                                      ? 'bg-orange-100 text-orange-800'
                                      : message.priorityLevel === 'normal'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {message.priorityLevel === 'urgent'
                                    ? 'Urgente'
                                    : message.priorityLevel === 'high'
                                    ? 'Haute'
                                    : message.priorityLevel === 'normal'
                                    ? 'Normale'
                                    : 'Basse'}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-2 line-clamp-3">{message.content}</p>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span>De: {message.adminName}</span>
                              <span>•</span>
                              <span>
                                {new Date(message.sentAt).toLocaleDateString('fr-FR', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {message.isRead && (
                                <>
                                  <span>•</span>
                                  <span className="text-green-600">Lu</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Pagination for admin messages */}
                    {adminMessagesPagination && adminMessagesPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <p className="text-sm text-gray-500">
                          Page {adminMessagesPagination.page} sur {adminMessagesPagination.totalPages} ({adminMessagesPagination.total} messages)
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMessagePage((p) => Math.max(1, p - 1))}
                            disabled={messagePage === 1}
                          >
                            Précédent
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMessagePage((p) => Math.min(adminMessagesPagination.totalPages, p + 1))}
                            disabled={messagePage === adminMessagesPagination.totalPages}
                          >
                            Suivant
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="announcements" className="space-y-6">
            <StudentWriteToTeacherPanel />
            {/* Teacher Messages Section */}
            <Card>
              <CardHeader>
                <CardTitle>Annonces des enseignants</CardTitle>
                <CardDescription>
                  Messages et annonces envoyés par vos enseignants
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingTeacherMessages ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-4">Chargement des messages...</p>
                  </div>
                ) : teacherMessagesError ? (
                  <div className="text-center py-12 text-red-500">
                    <p>Erreur lors du chargement des messages</p>
                    <p className="text-sm mt-2">
                      {teacherMessagesError instanceof Error ? teacherMessagesError.message : 'Une erreur est survenue'}
                    </p>
                  </div>
                ) : teacherMessages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Megaphone className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>Aucun message</p>
                    <p className="text-sm mt-2">Aucun message de vos enseignants pour le moment</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {teacherMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`border rounded-lg p-4 hover:bg-gray-50 transition-colors ${
                          !message.isRead ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">{message.subject}</h3>
                              {!message.isRead && (
                                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                                  Nouveau
                                </span>
                              )}
                              {message.priorityLevel && (
                                <span
                                  className={`text-xs px-2 py-1 rounded-full ${
                                    message.priorityLevel === 'urgent'
                                      ? 'bg-red-100 text-red-800'
                                      : message.priorityLevel === 'high'
                                      ? 'bg-orange-100 text-orange-800'
                                      : message.priorityLevel === 'normal'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {message.priorityLevel === 'urgent'
                                    ? 'Urgente'
                                    : message.priorityLevel === 'high'
                                    ? 'Haute'
                                    : message.priorityLevel === 'normal'
                                    ? 'Normale'
                                    : 'Basse'}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-2 whitespace-pre-wrap">{message.content}</p>
                            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                              <span>De: {message.teacherName}</span>
                              <span>•</span>
                              <span>
                                {new Date(message.sentAt).toLocaleDateString('fr-FR', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {message.isRead && (
                                <>
                                  <span>•</span>
                                  <span className="text-green-600">Lu</span>
                                </>
                              )}
                            </div>

                            {/* Reply Section */}
                            {selectedMessageId === message.id ? (
                              <div className="mt-4 pt-4 border-t">
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (replyContent[message.id]?.trim()) {
                                      replyMutation.mutate({
                                        messageId: message.id,
                                        content: replyContent[message.id],
                                        channels: replyChannels,
                                      });
                                    }
                                  }}
                                  className="space-y-2"
                                >
                                  <Textarea
                                    value={replyContent[message.id] || ''}
                                    onChange={(e) =>
                                      setReplyContent({ ...replyContent, [message.id]: e.target.value })
                                    }
                                    placeholder="Tapez votre réponse..."
                                    rows={3}
                                    disabled={replyMutation.isPending}
                                    className="resize-none"
                                  />
                                  <MessageChannelsField
                                    idPrefix={`student-reply-${message.id}`}
                                    channels={replyChannels}
                                    onChange={setReplyChannels}
                                    disabled={replyMutation.isPending}
                                    templateKind="student_teacher_reply"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedMessageId(null);
                                        setReplyContent({ ...replyContent, [message.id]: '' });
                                      }}
                                      disabled={replyMutation.isPending}
                                    >
                                      Annuler
                                    </Button>
                                    <Button
                                      type="submit"
                                      size="sm"
                                      disabled={replyMutation.isPending || !replyContent[message.id]?.trim()}
                                      className="bg-emerald-600 hover:bg-emerald-700"
                                    >
                                      {replyMutation.isPending ? (
                                        <>
                                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          Envoi...
                                        </>
                                      ) : (
                                        <>
                                          <Send className="h-4 w-4 mr-2" />
                                          Envoyer
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </form>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedMessageId(message.id)}
                                className="mt-2"
                              >
                                <Send className="h-4 w-4 mr-2" />
                                Répondre
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Pagination for teacher messages */}
                    {teacherMessagesPagination && teacherMessagesPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <p className="text-sm text-gray-500">
                          Page {teacherMessagesPagination.page} sur {teacherMessagesPagination.totalPages} ({teacherMessagesPagination.total} messages)
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAnnouncementPage((p) => Math.max(1, p - 1))}
                            disabled={announcementPage === 1}
                          >
                            Précédent
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAnnouncementPage((p) => Math.min(teacherMessagesPagination.totalPages, p + 1))}
                            disabled={announcementPage === teacherMessagesPagination.totalPages}
                          >
                            Suivant
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

