'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Send, Users, X } from 'lucide-react';
import {
  MessageChannelSelector,
  formatEmailSummary,
  type MessageChannels,
} from '@/components/messaging/MessageChannelSelector';
import { useAdminSendToTeachers } from '@/lib/hooks/use-admin-messages';
import {
  useMessageEmailTemplates,
  type MessageTemplateKind,
} from '@/lib/hooks/use-admin-message-templates';
import { toast } from 'sonner';
import { LIGHT_TEXTAREA, PRIORITY_OPTIONS } from './message-ui';

interface AdminTeacherMessagesProps {
  teachers?: Array<{ id: string; name: string }>;
  isLoading?: boolean;
  error?: Error | null;
  onOpenTemplate?: (kind: MessageTemplateKind) => void;
}

const EMPTY_MESSAGE = {
  subject: '',
  content: '',
  priorityLevel: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
};

export function AdminTeacherMessages({
  teachers = [],
  isLoading = false,
  error,
  onOpenTemplate,
}: AdminTeacherMessagesProps) {
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [allTeachers, setAllTeachers] = useState(false);
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const [messageData, setMessageData] = useState(EMPTY_MESSAGE);

  const sendMessageMutation = useAdminSendToTeachers();
  const { data: templatesData } = useMessageEmailTemplates();
  const template = templatesData?.templates.find((t) => t.kind === 'admin_teacher');

  const availableTeachers = useMemo(
    () => teachers.filter((teacher) => !selectedTeacherIds.includes(teacher.id)),
    [teachers, selectedTeacherIds]
  );

  const recipientCount = allTeachers ? teachers.length : selectedTeacherIds.length;

  const resetForm = () => {
    setMessageData(EMPTY_MESSAGE);
    setSelectedTeacherIds([]);
    setAllTeachers(false);
    setChannels({ whatsapp: false, email: false });
  };

  const handleTeacherToggle = (teacherId: string) => {
    setSelectedTeacherIds((prev) =>
      prev.includes(teacherId) ? prev.filter((id) => id !== teacherId) : [...prev, teacherId]
    );
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!allTeachers && selectedTeacherIds.length === 0) {
      toast.error('Sélectionnez au moins un enseignant ou cochez « Tous les enseignants »');
      return;
    }
    if (!messageData.subject.trim() || !messageData.content.trim()) {
      toast.error('Le sujet et le message sont requis');
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        teacherIds: allTeachers ? [] : selectedTeacherIds,
        allTeachers,
        subject: messageData.subject.trim(),
        content: messageData.content.trim(),
        priorityLevel: messageData.priorityLevel,
        sendWhatsapp: channels.whatsapp,
        sendEmail: channels.email,
      });

      const emailSummary = formatEmailSummary(result.data.emailSummary);
      toast.success(
        `Message envoyé à ${result.data.sentTo} enseignant(s)${emailSummary ? ` — ${emailSummary}` : ''}`
      );
      resetForm();
    } catch {
      // L'erreur est remontée par la mutation et affichée sous le formulaire.
    }
  };

  const canSubmit =
    !sendMessageMutation.isPending &&
    (allTeachers || selectedTeacherIds.length > 0) &&
    !!messageData.subject.trim() &&
    !!messageData.content.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-emerald-600" />
          Messages aux enseignants
        </CardTitle>
        <CardDescription>
          Adressez un message à un ou plusieurs enseignants de l&apos;établissement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSendMessage} className="space-y-6">
          {/* Destinataires */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-base font-semibold">Destinataires</Label>
              {recipientCount > 0 && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                  {recipientCount} enseignant(s)
                </Badge>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 p-4">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                <p className="text-sm text-slate-500">Chargement des enseignants…</p>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p className="text-sm">Erreur lors du chargement des enseignants : {error.message}</p>
              </div>
            ) : teachers.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Aucun enseignant disponible</p>
                  <p className="mt-1 text-xs">
                    Seuls les enseignants disposant d&apos;un compte utilisateur peuvent recevoir des
                    messages.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    allTeachers ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Checkbox
                    id="all-teachers"
                    checked={allTeachers}
                    onCheckedChange={(value) => {
                      const enabled = value === true;
                      setAllTeachers(enabled);
                      if (enabled) setSelectedTeacherIds([]);
                    }}
                    disabled={sendMessageMutation.isPending}
                  />
                  <Label htmlFor="all-teachers" className="flex-1 cursor-pointer text-sm font-medium text-slate-900">
                    Tous les enseignants de l&apos;établissement ({teachers.length})
                  </Label>
                </div>

                {!allTeachers && (
                  <>
                    <Select
                      value=""
                      onValueChange={(value) => {
                        if (value && !selectedTeacherIds.includes(value)) {
                          setSelectedTeacherIds([...selectedTeacherIds, value]);
                        }
                      }}
                      disabled={availableTeachers.length === 0 || sendMessageMutation.isPending}
                    >
                      <SelectTrigger id="teachers">
                        <SelectValue
                          placeholder={
                            availableTeachers.length > 0
                              ? 'Ajouter un enseignant…'
                              : 'Tous les enseignants sont sélectionnés'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {availableTeachers.map((teacher) => (
                          <SelectItem key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedTeacherIds.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedTeacherIds.map((teacherId) => {
                          const teacher = teachers.find((t) => t.id === teacherId);
                          if (!teacher) return null;
                          return (
                            <Badge
                              key={teacherId}
                              variant="secondary"
                              className="cursor-pointer gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                              onClick={() => handleTeacherToggle(teacherId)}
                            >
                              <Users className="h-3 w-3" />
                              {teacher.name}
                              <X className="h-3 w-3" />
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          {/* Contenu */}
          <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-2">
              <Label htmlFor="teacher-subject">Sujet *</Label>
              <Input
                id="teacher-subject"
                placeholder="Ex. : réunion pédagogique du 12 mars"
                value={messageData.subject}
                onChange={(e) => setMessageData({ ...messageData, subject: e.target.value })}
                disabled={sendMessageMutation.isPending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="teacher-priority">Priorité</Label>
              <Select
                value={messageData.priorityLevel}
                onValueChange={(value) =>
                  setMessageData({ ...messageData, priorityLevel: value as typeof messageData.priorityLevel })
                }
              >
                <SelectTrigger id="teacher-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <div className="space-y-2">
            <Label htmlFor="teacher-content">Message *</Label>
            <Textarea
              id="teacher-content"
              placeholder="Rédigez votre message…"
              value={messageData.content}
              onChange={(e) => setMessageData({ ...messageData, content: e.target.value })}
              disabled={sendMessageMutation.isPending}
              rows={8}
              required
              className={`${LIGHT_TEXTAREA} resize-none`}
            />
          </div>

          <MessageChannelSelector
            idPrefix="admin-teachers"
            channels={channels}
            onChange={setChannels}
            disabled={sendMessageMutation.isPending}
            emailConfigured={templatesData?.emailConfigured ?? true}
            templateLabel={template?.label}
            onEditTemplate={onOpenTemplate ? () => onOpenTemplate('admin_teacher') : undefined}
          />

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={resetForm} disabled={sendMessageMutation.isPending}>
              Réinitialiser
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {sendMessageMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Envoi…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Envoyer le message
                </>
              )}
            </Button>
          </div>
        </form>

        {sendMessageMutation.isSuccess && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="font-medium">
              Message envoyé à {sendMessageMutation.data?.data.sentTo} enseignant(s)
              {formatEmailSummary(sendMessageMutation.data?.data.emailSummary)
                ? ` — ${formatEmailSummary(sendMessageMutation.data?.data.emailSummary)}`
                : ''}
            </p>
          </div>
        )}

        {sendMessageMutation.isError && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="font-medium">
              {sendMessageMutation.error?.message || "Erreur lors de l'envoi du message"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
