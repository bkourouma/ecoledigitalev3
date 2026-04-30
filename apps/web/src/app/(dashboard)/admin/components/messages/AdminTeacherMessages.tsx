'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Send, Loader2, AlertCircle, CheckCircle2, Users, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { WhatsappSendCheckbox } from '@/components/messaging/WhatsappSendCheckbox';
import { useAdminSendToTeachers } from '@/lib/hooks/use-admin-messages';
import { toast } from 'sonner';

interface AdminTeacherMessagesProps {
  teachers?: Array<{ id: string; name: string }>;
  isLoading?: boolean;
  error?: Error | null;
}

export function AdminTeacherMessages({ teachers = [], isLoading = false, error }: AdminTeacherMessagesProps) {
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [allTeachers, setAllTeachers] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [messageData, setMessageData] = useState({
    subject: '',
    content: '',
    priorityLevel: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  });

  // Send message mutation
  const sendMessageMutation = useAdminSendToTeachers();

  // Debug: Log teachers when they change
  React.useEffect(() => {
    console.log('AdminTeacherMessages - Teachers received:', {
      count: teachers.length,
      teachers: teachers.slice(0, 5).map(t => ({ id: t.id, name: t.name })),
      isLoading,
      error: error?.message
    });
  }, [teachers, isLoading, error]);

  // Handle teacher selection (multi-select)
  const handleTeacherToggle = (teacherId: string) => {
    setSelectedTeacherIds((prev) => {
      if (prev.includes(teacherId)) {
        return prev.filter((id) => id !== teacherId);
      } else {
        return [...prev, teacherId];
      }
    });
  };

  // Handle send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!allTeachers && selectedTeacherIds.length === 0) {
      toast.error('Veuillez sélectionner au moins un enseignant ou cocher « Tous les enseignants »');
      return;
    }

    if (!messageData.subject.trim() || !messageData.content.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        teacherIds: allTeachers ? [] : selectedTeacherIds,
        allTeachers,
        subject: messageData.subject.trim(),
        content: messageData.content.trim(),
        priorityLevel: messageData.priorityLevel,
        sendWhatsapp,
      });
      
      toast.success(`Message envoyé à ${result.data.sentTo} enseignant(s) avec succès`);
      setMessageData({ subject: '', content: '', priorityLevel: 'normal' });
      setSelectedTeacherIds([]);
      setAllTeachers(false);
      setSendWhatsapp(false);
    } catch (error) {
      // Error is handled by the hook and toast
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-emerald-600" />
          Messages aux Enseignants
        </CardTitle>
        <CardDescription>
          Envoyez un message à un ou plusieurs enseignants de l'établissement
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSendMessage} className="space-y-6">
          {/* Teacher Selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="all-teachers"
                checked={allTeachers}
                onCheckedChange={(v) => {
                  const on = v === true;
                  setAllTeachers(on);
                  if (on) setSelectedTeacherIds([]);
                }}
                disabled={sendMessageMutation.isPending || teachers.length === 0}
              />
              <Label htmlFor="all-teachers" className="cursor-pointer font-medium">
                Tous les enseignants du système ({teachers.length})
              </Label>
            </div>
            <Label htmlFor="teachers">Enseignants destinataires *</Label>
            {isLoading ? (
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                  <p className="text-sm text-gray-500">Chargement des enseignants...</p>
                </div>
              </div>
            ) : error ? (
              <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <p className="text-sm">Erreur lors du chargement des enseignants: {error.message}</p>
                </div>
              </div>
            ) : teachers.length === 0 ? (
              <div className="p-4 border border-gray-200 rounded-lg bg-yellow-50">
                <div className="flex items-center gap-2 text-yellow-800">
                  <AlertCircle className="h-4 w-4" />
                  <div>
                    <p className="text-sm font-medium">Aucun enseignant disponible</p>
                    <p className="text-xs text-yellow-700 mt-1">
                      Aucun enseignant avec un compte utilisateur n'a été trouvé. 
                      Les enseignants doivent avoir un compte utilisateur associé pour recevoir des messages.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-2">
                  <p className="text-xs text-gray-500">
                    {teachers.length} enseignant(s) disponible(s)
                  </p>
                </div>
                {(() => {
                  const availableTeachers = teachers.filter((teacher) => !selectedTeacherIds.includes(teacher.id));
                  const hasAvailableTeachers = availableTeachers.length > 0;
                  
                  return (
                    <>
                      <Select
                        value=""
                        onValueChange={(value) => {
                          if (value && !selectedTeacherIds.includes(value)) {
                            setSelectedTeacherIds([...selectedTeacherIds, value]);
                          }
                        }}
                        disabled={!hasAvailableTeachers || allTeachers}
                      >
                        <SelectTrigger id="teachers">
                          <SelectValue placeholder={
                            hasAvailableTeachers 
                              ? "Sélectionner un enseignant" 
                              : "Tous les enseignants sont sélectionnés"
                          } />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {availableTeachers.length > 0 ? (
                            availableTeachers.map((teacher) => (
                              <SelectItem key={teacher.id} value={teacher.id}>
                                {teacher.name}
                              </SelectItem>
                            ))
                          ) : (
                            <div className="px-2 py-1.5 text-sm text-gray-500">
                              Aucun enseignant disponible
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {!hasAvailableTeachers && teachers.length > 0 && (
                        <p className="text-sm text-gray-500 mt-2">
                          Tous les enseignants sont sélectionnés
                        </p>
                      )}
                    </>
                  );
                })()}
                
                {/* Selected Teachers Badges */}
                {selectedTeacherIds.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedTeacherIds.map((teacherId) => {
                      const teacher = teachers.find((t) => t.id === teacherId);
                      if (!teacher) return null;
                      return (
                        <Badge
                          key={teacherId}
                          variant="secondary"
                          className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer flex items-center gap-1"
                          onClick={() => handleTeacherToggle(teacherId)}
                        >
                          {teacher.name}
                          <X className="h-3 w-3" />
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {selectedTeacherIds.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedTeacherIds.length} enseignant(s) sélectionné(s)
                  </p>
                )}
              </>
            )}
          </div>

          {/* Priority Level */}
          <div className="space-y-2">
            <Label htmlFor="priority">Niveau de priorité</Label>
            <Select
              value={messageData.priorityLevel}
              onValueChange={(value) => setMessageData({ ...messageData, priorityLevel: value as any })}
            >
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Faible</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">Élevé</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Sujet *</Label>
            <Input
              id="subject"
              placeholder="Ex: Information importante, réunion..."
              value={messageData.subject}
              onChange={(e) => setMessageData({ ...messageData, subject: e.target.value })}
              disabled={sendMessageMutation.isPending}
              required
            />
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">Message *</Label>
            <Textarea
              id="content"
              placeholder="Rédigez votre message..."
              value={messageData.content}
              onChange={(e) => setMessageData({ ...messageData, content: e.target.value })}
              disabled={sendMessageMutation.isPending}
              rows={8}
              required
              className="resize-none"
            />
          </div>

          <WhatsappSendCheckbox
            checked={sendWhatsapp}
            onCheckedChange={setSendWhatsapp}
            disabled={sendMessageMutation.isPending}
            id="wa-admin-teachers"
          />

          {/* Submit Button */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMessageData({ subject: '', content: '', priorityLevel: 'normal' });
                setSelectedTeacherIds([]);
                setAllTeachers(false);
                setSendWhatsapp(false);
              }}
              disabled={sendMessageMutation.isPending}
            >
              Réinitialiser
            </Button>
            <Button
              type="submit"
              disabled={
                sendMessageMutation.isPending ||
                (!allTeachers && selectedTeacherIds.length === 0) ||
                !messageData.subject.trim() ||
                !messageData.content.trim()
              }
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {sendMessageMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Envoi...
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

        {/* Success Message */}
        {sendMessageMutation.isSuccess && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-medium">
                Message envoyé avec succès à {sendMessageMutation.data?.data.sentTo} enseignant(s)
              </p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {sendMessageMutation.isError && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="h-5 w-5" />
              <p className="font-medium">
                {sendMessageMutation.error?.message || 'Erreur lors de l\'envoi du message'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
