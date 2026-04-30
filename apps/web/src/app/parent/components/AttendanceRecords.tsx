'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, AlertCircle, CheckCircle2, XCircle, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { AttendanceRecord } from '@/lib/hooks/use-parent-children';

interface AttendanceRecordsProps {
  attendanceRecords: AttendanceRecord[] | null;
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasMore: boolean;
  } | null;
  isLoading?: boolean;
  error?: Error | null;
  onPageChange?: (page: number) => void;
}

export function AttendanceRecords({ 
  attendanceRecords, 
  pagination, 
  isLoading, 
  error,
  onPageChange 
}: AttendanceRecordsProps) {

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

  // Format time (HH:MM)
  const formatTime = (time: string) => {
    if (!time) return '';
    // Handle both HH:MM:SS and HH:MM formats
    return time.substring(0, 5);
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'present':
        return <Badge className="bg-green-100 text-green-800">Présent</Badge>;
      case 'absent':
        return <Badge className="bg-red-100 text-red-800">Absent</Badge>;
      case 'late':
        return <Badge className="bg-yellow-100 text-yellow-800">En retard</Badge>;
      case 'excused':
        return <Badge className="bg-blue-100 text-blue-800">Excusé</Badge>;
      case 'medical_leave':
        return <Badge className="bg-purple-100 text-purple-800">Congé médical</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'present':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'absent':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'late':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'excused':
        return <FileText className="h-5 w-5 text-blue-600" />;
      case 'medical_leave':
        return <FileText className="h-5 w-5 text-purple-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
    }
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (onPageChange) {
      onPageChange(newPage);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Historique de Présence
          </CardTitle>
          <CardDescription>
            Enregistrements de présence avec pagination (20 par page)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement de l'historique de présence">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
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
            <Calendar className="h-5 w-5 text-emerald-600" />
            Historique de Présence
          </CardTitle>
          <CardDescription>
            Enregistrements de présence avec pagination (20 par page)
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

  // Empty state
  if (!attendanceRecords || attendanceRecords.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Historique de Présence
          </CardTitle>
          <CardDescription>
            Enregistrements de présence avec pagination (20 par page)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Calendar className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun enregistrement</h3>
            <p className="text-gray-600">
              Aucun enregistrement de présence n'est disponible pour le moment.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-emerald-600" />
          Historique de Présence
        </CardTitle>
        <CardDescription>
          {pagination && (
            <span>
              {pagination.total} enregistrement{pagination.total !== 1 ? 's' : ''} au total
              {pagination.pages > 1 && ` - Page ${pagination.page} sur ${pagination.pages}`}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Attendance Records List */}
          <div className="space-y-3">
            {attendanceRecords.map((record) => (
              <div
                key={record.id}
                className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Date and Status */}
                    <div className="flex items-center gap-3 mb-2">
                      <Calendar className="h-4 w-4 text-gray-600" />
                      <span className="text-sm font-semibold text-gray-700">
                        {formatDate(record.date)}
                      </span>
                      {getStatusBadge(record.status)}
                    </div>

                    {/* Course Name */}
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(record.status)}
                      <h4 className="text-lg font-semibold text-gray-900">
                        {record.courseName}
                      </h4>
                      {record.courseCode && (
                        <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                          {record.courseCode}
                        </Badge>
                      )}
                    </div>

                    {/* Additional Information */}
                    <div className="space-y-1 mt-3">
                      {/* Arrival Time (if late) */}
                      {record.status === 'late' && record.arrivalTime && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Clock className="h-4 w-4 text-yellow-600" />
                          <span>Heure d'arrivée : {formatTime(record.arrivalTime)}</span>
                        </div>
                      )}

                      {/* Excuse Reason (if excused or medical leave) */}
                      {(record.status === 'excused' || record.status === 'medical_leave') && record.excuseReason && (
                        <div className="flex items-start gap-2 text-sm text-gray-700">
                          <FileText className="h-4 w-4 text-blue-600 mt-0.5" />
                          <span>
                            <span className="font-medium">Raison :</span> {record.excuseReason}
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      {record.notes && (
                        <div className="flex items-start gap-2 text-sm text-gray-600">
                          <FileText className="h-4 w-4 text-gray-500 mt-0.5" />
                          <span>{record.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Page {pagination.page} sur {pagination.pages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="flex items-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasMore}
                  className="flex items-center gap-2"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

