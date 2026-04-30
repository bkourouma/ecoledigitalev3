"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Clock, Calendar, FileText, Play, CheckCircle, AlertCircle, Search, Filter } from "lucide-react";
import { useState } from "react";
import { useStudentAssignments, type Assignment } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { formatDistanceToNow, format, isAfter, isBefore } from "date-fns";
import { fr } from "date-fns/locale";

export default function StudentEvaluationsPage() {
  const [filters, setFilters] = useState({
    type: "",
    status: "",
    search: "",
  });

  const { data, isLoading, error } = useStudentAssignments({
    page: 1,
    limit: 20,
    ...filters,
  });

  const assignments = data?.assignments || [];

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value === "all" ? "" : value }));
  };

  const getAssignmentStatus = (assignment: Assignment) => {
    const now = new Date();
    const startsAt = assignment.starts_at ? new Date(assignment.starts_at) : null;
    const endsAt = new Date(assignment.ends_at);

    if (assignment.status !== 'published') {
      return { status: 'unavailable', label: 'Non disponible', color: 'secondary' };
    }

    if (startsAt && isBefore(now, startsAt)) {
      return { status: 'upcoming', label: 'À venir', color: 'outline' };
    }

    if (isAfter(now, endsAt)) {
      return { status: 'expired', label: 'Expiré', color: 'destructive' };
    }

    return { status: 'available', label: 'Disponible', color: 'default' };
  };

  const getTypeBadge = (type: string) => {
    const variants = {
      evaluation: "default",
      homework: "secondary"
    } as const;

    const labels = {
      evaluation: "Évaluation",
      homework: "Devoir"
    };

    return (
      <Badge variant={variants[type as keyof typeof variants] || "default"}>
        {labels[type as keyof typeof labels] || type}
      </Badge>
    );
  };

  const getStatusBadge = (assignment: Assignment) => {
    const { status, label, color } = getAssignmentStatus(assignment);
    return (
      <Badge variant={color as any}>
        {label}
      </Badge>
    );
  };

  const canTakeAssignment = (assignment: Assignment) => {
    const { status } = getAssignmentStatus(assignment);
    return status === 'available';
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Mes Évaluations</h2>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-red-600">Erreur lors du chargement: {String(error)}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Mes Évaluations</h2>
          <p className="text-muted-foreground">
            Consultez et réalisez vos évaluations et devoirs
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtres
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Titre ou cours..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={filters.type || "all"} onValueChange={(value) => handleFilterChange("type", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="evaluation">Évaluations</SelectItem>
                  <SelectItem value="homework">Devoirs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Statut</label>
              <Select value={filters.status || "all"} onValueChange={(value) => handleFilterChange("status", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="available">Disponible</SelectItem>
                  <SelectItem value="upcoming">À venir</SelectItem>
                  <SelectItem value="expired">Expiré</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Assignments List */}
      <div className="grid gap-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p>Chargement...</p>
            </CardContent>
          </Card>
        ) : assignments.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Aucune évaluation trouvée</h3>
              <p className="text-muted-foreground">
                Aucune évaluation n'est disponible pour le moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          assignments.map((assignment) => {
            const canTake = canTakeAssignment(assignment);
            const { status } = getAssignmentStatus(assignment);
            
            return (
              <Card key={assignment.id} className={`hover:shadow-md transition-shadow ${!canTake ? 'opacity-75' : ''}`}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{assignment.title}</CardTitle>
                        {getTypeBadge(assignment.type)}
                        {getStatusBadge(assignment)}
                      </div>
                      <CardDescription>
                        {assignment.description || "Aucune description"}
                      </CardDescription>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>{assignment.course_title} ({assignment.course_code})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canTake ? (
                        <Link href={`/evaluations/${assignment.id}`}>
                          <Button>
                            <Play className="h-4 w-4 mr-2" />
                            {assignment.type === 'evaluation' ? 'Commencer' : 'Voir le sujet'}
                          </Button>
                        </Link>
                      ) : (
                        <Button disabled>
                          {status === 'upcoming' ? 'Pas encore disponible' :
                           status === 'expired' ? 'Expiré' :
                           'Non disponible'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Échéance</p>
                        <p className="text-muted-foreground">
                          {format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(assignment.ends_at), { addSuffix: true, locale: fr })}
                        </p>
                      </div>
                    </div>
                    
                    {assignment.type === 'evaluation' && assignment.duration_minutes && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Durée</p>
                          <p className="text-muted-foreground">{assignment.duration_minutes} minutes</p>
                        </div>
                      </div>
                    )}

                    {assignment.starts_at && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Début</p>
                          <p className="text-muted-foreground">
                            {format(new Date(assignment.starts_at), "PPP à HH:mm", { locale: fr })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {assignment.type === 'evaluation' && (
                    <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Tentatives: {assignment.max_attempts}</span>
                      <span>Questions mélangées: {assignment.shuffle_questions ? 'Oui' : 'Non'}</span>
                      <span>Résultats: {
                        assignment.show_results_mode === 'immediate' ? 'Immédiat' :
                        assignment.show_results_mode === 'after_end' ? 'Après la fin' :
                        'Après correction'
                      }</span>
                    </div>
                  )}

                  {assignment.type === 'homework' && (
                    <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Format: PDF</span>
                      <span>Taille max: {assignment.max_file_size_mb}MB</span>
                      <span>Retard autorisé: {assignment.late_submission_allowed ? 'Oui' : 'Non'}</span>
                      {assignment.late_submission_allowed && assignment.late_penalty_percent > 0 && (
                        <span>Pénalité: {assignment.late_penalty_percent}%</span>
                      )}
                    </div>
                  )}

                  {/* Progress indicator for submitted assignments */}
                  {/* TODO: Add submission status when we have the data */}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {data && data.total > data.limit && (
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                Affichage de {assignments.length} sur {data.total} évaluations
              </p>
              {/* TODO: Add pagination controls */}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
