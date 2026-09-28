'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageSquare, Megaphone, GraduationCap, Send, Plus, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CreateMessageForm } from '../components/communications/CreateMessageForm';
import { TeacherEstablishmentForm, TeacherStudentBroadcastForm } from '../components/communications/TeacherExtraMessagingPanels';
import { useTeacherMessages, useAdminMessagesForTeacher } from '@/lib/hooks/use-teacher-messages';
import { useSchoolAnnouncements } from '@/lib/hooks/use-parent-messages';

export default function TeacherCommunicationsPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'messages' | 'students' | 'announcements'>('messages');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [page, setPage] = useState(1);
  const [announcementPage, setAnnouncementPage] = useState(1);
  const limit = 20;

  // Fetch teacher messages
  const { data: messagesData, isLoading: isLoadingMessages, error: messagesError } = useTeacherMessages({}, page, limit);
  const messages = messagesData?.data?.messages || [];
  const pagination = messagesData?.data?.pagination || null;

  // Fetch school announcements
  const { data: announcementsData, isLoading: isLoadingAnnouncements, error: announcementsError } = useSchoolAnnouncements({}, announcementPage, limit);
  const announcements = announcementsData?.data?.announcements || [];
  const announcementPagination = announcementsData?.data?.pagination || null;

  // Fetch admin messages for teacher
  const { data: adminMessagesData, isLoading: isLoadingAdminMessages, error: adminMessagesError } = useAdminMessagesForTeacher({}, announcementPage, limit);
  const adminMessages = adminMessagesData?.data?.messages || [];
  const adminMessagesPagination = adminMessagesData?.data?.pagination || null;

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Communications</h1>
              <p className="text-sm sm:text-base text-purple-100">
                Gérez vos communications avec les parents et l'école
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm" role="region" aria-label="Statistiques des communications">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm font-medium">Messages</span>
                </div>
                <div className="text-2xl font-bold" aria-live="polite">
                  {pagination?.total || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'messages' | 'students' | 'announcements')} className="space-y-6">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 gap-2">
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              Messages aux Parents
            </TabsTrigger>
            <TabsTrigger value="students" className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              Messages aux élèves
            </TabsTrigger>
            <TabsTrigger value="announcements" className="flex items-center gap-2">
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

          <TabsContent value="messages" className="space-y-6">
            {/* Create Message Button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Messages aux Parents</h2>
                <p className="text-gray-500 whitespace-nowrap text-sm md:text-base">
                  Envoyez et gérez vos messages aux parents de vos étudiants
                </p>
              </div>
              <Button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                {showCreateForm ? 'Annuler' : 'Nouveau Message'}
              </Button>
            </div>

            {/* Create Message Form */}
            {showCreateForm && (
              <CreateMessageForm
                onSuccess={() => {
                  setShowCreateForm(false);
                }}
                onCancel={() => setShowCreateForm(false)}
              />
            )}

            {/* Messages List */}
            <Card>
              <CardHeader>
                <CardTitle>Messages Envoyés</CardTitle>
                <CardDescription>
                  Liste de tous les messages que vous avez envoyés aux parents
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingMessages ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-4">Chargement des messages...</p>
                  </div>
                ) : messagesError ? (
                  <div className="text-center py-12 text-red-500">
                    <p>Erreur lors du chargement des messages</p>
                    <p className="text-sm mt-2">
                      {messagesError instanceof Error ? messagesError.message : 'Une erreur est survenue'}
                    </p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>Aucun message envoyé</p>
                    <p className="text-sm mt-2">Commencez par créer votre premier message</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">{message.subject}</h3>
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
                            <p className="text-sm text-gray-600 mb-2 line-clamp-2">{message.content}</p>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span>À: {message.parentName}</span>
                              <span>•</span>
                              <span>Étudiant: {message.studentName}</span>
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

                    {/* Pagination */}
                    {pagination && pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <p className="text-sm text-gray-500">
                          Page {pagination.page} sur {pagination.totalPages} ({pagination.total} messages)
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                          >
                            Précédent
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                            disabled={page === pagination.totalPages}
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

          <TabsContent value="students" className="space-y-6">
            <TeacherStudentBroadcastForm />
          </TabsContent>

          <TabsContent value="announcements" className="space-y-6">
            <TeacherEstablishmentForm />
            {/* Admin Messages Section */}
            <Card>
              <CardHeader>
                <CardTitle>Messages de l'Administration</CardTitle>
                <CardDescription>
                  Messages envoyés par l'administration de l'établissement
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
                            onClick={() => setAnnouncementPage((p) => Math.max(1, p - 1))}
                            disabled={announcementPage === 1}
                          >
                            Précédent
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAnnouncementPage((p) => Math.min(adminMessagesPagination.totalPages, p + 1))}
                            disabled={announcementPage === adminMessagesPagination.totalPages}
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

            {/* School Announcements Section */}
            <Card>
              <CardHeader>
                <CardTitle>Annonces de l'École</CardTitle>
                <CardDescription>
                  Consultez les annonces publiées par l'administration
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAnnouncements ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-4">Chargement des annonces...</p>
                  </div>
                ) : announcementsError ? (
                  <div className="text-center py-12 text-red-500">
                    <p>Erreur lors du chargement des annonces</p>
                    <p className="text-sm mt-2">
                      {announcementsError instanceof Error ? announcementsError.message : 'Une erreur est survenue'}
                    </p>
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Megaphone className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>Aucune annonce</p>
                    <p className="text-sm mt-2">Aucune annonce n'a été publiée pour le moment</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {announcements.map((announcement) => (
                      <div
                        key={announcement.id}
                        className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">{announcement.title}</h3>
                              {announcement.priorityLevel && (
                                <span
                                  className={`text-xs px-2 py-1 rounded-full ${
                                    announcement.priorityLevel === 'urgent'
                                      ? 'bg-red-100 text-red-800'
                                      : announcement.priorityLevel === 'high'
                                      ? 'bg-orange-100 text-orange-800'
                                      : announcement.priorityLevel === 'normal'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {announcement.priorityLevel === 'urgent'
                                    ? 'Urgente'
                                    : announcement.priorityLevel === 'high'
                                    ? 'Haute'
                                    : announcement.priorityLevel === 'normal'
                                    ? 'Normale'
                                    : 'Basse'}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-2 line-clamp-3">{announcement.content}</p>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span>Par: {announcement.authorName}</span>
                              <span>•</span>
                              <span>
                                {new Date(announcement.postedAt).toLocaleDateString('fr-FR', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Pagination */}
                    {announcementPagination && announcementPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <p className="text-sm text-gray-500">
                          Page {announcementPagination.page} sur {announcementPagination.totalPages} ({announcementPagination.total} annonces)
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
                            onClick={() => setAnnouncementPage((p) => Math.min(announcementPagination.totalPages, p + 1))}
                            disabled={announcementPage === announcementPagination.totalPages}
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

          {/* <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                  Consultez vos notifications importantes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-gray-500">
                  <Bell className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>Fonctionnalité en cours de développement</p>
                  <p className="text-sm mt-2">Vos notifications apparaîtront ici</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent> */}

          {/* <TabsContent value="invitations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Invitations</CardTitle>
                <CardDescription>
                  Gérez vos invitations aux événements de l'école
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-gray-500">
                  <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>Fonctionnalité en cours de développement</p>
                  <p className="text-sm mt-2">Vos invitations aux événements apparaîtront ici</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent> */}
        </Tabs>
      </div>
    </div>
  );
}