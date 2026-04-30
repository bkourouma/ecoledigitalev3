'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Megaphone, Send, Loader2, AlertCircle, CheckCircle2, Users, X, GraduationCap } from 'lucide-react';
import { useAdminSendToStudents } from '@/lib/hooks/use-admin-messages';
import { useClasses } from '@/lib/hooks/use-classes';
import { useQuery } from '@tanstack/react-query';
import { createApiHeaders } from '@/lib/api-utils';
import { toast } from 'sonner';
import { WhatsappSendCheckbox } from '@/components/messaging/WhatsappSendCheckbox';

export function AdminStudentAnnouncements() {
  const [selectedMode, setSelectedMode] = useState<'by-class' | 'by-student'>('by-class');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [messageData, setMessageData] = useState({
    subject: '',
    content: '',
    priorityLevel: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  });
  const [sendWhatsapp, setSendWhatsapp] = useState(false);

  // Send message mutation
  const sendMessageMutation = useAdminSendToStudents();

  // Fetch all classes
  const { data: classesData, isLoading: isLoadingClasses } = useClasses({ includeDetails: true });
  const classes = classesData?.data || [];

  // Fetch students for selected class (when in by-student mode)
  // We'll use a custom query to fetch students by class
  const { data: studentsData, isLoading: isLoadingStudents } = useQuery({
    queryKey: ['students-by-class', selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return { success: true, data: [] };
      
      const headers = createApiHeaders();
      const response = await fetch(`/api/v1/admin/messages/students-by-class?classId=${selectedClassId}`, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch students' }));
        throw new Error(error.message || 'Failed to fetch students');
      }
      
      return response.json();
    },
    enabled: !!selectedClassId && selectedMode === 'by-student',
  });
  const students = studentsData?.data || [];

  // Get students from selected classes (when in by-class mode)
  const studentsFromSelectedClasses = useMemo(() => {
    if (selectedMode !== 'by-class' || selectedClassIds.length === 0) {
      return [];
    }

    // Fetch students for each selected class
    // Note: This is a simplified approach. In a real scenario, you might want to fetch all students
    // and filter by classId, or use a dedicated API endpoint
    return [];
  }, [selectedMode, selectedClassIds]);

  // Handle class selection (by-class mode)
  const handleClassToggle = (classId: string) => {
    setSelectedClassIds((prev) => {
      if (prev.includes(classId)) {
        return prev.filter((id) => id !== classId);
      } else {
        return [...prev, classId];
      }
    });
  };

  // Handle student selection (by-student mode)
  const handleStudentToggle = (studentId: string) => {
    setSelectedStudentIds((prev) => {
      if (prev.includes(studentId)) {
        return prev.filter((id) => id !== studentId);
      } else {
        return [...prev, studentId];
      }
    });
  };

  // Handle send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedMode === 'by-class' && selectedClassIds.length === 0) {
      toast.error('Veuillez sélectionner au moins une classe');
      return;
    }

    if (selectedMode === 'by-student') {
      if (!selectedClassId) {
        toast.error('Veuillez sélectionner une classe');
        return;
      }
      if (selectedStudentIds.length === 0) {
        toast.error('Veuillez sélectionner au moins un étudiant');
        return;
      }
    }

    if (!messageData.subject.trim() || !messageData.content.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        classIds: selectedMode === 'by-class' ? selectedClassIds : [],
        studentIds: selectedMode === 'by-student' ? selectedStudentIds : [],
        subject: messageData.subject.trim(),
        content: messageData.content.trim(),
        priorityLevel: messageData.priorityLevel,
        sendWhatsapp,
      });

      toast.success(`Annonce envoyée à ${result.data.sentTo} étudiant(s) avec succès`);
      setMessageData({ subject: '', content: '', priorityLevel: 'normal' });
      setSelectedClassIds([]);
      setSelectedClassId('');
      setSelectedStudentIds([]);
      setSendWhatsapp(false);
    } catch (error) {
      // Error is handled by the hook and toast
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-emerald-600" />
          Annonces aux Étudiants
        </CardTitle>
        <CardDescription>
          Envoyez une annonce à des étudiants par classe ou individuellement
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSendMessage} className="space-y-6">
          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>Mode d'envoi</Label>
            <RadioGroup value={selectedMode} onValueChange={(value) => {
              setSelectedMode(value as 'by-class' | 'by-student');
              setSelectedClassIds([]);
              setSelectedClassId('');
              setSelectedStudentIds([]);
            }}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="by-class" id="by-class" />
                <Label htmlFor="by-class" className="font-normal cursor-pointer">
                  Par classe (envoyer à tous les étudiants des classes sélectionnées)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="by-student" id="by-student" />
                <Label htmlFor="by-student" className="font-normal cursor-pointer">
                  Par étudiant (sélectionner des étudiants spécifiques)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* By Class Mode */}
          {selectedMode === 'by-class' && (
            <div className="space-y-2">
              <Label htmlFor="classes">Classes *</Label>
              {isLoadingClasses ? (
                <div className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    <p className="text-sm text-gray-500">Chargement des classes...</p>
                  </div>
                </div>
              ) : classes.length === 0 ? (
                <div className="p-4 border border-gray-200 rounded-lg">
                  <p className="text-sm text-gray-500 text-center">
                    Aucune classe disponible
                  </p>
                </div>
              ) : (
                <>
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
                      <SelectValue placeholder="Sélectionner une classe" />
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

                  {/* Selected Classes Badges */}
                  {selectedClassIds.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selectedClassIds.map((classId) => {
                        const classItem = classes.find((c) => c.id === classId);
                        if (!classItem) return null;
                        return (
                          <Badge
                            key={classId}
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer flex items-center gap-1"
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
                  {selectedClassIds.length > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      {selectedClassIds.length} classe(s) sélectionnée(s)
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* By Student Mode */}
          {selectedMode === 'by-student' && (
            <>
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
                  <SelectContent>
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
                    {students.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedStudentIds(students.map((s: { id: string }) => s.id))}
                        disabled={sendMessageMutation.isPending}
                      >
                        Toute la classe
                      </Button>
                    )}
                  </div>
                  {isLoadingStudents ? (
                    <div className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                        <p className="text-sm text-gray-500">Chargement des étudiants...</p>
                      </div>
                    </div>
                  ) : students.length === 0 ? (
                    <div className="p-4 border border-gray-200 rounded-lg">
                      <p className="text-sm text-gray-500 text-center">
                        Aucun étudiant dans cette classe
                      </p>
                    </div>
                  ) : (
                    <>
                      <Select
                        value=""
                        onValueChange={(value) => {
                          if (value && !selectedStudentIds.includes(value)) {
                            setSelectedStudentIds([...selectedStudentIds, value]);
                          }
                        }}
                        disabled={students.filter((s) => !selectedStudentIds.includes(s.id)).length === 0}
                      >
                        <SelectTrigger id="students">
                          <SelectValue placeholder="Sélectionner un étudiant" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {students
                            .filter((s) => !selectedStudentIds.includes(s.id))
                            .map((student) => (
                              <SelectItem key={student.id} value={student.id}>
                                {student.firstName} {student.lastName}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {/* Selected Students Badges */}
                      {selectedStudentIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {selectedStudentIds.map((studentId) => {
                            const student = students.find((s) => s.id === studentId);
                            if (!student) return null;
                            return (
                              <Badge
                                key={studentId}
                                variant="secondary"
                                className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer flex items-center gap-1"
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
                      {selectedStudentIds.length > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          {selectedStudentIds.length} étudiant(s) sélectionné(s)
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

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
              placeholder="Rédigez votre annonce..."
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
            id="wa-admin-students"
          />

          {/* Submit Button */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMessageData({ subject: '', content: '', priorityLevel: 'normal' });
                setSelectedClassIds([]);
                setSelectedClassId('');
                setSelectedStudentIds([]);
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
                (selectedMode === 'by-class' && selectedClassIds.length === 0) ||
                (selectedMode === 'by-student' && (!selectedClassId || selectedStudentIds.length === 0)) ||
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
                  Envoyer l'annonce
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
                Annonce envoyée avec succès à {sendMessageMutation.data?.data.sentTo} étudiant(s)
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
                {sendMessageMutation.error?.message || 'Erreur lors de l\'envoi de l\'annonce'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

