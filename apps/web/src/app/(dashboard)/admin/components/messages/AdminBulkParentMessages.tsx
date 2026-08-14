'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { GraduationCap, Loader2, Send, Users, X } from 'lucide-react';
import { useClasses } from '@/lib/hooks/use-classes';
import { useAdminBulkParentConversations, useAdminStudentsWithParents } from '@/lib/hooks/use-admin-messages';
import {
  MessageChannelSelector,
  formatEmailSummary,
  type MessageChannels,
} from '@/components/messaging/MessageChannelSelector';
import {
  useMessageEmailTemplates,
  type MessageTemplateKind,
} from '@/lib/hooks/use-admin-message-templates';
import { toast } from 'sonner';
import { LIGHT_TEXTAREA } from './message-ui';

interface Props {
  onOpenTemplate?: (kind: MessageTemplateKind) => void;
}

interface StudentParentRow {
  studentProfileId: string;
  studentName: string;
  parentId: string;
  parentName: string;
  parentEmail?: string;
}

export function AdminBulkParentMessages({ onOpenTemplate }: Props) {
  const [mode, setMode] = useState<'classes' | 'students'>('classes');
  const [allClasses, setAllClasses] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [studentClassId, setStudentClassId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<MessageChannels>({ whatsapp: false, email: false });

  const { data: classesData, isLoading: loadingClasses } = useClasses({ includeDetails: true });
  const classes = classesData?.data || [];

  const { data: studentsWithParentsData, isLoading: loadingStudents } = useAdminStudentsWithParents(
    mode === 'students' ? studentClassId : undefined
  );
  const studentsWithParents: StudentParentRow[] = (studentsWithParentsData as any)?.data || [];

  const bulk = useAdminBulkParentConversations();
  const { data: templatesData } = useMessageEmailTemplates();
  const template = templatesData?.templates.find((t) => t.kind === 'admin_parent_bulk');

  const availableClasses = useMemo(
    () => classes.filter((cls: { id: string }) => !selectedClassIds.includes(cls.id)),
    [classes, selectedClassIds]
  );

  const toggleClass = (id: string) =>
    setSelectedClassIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleStudent = (id: string) =>
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const resetForm = () => {
    setSubject('');
    setContent('');
    setSelectedClassIds([]);
    setSelectedStudentIds([]);
    setAllClasses(false);
    setChannels({ whatsapp: false, email: false });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || !content.trim()) {
      toast.error('Le sujet et le message sont requis');
      return;
    }
    if (mode === 'classes' && !allClasses && selectedClassIds.length === 0) {
      toast.error('Sélectionnez au moins une classe ou cochez « Toutes les classes »');
      return;
    }
    if (mode === 'students' && (!studentClassId || selectedStudentIds.length === 0)) {
      toast.error('Choisissez une classe puis au moins un élève');
      return;
    }

    try {
      const payload =
        mode === 'classes'
          ? { allClasses, classIds: allClasses ? [] : selectedClassIds }
          : { studentProfileIds: selectedStudentIds };

      const result = await bulk.mutateAsync({
        ...payload,
        subject: subject.trim(),
        content: content.trim(),
        sendWhatsapp: channels.whatsapp,
        sendEmail: channels.email,
      });

      const emailSummary = formatEmailSummary(result.data?.emailSummary);
      toast.success(
        `${result.data?.created || 0} conversation(s) créée(s)${emailSummary ? ` — ${emailSummary}` : ''}`
      );
      resetForm();
    } catch (error: any) {
      toast.error(error?.message || "Erreur lors de l'envoi groupé");
    }
  };

  return (
    <Card className="border-teal-200 bg-teal-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GraduationCap className="h-5 w-5 text-teal-600" />
          Envoi groupé aux parents
        </CardTitle>
        <CardDescription>
          Par classes (une, plusieurs ou toutes) ou par élèves d&apos;une classe — une conversation
          parent/enfant est créée pour chaque couple ciblé.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {/* Mode */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { value: 'classes', title: 'Par classes', hint: 'Tous les parents des classes ciblées', icon: GraduationCap },
                { value: 'students', title: 'Par élèves', hint: "Sélection nominative dans une classe", icon: Users },
              ] as const
            ).map(({ value, title, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setSelectedClassIds([]);
                  setSelectedStudentIds([]);
                  setAllClasses(false);
                }}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  mode === value
                    ? 'border-teal-500 bg-white'
                    : 'border-slate-200 bg-white/70 hover:border-teal-300'
                }`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${mode === value ? 'text-teal-600' : 'text-slate-400'}`} />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>

          {mode === 'classes' && (
            <div className="space-y-3">
              <div
                className={`flex items-center gap-3 rounded-lg border bg-white p-3 transition-colors ${
                  allClasses ? 'border-teal-400' : 'border-slate-200 hover:border-teal-300'
                }`}
              >
                <Checkbox
                  id="all-classes"
                  checked={allClasses}
                  onCheckedChange={(value) => {
                    const enabled = value === true;
                    setAllClasses(enabled);
                    if (enabled) setSelectedClassIds([]);
                  }}
                  disabled={bulk.isPending}
                />
                <Label htmlFor="all-classes" className="flex-1 cursor-pointer text-sm font-medium text-slate-900">
                  Toutes les classes
                </Label>
              </div>

              {!allClasses && (
                <div className="space-y-2">
                  <Label>Classes</Label>
                  {loadingClasses ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement des classes…
                    </div>
                  ) : (
                    <Select
                      value=""
                      onValueChange={(value) => value && toggleClass(value)}
                      disabled={availableClasses.length === 0 || bulk.isPending}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Ajouter une classe…" />
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
                  {selectedClassIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedClassIds.map((id) => {
                        const cls = classes.find((x: { id: string }) => x.id === id);
                        return (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="cursor-pointer gap-1 bg-teal-100 text-teal-800 hover:bg-teal-200"
                            onClick={() => toggleClass(id)}
                          >
                            {cls?.name || id}
                            <X className="h-3 w-3" />
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'students' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Classe</Label>
                <Select
                  value={studentClassId}
                  onValueChange={(value) => {
                    setStudentClassId(value);
                    setSelectedStudentIds([]);
                  }}
                >
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Élèves concernés</Label>
                    {studentsWithParents.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedStudentIds(studentsWithParents.map((row) => row.studentProfileId))
                        }
                        disabled={bulk.isPending}
                      >
                        Toute la classe
                      </Button>
                    )}
                  </div>
                  {loadingStudents ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement des élèves…
                    </div>
                  ) : studentsWithParents.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
                      Aucun élève relié à un parent dans cette classe
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                      {studentsWithParents.map((row) => (
                        <label
                          key={row.studentProfileId}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                        >
                          <Checkbox
                            checked={selectedStudentIds.includes(row.studentProfileId)}
                            onCheckedChange={() => toggleStudent(row.studentProfileId)}
                          />
                          <span className="text-slate-900">{row.studentName}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-slate-600">{row.parentName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="bulk-subject">Sujet *</Label>
            <Input
              id="bulk-subject"
              placeholder="Ex. : réunion de rentrée"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={bulk.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-content">Message *</Label>
            <Textarea
              id="bulk-content"
              rows={5}
              placeholder="Rédigez votre communication…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={bulk.isPending}
              className={`${LIGHT_TEXTAREA} resize-none`}
            />
          </div>

          <MessageChannelSelector
            idPrefix="admin-bulk-parents"
            channels={channels}
            onChange={setChannels}
            disabled={bulk.isPending}
            emailConfigured={templatesData?.emailConfigured ?? true}
            templateLabel={template?.label}
            onEditTemplate={onOpenTemplate ? () => onOpenTemplate('admin_parent_bulk') : undefined}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetForm} disabled={bulk.isPending}>
              Réinitialiser
            </Button>
            <Button type="submit" disabled={bulk.isPending} className="gap-2 bg-teal-600 hover:bg-teal-700">
              {bulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
