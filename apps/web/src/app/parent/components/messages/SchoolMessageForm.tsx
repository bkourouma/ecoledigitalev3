'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, Send, Loader2, CheckCircle2, AlertCircle, Mail, Clock, Plus, X, User } from 'lucide-react';
import { 
  useSendSchoolMessage, 
  useSchoolConversations, 
  useSchoolConversationThread, 
  useReplyToSchoolConversation 
} from '@/lib/hooks/use-parent-messages';
import { toast } from 'sonner';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';

interface SchoolMessageFormProps {
  children?: Array<{ id: string; name: string }>;
}

export function SchoolMessageForm({ children = [] }: SchoolMessageFormProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(undefined);
  const [replyContent, setReplyContent] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [showNewMessageForm, setShowNewMessageForm] = useState(false);
  const [newMessageData, setNewMessageData] = useState({
    childId: '',
    subject: '',
    content: '',
  });
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const [replyChannels, setReplyChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  const { data: conversationsData, isLoading: isLoadingConversations, error: conversationsError } = useSchoolConversations(
    selectedChildId,
    undefined,
    1,
    50
  );
  const conversations = conversationsData?.data?.conversations || [];

  // Fetch conversation thread when a conversation is selected
  const { data: threadData, isLoading: isLoadingThread } = useSchoolConversationThread(selectedConversationId);
  const conversation = threadData?.data?.conversation;
  const messages = threadData?.data?.messages || [];

  // Send message mutation
  const sendMessageMutation = useSendSchoolMessage();
  
  // Reply mutation
  const replyMutation = useReplyToSchoolConversation();

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
    setShowNewMessageForm(false);
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
      toast.success('Réponse envoyée avec succès');
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setIsReplying(false);
    }
  };

  // Handle send new message
  const handleSendNewMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessageData.childId || !newMessageData.subject.trim() || !newMessageData.content.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        childId: newMessageData.childId,
        subject: newMessageData.subject,
        content: newMessageData.content,
        sendWhatsapp: channels.whatsapp,
        sendEmail: channels.email,
      });
      
      toast.success('Message envoyé à l\'établissement avec succès');
      setNewMessageData({ childId: '', subject: '', content: '' });
      setChannels({ whatsapp: false, email: false });
      setShowNewMessageForm(false);
      // Select the new conversation
      if (result.data?.conversation?.id) {
        setSelectedConversationId(result.data.conversation.id);
      }
    } catch (error) {
      // Error is handled by the hook
    }
  };

  // Loading state
  if (isLoadingConversations) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" />
            Messages à l'Établissement
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
            <Building2 className="h-5 w-5 text-emerald-600" />
            Messages à l'Établissement
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
      {/* Conversations List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-emerald-600" />
                Messages à l'Établissement
              </CardTitle>
              <CardDescription>
                Conversations avec l'administration de l'établissement
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setShowNewMessageForm(!showNewMessageForm);
                setSelectedConversationId(null);
              }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Nouveau Message
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter by child */}
          {children && children.length > 0 && (
            <div className="mb-4">
              <Select
                value={selectedChildId || 'all'}
                onValueChange={(value) => setSelectedChildId(value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue placeholder="Filtrer par enfant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* New Message Form */}
          {showNewMessageForm && (
            <Card className="mb-6 border-emerald-200 bg-emerald-50/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Nouveau Message</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowNewMessageForm(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription>
                  Envoyez un nouveau message à l'administration de l'établissement
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSendNewMessage} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-child">Enfant concerné *</Label>
                    <Select
                      value={newMessageData.childId}
                      onValueChange={(value) => setNewMessageData({ ...newMessageData, childId: value })}
                      required
                    >
                      <SelectTrigger id="new-child">
                        <SelectValue placeholder="Sélectionner un enfant" />
                      </SelectTrigger>
                      <SelectContent>
                        {children.map((child) => (
                          <SelectItem key={child.id} value={child.id}>
                            {child.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-subject">Sujet *</Label>
                    <Input
                      id="new-subject"
                      placeholder="Ex: Question sur les horaires..."
                      value={newMessageData.subject}
                      onChange={(e) => setNewMessageData({ ...newMessageData, subject: e.target.value })}
                      disabled={sendMessageMutation.isPending}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-content">Message *</Label>
                    <Textarea
                      id="new-content"
                      placeholder="Rédigez votre message..."
                      value={newMessageData.content}
                      onChange={(e) => setNewMessageData({ ...newMessageData, content: e.target.value })}
                      disabled={sendMessageMutation.isPending}
                      rows={6}
                      required
                      className="resize-none"
                    />
                  </div>

                  <MessageChannelsField
                    idPrefix="parent-school"
                    channels={channels}
                    onChange={setChannels}
                    disabled={sendMessageMutation.isPending}
                    templateKind="parent_school_new"
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowNewMessageForm(false)}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="submit"
                      disabled={sendMessageMutation.isPending || !newMessageData.childId || !newMessageData.subject.trim() || !newMessageData.content.trim()}
                      className="flex items-center gap-2"
                    >
                      {sendMessageMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Envoi...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Envoyer
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Conversations List */}
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Mail className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium mb-2">Aucune conversation</p>
              <p className="text-gray-500 text-sm">Vous n'avez pas encore de conversations avec l'établissement</p>
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
                        {conv.childName}
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
        </CardContent>
      </Card>

      {/* Conversation Thread */}
      {selectedConversationId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-emerald-600" />
                  {conversation?.subject || 'Conversation'}
                </CardTitle>
                <CardDescription>
                  {conversation?.childName && `Enfant: ${conversation.childName}`}
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
                      const isParent = message.senderId === conversation?.parentId;
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isParent ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-4 ${
                              isParent
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
                      <MessageChannelsField
                        idPrefix="parent-school-reply"
                        channels={replyChannels}
                        onChange={setReplyChannels}
                        disabled={isReplying}
                        templateKind="parent_school_reply"
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
