'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock, FileText, AlertCircle, BookOpen, AlertTriangle } from 'lucide-react';
import { ParentAssignment } from '@ecoledigitale/contracts';

interface UpcomingDeadlinesProps {
  deadlines: ParentAssignment[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  onChildChange?: (childId: string | undefined) => void;
}

export function UpcomingDeadlines({ 
  deadlines, 
  isLoading, 
  error,
  children,
  selectedChildId,
  onChildChange
}: UpcomingDeadlinesProps) {
  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Format time remaining
  const formatTimeRemaining = (daysRemaining: number) => {
    if (daysRemaining === 0) {
      return "Aujourd'hui";
    } else if (daysRemaining === 1) {
      return 'Demain';
    } else if (daysRemaining < 7) {
      return `${daysRemaining} jours`;
    } else {
      const weeks = Math.floor(daysRemaining / 7);
      const days = daysRemaining % 7;
      if (days === 0) {
        return `${weeks} semaine${weeks > 1 ? 's' : ''}`;
      } else {
        return `${weeks} semaine${weeks > 1 ? 's' : ''} et ${days} jour${days > 1 ? 's' : ''}`;
      }
    }
  };

  // Get priority badge
  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return (
          <Badge className="bg-red-100 text-red-800 border-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Urgent
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Moyen
          </Badge>
        );
      case 'low':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-300 flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            Faible
          </Badge>
        );
      default:
        return <Badge variant="secondary">{priority}</Badge>;
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-gray-100 text-gray-800">En attente</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800">En cours</Badge>;
      case 'submitted':
        return <Badge className="bg-green-100 text-green-800">Soumis</Badge>;
      case 'graded':
        return <Badge className="bg-purple-100 text-purple-800">Noté</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800">Expiré</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-600" />
            Échéances à Venir
          </CardTitle>
          <CardDescription>
            Liste des devoirs avec échéances dans les 30 prochains jours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des échéances à venir">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-600" />
            Échéances à Venir
          </CardTitle>
          <CardDescription>
            Liste des devoirs avec échéances dans les 30 prochains jours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium">Erreur lors du chargement</p>
            <p className="text-gray-600 text-sm mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600" />
              Échéances à Venir
            </CardTitle>
            <CardDescription>
              Liste des devoirs avec échéances dans les 30 prochains jours
            </CardDescription>
          </div>
          {/* Child Filter */}
          {children && children.length > 0 && (
            <div className="w-full sm:w-auto">
              <Select
                value={selectedChildId || 'all'}
                onValueChange={handleChildChange}
              >
                <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filtrer par enfant">
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={`deadlines-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!deadlines || deadlines.length === 0 ? (
          <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
            <Clock className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune échéance à venir</h3>
            <p className="text-gray-600">
              Aucun devoir avec échéance dans les 30 prochains jours.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {deadlines.map((deadline, index) => (
              <div
                key={`deadline-${index}`}
                className={`border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow ${
                  deadline.priority === 'high'
                    ? 'border-red-300 bg-red-50'
                    : deadline.priority === 'medium'
                    ? 'border-yellow-300 bg-yellow-50'
                    : 'border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Title and Status */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h4 className="text-lg font-semibold text-gray-900">{deadline.title}</h4>
                      {getStatusBadge(deadline.status)}
                      {getPriorityBadge(deadline.priority)}
                    </div>

                    {/* Course and Child Info */}
                    <div className="flex items-center gap-4 mb-2 text-sm text-gray-600 flex-wrap">
                      <div className="flex items-center gap-1">
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        <span>{deadline.courseName}</span>
                        {deadline.courseCode && (
                          <Badge variant="outline" className="text-xs text-purple-600 border-purple-300 ml-1">
                            {deadline.courseCode}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Enfant:</span>
                        <span>{deadline.childName}</span>
                      </div>
                    </div>

                    {/* Description */}
                    {deadline.description && (
                      <p className="text-sm text-gray-700 mb-3 line-clamp-2">
                        {deadline.description}
                      </p>
                    )}

                    {/* Deadline and Countdown */}
                    <div className="flex items-center gap-4 text-sm flex-wrap">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Calendar className="h-4 w-4" aria-hidden="true" />
                        <span className="font-medium">Échéance:</span>
                        <span>{formatDate(deadline.dueDate)}</span>
                      </div>
                      <div className={`flex items-center gap-1 font-medium ${
                        deadline.daysRemaining <= 3
                          ? 'text-red-600'
                          : deadline.daysRemaining <= 7
                          ? 'text-yellow-600'
                          : 'text-green-600'
                      }`}>
                        <Clock className="h-4 w-4" aria-hidden="true" />
                        <span>Dans {formatTimeRemaining(deadline.daysRemaining)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

