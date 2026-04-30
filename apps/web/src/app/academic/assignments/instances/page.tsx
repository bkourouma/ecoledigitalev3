"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Plus,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  Users,
  Calendar,
  Clock,
  BookOpen,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useAssignmentInstances } from "@/lib/hooks/use-assignment-instances";
import { useClasses } from "@/lib/hooks/use-classes";
import { useCourses } from "@/lib/hooks/use-courses";

interface AssignmentInstance {
  id: string;
  assignment_id: string;
  class_id: string;
  teacher_id: string;
  academic_year_id: string;
  starts_at: string | null;
  ends_at: string;
  status: 'draft' | 'active' | 'expired';
  duration_minutes: number | null;
  max_attempts: number | null;
  show_results_mode: string;
  late_submission_allowed: boolean;
  late_penalty_percent: number;
  created_at: string;
  updated_at: string;
  // Relations
  assignment_title?: string;
  assignment_type?: string;
  assignment_description?: string;
  class_name?: string;
  course_name?: string;
  course_code?: string;
  teacher_name?: string;
  submissions_count?: number;
  completed_submissions?: number;
}

export default function AssignmentInstancesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [filters, setFilters] = useState({
    class_id: "",
    status: "",
    search: "",
  });

  // Show success message if redirected from assignment creation
  useEffect(() => {
    if (searchParams.get('success') === 'assigned') {
      setShowSuccessMessage(true);
      // Hide message after 5 seconds
      const timer = setTimeout(() => setShowSuccessMessage(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  const { data: instancesData, isLoading, error } = useAssignmentInstances({
    page: 1,
    limit: 50,
    ...filters,
  });

  const { data: classesData } = useClasses({ includeDetails: false });
  const { data: coursesData } = useCourses({});

  const instances = instancesData?.data || [];
  const classes = classesData?.data || [];
  const courses = coursesData?.data || [];

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value === "all" ? "" : value }));
  };

  const getStatusBadge = (instance: AssignmentInstance) => {
    const now = new Date();
    const endsAt = new Date(instance.ends_at);
    const startsAt = instance.starts_at ? new Date(instance.starts_at) : null;

    if (instance.status === 'draft') {
      return <Badge variant="secondary"><Edit className="h-3 w-3 mr-1" />Brouillon</Badge>;
    }

    if (endsAt < now) {
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Expirée</Badge>;
    }

    if (startsAt && startsAt > now) {
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Programmée</Badge>;
    }

    return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Active</Badge>;
  };

  const getTypeBadge = (type: string) => {
    return type === 'evaluation' ? (
      <Badge variant="default">Évaluation</Badge>
    ) : (
      <Badge variant="secondary">Devoir</Badge>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getProgressInfo = (instance: AssignmentInstance) => {
    const total = instance.submissions_count || 0;
    const completed = instance.completed_submissions || 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return { total, completed, percentage };
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/academic/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">Chargement...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/academic/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-red-600">Erreur</h2>
            <p className="text-muted-foreground">
              Impossible de charger les évaluations assignées
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success Message */}
      {showSuccessMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <h3 className="text-sm font-medium text-green-800">
                Évaluation assignée avec succès !
              </h3>
              <p className="text-sm text-green-700">
                L'évaluation a été assignée à la classe et est maintenant disponible pour les étudiants.
              </p>
            </div>
            <button
              onClick={() => setShowSuccessMessage(false)}
              className="ml-auto text-green-600 hover:text-green-800"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/academic/assignments">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Évaluations Assignées</h2>
          <p className="text-muted-foreground">
            Gérez toutes les évaluations assignées aux classes
          </p>
        </div>
        <Link href="/academic/assignments/assign">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle assignation
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
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
                  placeholder="Titre de l'évaluation..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Classe</label>
              <Select value={filters.class_id} onValueChange={(value) => handleFilterChange('class_id', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes les classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Statut</label>
              <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expirée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button 
                variant="outline" 
                onClick={() => setFilters({ class_id: "", status: "", search: "" })}
                className="w-full"
              >
                Réinitialiser
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{instances.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm text-muted-foreground">Actives</p>
                <p className="text-2xl font-bold">
                  {instances.filter(i => {
                    const now = new Date();
                    const endsAt = new Date(i.ends_at);
                    const startsAt = i.starts_at ? new Date(i.starts_at) : null;
                    return i.status !== 'draft' && endsAt >= now && (!startsAt || startsAt <= now);
                  }).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm text-muted-foreground">Expirées</p>
                <p className="text-2xl font-bold">
                  {instances.filter(i => new Date(i.ends_at) < new Date()).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-gray-600" />
              <div>
                <p className="text-sm text-muted-foreground">Brouillons</p>
                <p className="text-2xl font-bold">
                  {instances.filter(i => i.status === 'draft').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instances List */}
      <div className="grid gap-4">
        {instances.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Aucune évaluation assignée</h3>
              <p className="text-muted-foreground mb-4">
                Commencez par assigner une évaluation à une classe.
              </p>
              <Link href="/academic/assignments/assign">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Assigner une évaluation
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          instances.map((instance) => {
            const progress = getProgressInfo(instance);
            
            return (
              <Card key={instance.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">
                          {instance.assignment_title || 'Titre non disponible'}
                        </CardTitle>
                        {instance.assignment_type && getTypeBadge(instance.assignment_type)}
                        {getStatusBadge(instance)}
                      </div>
                      
                      <CardDescription>
                        {instance.assignment_description || "Aucune description"}
                      </CardDescription>
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          <span>{instance.class_name || 'Classe inconnue'}</span>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <BookOpen className="h-4 w-4" />
                          <span>
                            {instance.course_name || 'Cours inconnu'} 
                            {instance.course_code && ` (${instance.course_code})`}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>Fin: {formatDate(instance.ends_at)}</span>
                        </div>
                        
                        {instance.starts_at && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>Début: {formatDate(instance.starts_at)}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Progress */}
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Progression:</span>
                        <span className="font-medium">
                          {progress.completed}/{progress.total} soumissions ({progress.percentage}%)
                        </span>
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-32">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${progress.percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <Link href={`/academic/evaluations/${instance.assignment_id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                      
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Supprimer l'assignation</DialogTitle>
                            <DialogDescription>
                              Êtes-vous sûr de vouloir supprimer cette assignation ?
                              Cette action est irréversible et supprimera toutes les soumissions associées.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline">Annuler</Button>
                            <Button className="bg-red-600 hover:bg-red-700">
                              Supprimer
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
