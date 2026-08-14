'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Send, Loader2, X } from 'lucide-react';
import {
  useCreateTeacherMessage,
  useTeacherBulkToParents,
} from '@/lib/hooks/use-teacher-messages';
import { useTeacherStudentsByClass } from '@/lib/hooks/use-teachers';
import { MessageChannelsField, type MessageChannels } from '@/components/messaging/MessageChannelSelector';
import { toast } from 'sonner';

interface CreateMessageFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateMessageForm({ onSuccess, onCancel }: CreateMessageFormProps) {
  const [mode, setMode] = useState<'single' | 'multi' | 'class'>('single');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [priorityLevel, setPriorityLevel] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [selectedClass, setSelectedClass] = useState('all');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });

  const { data: studentsData, isLoading: isLoadingStudents } = useTeacherStudentsByClass(selectedClass, false);
  const students = studentsData?.students || [];
  const classes = studentsData?.classes || [];

  const createMessage = useCreateTeacherMessage();
  const bulkParents = useTeacherBulkToParents();

  const filteredStudents = useMemo(() => {
    if (selectedClass === 'all') return students;
    return students.filter((s: { classId?: string }) => s.classId === selectedClass || !s.classId);
  }, [students, selectedClass]);

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) {
      toast.error('Sujet et message requis');
      return;
    }
    try {
      if (mode === 'single') {
        if (!selectedStudentId) {
          toast.error('Sélectionnez un élève');
          return;
        }
        await createMessage.mutateAsync({
          studentId: selectedStudentId,
          subject: subject.trim(),
          content: content.trim(),
          priorityLevel: priorityLevel === 'normal' ? undefined : priorityLevel,
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        });
      } else if (mode === 'class') {
        if (selectedClass === 'all') {
          toast.error('Choisissez une classe précise pour « toute la classe »');
          return;
        }
        await bulkParents.mutateAsync({
          classId: selectedClass,
          subject: subject.trim(),
          content: content.trim(),
          priorityLevel: priorityLevel === 'normal' ? undefined : priorityLevel,
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        });
      } else {
        if (selectedStudentIds.length === 0) {
          toast.error('Sélectionnez au moins un élève');
          return;
        }
        await bulkParents.mutateAsync({
          studentIds: selectedStudentIds,
          subject: subject.trim(),
          content: content.trim(),
          priorityLevel: priorityLevel === 'normal' ? undefined : priorityLevel,
          sendWhatsapp: channels.whatsapp,
          sendEmail: channels.email,
        });
      }
      toast.success('Message(s) envoyé(s)');
      setSelectedStudentId('');
      setSelectedStudentIds([]);
      setSubject('');
      setContent('');
      setPriorityLevel('normal');
      setChannels({ whatsapp: false, email: false });
      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const pending = createMessage.isPending || bulkParents.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Messages aux parents</CardTitle>
            <CardDescription>Un élève, plusieurs élèves, ou toute une classe (vos classes uniquement)</CardDescription>
          </div>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="grid gap-2 sm:grid-cols-3">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="single" id="m1" />
              <Label htmlFor="m1" className="font-normal cursor-pointer text-sm">
                Un élève
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="multi" id="m2" />
              <Label htmlFor="m2" className="font-normal cursor-pointer text-sm">
                Plusieurs élèves
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="class" id="m3" />
              <Label htmlFor="m3" className="font-normal cursor-pointer text-sm">
                Toute une classe
              </Label>
            </div>
          </RadioGroup>

          <div className="space-y-2">
            <Label>Classe (filtre)</Label>
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger>
                <SelectValue placeholder="Classe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes mes classes</SelectItem>
                {classes.map((cls: { id: string; name: string }) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'single' && (
            <div className="space-y-2">
              <Label>Étudiant *</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId} disabled={isLoadingStudents}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un étudiant" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {filteredStudents.map((student: { id: string; firstName: string; lastName: string; matricule?: string }) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.firstName} {student.lastName} ({student.matricule || '—'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'multi' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Élèves *</Label>
                {filteredStudents.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedStudentIds(filteredStudents.map((s: { id: string }) => s.id))}
                  >
                    Tous (filtre)
                  </Button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto border rounded-md p-2 space-y-2">
                {filteredStudents.map((student: { id: string; firstName: string; lastName: string }) => (
                  <label key={student.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selectedStudentIds.includes(student.id)} onCheckedChange={() => toggleStudent(student.id)} />
                    <span>
                      {student.firstName} {student.lastName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {mode === 'class' && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              Choisissez une classe précise dans le filtre ci-dessus (pas « Toutes mes classes »), puis validez pour
              envoyer à tous les parents des élèves de cette classe.
            </p>
          )}

          <div className="space-y-2">
            <Label>Sujet *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={pending} required />
          </div>

          <div className="space-y-2">
            <Label>Priorité</Label>
            <Select value={priorityLevel} onValueChange={(v) => setPriorityLevel(v as typeof priorityLevel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Basse</SelectItem>
                <SelectItem value="normal">Normale</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Message *</Label>
            <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} disabled={pending} required />
          </div>

          <MessageChannelsField
            idPrefix="teacher-parents"
            channels={channels}
            onChange={setChannels}
            disabled={pending}
            templateKind={mode === 'single' ? 'teacher_parent' : 'teacher_parent_bulk'}
          />

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Annuler
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Envoyer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
