'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, User, Filter, AlertCircle, Mail, Clock, Send, X, Plus, Loader2 } from 'lucide-react';
import { ParentTeacherConversation, ConversationFilter, ConversationMessage } from '@ecoledigitale/contracts';
import { useConversationThread, useReplyToConversation, useStartParentConversation, useChildTeachers } from '@/lib/hooks/use-parent-messages';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';

interface ParentTeacherMessagesProps {
  conversations: ParentTeacherConversation[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  teachers?: Array<{ id: string; name: string }>;
  filters?: ConversationFilter;
  onFiltersChange?: (filters: ConversationFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onConversationClick?: (conversation: ParentTeacherConversation) => void;
}

export function ParentTeacherMessages({ 
  conversations, 
  isLoading, 
  error,
  children,
  teachers,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange,
  onConversationClick
}: ParentTeacherMessagesProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replyChannels, setReplyChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const [isReplying, setIsReplying] = useState(false);
  const [showNewConversationForm, setShowNewConversationForm] = useState(false);
  const [newConversationData, setNewConversationData] = useState({
    childId: '',
    teacherId: '',
    subject: '',
    content: '',
  });
  const [newChannels, setNewChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation thread when a conversation is selected
  const { data: threadData, isLoading: isLoadingThread } = useConversationThread(selectedConversationId);
  const conversation = threadData?.data?.conversation;
  const messages = threadData?.data?.messages || [];

  // Reply mutation
  const replyMutation = useReplyToConversation();
  
  // Start conversation mutation
  const startConversationMutation = useStartParentConversation();
  
  // Fetch teachers for selected child
  const { data: teachersData, isLoading: isLoadingTeachers } = useChildTeachers(
    newConversationData.childId || null
  );
  const availableTeachers = teachersData?.data?.teachers || [];

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle filter change
  const handleFilterChange = (key: keyof ConversationFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: ConversationFilter = {
      childId: undefined,
      teacherId: undefined,
      status: undefined,
    };
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'archived':
        return <Badge className="bg-gray-100 text-gray-800">Archivée</Badge>;
      case 'closed':
        return <Badge className="bg-red-100 text-red-800">Fermée</Badge>;
      default:
        return null;
    }
  };

  // Get content preview
  const getContentPreview = (content: string | null, maxLength: number = 100) => {
    if (!content) return '';
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Handle conversation click
  const handleConversationClick = (conversation: ParentTeacherConversation) => {
    setSelectedConversationId(conversation.id);
    if (onConversationClick) {
      onConversationClick(conversation);
    }
  };

  // Handle reply
  const handleReply = async () => {
    if (!selectedConversationId || !replyContent.trim()) return;
    
    setIsReplying(true);
    try {
      await replyMutation.mutateAsync({
        conversationId: selectedConversationId,
        content: replyContent.trim(),
        sendWhatsapp: replyChannels.whatsapp,
        sendEmail: replyChannels.email,
      });
      setReplyContent('');
      setReplyChannels({ whatsapp: false, email: false });
      // Scroll to bottom will be handled by useEffect
    } catch (error) {
      console.error('Failed to send reply:', error);
      // You could add a toast notification here
    } finally {
      setIsReplying(false);
    }
  };

  // Handle start new conversation
  const handleStartConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConversationData.childId || !newConversationData.teacherId || !newConversationData.subject.trim() || !newConversationData.content.trim()) {
      return;
    }

    try {
      await startConversationMutation.mutateAsync({
        childId: newConversationData.childId,
        teacherId: newConversationData.teacherId,
        subject: newConversationData.subject.trim(),
        content: newConversationData.content.trim(),
        sendWhatsapp: newChannels.whatsapp,
        sendEmail: newChannels.email,
      });
      // Reset form and close
      setNewConversationData({
        childId: '',
        teacherId: '',
        subject: '',
        content: '',
      });
      setNewChannels({ whatsapp: false, email: false });
      setShowNewConversationForm(false);
    } catch (error) {
      console.error('Failed to start conversation:', error);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            Conversations Parent-Enseignant
          </CardTitle>
          <CardDescription>
            Conversations avec les enseignants de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            Conversations Parent-Enseignant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des conversations</p>
            <p className="text-gray-600 text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!conversations || conversations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            Conversations Parent-Enseignant
          </CardTitle>
          <CardDescription>
            Conversations avec les enseignants de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {children && children.length > 0 && (
                <Select
                  value={filters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`parent-messages-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={filters.status || 'all'}
                onValueChange={(value) => handleFilterChange('status', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archivée</SelectItem>
                  <SelectItem value="closed">Fermée</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(filters.childId || filters.teacherId || filters.status) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium mb-2">Aucune conversation</p>
            <p className="text-gray-500 text-sm">Vous n'avez pas encore de conversations avec les enseignants</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Conversations List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-600" />
                Conversations Parent-Enseignant
              </CardTitle>
              <CardDescription>
                Conversations avec les enseignants de vos enfants
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowNewConversationForm(!showNewConversationForm)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Nouvelle Conversation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* New Conversation Form */}
          {showNewConversationForm && (
            <Card className="mb-6 border-emerald-200 bg-emerald-50/50">
              <CardHeader>
                <CardTitle className="text-lg">Nouvelle Conversation</CardTitle>
                <CardDescription>
                  Créez une nouvelle conversation avec un enseignant de votre enfant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStartConversation} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-child">Enfant *</Label>
                    <Select
                      value={newConversationData.childId}
                      onValueChange={(value) => {
                        setNewConversationData({
                          ...newConversationData,
                          childId: value,
                          teacherId: '', // Reset teacher when child changes
                        });
                      }}
                      required
                    >
                      <SelectTrigger id="new-child">
                        <SelectValue placeholder="Sélectionner un enfant" />
                      </SelectTrigger>
                      <SelectContent>
                        {children?.map((child, index) => (
                          <SelectItem key={`parent-messages-child-${index}`} value={child.id}>
                            {child.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-teacher">Enseignant *</Label>
                    {isLoadingTeachers ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Chargement des enseignants...
                      </div>
                    ) : availableTeachers.length === 0 && newConversationData.childId ? (
                      <p className="text-sm text-gray-500">
                        Aucun enseignant assigné à cet enfant
                      </p>
                    ) : (
                      <Select
                        value={newConversationData.teacherId}
                        onValueChange={(value) =>
                          setNewConversationData({ ...newConversationData, teacherId: value })
                        }
                        required
                        disabled={!newConversationData.childId || isLoadingTeachers}
                      >
                        <SelectTrigger id="new-teacher">
                          <SelectValue placeholder="Sélectionner un enseignant" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTeachers.map((teacher, index) => {
                            const courses =
                              teacher.coursesSummary ||
                              [teacher.courseName, teacher.className].filter(Boolean).join(' — ');
                            return (
                              <SelectItem key={`parent-messages-teacher-${teacher.id}-${index}`} value={teacher.id}>
                                {courses ? `${teacher.name} — ${courses}` : teacher.name}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-subject">Sujet *</Label>
                    <Input
                      id="new-subject"
                      value={newConversationData.subject}
                      onChange={(e) =>
                        setNewConversationData({ ...newConversationData, subject: e.target.value })
                      }
                      placeholder="Ex: Question sur les devoirs"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-content">Message *</Label>
                    <Textarea
                      id="new-content"
                      value={newConversationData.content}
                      onChange={(e) =>
                        setNewConversationData({ ...newConversationData, content: e.target.value })
                      }
                      placeholder="Rédigez votre message..."
                      rows={4}
                      required
                    />
                  </div>

                  <MessageChannelsField
                    idPrefix="parent-teacher-new"
                    channels={newChannels}
                    onChange={setNewChannels}
                    disabled={startConversationMutation.isPending}
                    templateKind="parent_teacher_new"
                  />

                  <div className="flex items-center gap-2">
                    <Button
                      type="submit"
                      disabled={
                        startConversationMutation.isPending ||
                        !newConversationData.childId ||
                        !newConversationData.teacherId ||
                        !newConversationData.subject.trim() ||
                        !newConversationData.content.trim()
                      }
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {startConversationMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Création...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Créer la conversation
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowNewConversationForm(false);
                        setNewConversationData({
                          childId: '',
                          teacherId: '',
                          subject: '',
                          content: '',
                        });
                        setNewChannels({ whatsapp: false, email: false });
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                  {startConversationMutation.isError && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
                      <p className="font-medium">Erreur lors de la création</p>
                      <p className="mt-1">
                        {startConversationMutation.error instanceof Error
                          ? startConversationMutation.error.message
                          : 'Une erreur est survenue'}
                      </p>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {children && children.length > 0 && (
                <Select
                  value={filters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`parent-messages-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={filters.status || 'all'}
                onValueChange={(value) => handleFilterChange('status', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archivée</SelectItem>
                  <SelectItem value="closed">Fermée</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(filters.childId || filters.teacherId || filters.status) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>

          {/* Conversations List */}
          <div className="space-y-4">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleConversationClick(conv)}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedConversationId === conv.id
                    ? 'bg-blue-50 border-blue-300'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{conv.subject}</h3>
                      {conv.unreadCount > 0 && (
                        <Badge className="bg-blue-100 text-blue-800">{conv.unreadCount} non lu(s)</Badge>
                      )}
                      {getStatusBadge(conv.status)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Enseignant: {conv.teacherName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Enfant: {conv.childName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>{formatDate(conv.lastMessageDate)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {conv.lastMessagePreview && (
                  <p className="text-gray-700 text-sm">{getContentPreview(conv.lastMessagePreview)}</p>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-gray-600">
                Page {pagination.page} sur {pagination.totalPages} ({pagination.total} conversations)
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversation Thread Modal */}
      {selectedConversationId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex items-start justify-between">
              <div className="flex-1">
                {isLoadingThread ? (
                  <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ) : conversation ? (
                  <>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{conversation.subject}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Enseignant: {conversation.teacherName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Enfant: {conversation.childName}</span>
                      </div>
                      {getStatusBadge(conversation.status)}
                    </div>
                  </>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedConversationId(null);
                  setReplyContent('');
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {isLoadingThread ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-20 bg-gray-200 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Mail className="h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-600 font-medium mb-2">Aucun message</p>
                  <p className="text-gray-500 text-sm">Cette conversation ne contient pas encore de messages</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => {
                    const isParentMessage = message.senderId === conversation?.parentId;
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isParentMessage ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-lg p-4 ${
                            isParentMessage
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                              : 'bg-gray-100 text-gray-900 border border-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-sm">
                              {isParentMessage ? 'Vous' : message.senderName}
                            </span>
                            <span className="text-xs opacity-70">
                              {new Date(message.sentAt).toLocaleDateString('fr-FR', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {message.isRead && isParentMessage && (
                              <span className="text-xs opacity-70">✓ Lu</span>
                            )}
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Reply Form */}
            {conversation && conversation.status !== 'closed' && (
              <div className="p-6 border-t bg-gray-50">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="reply-textarea" className="block text-sm font-medium text-gray-700 mb-2">
                      Votre réponse
                    </label>
                    <Textarea
                      id="reply-textarea"
                      placeholder="Tapez votre message ici..."
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      rows={4}
                      className="resize-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          if (replyContent.trim() && !isReplying && !replyMutation.isPending) {
                            handleReply();
                          }
                        }
                      }}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Appuyez sur Ctrl+Entrée (ou Cmd+Entrée sur Mac) pour envoyer rapidement
                    </p>
                  </div>
                  <MessageChannelsField
                    idPrefix="parent-teacher-reply"
                    channels={replyChannels}
                    onChange={setReplyChannels}
                    disabled={isReplying || replyMutation.isPending}
                    templateKind="parent_teacher_reply"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedConversationId(null);
                        setReplyContent('');
                        setReplyChannels({ whatsapp: false, email: false });
                      }}
                      disabled={isReplying || replyMutation.isPending}
                    >
                      Fermer
                    </Button>
                    <Button
                      onClick={handleReply}
                      disabled={!replyContent.trim() || isReplying || replyMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isReplying || replyMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Envoi en cours...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Envoyer la réponse
                        </>
                      )}
                    </Button>
                  </div>
                  {(replyMutation.isError) && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
                      <p className="font-medium">Erreur lors de l'envoi</p>
                      <p className="mt-1">
                        {replyMutation.error instanceof Error
                          ? replyMutation.error.message
                          : 'Une erreur est survenue lors de l\'envoi de votre message'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {conversation && conversation.status === 'closed' && (
              <div className="p-6 border-t bg-gray-50">
                <div className="text-center py-4">
                  <p className="text-gray-600 text-sm">
                    Cette conversation est fermée. Vous ne pouvez plus y répondre.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

