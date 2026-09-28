'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Clock, FileText, AlertCircle, BookOpen, ClipboardList, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import AssignmentDownloadUnified from '@/components/assignments/AssignmentDownloadUnified';
import { createApiHeaders } from '@/lib/api-utils';
import { cn } from '@/lib/utils';

interface Assignment {
  id: string;
  assignment_id?: string;
  /** « professionnel » : devoir du Module Professionnel, sans fiche de détail. */
  source?: string;
  title: string;
  description: string;
  course: {
    id: string;
    name: string;
    code: string;
  };
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
  };
  due_date: string;
  submitted_at?: string;
  status: 'pending' | 'submitted' | 'graded' | 'expired';
  priority: 'low' | 'medium' | 'high';
  max_points: number;
  grade?: number;
  submission_type: 'evaluation' | 'homework';
  feedback?: string;
  subject_document_url?: string;
  subject_document_name?: string;
}

type FilterKey = 'all' | 'pending' | 'submitted' | 'graded';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'À faire' },
  { key: 'submitted', label: 'Soumis' },
  { key: 'graded', label: 'Notés' },
];

function priorityBadgeClass(priority: string) {
  switch (priority) {
    case 'high':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200';
    case 'medium':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200';
    case 'low':
      return 'border-border bg-muted/60 text-muted-foreground';
    default:
      return 'border-border bg-muted/60 text-muted-foreground';
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'pending':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200';
    case 'submitted':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
    case 'graded':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200';
    case 'expired':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    default:
      return 'border-border bg-muted/60 text-muted-foreground';
  }
}

export default function StudentAssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const { data: session } = useSession();

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        setLoading(true);
        setError(null);

        const headers = createApiHeaders(session);

        const response = await fetch('/api/v1/student/assignments', {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Erreur ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (data.success && data.data) {
          setAssignments(data.data);
        } else {
          setAssignments([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors du chargement des devoirs');
        setAssignments([]);
      } finally {
        setLoading(false);
      }
    };

    if (session) {
      fetchAssignments();
    }

    const intervalId = setInterval(() => {
      if (session) {
        fetchAssignments();
      }
    }, 30000);

    return () => clearInterval(intervalId);
  }, [session]);

  const counts = useMemo(() => {
    return {
      all: assignments.length,
      pending: assignments.filter((a) => a.status === 'pending').length,
      submitted: assignments.filter((a) => a.status === 'submitted').length,
      graded: assignments.filter((a) => a.status === 'graded').length,
    };
  }, [assignments]);

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'À faire';
      case 'submitted':
        return 'Soumis';
      case 'graded':
        return 'Noté';
      case 'expired':
        return 'Expiré';
      default:
        return status;
    }
  };

  const filteredAssignments = assignments.filter(
    (assignment) => filter === 'all' || assignment.status === filter
  );

  const getDaysUntilDue = (dueDate: string) => {
    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 rounded-xl border border-border bg-card/80 p-6">
            <Skeleton className="mb-2 h-8 w-48 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-md" />
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-24">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h2 className="mb-2 text-xl font-semibold text-foreground">Erreur de chargement</h2>
            <p className="mb-6 text-muted-foreground whitespace-nowrap text-sm md:text-base">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Réessayer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-xl border border-border bg-card/80 p-6 shadow-sm">
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <ClipboardList className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-bold tracking-tight text-foreground whitespace-nowrap text-2xl leading-tight md:text-3xl">Mes devoirs</h1>
                <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                  Consultez les échéances, téléchargez les sujets et accédez à vos soumissions.
                </p>
              </div>
            </div>
            {counts.pending > 0 && (
              <Badge variant="outline" className="w-fit border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200">
                {counts.pending} à rendre
              </Badge>
            )}
          </div>
        </header>

        <div
          className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="Filtrer les devoirs"
        >
          {FILTER_TABS.map(({ key, label }) => {
            const count =
              key === 'all'
                ? counts.all
                : key === 'pending'
                  ? counts.pending
                  : key === 'submitted'
                    ? counts.submitted
                    : counts.graded;
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                    active ? 'bg-muted' : 'bg-muted/50 text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4">
          {filteredAssignments.map((assignment) => {
            const daysUntilDue = getDaysUntilDue(assignment.due_date);
            const isUrgent = daysUntilDue <= 3 && assignment.status === 'pending';

            return (
              <Card
                key={assignment.id}
                className={cn(
                  'border-border transition-colors hover:border-emerald-500/35',
                  isUrgent && 'border-amber-500/50 bg-amber-500/[0.06]'
                )}
              >
                <CardHeader className="pb-2">
                  <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <CardTitle className="text-lg text-foreground sm:text-xl whitespace-nowrap text-2xl leading-tight md:text-3xl">{assignment.title}</CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium text-foreground/90">
                            {assignment.course.code}
                          </span>
                          <span className="hidden sm:inline">·</span>
                          <span>{assignment.course.name}</span>
                        </span>
                        {assignment.instructor && (
                          <span className="text-xs sm:ml-1">
                            {assignment.instructor.first_name} {assignment.instructor.last_name}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className={cn(priorityBadgeClass(assignment.priority))}>
                        {assignment.priority === 'high' && <AlertCircle className="mr-1 h-3 w-3" />}
                        {assignment.priority === 'high'
                          ? 'Urgent'
                          : assignment.priority === 'medium'
                            ? 'Moyen'
                            : 'Faible'}
                      </Badge>
                      <Badge variant="outline" className={cn(statusBadgeClass(assignment.status))}>
                        {getStatusText(assignment.status)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  {assignment.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{assignment.description}</p>
                  ) : null}

                  <div className="flex flex-col gap-4 border-t border-border/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 shrink-0 opacity-80" />
                        {new Date(assignment.due_date).toLocaleDateString('fr-FR', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 shrink-0 opacity-80" />
                        {new Date(assignment.due_date).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-4 w-4 shrink-0 opacity-80" />
                        {assignment.submission_type === 'evaluation'
                          ? 'Évaluation en ligne'
                          : assignment.submission_type === 'homework'
                            ? 'Devoir fichier'
                            : assignment.submission_type}
                      </div>
                      <span className="font-medium text-foreground">{assignment.max_points} pts</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-end">
                      {isUrgent && (
                        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          {daysUntilDue < 0
                            ? 'En retard'
                            : daysUntilDue === 0
                              ? "Aujourd'hui"
                              : daysUntilDue === 1
                                ? 'Demain'
                                : `${daysUntilDue} j.`}
                        </span>
                      )}
                      {assignment.subject_document_url && (
                        <AssignmentDownloadUnified
                          assignmentId={assignment.id}
                          fileUrl={assignment.subject_document_url}
                          fileName={assignment.subject_document_name || `${assignment.title}.pdf`}
                          showFileName
                        />
                      )}
                      {assignment.source === 'professionnel' ? (
                        // Le Module Professionnel n'a pas de fiche de détail
                        // côté étudiant : la note et l'appréciation sont donc
                        // affichées ici, sur la carte.
                        <div className="flex items-center gap-3 text-sm">
                          {assignment.grade != null && (
                            <span className="font-semibold text-foreground">
                              {assignment.grade}/{assignment.max_points}
                            </span>
                          )}
                          {assignment.feedback && (
                            <span className="max-w-xs truncate text-muted-foreground" title={assignment.feedback}>
                              {assignment.feedback}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Button asChild variant="default" className="gap-1">
                          <Link href={`/student/assignments/${assignment.id}`}>
                            {assignment.status === 'pending'
                              ? 'Commencer'
                              : assignment.status === 'submitted'
                                ? 'Voir la soumission'
                                : 'Voir les résultats'}
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredAssignments.length === 0 && (
          <Card className="border-dashed border-border">
            <CardContent className="py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <FileText className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {filter === 'all'
                  ? 'Aucun devoir'
                  : filter === 'pending'
                    ? "Rien à faire pour l'instant"
                    : filter === 'submitted'
                      ? 'Aucune soumission'
                      : 'Aucune note pour l’instant'}
              </h3>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                {filter === 'all'
                  ? "Vous n'avez actuellement aucun devoir assigné."
                  : "Aucun devoir ne correspond à ce filtre. Essayez « Tous » ou un autre onglet."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
