'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Loader2, Send, User } from 'lucide-react';
import {
  useStudentMyTeachers,
  useStudentMessageToSchool,
  useStudentMessageToTeacher,
} from '@/lib/hooks/use-student-messages';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';
import { toast } from 'sonner';

export function StudentWriteToSchoolPanel() {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const mut = useStudentMessageToSchool();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) return;
    try {
      await mut.mutateAsync({ subject: subject.trim(), content: content.trim(), sendWhatsapp: channels.whatsapp, sendEmail: channels.email });
      toast.success('Message envoyé à l’établissement');
      setSubject('');
      setContent('');
      setChannels({ whatsapp: false, email: false });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };
  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Écrire à l’établissement
        </CardTitle>
        <CardDescription>Votre message est enregistré et transmis à l’administration.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Sujet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={mut.isPending} />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} disabled={mut.isPending} />
          </div>
          <MessageChannelsField
            idPrefix="student-school"
            channels={channels}
            onChange={setChannels}
            disabled={mut.isPending}
            templateKind="student_school"
          />
          <Button type="submit" disabled={mut.isPending} size="sm" className="gap-2">
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function StudentWriteToTeacherPanel() {
  const { data, isLoading } = useStudentMyTeachers();
  const teachers = (data as any)?.data || [];
  const [classCourseId, setClassCourseId] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const mut = useStudentMessageToTeacher();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const row = teachers.find((t: any) => t.classCourseId === classCourseId);
    if (!row?.teacherUserId || !subject.trim() || !content.trim()) {
      toast.error('Complétez tous les champs');
      return;
    }
    try {
      await mut.mutateAsync({
        teacherUserId: row.teacherUserId,
        classCourseId: row.classCourseId,
        subject: subject.trim(),
        content: content.trim(),
        sendWhatsapp: channels.whatsapp,
        sendEmail: channels.email,
      });
      toast.success('Message envoyé à l’enseignant');
      setSubject('');
      setContent('');
      setChannels({ whatsapp: false, email: false });
      setClassCourseId('');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };
  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" />
          Écrire à un enseignant
        </CardTitle>
        <CardDescription>Enseignants de vos classes (par matière).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Enseignant</Label>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Select value={classCourseId} onValueChange={setClassCourseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {teachers.map((t: any) => (
                    <SelectItem key={t.classCourseId} value={t.classCourseId}>
                      {t.teacherName} — {t.courseName} ({t.className})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Sujet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={mut.isPending} />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} disabled={mut.isPending} />
          </div>
          <MessageChannelsField
            idPrefix="student-teacher"
            channels={channels}
            onChange={setChannels}
            disabled={mut.isPending}
            templateKind="student_teacher_new"
          />
          <Button type="submit" disabled={mut.isPending} size="sm" className="gap-2">
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
