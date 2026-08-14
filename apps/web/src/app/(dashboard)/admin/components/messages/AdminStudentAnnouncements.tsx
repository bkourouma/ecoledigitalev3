'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Megaphone,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useAdminSendToStudents } from '@/lib/hooks/use-admin-messages';
import { useClasses } from '@/lib/hooks/use-classes';
import { useQuery } from '@tanstack/react-query';
import { createApiHeaders } from '@/lib/api-utils';
import { toast } from 'sonner';
import {
  MessageChannelSelector,
  formatEmailSummary,
  type MessageChannels,
} from '@/components/messaging/MessageChannelSelector';
import {
  useMessageEmailTemplates,
  type MessageTemplateKind,
} from '@/lib/hooks/use-admin-message-templates';
import { LIGHT_TEXTAREA, PRIORITY_OPTIONS } from './message-ui';

interface Props {
  onOpenTemplate?: (kind: MessageTemplateKind) => void;
}

type SendMode = 'by-class' | 'by-student';

interface StudentRow {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

const EMPTY_MESSAGE = {
  subject: '',
  content: '',
  priorityLevel: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
};

export function AdminStudentAnnouncements({ onOpenTemplate }: Props) {
  const [selectedMode, setSelectedMode] = useState<SendMode>('by-class');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [messageData, setMessageData] = useState(EMPTY_MESSAGE);
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });

  const sendMessageMutation = useAdminSendToStudents();
  const { data: templatesData } = useMessageEmailTemplates();
  const template = templatesData?.templates.find((t) => t.kind === 'admin_student');

  const { data: classesData, isLoading: isLoadingClasses } = useClasses({ includeDetails: true });
  const classes = classesData?.data || [];

  const { data: studentsData, isLoading: isLoadingStudents } = useQuery({
    queryKey: ['students-by-class', selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return { success: true, data: [] as StudentRow[] };
      const response = await fetch(
        `/api/v1/admin/messages/students-by-class?classId=${encodeURIComponent(selectedClassId)}`,
        { headers: createApiHeaders() }
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Impossible de charger les étudiants');
      }
      return response.json();
    },
    enabled: !!selectedClassId && selectedMode === 'by-student',
  });
  const students: StudentRow[] = studentsData?.data || [];

  const availableStudents = useMemo(
    () => students.filter((student) => !selectedStudentIds.includes(student.id)),
    [students, selectedStudentIds]
  );

  const resetForm = () => {
    setMessageData(EMPTY_MESSAGE);
    setSelectedClassIds([]);
    setSelectedClassId('');
    setSelectedStudentIds([]);
    setChannels({ whatsapp: false, email: false });
  };

  const handleClassToggle = (classId: string) => {
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const handleStudentToggle = (studentId: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();

    if (selectedMode === 'by-class' && selectedClassIds.length === 0) {
      toast.error('Sélectionnez au moins une classe');
      return;
    }
    if (selectedMode === 'by-student' && (!selectedClassId || selectedStudentIds.length === 0)) {
      toast.error('Choisissez une classe puis au moins un étudiant');
      return;
    }
    if (!messageData.subject.trim() || !messageData.content.trim()) {
      toast.error('Le sujet et le message sont requis');
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        classIds: selectedMode === 'by-class' ? selectedClassIds : [],
        studentIds: selectedMode === 'by-student' ? selectedStudentIds : [],
        subject: messageData.subject.trim(),
        content: messageData.content.trim(),
        priorityLevel: messageData.priorityLevel,
        sendWhatsapp: channels.whatsapp,
        sendEmail: channels.email,
      });

      const emailSummary = formatEmailSummary(result.data.emailSummary);
      toast.success(
        `Annonce envoyée à ${result.data.sentTo} étudiant(s)${emailSummary ? ` — ${emailSummary}` : ''}`
      );
      resetForm();
    } catch {
      // L'erreur est affichée sous le formulaire.
    }
  };

  const canSubmit =
    !sendMessageMutation.isPending &&
    (selectedMode === 'by-class'
      ? selectedClassIds.length > 0
      : !!selectedClassId && selectedStudentIds.length > 0) &&
    !!messageData.subject.trim() &&
    !!messageData.content.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-emerald-600" />
          Annonces aux étudiants
        </CardTitle>
        <CardDescription>
          Diffusez une annonce à des classes entières ou à une sélection d&apos;étudiants.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSendMessage} className="space-y-6">
          {/* Mode de ciblage */}
          <section className="space-y-3">
            <Label className="text-base font-semibold">Ciblage</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { value: 'by-class', title: 'Par classe', hint: 'Tous les étudiants des classes choisies', icon: GraduationCap },
                  { value: 'by-student', title: 'Par étudiant', hint: 'Sélection nominative dans une classe', icon: Users },
                ] as const
              ).map(({ value, title, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSelectedMode(value);
                    setSelectedClassIds([]);
                    setSelectedClassId('');
                    setSelectedStudentIds([]);
                  }}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selectedMode === value
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      selectedMode === value ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Sélection par classe */}
          {selectedMode === 'by-class' && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="classes">Classes *</Label>
                {selectedClassIds.length > 0 && (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                    {selectedClassIds.length} classe(s)
                  </Badge>
                )}
              </div>
              {isLoadingClasses ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 p-4">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                  <p className="text-sm text-slate-500">Chargement des classes…</p>
                </div>
              ) : classes.length === 0 ? (
                <p className="rounded-lg border border-slate-200 p-4 text-center text-sm text-slate-500">
                  Aucune classe disponible
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedClassIds(classes.map((cls) => cls.id))}
                      disabled={sendMessageMutation.isPending || selectedClassIds.length === classes.length}
                    >
                      Toutes les classes
                    </Button>
                    {selectedClassIds.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedClassIds([])}
                        disabled={sendMessageMutation.isPending}
                      >
                        Tout désélectionner
                      </Button>
                    )}
                  </div>
                  <Select
                    value=""
                    onValueChange={(value) => {
                      if (value && !selectedClassIds.includes(value)) {
                        setSelectedClassIds([...selectedClassIds, value]);
                      }
                    }}
                    disabled={classes.filter((cls) => !selectedClassIds.includes(cls.id)).length === 0}
                  >
                    <SelectTrigger id="classes">
                      <SelectValue placeholder="Ajouter une classe…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {classes
                        .filter((cls) => !selectedClassIds.includes(cls.id))
                        .map((cls) => (
                          <SelectItem key={cls.id} value={cls.id}>
                            {cls.name} {cls.code ? `(${cls.code})` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {selectedClassIds.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedClassIds.map((classId) => {
                        const classItem = classes.find((cls) => cls.id === classId);
                        if (!classItem) return null;
                        return (
                          <Badge
                            key={classId}
                            variant="secondary"
                            className="cursor-pointer gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                            onClick={() => handleClassToggle(classId)}
                          >
                            <GraduationCap className="h-3 w-3" />
                            {classItem.name}
                            <X className="h-3 w-3" />
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Sélection par étudiant */}
          {selectedMode === 'by-student' && (
            <section className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="class">Classe *</Label>
                <Select
                  value={selectedClassId}
                  onValueChange={(value) => {
                    setSelectedClassId(value);
                    setSelectedStudentIds([]);
                  }}
                >
                  <SelectTrigger id="class">
                    <SelectValue placeholder="Sélectionner une classe" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {classes.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name} {cls.code ? `(${cls.code})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedClassId && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="students">Étudiants *</Label>
                    <div className="flex items-center gap-2">
                      {selectedStudentIds.length > 0 && (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                          {selectedStudentIds.length} sélectionné(s)
                        </Badge>
                      )}
                      {students.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedStudentIds(students.map((student) => student.id))}
                          disabled={sendMessageMutation.isPending}
                        >
                          Toute la classe
                        </Button>
                      )}
                    </div>
                  </div>

                  {isLoadingStudents ? (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 p-4">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      <p className="text-sm text-slate-500">Chargement des étudiants…</p>
                    </div>
                  ) : students.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 p-4 text-center text-sm text-slate-500">
                      Aucun étudiant dans cette classe
                    </p>
                  ) : (
                    <>
                      <Select
                        value=""
                        onValueChange={(value) => {
                          if (value && !selectedStudentIds.includes(value)) {
                            setSelectedStudentIds([...selectedStudentIds, value]);
                          }
                        }}
                        disabled={availableStudents.length === 0}
                      >
                        <SelectTrigger id="students">
                          <SelectValue placeholder="Ajouter un étudiant…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {availableStudents.map((student) => (
                            <SelectItem key={student.id} value={student.id}>
                              {student.firstName} {student.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedStudentIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {selectedStudentIds.map((studentId) => {
                            const student = students.find((s) => s.id === studentId);
                            if (!student) return null;
                            return (
                              <Badge
                                key={studentId}
                                variant="secondary"
                                className="cursor-pointer gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                onClick={() => handleStudentToggle(studentId)}
                              >
                                <Users className="h-3 w-3" />
                                {student.firstName} {student.lastName}
                                <X className="h-3 w-3" />
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Contenu */}
          <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-2">
              <Label htmlFor="student-subject">Sujet *</Label>
              <Input
                id="student-subject"
                placeholder="Ex. : ouverture des inscriptions aux examens"
                value={messageData.subject}
                onChange={(e) => setMessageData({ ...messageData, subject: e.target.value })}
                disabled={sendMessageMutation.isPending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-priority">Priorité</Label>
              <Select
                value={messageData.priorityLevel}
                onValueChange={(value) =>
                  setMessageData({ ...messageData, priorityLevel: value as typeof messageData.priorityLevel })
                }
              >
                <SelectTrigger id="student-priority">
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
            <Label htmlFor="student-content">Annonce *</Label>
            <Textarea
              id="student-content"
              placeholder="Rédigez votre annonce…"
              value={messageData.content}
              onChange={(e) => setMessageData({ ...messageData, content: e.target.value })}
              disabled={sendMessageMutation.isPending}
              rows={8}
              required
              className={`${LIGHT_TEXTAREA} resize-none`}
            />
          </div>

          <MessageChannelSelector
            idPrefix="admin-students"
            channels={channels}
            onChange={setChannels}
            disabled={sendMessageMutation.isPending}
            emailConfigured={templatesData?.emailConfigured ?? true}
            templateLabel={template?.label}
            onEditTemplate={onOpenTemplate ? () => onOpenTemplate('admin_student') : undefined}
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
                  Envoyer l&apos;annonce
                </>
              )}
            </Button>
          </div>
        </form>

        {sendMessageMutation.isSuccess && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p className="font-medium">
              Annonce envoyée à {sendMessageMutation.data?.data.sentTo} étudiant(s)
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
              {sendMessageMutation.error?.message || "Erreur lors de l'envoi de l'annonce"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
