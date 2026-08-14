'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Building2, GraduationCap, Loader2, Send } from 'lucide-react';
import {
  useTeacherMessageToEstablishment,
  useTeacherMessagesToStudents,
} from '@/lib/hooks/use-teacher-messages';
import { useTeacherStudentsByClass } from '@/lib/hooks/use-teachers';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';
import { toast } from 'sonner';

export function TeacherEstablishmentForm() {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });
  const mut = useTeacherMessageToEstablishment();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) return;
    try {
      await mut.mutateAsync({ subject: subject.trim(), content: content.trim(), sendWhatsapp: channels.whatsapp, sendEmail: channels.email });
      toast.success('Message transmis à l’établissement');
      setSubject('');
      setContent('');
      setChannels({ whatsapp: false, email: false });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <Card className="border-indigo-200 bg-indigo-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5 text-indigo-600" />
          Écrire à l’établissement
        </CardTitle>
        <CardDescription>Message adressé à l’administration (boîte interne + option WhatsApp pour les admins).</CardDescription>
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
            idPrefix="teacher-establishment"
            channels={channels}
            onChange={setChannels}
            disabled={mut.isPending}
            templateKind="teacher_establishment"
          />
          <Button type="submit" disabled={mut.isPending} className="gap-2">
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TeacherStudentBroadcastForm() {
  const [mode, setMode] = useState<'class' | 'multi'>('class');
  const [classId, setClassId] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });

  const { data: studentsData, isLoading } = useTeacherStudentsByClass(selectedClassFilter, false);
  const students = studentsData?.students || [];
  const classes = studentsData?.classes || [];
  const mut = useTeacherMessagesToStudents();

  const toggle = (id: string) => {
    setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) {
      toast.error('Sujet et message requis');
      return;
    }
    try {
      if (mode === 'class') {
        if (!classId) {
          toast.error('Choisissez une classe');
          return;
        }
        await mut.mutateAsync({
          classId,
          subject: subject.trim(),
          content: content.trim(),
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        });
      } else {
        if (selectedIds.length === 0) {
          toast.error('Sélectionnez au moins un élève');
          return;
        }
        await mut.mutateAsync({
          studentProfileIds: selectedIds,
          subject: subject.trim(),
          content: content.trim(),
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        });
      }
      toast.success('Messages élèves envoyés');
      setSubject('');
      setContent('');
      setSelectedIds([]);
      setChannels({ whatsapp: false, email: false });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const list =
    selectedClassFilter === 'all' ? students : students.filter((s: { classId?: string }) => s.classId === selectedClassFilter);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-purple-600" />
          Messages aux élèves
        </CardTitle>
        <CardDescription>Classe entière ou plusieurs élèves (vos affectations uniquement).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'class' | 'multi')} className="flex gap-6">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="class" id="ts1" />
              <Label htmlFor="ts1" className="cursor-pointer font-normal">
                Toute une classe
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="multi" id="ts2" />
              <Label htmlFor="ts2" className="cursor-pointer font-normal">
                Plusieurs élèves
              </Label>
            </div>
          </RadioGroup>

          {mode === 'class' ? (
            <div>
              <Label>Classe</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger>
                  <SelectValue placeholder="Classe" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c: { id: string; name: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div>
                <Label>Filtrer par classe</Label>
                <Select value={selectedClassFilter} onValueChange={(v) => { setSelectedClassFilter(v); setSelectedIds([]); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    {classes.map((c: { id: string; name: string }) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between items-center">
                <Label>Élèves</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedIds(list.map((s: { id: string }) => s.id))}>
                  Tout sélectionner (filtre)
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  list.map((s: { id: string; firstName: string; lastName: string }) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={selectedIds.includes(s.id)} onCheckedChange={() => toggle(s.id)} />
                      {s.firstName} {s.lastName}
                    </label>
                  ))
                )}
              </div>
            </>
          )}

          <div>
            <Label>Sujet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={mut.isPending} />
          </div>
          <div>
            <Label>Message</Label>
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} disabled={mut.isPending} />
          </div>
          <MessageChannelsField
            idPrefix="teacher-students"
            channels={channels}
            onChange={setChannels}
            disabled={mut.isPending}
            templateKind="teacher_student"
          />
          <Button type="submit" disabled={mut.isPending} className="gap-2">
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer aux élèves
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
