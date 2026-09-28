"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Plus, Filter, Search, Calendar, Clock, FileText, Users, Settings, Trash2, Eye } from "lucide-react";
import { useState } from "react";
import { useAssignments, useDeleteAssignment, type Assignment } from "@/lib/hooks/use-evaluations";
import { useCourses } from "@/lib/hooks/use-courses";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export default function EvaluationsPage() {
  const [filters, setFilters] = useState({
    type: "",
    status: "",
    course_id: "",
    search: "",
  });

  const { data, isLoading, error } = useAssignments({
    page: 1,
    limit: 20,
    ...filters,
  });

  const { data: coursesData } = useCourses({});
  const deleteAssignmentMutation = useDeleteAssignment();

  const assignments = data?.assignments || [];
  const courses = coursesData?.data || [];

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value === "all" ? "" : value }));
  };

  const handleDelete = async (assignment: Assignment) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${assignment.title}" ?`)) {
      return;
    }

    try {
      await deleteAssignmentMutation.mutateAsync(assignment.id);
    } catch (error) {
      alert('Erreur lors de la suppression: ' + String(error));
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: "secondary",
      published: "default",
      archived: "outline"
    } as const;

    const labels = {
      draft: "Brouillon",
      published: "Publié",
      archived: "Archivé"
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
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

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Évaluations et Devoirs</h2>
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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h2 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Évaluations et Devoirs</h2>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Gérez vos évaluations en ligne et devoirs PDF
          </p>
        </div>
        <Link href="/academic/evaluations/create">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle évaluation
          </Button>
        </Link>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Titre ou description..."
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
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="published">Publié</SelectItem>
                  <SelectItem value="archived">Archivé</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cours</label>
              <Select value={filters.course_id || "all"} onValueChange={(value) => handleFilterChange("course_id", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les cours" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les cours</SelectItem>
                  {courses.map((course: any) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name} ({course.code})
                    </SelectItem>
                  ))}
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
              <p className="text-muted-foreground mb-4">
                Commencez par créer votre première évaluation ou devoir.
              </p>
              <Link href="/academic/evaluations/create">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Créer une évaluation
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          assignments.map((assignment) => (
            <Card key={assignment.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{assignment.title}</CardTitle>
                      {getTypeBadge(assignment.type)}
                      {getStatusBadge(assignment.status)}
                    </div>
                    <CardDescription>
                      {assignment.description || "Aucune description"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/academic/evaluations/${assignment.id}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleDelete(assignment)}
                      disabled={deleteAssignmentMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{assignment.course_title} ({assignment.course_code})</span>
                  </div>
                  
                  {assignment.type === 'evaluation' && assignment.duration_minutes && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{assignment.duration_minutes} minutes</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Échéance: {formatDistanceToNow(new Date(assignment.ends_at), { 
                        addSuffix: true, 
                        locale: fr 
                      })}
                    </span>
                  </div>
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
                    <span>Taille max: {assignment.max_file_size_mb}MB</span>
                    <span>Retard autorisé: {assignment.late_submission_allowed ? 'Oui' : 'Non'}</span>
                    {assignment.late_submission_allowed && assignment.late_penalty_percent > 0 && (
                      <span>Pénalité: {assignment.late_penalty_percent}%</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
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
