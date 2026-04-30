'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageSquare, Send, Loader2, AlertCircle, Mail, Clock, User, Building2, X, Plus, Users } from 'lucide-react';
import { 
  useAdminConversations, 
  useAdminConversationThread, 
  useAdminReplyToConversation,
  useAdminParents,
  useAdminStartConversation
} from '@/lib/hooks/use-admin-messages';
import { toast } from 'sonner';
import { AdminBulkParentMessages } from './AdminBulkParentMessages';
import { WhatsappSendCheckbox } from '@/components/messaging/WhatsappSendCheckbox';

export function AdminParentConversations() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);
  const [replyContent, setReplyContent] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [showNewConversationForm, setShowNewConversationForm] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [newConversationData, setNewConversationData] = useState({
    parentId: '',
    childId: '',
    subject: '',
    content: '',
  });
  const [sendWhatsappNew, setSendWhatsappNew] = useState(false);
  const [sendWhatsappReply, setSendWhatsappReply] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  const { data: conversationsData, isLoading: isLoadingConversations, error: conversationsError } = useAdminConversations(
    undefined,
    undefined,
    selectedStatus,
    page,
    limit
  );
  const conversations = conversationsData?.data?.conversations || [];
  const pagination = conversationsData?.data?.pagination;

  // Fetch conversation thread when a conversation is selected
  const { data: threadData, isLoading: isLoadingThread } = useAdminConversationThread(selectedConversationId);
  const conversation = threadData?.data?.conversation;
  const messages = threadData?.data?.messages || [];

  // Reply mutation
  const replyMutation = useAdminReplyToConversation();

  // Fetch parents for new conversation
  const { data: parentsData, isLoading: isLoadingParents } = useAdminParents(
    parentSearch || undefined
  );
  const parents = parentsData?.data?.parents || [];

  // Start conversation mutation
  const startConversationMutation = useAdminStartConversation();

  // Get children for selected parent
  const selectedParent = parents.find(p => p.id === newConversationData.parentId);
  const availableChildren = selectedParent?.children || [];

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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

  // Get content preview
  const getContentPreview = (content: string | null, maxLength: number = 100) => {
    if (!content) return '';
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Handle conversation click
  const handleConversationClick = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setShowNewConversationForm(false);
  };

  // Handle reply
  const handleReply = async () => {
    if (!selectedConversationId || !replyContent.trim()) return;
    
    setIsReplying(true);
    try {
      await replyMutation.mutateAsync({
        conversationId: selectedConversationId,
        content: replyContent.trim(),
        sendWhatsapp: sendWhatsappReply,
      });
      setReplyContent('');
      toast.success('Réponse envoyée avec succès');
    } catch (error) {
      console.error('Failed to send reply:', error);
      toast.error('Erreur lors de l\'envoi de la réponse');
    } finally {
      setIsReplying(false);
    }
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle start new conversation
  const handleStartConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newConversationData.parentId || !newConversationData.childId || !newConversationData.subject.trim() || !newConversationData.content.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const result = await startConversationMutation.mutateAsync({
        parentId: newConversationData.parentId,
        childId: newConversationData.childId,
        subject: newConversationData.subject.trim(),
        content: newConversationData.content.trim(),
        sendWhatsapp: sendWhatsappNew,
      });
      
      toast.success('Conversation créée avec succès');
      setNewConversationData({ parentId: '', childId: '', subject: '', content: '' });
      setShowNewConversationForm(false);
      setParentSearch('');
      // Select the new conversation
      if (result.data?.conversation?.id) {
        setSelectedConversationId(result.data.conversation.id);
      }
    } catch (error) {
      console.error('Failed to start conversation:', error);
    }
  };

  // Loading state
  if (isLoadingConversations) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            Messages des Parents
          </CardTitle>
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
  if (conversationsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            Messages des Parents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des conversations</p>
            <p className="text-gray-600 text-sm">{conversationsError.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AdminBulkParentMessages />
      {/* Conversations List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" />
                Messages des Parents
              </CardTitle>
              <CardDescription>
                Conversations avec les parents de l'établissement
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setShowNewConversationForm(!showNewConversationForm);
                setSelectedConversationId(null);
              }}
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
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Nouvelle Conversation</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowNewConversationForm(false);
                        setNewConversationData({ parentId: '', childId: '', subject: '', content: '' });
                        setParentSearch('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription>
                    Créez une nouvelle conversation avec un parent
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleStartConversation} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="parent-search">Rechercher un parent</Label>
                      <Input
                        id="parent-search"
                        placeholder="Rechercher par nom ou email..."
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-parent">Parent *</Label>
                      {isLoadingParents ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Chargement des parents...
                        </div>
                      ) : parents.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          {parentSearch ? 'Aucun parent trouvé' : 'Commencez par rechercher un parent'}
                        </p>
                      ) : (
                        <Select
                          value={newConversationData.parentId}
                          onValueChange={(value) => {
                            setNewConversationData({
                              ...newConversationData,
                              parentId: value,
                              childId: '', // Reset child when parent changes
                            });
                          }}
                          required
                        >
                          <SelectTrigger id="new-parent">
                            <SelectValue placeholder="Sélectionner un parent" />
                          </SelectTrigger>
                          <SelectContent>
                            {parents.map((parent) => (
                              <SelectItem key={parent.id} value={parent.id}>
                                {parent.name} ({parent.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-child">Enfant concerné *</Label>
                      {!newConversationData.parentId ? (
                        <p className="text-sm text-gray-500">
                          Sélectionnez d'abord un parent
                        </p>
                      ) : availableChildren.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          Ce parent n'a pas d'enfant associé
                        </p>
                      ) : (
                        <Select
                          value={newConversationData.childId}
                          onValueChange={(value) => setNewConversationData({ ...newConversationData, childId: value })}
                          required
                          disabled={!newConversationData.parentId}
                        >
                          <SelectTrigger id="new-child">
                            <SelectValue placeholder="Sélectionner un enfant" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableChildren.map((child) => (
                              <SelectItem key={child.id} value={child.id}>
                                {child.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-subject">Sujet *</Label>
                      <Input
                        id="new-subject"
                        placeholder="Ex: Information importante, demande de rendez-vous..."
                        value={newConversationData.subject}
                        onChange={(e) => setNewConversationData({ ...newConversationData, subject: e.target.value })}
                        disabled={startConversationMutation.isPending}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="new-content">Message *</Label>
                      <Textarea
                        id="new-content"
                        placeholder="Rédigez votre message..."
                        value={newConversationData.content}
                        onChange={(e) => setNewConversationData({ ...newConversationData, content: e.target.value })}
                        disabled={startConversationMutation.isPending}
                        rows={6}
                        required
                        className="resize-none"
                      />
                    </div>

                    <WhatsappSendCheckbox
                      checked={sendWhatsappNew}
                      onCheckedChange={setSendWhatsappNew}
                      disabled={startConversationMutation.isPending}
                      id="wa-new-parent"
                    />

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowNewConversationForm(false);
                          setNewConversationData({ parentId: '', childId: '', subject: '', content: '' });
                          setParentSearch('');
                        }}
                      >
                        Annuler
                      </Button>
                      <Button
                        type="submit"
                        disabled={startConversationMutation.isPending || !newConversationData.parentId || !newConversationData.childId || !newConversationData.subject.trim() || !newConversationData.content.trim()}
                        className="flex items-center gap-2"
                      >
                        {startConversationMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Création...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Créer la conversation
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

          {/* Filter by status */}
          <div className="mb-4">
            <Select
              value={selectedStatus || 'all'}
              onValueChange={(value) => setSelectedStatus(value === 'all' ? undefined : value)}
            >
              <SelectTrigger className="w-full md:w-64">
                <SelectValue placeholder="Filtrer par statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archivée</SelectItem>
                <SelectItem value="closed">Fermée</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conversations List */}
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Mail className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium mb-2">Aucune conversation</p>
              <p className="text-gray-500 text-sm">Aucune conversation avec les parents pour le moment</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleConversationClick(conv.id)}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedConversationId === conv.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{conv.subject}</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {conv.parentName} - {conv.childName}
                      </p>
                    </div>
                    <Badge className={conv.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {conv.status === 'active' ? 'Active' : conv.status}
                    </Badge>
                  </div>
                  {conv.lastMessage && (
                    <div className="mt-2 text-sm text-gray-500">
                      <p className="truncate">{getContentPreview(conv.lastMessage.content)}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <Clock className="h-3 w-3" />
                        {formatDate(conv.lastMessage.sentAt)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
              >
                Précédent
              </Button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} sur {pagination.totalPages} ({pagination.total} conversations)
              </span>
              <Button
                variant="outline"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= pagination.totalPages}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversation Thread */}
      {selectedConversationId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-emerald-600" />
                  {conversation?.subject || 'Conversation'}
                </CardTitle>
                <CardDescription>
                  {conversation && (
                    <>
                      Parent: {conversation.parentName} - Enfant: {conversation.childName}
                    </>
                  )}
                </CardDescription>
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
          </CardHeader>
          <CardContent>
            {isLoadingThread ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
                  {messages.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">Aucun message dans cette conversation</p>
                  ) : (
                    messages.map((message) => {
                      const isAdmin = message.senderId !== conversation?.parentId;
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-4 ${
                              isAdmin
                                ? 'bg-emerald-100 text-emerald-900'
                                : 'bg-gray-100 text-gray-900'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <User className="h-4 w-4" />
                              <span className="font-semibold text-sm">{message.senderName}</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-600">
                              <Clock className="h-3 w-3" />
                              {formatDate(message.sentAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Form */}
                {conversation?.status !== 'closed' && (
                  <div className="border-t pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="reply">Répondre</Label>
                      <Textarea
                        id="reply"
                        placeholder="Tapez votre réponse..."
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        disabled={isReplying}
                        rows={4}
                        className="resize-none"
                      />
                    </div>
                    <div className="mt-3">
                      <WhatsappSendCheckbox
                        checked={sendWhatsappReply}
                        onCheckedChange={setSendWhatsappReply}
                        disabled={isReplying}
                        id="wa-reply-parent"
                      />
                    </div>
                    <div className="flex justify-end mt-4">
                      <Button
                        onClick={handleReply}
                        disabled={isReplying || !replyContent.trim()}
                        className="flex items-center gap-2"
                      >
                        {isReplying ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Envoi...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Envoyer la réponse
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

