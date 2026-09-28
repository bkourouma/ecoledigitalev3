"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Badge } from "@ecoledigitale/ui";
import { ArrowLeft, Filter, Search, Download, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useAssignment, useSubmissions, useAutoGradeSubmission, type SubmissionsQuery } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import SubmissionsList from "@/components/evaluations/SubmissionsList";

export default function GradingPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  const [filters, setFilters] = useState<SubmissionsQuery>({
    status: "",
    page: 1,
    limit: 20,
  });

  const [searchTerm, setSearchTerm] = useState("");

  const { data: assignment } = useAssignment(assignmentId);
  const { data: submissionsData, isLoading, error } = useSubmissions(assignmentId, filters);
  const autoGradeMutation = useAutoGradeSubmission();

  const submissions = submissionsData?.submissions || [];

  const handleFilterChange = (key: keyof SubmissionsQuery, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value === "" || value === "all" ? undefined : value, page: 1 }));
  };

  const handleAutoGradeAll = async () => {
    if (!confirm("Êtes-vous sûr de vouloir corriger automatiquement toutes les évaluations soumises ?")) {
      return;
    }

    const submittedEvaluations = submissions.filter(
      s => s.status === 'submitted' && assignment?.type === 'evaluation'
    );

    for (const submission of submittedEvaluations) {
      try {
        await autoGradeMutation.mutateAsync({
          assignmentId,
          submissionId: submission.id,
        });
      } catch (error) {
        console.error(`Failed to auto-grade submission ${submission.id}:`, error);
      }
    }
  };

  const getStatusStats = () => {
    const total = submissions.length;
    const inProgress = submissions.filter(s => s.status === 'in_progress').length;
    const submitted = submissions.filter(s => s.status === 'submitted').length;
    const graded = submissions.filter(s => s.status === 'graded').length;

    return { total, inProgress, submitted, graded };
  };

  const stats = getStatusStats();

  if (!assignment) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href={`/academic/evaluations/${assignmentId}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Chargement...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href={`/academic/evaluations/${assignmentId}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Erreur</h2>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              Erreur lors du chargement: {String(error)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href={`/academic/evaluations/${assignmentId}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold leading-tight text-2xl md:text-3xl">Correction - {assignment.title}</h2>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              Gérez la correction et la notation des soumissions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {assignment.type === 'evaluation' && stats.submitted > 0 && (
            <Button 
              onClick={handleAutoGradeAll}
              disabled={autoGradeMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Correction automatique
            </Button>
          )}
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-medium text-sm">{stats.total}</span>
              </div>
              <div>
                <p className="text-sm font-medium">Total</p>
                <p className="text-xs text-muted-foreground">Soumissions</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              <div>
                <p className="text-sm font-medium">{stats.inProgress}</p>
                <p className="text-xs text-muted-foreground">En cours</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <div>
                <p className="text-sm font-medium">{stats.submitted}</p>
                <p className="text-xs text-muted-foreground">À corriger</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-sm font-medium">{stats.graded}</p>
                <p className="text-xs text-muted-foreground">Corrigé</p>
              </div>
            </div>
          </CardContent>
        </Card>
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
              <label className="text-sm font-medium">Recherche étudiant</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nom ou email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Statut</label>
              <Select value={filters.status || "all"} onValueChange={(value) => handleFilterChange("status", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="in_progress">En cours</SelectItem>
                  <SelectItem value="submitted">Soumis</SelectItem>
                  <SelectItem value="graded">Corrigé</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Affichage</label>
              <Select 
                value={filters.limit?.toString() || "20"} 
                onValueChange={(value) => handleFilterChange("limit", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 par page</SelectItem>
                  <SelectItem value="20">20 par page</SelectItem>
                  <SelectItem value="50">50 par page</SelectItem>
                  <SelectItem value="100">100 par page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions List */}
      <div>
        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p>Chargement des soumissions...</p>
            </CardContent>
          </Card>
        ) : (
          <SubmissionsList 
            assignmentId={assignmentId} 
            submissions={submissions}
            showActions={true}
          />
        )}
      </div>

      {/* Pagination */}
      {submissionsData && submissionsData.total > submissionsData.limit && (
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                Affichage de {submissions.length} sur {submissionsData.total} soumissions
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page === 1}
                  onClick={() => handleFilterChange("page", String((filters.page || 1) - 1))}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={submissions.length < (filters.limit || 20)}
                  onClick={() => handleFilterChange("page", String((filters.page || 1) + 1))}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
