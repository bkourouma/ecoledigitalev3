"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  Calendar,
  Clock,
  BookOpen,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface Course {
  id: string;
  name: string;
  code: string;
  hoursTotal: number;
}

interface Class {
  id: string;
  name: string;
  code: string;
}

interface TimeSlotSelection {
  day: string;
  timeSlot: string;
  courseId: string;
  teacherId: string;
}

interface Teacher {
  id: string;
  name: string;
}

const DAYS = [
  { value: 'monday', label: 'Lundi' },
  { value: 'tuesday', label: 'Mardi' },
  { value: 'wednesday', label: 'Mercredi' },
  { value: 'thursday', label: 'Jeudi' },
  { value: 'friday', label: 'Vendredi' },
  { value: 'saturday', label: 'Samedi' },
  { value: 'sunday', label: 'Dimanche' },
];

const TIME_SLOTS = [
  // Nouveaux horaires de 2 heures
  { value: '08:00-10:00', label: '08:00 - 10:00' },
  { value: '10:00-12:00', label: '10:00 - 12:00' },
  { value: '14:00-16:00', label: '14:00 - 16:00' },
  { value: '16:00-18:00', label: '16:00 - 18:00' },
  // Anciens horaires
  { value: '08:00-12:00', label: '08:00 - 12:00' },
  { value: '13:00-17:00', label: '13:00 - 17:00' },
  { value: '18:00-20:00', label: '18:00 - 20:00' },
];

export default function SimpleSchedulePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  
  const [selectedClassId, setSelectedClassId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [selections, setSelections] = useState<TimeSlotSelection[]>([]);

  // Fetch classes
  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["classes"],
    queryFn: async () => {
      const response = await fetch("/api/v1/classes", {
        headers: {
          "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
        },
      });
      const data = await response.json();
      return data.data || [];
    },
  });

  // Fetch courses for selected class
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["class-courses", selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return [];
      const response = await fetch(`/api/v1/classes/${selectedClassId}/courses`, {
        headers: {
          "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
        },
      });
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!selectedClassId,
  });

  // Store teachers for each course
  const [courseTeachers, setCourseTeachers] = useState<Map<string, Teacher[]>>(new Map());

  // Fetch teachers for courses that are selected
  useEffect(() => {
    const fetchTeachersForCourses = async () => {
      if (!selectedClassId) return;
      
      const uniqueCourseIds = Array.from(new Set(selections.map(s => s.courseId).filter(Boolean)));
      if (uniqueCourseIds.length === 0) return;

      const newCourseTeachers = new Map<string, Teacher[]>();
      
      await Promise.all(uniqueCourseIds.map(async (courseId) => {
        try {
          const response = await fetch(
            `/api/v1/teacher-assignments?classId=${selectedClassId}&courseId=${courseId}&showAll=true`,
            {
              headers: {
                "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
              },
            }
          );
          const data = await response.json();
          // Deduplicate teachers by ID (same teacher may have multiple assignments)
          const teacherMap = new Map<string, Teacher>();
          (data.data || []).forEach((ta: any) => {
            if (!teacherMap.has(ta.teacherId)) {
              teacherMap.set(ta.teacherId, {
                id: ta.teacherId,
                name: ta.teacherName,
              });
            }
          });
          newCourseTeachers.set(courseId, Array.from(teacherMap.values()));
        } catch (error) {
          console.error(`Error fetching teachers for course ${courseId}:`, error);
          newCourseTeachers.set(courseId, []);
        }
      }));

      setCourseTeachers(newCourseTeachers);
    };

    fetchTeachersForCourses();
  }, [selectedClassId, selections]);

  // Fetch teachers for a specific course from teacher_assignments
  const getTeachersForCourse = (courseId: string): Teacher[] => {
    if (!selectedClassId || !courseId) return [];
    return courseTeachers.get(courseId) || [];
  };

  // Generate schedule mutation
  const generateMutation = useMutation({
    mutationFn: async (data: { classId: string; startDate: string; timeSlotSelections: TimeSlotSelection[] }) => {
      const response = await fetch("/api/v1/simple-schedule/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
          "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate schedule');
      }
      return response.json();
    },
    onSuccess: (data) => {
      alert(`✅ Généré ${data.sessions.length} sessions!`);
      router.push('/schedule-generation/calendar');
    },
  });

  const addSelection = () => {
    setSelections([...selections, { day: 'monday', timeSlot: '08:00-10:00', courseId: '', teacherId: '' }]);
  };

  const removeSelection = (index: number) => {
    setSelections(selections.filter((_, i) => i !== index));
  };

  const updateSelection = (index: number, field: keyof TimeSlotSelection, value: string) => {
    const updated = [...selections];
    updated[index] = { ...updated[index], [field]: value };
    setSelections(updated);
  };

  const handleGenerate = () => {
    if (!selectedClassId || !startDate || selections.length === 0) {
      alert('Veuillez remplir tous les champs');
      return;
    }

    const invalidSelections = selections.filter(s => !s.courseId || !s.teacherId);
    if (invalidSelections.length > 0) {
      alert('Veuillez sélectionner un cours et un enseignant pour chaque créneau');
      return;
    }

    generateMutation.mutate({
      classId: selectedClassId,
      startDate,
      timeSlotSelections: selections,
    });
  };

  const getTotalHours = () => {
    return selections.reduce((sum, sel) => {
      const course = courses.find(c => c.id === sel.courseId);
      return sum + (course?.hoursTotal || 0);
    }, 0);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-foreground">Génération Simplifiée de Planning</h1>
        <p className="text-muted-foreground text-base">Créez un emploi du temps directement</p>
      </motion.div>

      {/* Class Selection */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">1. Sélectionner la Classe</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="bg-background border-border text-foreground">
              <SelectValue placeholder="Choisissez une classe" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((cls) => (
                <SelectItem key={cls.id} value={cls.id}>
                  <span className="text-foreground">{cls.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Start Date */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">2. Date de Début</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="bg-background border-border text-foreground"
          />
        </CardContent>
      </Card>

      {/* Time Slot Selections */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">3. Créneaux Horaires</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sélectionnez un jour, un horaire, et le cours à enseigner. Le système générera automatiquement les sessions jusqu'à atteindre le nombre d'heures requis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selections.map((selection, index) => (
            <div key={index} className="flex items-end gap-3 p-4 border border-border rounded-lg bg-accent/50">
              <div className="flex-1">
                <Label className="text-foreground">Jour</Label>
                <Select 
                  value={selection.day} 
                  onValueChange={(value) => updateSelection(index, 'day', value)}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(day => (
                      <SelectItem key={day.value} value={day.value}>
                        <span className="text-foreground">{day.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1">
                <Label className="text-foreground">Horaire</Label>
                <Select 
                  value={selection.timeSlot} 
                  onValueChange={(value) => updateSelection(index, 'timeSlot', value)}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map(slot => (
                      <SelectItem key={slot.value} value={slot.value}>
                        <span className="text-foreground">{slot.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1">
                <Label className="text-foreground">Cours</Label>
                <Select 
                  value={selection.courseId} 
                  onValueChange={(value) => updateSelection(index, 'courseId', value)}
                  disabled={!selectedClassId}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Sélectionner un cours" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map(course => (
                      <SelectItem key={course.id} value={course.id}>
                        <span className="text-foreground">{course.name} ({course.hoursTotal}h)</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1">
                <Label className="text-foreground">Enseignant</Label>
                <Select 
                  value={selection.teacherId} 
                  onValueChange={(value) => updateSelection(index, 'teacherId', value)}
                  disabled={!selection.courseId}
                >
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Sélectionner un enseignant" />
                  </SelectTrigger>
                  <SelectContent>
                    {getTeachersForCourse(selection.courseId).length > 0 ? (
                      getTeachersForCourse(selection.courseId).map(teacher => (
                        <SelectItem key={teacher.id} value={teacher.id}>
                          <span className="text-foreground">{teacher.name}</span>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem disabled value="none">
                        <span className="text-muted-foreground">
                          {!selection.courseId ? 'Sélectionnez d\'abord un cours' : 'Aucun enseignant assigné'}
                        </span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() => removeSelection(index)}
                className="shrink-0 bg-background hover:bg-destructive/10 border-border text-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button onClick={addSelection} variant="outline" className="w-full bg-background hover:bg-accent border-border text-foreground">
            <Plus className="h-4 w-4 mr-2" />
            Ajouter un créneau
          </Button>
        </CardContent>
      </Card>

      {/* Summary */}
      {selections.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Résumé</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-foreground">
                <strong className="text-foreground">Créneaux sélectionnés:</strong> <span className="text-muted-foreground">{selections.length}</span>
              </p>
              <p className="text-foreground">
                <strong className="text-foreground">Heures totales des cours:</strong> <span className="text-muted-foreground">{getTotalHours()}h</span>
              </p>
              <div>
                <strong className="text-foreground">Distribution:</strong>
                <ul className="mt-2 space-y-1">
                  {Array.from(new Set(selections.map(s => s.courseId))).map(courseId => {
                    const course = courses.find(c => c.id === courseId);
                    const count = selections.filter(s => s.courseId === courseId).length;
                    if (!course) return null;
                    return (
                      <li key={courseId} className="text-sm text-muted-foreground">
                        • {course.name}: {count} créneau(x) par semaine × {course.hoursTotal}h total
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate Button */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => router.push('/schedule-generation/calendar')}
          className="bg-background hover:bg-accent border-border text-foreground"
        >
          Voir le Calendrier
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={!selectedClassId || !startDate || selections.length === 0 || generateMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Génération...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Générer le Planning
            </>
          )}
        </Button>
      </div>

      {/* Error Alert */}
      {generateMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {generateMutation.error?.message || 'Erreur lors de la génération'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

