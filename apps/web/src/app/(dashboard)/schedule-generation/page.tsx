"use client";

import { useState, useEffect } from "react";
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
  Badge,
  Separator,
  Progress,
} from "@ecoledigitale/ui";
import {
  Calendar,
  Clock,
  BookOpen,
  Settings,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Users,
  MapPin,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";

interface Class {
  id: string;
  name: string;
  capacity: number;
  programmeName: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
  hoursTotal: number;
  isAssigned: boolean;
  teacherName?: string;
}

interface TimeSlot {
  id: string;
  name: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  priority: number;
}

interface Classroom {
  id: string;
  name: string;
  capacity: number;
  type?: string;
}

interface SelectedCourse {
  courseId: string;
  requiredHours: number;
  preferredSessionDuration: number;
  maxSessionsPerWeek?: number;
}

interface GenerationPreferences {
  balanceWorkload: boolean;
  avoidBackToBackSessions: boolean;
  preferMorningSlots: boolean;
  maxDailyHours?: number;
  allowWeekendSessions: boolean;
}

export default function ScheduleGenerationPage() {
  const router = useRouter();
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedCourses, setSelectedCourses] = useState<SelectedCourse[]>([]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [preferences, setPreferences] = useState<GenerationPreferences>({
    balanceWorkload: true,
    avoidBackToBackSessions: false,
    preferMorningSlots: false,
    allowWeekendSessions: false,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string>("");

  // Fetch classes
  const { data: classes, isLoading: classesLoading } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => {
      const response = await fetch("/api/v1/classes", {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });
      if (!response.ok) throw new Error("Failed to fetch classes");
      const result = await response.json();
      console.log("API Response:", result);
      console.log("Response type:", typeof result);
      console.log("Is array?", Array.isArray(result));
      console.log("Has data property?", result?.data);
      console.log("Data is array?", Array.isArray(result?.data));
      // Extract data array from response
      const classesData = result.data || result || [];
      console.log("Final classes data:", classesData);
      console.log("Final classes count:", Array.isArray(classesData) ? classesData.length : 0);
      return classesData;
    },
  });

  // Fetch generation options when class is selected
  const { data: generationOptions, isLoading: optionsLoading } = useQuery({
    queryKey: ["generation-options", selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return null;
      const response = await fetch(`/api/v1/schedule-generation/classes/${selectedClassId}/generation-options`, {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });
      if (!response.ok) throw new Error("Failed to fetch generation options");
      return response.json();
    },
    enabled: !!selectedClassId,
  });

  // Generate schedule mutation
  const generateScheduleMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/v1/schedule-generation/generate", {
        method: "POST",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to generate schedule" }));
        throw new Error(errorData.message || "Failed to generate schedule");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsGenerating(false);
      setGenerationError("");
      if (data.requestId) {
        router.push(`/schedule-generation/${data.requestId}`);
      } else {
        setGenerationError("Erreur: Aucun identifiant de génération reçu");
      }
    },
    onError: (error: Error) => {
      setIsGenerating(false);
      setGenerationError(error.message || "Une erreur est survenue lors de la génération");
      console.error("Generation error:", error);
    },
  });

  const handleCourseSelection = (courseId: string, checked: boolean) => {
    if (checked) {
      const course = generationOptions?.availableCourses.find((c: Course) => c.id === courseId);
      if (course) {
        setSelectedCourses(prev => [...prev, {
          courseId,
          requiredHours: course.hoursTotal,
          preferredSessionDuration: 120, // 2 hours default
        }]);
      }
    } else {
      setSelectedCourses(prev => prev.filter(c => c.courseId !== courseId));
    }
  };

  const updateCourseHours = (courseId: string, hours: number) => {
    setSelectedCourses(prev => 
      prev.map(c => c.courseId === courseId ? { ...c, requiredHours: hours } : c)
    );
  };

  const updateSessionDuration = (courseId: string, duration: number) => {
    setSelectedCourses(prev => 
      prev.map(c => c.courseId === courseId ? { ...c, preferredSessionDuration: duration } : c)
    );
  };

  const handleTimeSlotSelection = (timeSlotId: string, checked: boolean) => {
    if (checked) {
      setSelectedTimeSlots(prev => [...prev, timeSlotId]);
    } else {
      setSelectedTimeSlots(prev => prev.filter(id => id !== timeSlotId));
    }
  };

  const handleGenerate = () => {
    if (!selectedClassId || selectedCourses.length === 0 || selectedTimeSlots.length === 0 || !startDate) {
      setGenerationError("Veuillez remplir tous les champs requis");
      return;
    }

    setIsGenerating(true);
    setGenerationError("");
    generateScheduleMutation.mutate({
      classId: selectedClassId,
      selectedCourses,
      availableTimeSlots: selectedTimeSlots,
      generationPreferences: preferences,
      startDate: startDate,
    });
  };

  const canGenerate = selectedClassId && selectedCourses.length > 0 && selectedTimeSlots.length > 0 && startDate;
  const totalRequiredHours = selectedCourses.reduce((sum, course) => sum + course.requiredHours, 0);

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Génération d'Emploi du Temps</h1>
          <p className="text-gray-600 mt-2">
            Créez automatiquement un planning optimisé pour vos classes
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className="bg-primary hover:bg-primary/90"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isGenerating ? "Génération..." : "Générer le Planning"}
          </Button>
        </div>
      </motion.div>

      {/* Error Alert */}
      {generationError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{generationError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Class Selection */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Sélection de la Classe
                </CardTitle>
                <CardDescription>
                  Choisissez la classe pour laquelle générer l'emploi du temps
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="class-select">Classe *</Label>
                    <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionnez une classe" />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          console.log("Rendering SelectContent - classes:", classes);
                          console.log("Is array?", Array.isArray(classes));
                          console.log("Classes length:", Array.isArray(classes) ? classes.length : "not an array");
                          if (!Array.isArray(classes)) {
                            console.warn("Classes is not an array:", typeof classes);
                            return <SelectItem disabled>Aucune classe disponible</SelectItem>;
                          }
                          if (classes.length === 0) {
                            console.warn("Classes array is empty");
                            return <SelectItem disabled>Aucune classe disponible</SelectItem>;
                          }
                          return classes.map((cls: any) => {
                            console.log("Rendering class:", cls.name, cls.id);
                            return (
                              <SelectItem key={cls.id} value={cls.id}>
                                {cls.name}
                              </SelectItem>
                            );
                          });
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Start Date Selection */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Date de Début de Planification
                </CardTitle>
                <CardDescription>
                  Définissez la date à partir de laquelle le planning doit commencer
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="start-date">Date de début *</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="mt-1"
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Le planning généré commencera à partir de cette date
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Course Selection */}
          {generationOptions?.availableCourses && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Sélection des Cours
                  </CardTitle>
                  <CardDescription>
                    Choisissez les cours à inclure dans le planning
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {generationOptions.availableCourses.map((course: Course) => {
                      const isSelected = selectedCourses.some(c => c.courseId === course.id);
                      const selectedCourse = selectedCourses.find(c => c.courseId === course.id);

                      return (
                        <div key={course.id} className="border rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => 
                                handleCourseSelection(course.id, checked as boolean)
                              }
                            />
                            <div className="flex-1 space-y-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{course.name}</h4>
                                  <Badge variant="outline">{course.code}</Badge>
                                  {course.isAssigned && (
                                    <Badge variant="secondary">
                                      {course.teacherName || "Assigné"}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-gray-600">
                                  Volume horaire total: {course.hoursTotal}h
                                </p>
                              </div>

                              {isSelected && selectedCourse && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t">
                                  <div>
                                    <Label htmlFor={`hours-${course.id}`}>
                                      Heures requises
                                    </Label>
                                    <Input
                                      id={`hours-${course.id}`}
                                      type="number"
                                      min="1"
                                      max={course.hoursTotal}
                                      value={selectedCourse.requiredHours}
                                      onChange={(e) => 
                                        updateCourseHours(course.id, parseInt(e.target.value) || 0)
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`duration-${course.id}`}>
                                      Durée par session (min)
                                    </Label>
                                    <Select
                                      value={selectedCourse.preferredSessionDuration.toString()}
                                      onValueChange={(value) => 
                                        updateSessionDuration(course.id, parseInt(value))
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="60">1 heure</SelectItem>
                                        <SelectItem value="90">1h30</SelectItem>
                                        <SelectItem value="120">2 heures</SelectItem>
                                        <SelectItem value="180">3 heures</SelectItem>
                                        <SelectItem value="240">4 heures</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Time Slots Selection */}
          {generationOptions?.availableTimeSlots && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Créneaux Horaires Disponibles
                  </CardTitle>
                  <CardDescription>
                    Sélectionnez les créneaux où les cours peuvent être programmés
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Group by day */}
                    {Object.entries(
                      generationOptions.availableTimeSlots.reduce((acc: any, slot: TimeSlot) => {
                        const day = slot.dayOfWeek;
                        if (!acc[day]) acc[day] = [];
                        acc[day].push(slot);
                        return acc;
                      }, {})
                    ).map(([day, slots]) => (
                      <div key={day} className="space-y-2">
                        <h4 className="font-medium capitalize text-sm text-gray-700">
                          {day === 'monday' && 'Lundi'}
                          {day === 'tuesday' && 'Mardi'}
                          {day === 'wednesday' && 'Mercredi'}
                          {day === 'thursday' && 'Jeudi'}
                          {day === 'friday' && 'Vendredi'}
                          {day === 'saturday' && 'Samedi'}
                          {day === 'sunday' && 'Dimanche'}
                        </h4>
                        <div className="grid grid-cols-1 gap-2">
                          {(slots as TimeSlot[]).map((slot) => (
                            <div key={slot.id} className="flex items-center gap-3 p-3 border rounded-lg">
                              <Checkbox
                                checked={selectedTimeSlots.includes(slot.id)}
                                onCheckedChange={(checked) =>
                                  handleTimeSlotSelection(slot.id, checked as boolean)
                                }
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{slot.name}</span>
                                  <Badge variant="outline" className="text-xs">
                                    Priorité {slot.priority}
                                  </Badge>
                                </div>
                                <p className="text-sm text-gray-600">
                                  {slot.startTime} - {slot.endTime}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Generation Preferences */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Préférences de Génération
                </CardTitle>
                <CardDescription>
                  Configurez les options d'optimisation du planning
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="balance-workload"
                      checked={preferences.balanceWorkload}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, balanceWorkload: checked as boolean }))
                      }
                    />
                    <Label htmlFor="balance-workload" className="text-sm">
                      Équilibrer la charge de travail sur la semaine
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="avoid-back-to-back"
                      checked={preferences.avoidBackToBackSessions}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, avoidBackToBackSessions: checked as boolean }))
                      }
                    />
                    <Label htmlFor="avoid-back-to-back" className="text-sm">
                      Éviter les cours consécutifs
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="prefer-morning"
                      checked={preferences.preferMorningSlots}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, preferMorningSlots: checked as boolean }))
                      }
                    />
                    <Label htmlFor="prefer-morning" className="text-sm">
                      Privilégier les créneaux du matin
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="allow-weekend"
                      checked={preferences.allowWeekendSessions}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, allowWeekendSessions: checked as boolean }))
                      }
                    />
                    <Label htmlFor="allow-weekend" className="text-sm">
                      Autoriser les cours le weekend
                    </Label>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="max-daily-hours">
                    Heures maximum par jour (optionnel)
                  </Label>
                  <Select
                    value={preferences.maxDailyHours?.toString() || "unlimited"}
                    onValueChange={(value) =>
                      setPreferences(prev => ({
                        ...prev,
                        maxDailyHours: value === "unlimited" ? undefined : parseInt(value)
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Aucune limite" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unlimited">Aucune limite</SelectItem>
                      <SelectItem value="4">4 heures</SelectItem>
                      <SelectItem value="6">6 heures</SelectItem>
                      <SelectItem value="8">8 heures</SelectItem>
                      <SelectItem value="10">10 heures</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Right Column - Summary & Time Slots */}
        <div className="space-y-6">
          {/* Summary */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Résumé
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Cours sélectionnés:</span>
                    <span className="font-medium">{selectedCourses.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Heures totales:</span>
                    <span className="font-medium">{totalRequiredHours}h</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Créneaux sélectionnés:</span>
                    <span className="font-medium">{selectedTimeSlots.length}</span>
                  </div>
                </div>

                {canGenerate && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Prêt pour la génération du planning
                    </AlertDescription>
                  </Alert>
                )}

                {!canGenerate && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Veuillez sélectionner une classe, des cours et des créneaux horaires
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}


