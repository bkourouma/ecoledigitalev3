"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  Calendar,
  BookOpen,
  CheckCircle,
  AlertCircle,
  Download,
  Plus,
  Edit,
  Save,
  X,
  Loader2,
  DollarSign,
  BarChart3
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle, 
  Button, 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
  Badge,
  Input
} from "@ecoledigitale/ui";
import { useTeachingHours } from '@/lib/hooks/use-teachers';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';

export default function TeacherHoursPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Get current month in YYYY-MM format
  const getCurrentMonth = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };
  
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [editingHour, setEditingHour] = useState<string | null>(null);
  const [hourData, setHourData] = useState<{[key: string]: any}>({});

  // Calculate date range for selected month (handles months with different days)
  const getLastDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };
  
  const [year, month] = selectedMonth.split('-').map(Number);
  const lastDay = getLastDayOfMonth(year, month);
  const fromDate = `${selectedMonth}-01`;
  const toDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;

  // Don't pass teacherId - backend will resolve it from X-User-Id header
  const { data: hoursData, isLoading: isLoadingHours, error } = useTeachingHours(undefined, fromDate, toDate);

  // Use real data from API - always define these before any conditional returns
  const teachingHours = hoursData?.data || [];
  const totals = hoursData?.totals || {
    totalHours: 0,
    validatedHours: 0,
    pendingHours: 0,
    totalAmount: 0,
    validatedAmount: 0
  };

  // Calculate statistics based on status - MUST be before any conditional returns
  const stats = useMemo(() => {
    const draftCount = teachingHours.filter((h: any) => h.status?.toLowerCase() === 'draft').length;
    const pendingCount = teachingHours.filter((h: any) => h.status?.toLowerCase() === 'pending').length;
    const completedCount = teachingHours.filter((h: any) => h.status?.toLowerCase() === 'completed').length;
    
    const draftHours = teachingHours
      .filter((h: any) => h.status?.toLowerCase() === 'draft')
      .reduce((sum, h) => sum + (h.duration || 0), 0);
    const pendingHours = teachingHours
      .filter((h: any) => h.status?.toLowerCase() === 'pending')
      .reduce((sum, h) => sum + (h.duration || 0), 0);
    const validatedHours = teachingHours
      .filter((h: any) => h.status?.toLowerCase() === 'completed')
      .reduce((sum, h) => sum + (h.duration || 0), 0);
    const validatedAmount = teachingHours
      .filter((h: any) => h.status?.toLowerCase() === 'completed')
      .reduce((sum, h) => sum + (h.amount || 0), 0);
    
    return {
      totalHours: totals.totalHours || 0,
      validatedHours,
      pendingHours,
      draftHours,
      validatedAmount,
      draftCount,
      pendingCount,
      completedCount,
    };
  }, [teachingHours, totals]);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  if (isLoadingHours) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span className="text-muted-foreground">Chargement des heures...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center px-4">
          <div className="text-red-400 font-medium mb-2">Erreur lors du chargement</div>
          <div className="text-muted-foreground text-sm">{error instanceof Error ? error.message : 'Erreur inconnue'}</div>
        </div>
      </div>
    );
  }

  // Generate months list dynamically (current month and 11 months back)
  const generateMonths = () => {
    const months = [];
    const now = new Date();
    const monthNames = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const value = `${year}-${month}`;
      const label = `${monthNames[date.getMonth()]} ${year}`;
      months.push({ value, label });
    }
    
    return months;
  };

  const months = generateMonths();

  const getStatusBadge = (hourStatus: string) => {
    switch (hourStatus?.toLowerCase()) {
      case 'completed':
        return (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
            Validé
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">
            En attente de validation
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            Brouillon
          </Badge>
        );
      case 'rejected':
        return <Badge variant="destructive">Rejeté</Badge>;
      default:
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            Brouillon
          </Badge>
        );
    }
  };

  const getTypeBadge = (sessionType: string) => {
    const typeMap: Record<string, { label: string; className: string }> = {
      theory: { label: 'Cours Magistral', className: 'border-violet-500/40 bg-violet-500/15 text-violet-200' },
      practical: { label: 'Travaux Pratiques', className: 'border-sky-500/40 bg-sky-500/15 text-sky-200' },
      exam: { label: 'Examen', className: 'border-rose-500/40 bg-rose-500/15 text-rose-200' },
      evaluation: { label: 'Évaluation', className: 'border-teal-500/40 bg-teal-500/15 text-teal-200' },
      supervision: { label: 'Supervision', className: 'border-border bg-muted/40 text-foreground' },
    };

    const type = typeMap[sessionType || 'theory'] || {
      label: 'Cours',
      className: 'border-border bg-muted/40 text-foreground',
    };
    return (
      <Badge variant="outline" className={type.className}>
        {type.label}
      </Badge>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatAmount = (amount: number) => {
    return amount.toLocaleString('fr-FR') + ' FCFA';
  };

  const { totalHours, validatedHours, pendingHours, draftHours, validatedAmount } = stats;

  const handleEditHour = (hourId: string) => {
    setEditingHour(hourId);
    const hour = teachingHours.find((h: any) => h.id === hourId);
    if (hour) {
      setHourData({
        [hourId]: {
          startTime: hour.startTime,
          endTime: hour.endTime,
          duration: hour.duration
        }
      });
    }
  };

  const handleSaveHour = (hourId: string) => {
    // Here you would save to your API
    console.log('Saving hour data:', hourData[hourId]);
    setEditingHour(null);
    alert('Heures mises à jour avec succès !');
  };

  const handleSubmitForValidation = async () => {
    // Get all draft hours
    const draftHours = teachingHours.filter((h: any) => h.status?.toLowerCase() === 'draft');
    
    if (draftHours.length === 0) {
      toast({
        title: "Aucune heure à soumettre",
        description: "Toutes vos heures sont déjà soumises ou validées.",
        variant: "default",
      });
      return;
    }

    const sessionIds = draftHours.map((h: any) => h.id);

    try {
      const response = await fetch('/api/teacher/attendance/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionIds }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Erreur lors de la soumission');
      }

      const result = await response.json();
      
      toast({
        title: "Heures soumises avec succès",
        description: `${result.data.submitted} heure(s) soumise(s) pour validation.`,
        variant: "default",
      });

      // Refresh the data
      queryClient.invalidateQueries({ queryKey: ["teaching-hours"] });
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Erreur lors de la soumission des heures",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-foreground flex items-center gap-3 whitespace-nowrap text-2xl leading-tight md:text-3xl">
                <Clock className="w-8 h-8 text-purple-400 shrink-0" />
                Mes Heures Enseignées
              </h1>
              <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                Gestion et validation de vos heures d'enseignement
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleSubmitForValidation}
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={teachingHours.filter((h: any) => h.status?.toLowerCase() === 'draft').length === 0}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Soumettre pour validation ({teachingHours.filter((h: any) => h.status?.toLowerCase() === 'draft').length})
              </Button>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Exporter
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Heures</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-400">{totalHours}h</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.draftCount} brouillon(s), {stats.pendingCount} en attente, {stats.completedCount} validé(s)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Heures Validées</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-400">{validatedHours}h</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">En Attente</CardTitle>
              <AlertCircle className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-400">{pendingHours}h</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.pendingCount} session(s)</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Montant Validé</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{formatAmount(validatedAmount)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Month Filter */}
        <div className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Période</CardTitle>
              <CardDescription className="text-muted-foreground">Sélectionnez le mois à consulter</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedMonth}
                onValueChange={(value) => setSelectedMonth(value)}
              >
                <SelectTrigger className="w-[300px] text-foreground">
                  <SelectValue placeholder="Sélectionner un mois" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* Hours List */}
        {teachingHours.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Aucune heure enregistrée
            </h3>
            <p className="text-muted-foreground mb-4">
              Aucune heure d'enseignement trouvée pour cette période.
            </p>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Ajouter des heures
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {teachingHours.map((hour: any) => {
              const isEditing = editingHour === hour.id;

              return (
                <Card key={hour.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="p-2 bg-purple-500/15 rounded-lg shrink-0">
                          <Clock className="w-6 h-6 text-purple-400" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3 mb-2 flex-wrap gap-2">
                            <h3 className="text-lg font-semibold text-foreground">
                              {hour.courseName || 'Cours non défini'}
                            </h3>
                            {getTypeBadge(hour.sessionType || 'theory')}
                            {getStatusBadge(hour.status || (hour.validated ? 'completed' : 'draft'))}
                          </div>

                          <div className="flex items-center space-x-6 text-sm text-muted-foreground flex-wrap gap-2">
                            <div className="flex items-center space-x-1">
                              <Calendar className="w-4 h-4" />
                              <span>{formatDate(hour.date)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <BookOpen className="w-4 h-4" />
                              <span>{hour.className || 'Classe non définie'}</span>
                            </div>
                            {isEditing ? (
                              <div className="flex items-center space-x-2">
                                <Input
                                  type="time"
                                  value={hourData[hour.id]?.startTime || hour.startTime || ''}
                                  onChange={(e) => setHourData(prev => ({
                                    ...prev,
                                    [hour.id]: { ...prev[hour.id], startTime: e.target.value }
                                  }))}
                                  className="w-[120px] text-foreground"
                                />
                                <span className="text-muted-foreground">-</span>
                                <Input
                                  type="time"
                                  value={hourData[hour.id]?.endTime || hour.endTime || ''}
                                  onChange={(e) => setHourData(prev => ({
                                    ...prev,
                                    [hour.id]: { ...prev[hour.id], endTime: e.target.value }
                                  }))}
                                  className="w-[120px] text-foreground"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center space-x-1">
                                <Clock className="w-4 h-4" />
                                <span>{hour.startTime || 'N/A'} - {hour.endTime || 'N/A'}</span>
                              </div>
                            )}
                            <div className="flex items-center space-x-1">
                              <BarChart3 className="w-4 h-4" />
                              <span>Durée: {hour.duration || 0}h</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <DollarSign className="w-4 h-4" />
                              <span>{formatAmount(hour.amount || 0)}</span>
                            </div>
                            {hour.hourlyRate && (
                              <div className="text-xs text-muted-foreground">
                                ({formatAmount(hour.hourlyRate)}/h)
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 ml-4">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSaveHour(hour.id)}
                              title="Enregistrer"
                              className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            >
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingHour(null)}
                              title="Annuler"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          (hour.status?.toLowerCase() === 'draft' || hour.status?.toLowerCase() === 'rejected') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditHour(hour.id)}
                              title="Modifier"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
