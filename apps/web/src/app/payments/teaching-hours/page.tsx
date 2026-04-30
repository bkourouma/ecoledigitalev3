"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DatePickerFr from "@/components/DatePickerFr";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, RefreshCcw, Clock, AlertCircle } from "lucide-react";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

interface Teacher { id: string; firstName: string; lastName: string; email: string; }
interface AttendanceSession {
  id: string;
  assignmentId: string;
  date: string;
  timeSlot: string;
  startTime: string | null;
  endTime: string | null;
  duration: number;
  sessionTitle: string;
  status: string;
  validated: boolean;
  hourlyRate: number;
  amount: number;
  courseName: string;
  courseCode: string;
  className: string;
  teacherName?: string;
  teacherId?: string;
  createdAt: string;
  updatedAt: string;
}

export default function TeachingHoursValidationPage() {
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [teacherId, setTeacherId] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "completed" | "draft">("all");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    const loadInitial = async () => {
      setLoading(true);
      try {
        const resTeachers = await fetch("/api/v1/teachers", { headers: createApiHeaders() });
        if (resTeachers.ok) {
          const t = await resTeachers.json();
          setTeachers(t.data || []);
        }
      } catch {}
      await fetchSessions();
      setLoading(false);
    };
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAcademicYearId]);

  const fetchSessions = async () => {
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (teacherId && teacherId !== "ALL") params.set("teacherId", teacherId);
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const response = await fetch(`/api/teacher/attendance${params.toString() ? `?${params.toString()}` : ""}`, {
        headers: createApiHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setSessions(data.data || []);
        setSelectedIds(new Set());
        
        if ((data.data || []).length === 0) {
          toast({ 
            title: "Aucune donnée", 
            description: "Aucune session trouvée avec les filtres sélectionnés", 
            variant: "default" 
          });
        }
      } else {
        const errorData = await response.json().catch(() => ({ message: "Erreur inconnue" }));
        toast({ 
          title: "Erreur", 
          description: errorData.message || "Impossible de charger les sessions", 
          variant: "destructive" 
        });
      }
    } catch (error) {
      console.error("Fetch error:", error);
      toast({ 
        title: "Erreur", 
        description: error instanceof Error ? error.message : "Erreur de connexion", 
        variant: "destructive" 
      });
    } finally {
      setFetching(false);
    }
  };

  // Helper function to check if a session is selectable
  const isSelectable = (status: string | undefined): boolean => {
    const normalizedStatus = status?.toLowerCase();
    // Allow selection of pending and draft sessions (they can be validated)
    return normalizedStatus === 'pending' || normalizedStatus === 'draft';
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      // Select all selectable sessions (pending and draft)
      const selectableIds = filteredSessions
        .filter(s => isSelectable(s.status))
        .map(s => s.id);
      setSelectedIds(new Set(selectableIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    const session = sessions.find(s => s.id === id);
    
    if (!session || !isSelectable(session.status)) {
      // Don't allow selecting non-selectable sessions
      toast({
        title: "Sélection impossible",
        description: "Seules les sessions en attente ou en brouillon peuvent être sélectionnées",
        variant: "destructive"
      });
      return;
    }

    setSelectedIds(prev => {
      const n = new Set(prev);
      if (checked) {
        n.add(id);
      } else {
        n.delete(id);
      }
      return n;
    });
  };

  const handleValidate = async () => {
    if (selectedIds.size === 0) {
      toast({ 
        title: "Sélection requise", 
        description: "Veuillez sélectionner des sessions à valider.", 
        variant: "destructive" 
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/teacher/attendance/validate', {
        method: 'POST',
        headers: createApiHeaders(),
        body: JSON.stringify({ sessionIds: Array.from(selectedIds) }),
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: '✅ Heures validées avec succès',
          description: `${result.data.validated} session(s) validée(s)`,
          duration: 5000
        });
        await fetchSessions(); // Refresh the data
        setSelectedIds(new Set()); // Clear selection
      } else {
        const err = await response.json().catch(() => ({}));
        toast({ 
          title: 'Erreur de validation', 
          description: err.message || 'Impossible de valider les heures', 
          variant: 'destructive' 
        });
      }
    } catch (error) {
      console.error('Validation error:', error);
      toast({ 
        title: 'Erreur', 
        description: 'Erreur de connexion', 
        variant: 'destructive' 
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const normalizedStatus = status?.toLowerCase();
    switch (normalizedStatus) {
      case 'completed':
        return <Badge className="bg-green-500/15 text-green-300 border-green-500/30">Validé</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">En attente</Badge>;
      case 'draft':
        return <Badge variant="outline" className="bg-muted/40 text-foreground border-border">Brouillon</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejeté</Badge>;
      default:
        return <Badge variant="outline">{status || 'Inconnu'}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatAmount = (amount: number) => {
    return amount.toLocaleString('fr-FR') + ' FCFA';
  };

  // Filter sessions based on status
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      if (statusFilter === "all") return true;
      // Normalize status comparison (case-insensitive)
      return session.status?.toLowerCase() === statusFilter.toLowerCase();
    });
  }, [sessions, statusFilter]);

  // Calculate totals
  const totals = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      acc.totalHours += session.duration || 0;
      acc.totalAmount += session.amount || 0;
      const normalizedStatus = session.status?.toLowerCase();
      if (normalizedStatus === 'completed') {
        acc.validatedHours += session.duration || 0;
        acc.validatedAmount += session.amount || 0;
      } else if (normalizedStatus === 'pending') {
        acc.pendingHours += session.duration || 0;
      }
      return acc;
    }, { totalHours: 0, validatedHours: 0, pendingHours: 0, totalAmount: 0, validatedAmount: 0 });
  }, [filteredSessions]);

  const selectedSummary = useMemo(() => {
    let count = 0;
    let hours = 0;
    let amount = 0;
    for (const session of filteredSessions) {
      if (!selectedIds.has(session.id)) continue;
      count += 1;
      hours += session.duration || 0;
      amount += session.amount || 0;
    }
    return { count, hours, amount };
  }, [filteredSessions, selectedIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-gradient-to-r from-slate-900/90 to-slate-800/80 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Validation des Heures Enseignées</h1>
          <p className="mt-1 text-sm text-slate-300">
            Contrôlez et validez les séances soumises par les enseignants avant le calcul des paiements.
          </p>
        </div>
        <Button variant="outline" onClick={fetchSessions} disabled={fetching} className="bg-white/10 text-white hover:bg-white/20">
          <RefreshCcw className={`w-4 h-4 mr-2 ${fetching ? 'animate-spin' : ''}`} /> 
          Rafraîchir
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredSessions.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Période filtrée</p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Heures</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.totalHours}h</div>
            <p className="text-xs text-muted-foreground mt-1">{formatAmount(totals.totalAmount)}</p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Attente</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{totals.pendingHours}h</div>
            <p className="text-xs text-muted-foreground mt-1">
              {filteredSessions.filter(s => s.status?.toLowerCase() === 'pending').length} session(s)
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Validées</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totals.validatedHours}h</div>
            <p className="text-xs text-muted-foreground mt-1">
              {filteredSessions.filter(s => s.status?.toLowerCase() === 'completed').length} session(s)
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>Choisissez les critères pour lister les sessions d'heures enseignées.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <Label className="mb-1.5 block">Enseignant</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger><SelectValue placeholder="Tous" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous</SelectItem>
                  {teachers.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Du</Label>
              <DatePickerFr value={fromDate} onChange={(iso) => setFromDate(iso)} />
            </div>
            <div>
              <Label className="mb-1.5 block">Au</Label>
              <DatePickerFr value={toDate} onChange={(iso) => setToDate(iso)} />
            </div>
            <div>
              <Label className="mb-1.5 block">Statut</Label>
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="pending">En attente</SelectItem>
                  <SelectItem value="completed">Validées</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setTeacherId("ALL");
                setFromDate("");
                setToDate("");
                setStatusFilter("all");
              }}
              disabled={fetching}
            >
              Réinitialiser
            </Button>
            <Button onClick={fetchSessions} disabled={fetching}>
              {fetching ? "Chargement..." : "Appliquer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Sessions d'Heures Enseignées</CardTitle>
          <CardDescription>Sélectionnez les sessions à valider</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-lg border border-border/70 bg-muted/30 p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-foreground">
              <Users className="w-4 h-4" /> {filteredSessions.length} session(s)
              <Badge variant="secondary" className="ml-2">
                Sélection: {selectedSummary.count} | {selectedSummary.hours}h | {formatAmount(selectedSummary.amount)}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="select-all" 
                checked={(() => {
                  const selectableSessions = filteredSessions.filter(s => isSelectable(s.status));
                  return selectedIds.size === selectableSessions.length && selectableSessions.length > 0;
                })()} 
                onCheckedChange={(v) => toggleAll(Boolean(v))}
                className="cursor-pointer"
              />
              <Label htmlFor="select-all" className="text-sm text-muted-foreground">
                Tout sélectionner (en attente / brouillon)
              </Label>
            </div>
          </div>

          <div className="overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b bg-muted/50">
                  <th className="py-3 px-3"></th>
                  <th className="py-3 pr-3">Date</th>
                  <th className="py-3 pr-3">Enseignant</th>
                  <th className="py-3 pr-3">Cours</th>
                  <th className="py-3 pr-3">Classe</th>
                  <th className="py-3 pr-3">Titre de la séance</th>
                  <th className="py-3 pr-3">Horaires</th>
                  <th className="py-3 pr-3">Durée</th>
                  <th className="py-3 pr-3">Montant</th>
                  <th className="py-3 pr-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => {
                  // Check if session is selectable (pending or draft)
                  const isSelectableSession = isSelectable(session.status);
                  const isSelected = selectedIds.has(session.id);
                  
                  return (
                    <tr 
                      key={session.id} 
                      className={`border-b hover:bg-muted/40 ${
                        session.status?.toLowerCase() === 'completed' ? 'bg-green-500/5' : ''
                      }`}
                    >
                      <td className="py-3 px-3" onClick={(e) => {
                        // Allow clicking the cell to toggle checkbox if selectable
                        if (isSelectableSession) {
                          e.stopPropagation();
                          toggleOne(session.id, !isSelected);
                        }
                      }}>
                        <Checkbox
                          id={`checkbox-${session.id}`}
                          checked={isSelected}
                          onCheckedChange={(v) => {
                            toggleOne(session.id, Boolean(v));
                          }}
                          disabled={!isSelectableSession}
                          className={!isSelectableSession ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                        />
                      </td>
                      <td className="py-3 pr-3 text-foreground">{formatDate(session.date)}</td>
                      <td className="py-3 pr-3 text-foreground">
                        {session.teacherName || 'Enseignant'}
                      </td>
                      <td className="py-3 pr-3 text-foreground">
                        {session.courseName} ({session.courseCode})
                      </td>
                      <td className="py-3 pr-3 text-foreground">{session.className}</td>
                      <td className="py-3 pr-3 text-foreground">{session.sessionTitle}</td>
                      <td className="py-3 pr-3 text-foreground">
                        {session.startTime && session.endTime 
                          ? `${session.startTime} - ${session.endTime}`
                          : session.timeSlot
                        }
                      </td>
                      <td className="py-3 pr-3 text-foreground font-medium">{session.duration}h</td>
                      <td className="py-3 pr-3 text-foreground font-medium">{formatAmount(session.amount)}</td>
                      <td className="py-3 pr-3">{getStatusBadge(session.status)}</td>
                    </tr>
                  );
                })}
                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-muted-foreground">
                      Aucune session trouvée avec les filtres sélectionnés
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button 
              onClick={handleValidate} 
              disabled={submitting || selectedIds.size === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {submitting ? (
                <>
                  <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
                  Traitement...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Valider les sessions sélectionnées ({selectedIds.size})
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
