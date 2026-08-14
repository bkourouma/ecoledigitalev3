'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Send,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  useAdminConversations,
  useAdminConversationThread,
  useAdminReplyToConversation,
  useAdminParents,
  useAdminStartConversation,
} from '@/lib/hooks/use-admin-messages';
import {
  useMessageEmailTemplates,
  type MessageTemplateKind,
} from '@/lib/hooks/use-admin-message-templates';
import { toast } from 'sonner';
import { AdminBulkParentMessages } from './AdminBulkParentMessages';
import {
  MessageChannelSelector,
  type MessageChannels,
} from '@/components/messaging/MessageChannelSelector';
import { LIGHT_TEXTAREA } from './message-ui';

interface Props {
  onOpenTemplate?: (kind: MessageTemplateKind) => void;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-800' },
  archived: { label: 'Archivée', className: 'bg-slate-100 text-slate-700' },
  closed: { label: 'Fermée', className: 'bg-red-100 text-red-800' },
};

const EMPTY_CONVERSATION = { parentId: '', childId: '', subject: '', content: '' };

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function preview(content: string | null, maxLength = 110): string {
  if (!content) return '';
  return content.length <= maxLength ? content : `${content.slice(0, maxLength)}…`;
}

export function AdminParentConversations({ onOpenTemplate }: Props) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);
  const [replyContent, setReplyContent] = useState('');
  const [showNewConversationForm, setShowNewConversationForm] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [newConversationData, setNewConversationData] = useState(EMPTY_CONVERSATION);
  const [newChannels, setNewChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const [replyChannels, setReplyChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const [page, setPage] = useState(1);
  const limit = 20;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    data: conversationsData,
    isLoading: isLoadingConversations,
    error: conversationsError,
  } = useAdminConversations(undefined, undefined, selectedStatus, page, limit);
  const conversations = conversationsData?.data?.conversations || [];
  const pagination = conversationsData?.data?.pagination;

  const { data: threadData, isLoading: isLoadingThread } = useAdminConversationThread(selectedConversationId);
  const conversation = threadData?.data?.conversation;
  const messages = threadData?.data?.messages || [];

  const replyMutation = useAdminReplyToConversation();
  const startConversationMutation = useAdminStartConversation();

  const { data: parentsData, isLoading: isLoadingParents } = useAdminParents(parentSearch || undefined);
  const parents = parentsData?.data?.parents || [];
  const selectedParent = parents.find((parent) => parent.id === newConversationData.parentId);
  const availableChildren = selectedParent?.children || [];

  const { data: templatesData } = useMessageEmailTemplates();
  const emailConfigured = templatesData?.emailConfigured ?? true;
  const newTemplate = templatesData?.templates.find((t) => t.kind === 'admin_parent_new');
  const replyTemplate = templatesData?.templates.find((t) => t.kind === 'admin_parent_reply');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReply = async () => {
    if (!selectedConversationId || !replyContent.trim()) return;
    try {
      await replyMutation.mutateAsync({
        conversationId: selectedConversationId,
        content: replyContent.trim(),
        sendWhatsapp: replyChannels.whatsapp,
        sendEmail: replyChannels.email,
      });
      setReplyContent('');
      setReplyChannels({ whatsapp: false, email: false });
      toast.success('Réponse envoyée');
    } catch (error: any) {
      toast.error(error?.message || "Erreur lors de l'envoi de la réponse");
    }
  };

  const handleStartConversation = async (event: React.FormEvent) => {
    event.preventDefault();
    const { parentId, childId, subject, content } = newConversationData;
    if (!parentId || !childId || !subject.trim() || !content.trim()) {
      toast.error('Renseignez le parent, l’enfant, le sujet et le message');
      return;
    }

    try {
      const result = await startConversationMutation.mutateAsync({
        parentId,
        childId,
        subject: subject.trim(),
        content: content.trim(),
        sendWhatsapp: newChannels.whatsapp,
        sendEmail: newChannels.email,
      });
      toast.success('Conversation créée');
      setNewConversationData(EMPTY_CONVERSATION);
      setNewChannels({ whatsapp: false, email: false });
      setShowNewConversationForm(false);
      setParentSearch('');
      if (result.data?.conversation?.id) setSelectedConversationId(result.data.conversation.id);
    } catch (error: any) {
      toast.error(error?.message || 'Impossible de créer la conversation');
    }
  };

  return (
    <div className="space-y-6">
      <AdminBulkParentMessages onOpenTemplate={onOpenTemplate} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" />
                Conversations avec les parents
              </CardTitle>
              <CardDescription>
                Fil de discussion par parent et par enfant, avec historique complet.
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setShowNewConversationForm((visible) => !visible);
                setSelectedConversationId(null);
              }}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Nouvelle conversation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Nouvelle conversation */}
          {showNewConversationForm && (
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Nouvelle conversation</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowNewConversationForm(false);
                      setNewConversationData(EMPTY_CONVERSATION);
                      setParentSearch('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStartConversation} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="parent-search">Rechercher un parent</Label>
                      <Input
                        id="parent-search"
                        placeholder="Nom, email…"
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-parent">Parent *</Label>
                      {isLoadingParents ? (
                        <div className="flex h-10 items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Chargement…
                        </div>
                      ) : parents.length === 0 ? (
                        <p className="flex h-10 items-center text-sm text-slate-500">
                          {parentSearch ? 'Aucun parent trouvé' : 'Aucun parent disponible'}
                        </p>
                      ) : (
                        <Select
                          value={newConversationData.parentId}
                          onValueChange={(value) =>
                            setNewConversationData({ ...newConversationData, parentId: value, childId: '' })
                          }
                        >
                          <SelectTrigger id="new-parent">
                            <SelectValue placeholder="Sélectionner un parent" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {parents.map((parent) => (
                              <SelectItem key={parent.id} value={parent.id}>
                                {parent.name} ({parent.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="new-child">Enfant concerné *</Label>
                      {!newConversationData.parentId ? (
                        <p className="flex h-10 items-center text-sm text-slate-500">
                          Sélectionnez d&apos;abord un parent
                        </p>
                      ) : availableChildren.length === 0 ? (
                        <p className="flex h-10 items-center text-sm text-slate-500">
                          Ce parent n&apos;a pas d&apos;enfant associé
                        </p>
                      ) : (
                        <Select
                          value={newConversationData.childId}
                          onValueChange={(value) =>
                            setNewConversationData({ ...newConversationData, childId: value })
                          }
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
                        placeholder="Ex. : demande de rendez-vous"
                        value={newConversationData.subject}
                        onChange={(e) =>
                          setNewConversationData({ ...newConversationData, subject: e.target.value })
                        }
                        disabled={startConversationMutation.isPending}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-content">Message *</Label>
                    <Textarea
                      id="new-content"
                      placeholder="Rédigez votre message…"
                      value={newConversationData.content}
                      onChange={(e) =>
                        setNewConversationData({ ...newConversationData, content: e.target.value })
                      }
                      disabled={startConversationMutation.isPending}
                      rows={6}
                      className={`${LIGHT_TEXTAREA} resize-none`}
                    />
                  </div>

                  <MessageChannelSelector
                    idPrefix="admin-parent-new"
                    channels={newChannels}
                    onChange={setNewChannels}
                    disabled={startConversationMutation.isPending}
                    emailConfigured={emailConfigured}
                    templateLabel={newTemplate?.label}
                    onEditTemplate={onOpenTemplate ? () => onOpenTemplate('admin_parent_new') : undefined}
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowNewConversationForm(false);
                        setNewConversationData(EMPTY_CONVERSATION);
                        setParentSearch('');
                      }}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        startConversationMutation.isPending ||
                        !newConversationData.parentId ||
                        !newConversationData.childId ||
                        !newConversationData.subject.trim() ||
                        !newConversationData.content.trim()
                      }
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                    >
                      {startConversationMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Création…
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

          {/* Filtre */}
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={selectedStatus || 'all'}
              onValueChange={(value) => {
                setSelectedStatus(value === 'all' ? undefined : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Filtrer par statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archivée</SelectItem>
                <SelectItem value="closed">Fermée</SelectItem>
              </SelectContent>
            </Select>
            {pagination && (
              <span className="text-sm text-slate-500">{pagination.total} conversation(s)</span>
            )}
          </div>

          {/* Liste */}
          {isLoadingConversations ? (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              Chargement des conversations…
            </div>
          ) : conversationsError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <p className="font-medium text-red-600">Erreur lors du chargement des conversations</p>
              <p className="text-sm text-slate-500">{(conversationsError as Error).message}</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Mail className="h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-700">Aucune conversation</p>
              <p className="text-sm text-slate-500">
                Démarrez une conversation ou utilisez l&apos;envoi groupé ci-dessus.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => {
                const statusStyle = STATUS_STYLES[conv.status] || STATUS_STYLES.archived;
                const isSelected = selectedConversationId === conv.id;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setSelectedConversationId(conv.id);
                      setShowNewConversationForm(false);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-slate-900">{conv.subject}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {conv.parentName} · élève : {conv.childName}
                        </p>
                      </div>
                      <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                    </div>
                    {conv.lastMessage && (
                      <div className="mt-2 text-sm text-slate-500">
                        <p className="truncate">{preview(conv.lastMessage.content)}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-xs">
                          <Clock className="h-3 w-3" />
                          {formatDate(conv.lastMessage.sentAt)}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setPage(page - 1)} disabled={page === 1}>
                Précédent
              </Button>
              <span className="text-sm text-slate-600">
                Page {pagination.page} sur {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage(page + 1)}
                disabled={page >= pagination.totalPages}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fil de discussion */}
      {selectedConversationId && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-emerald-600" />
                  {conversation?.subject || 'Conversation'}
                </CardTitle>
                <CardDescription>
                  {conversation && `Parent : ${conversation.parentName} · Élève : ${conversation.childName}`}
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
              <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                Chargement du fil…
              </div>
            ) : (
              <>
                <div className="mb-6 max-h-96 space-y-4 overflow-y-auto rounded-lg bg-slate-50 p-4">
                  {messages.length === 0 ? (
                    <p className="py-8 text-center text-slate-500">Aucun message dans cette conversation</p>
                  ) : (
                    messages.map((message) => {
                      const fromAdmin = message.senderId !== conversation?.parentId;
                      return (
                        <div key={message.id} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[80%] rounded-2xl p-4 ${
                              fromAdmin
                                ? 'rounded-br-sm bg-emerald-600 text-white'
                                : 'rounded-bl-sm border border-slate-200 bg-white text-slate-900'
                            }`}
                          >
                            <div className="mb-1.5 flex items-center gap-2">
                              <User className="h-3.5 w-3.5" />
                              <span className="text-xs font-semibold">{message.senderName}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                            <div
                              className={`mt-2 flex items-center gap-1 text-[11px] ${
                                fromAdmin ? 'text-emerald-100' : 'text-slate-500'
                              }`}
                            >
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

                {conversation?.status === 'closed' ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                    Cette conversation est fermée — aucune réponse n&apos;est possible.
                  </p>
                ) : (
                  <div className="space-y-3 border-t pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="reply">Répondre</Label>
                      <Textarea
                        id="reply"
                        placeholder="Tapez votre réponse…"
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        disabled={replyMutation.isPending}
                        rows={4}
                        className={`${LIGHT_TEXTAREA} resize-none`}
                      />
                    </div>

                    <MessageChannelSelector
                      idPrefix="admin-parent-reply"
                      channels={replyChannels}
                      onChange={setReplyChannels}
                      disabled={replyMutation.isPending}
                      emailConfigured={emailConfigured}
                      templateLabel={replyTemplate?.label}
                      onEditTemplate={
                        onOpenTemplate ? () => onOpenTemplate('admin_parent_reply') : undefined
                      }
                    />

                    <div className="flex justify-end">
                      <Button
                        onClick={handleReply}
                        disabled={replyMutation.isPending || !replyContent.trim()}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                      >
                        {replyMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Envoi…
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
