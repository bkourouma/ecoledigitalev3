'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { GraduationCap, Loader2, Send, X } from 'lucide-react';
import { useClasses } from '@/lib/hooks/use-classes';
import { useAdminBulkParentConversations, useAdminStudentsWithParents } from '@/lib/hooks/use-admin-messages';
import { WhatsappSendCheckbox } from '@/components/messaging/WhatsappSendCheckbox';
import { toast } from 'sonner';

export function AdminBulkParentMessages() {
  const [mode, setMode] = useState<'classes' | 'students'>('classes');
  const [allClasses, setAllClasses] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [studentClassId, setStudentClassId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sendWhatsapp, setSendWhatsapp] = useState(false);

  const { data: classesData, isLoading: loadingClasses } = useClasses({ includeDetails: true });
  const classes = classesData?.data || [];

  const { data: swp, isLoading: loadingStudents } = useAdminStudentsWithParents(
    mode === 'students' ? studentClassId : undefined
  );
  const studentsWithParents = (swp as any)?.data || [];

  const bulk = useAdminBulkParentConversations();

  const toggleClass = (id: string) => {
    setSelectedClassIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) {
      toast.error('Sujet et message requis');
      return;
    }
    try {
      if (mode === 'classes') {
        if (!allClasses && selectedClassIds.length === 0) {
          toast.error('Sélectionnez au moins une classe ou « Toutes les classes »');
          return;
        }
        const res = await bulk.mutateAsync({
          allClasses,
          classIds: allClasses ? [] : selectedClassIds,
          subject: subject.trim(),
          content: content.trim(),
          sendWhatsapp,
        });
        toast.success(`${res.data?.created || 0} conversation(s) créée(s)`);
      } else {
        if (!studentClassId || selectedStudentIds.length === 0) {
          toast.error('Choisissez une classe et au moins un élève');
          return;
        }
        const res = await bulk.mutateAsync({
          studentProfileIds: selectedStudentIds,
          subject: subject.trim(),
          content: content.trim(),
          sendWhatsapp,
        });
        toast.success(`${res.data?.created || 0} conversation(s) créée(s)`);
      }
      setSubject('');
      setContent('');
      setSelectedClassIds([]);
      setSelectedStudentIds([]);
      setSendWhatsapp(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const availableClasses = useMemo(
    () => classes.filter((c: { id: string }) => !selectedClassIds.includes(c.id)),
    [classes, selectedClassIds]
  );

  return (
    <Card className="border-teal-200 bg-teal-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GraduationCap className="h-5 w-5 text-teal-600" />
          Envoi groupé aux parents
        </CardTitle>
        <CardDescription>
          Par classes (une ou plusieurs, ou toutes) ou par élèves d&apos;une classe — une conversation parent/enfant
          est créée pour chaque couple cible.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'classes' | 'students')} className="flex gap-6">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="classes" id="m-classes" />
              <Label htmlFor="m-classes" className="font-normal cursor-pointer">
                Par classes
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="students" id="m-students" />
              <Label htmlFor="m-students" className="font-normal cursor-pointer">
                Par élèves (une classe)
              </Label>
            </div>
          </RadioGroup>

          {mode === 'classes' && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox id="all-cl" checked={allClasses} onCheckedChange={(v) => setAllClasses(v === true)} />
                <Label htmlFor="all-cl" className="cursor-pointer">
                  Toutes les classes
                </Label>
              </div>
              {!allClasses && (
                <>
                  <Label>Classes</Label>
                  {loadingClasses ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Select
                      value=""
                      onValueChange={(v) => v && toggleClass(v)}
                      disabled={availableClasses.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Ajouter une classe" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {availableClasses.map((cls: { id: string; name: string; code?: string }) => (
                          <SelectItem key={cls.id} value={cls.id}>
                            {cls.name} {cls.code ? `(${cls.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {selectedClassIds.map((id) => {
                      const c = classes.find((x: { id: string }) => x.id === id);
                      return (
                        <Badge
                          key={id}
                          variant="secondary"
                          className="cursor-pointer gap-1"
                          onClick={() => toggleClass(id)}
                        >
                          {c?.name || id}
                          <X className="h-3 w-3" />
                        </Badge>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {mode === 'students' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Classe</Label>
                <Select value={studentClassId} onValueChange={(v) => { setStudentClassId(v); setSelectedStudentIds([]); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir une classe" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {classes.map((cls: { id: string; name: string }) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {studentClassId && (
                <div className="space-y-2">
                  <Label>Élèves (plusieurs possibles)</Label>
                  {loadingStudents ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2">
                      {studentsWithParents.map((row: any) => (
                        <label key={row.studentProfileId} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={selectedStudentIds.includes(row.studentProfileId)}
                            onCheckedChange={() => toggleStudent(row.studentProfileId)}
                          />
                          <span>
                            {row.studentName} → {row.parentName}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Sujet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={bulk.isPending} />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} disabled={bulk.isPending} />
          </div>
          <WhatsappSendCheckbox checked={sendWhatsapp} onCheckedChange={setSendWhatsapp} disabled={bulk.isPending} />
          <div className="flex justify-end">
            <Button type="submit" disabled={bulk.isPending} className="gap-2">
              {bulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
