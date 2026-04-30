"use client";

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  BookOpen,
  Users,
  Calendar,
  Clock,
  MapPin,
  ArrowRight,
  GraduationCap,
  FileText,
  Loader2,
  DollarSign
} from 'lucide-react';
import { useTeacherAssignments } from '@/lib/hooks/use-teachers';

export default function TeacherAssignmentsPage() {
  const { data: session, status } = useSession();
  const userId = (session as any)?.user?.id as string | undefined;
  const { data: assignmentsData, isLoading: isLoadingAssignments, error } = useTeacherAssignments(userId);

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    redirect('/');
  }

  if (isLoadingAssignments) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-gray-600">Chargement des affectations...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 mb-2">Erreur lors du chargement</div>
          <div className="text-gray-600">{error.message}</div>
        </div>
      </div>
    );
  }

  // Use real data from API
  const assignments = assignmentsData?.data || [];

  // Calculate statistics from real data
  const totalStudents = assignments.reduce((sum: number, assignment: any) => {
    // Get student count from class enrollment or default to 0
    return sum + (assignment.studentCount || assignment.enrollmentCount || 0);
  }, 0);

  const totalCredits = assignments.reduce((sum: number, assignment: any) => {
    return sum + (assignment.credits || assignment.courseCredits || 0);
  }, 0);

  const activeAssignments = assignments.filter((a: any) => a.status === 'active').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                Mes Affectations
              </h1>
              <p className="text-gray-600 mt-2">
                Gestion de vos cours et classes assignées
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-500">Année académique</p>
                <p className="font-semibold text-purple-600">2024-2025</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Cours Actifs</p>
                <p className="text-3xl font-bold text-purple-600">{activeAssignments}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <BookOpen className="w-8 h-8 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Étudiants</p>
                <p className="text-3xl font-bold text-purple-600">{totalStudents}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Users className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Crédits</p>
                <p className="text-3xl font-bold text-purple-600">{totalCredits}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <GraduationCap className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Assignments List */}
        <div className="bg-white rounded-xl shadow-sm border border-purple-100">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Mes Cours Assignés</h2>
            <p className="text-gray-600 mt-1">Liste complète de vos affectations pour cette année académique</p>
          </div>

          <div className="divide-y divide-gray-200">
            {assignments.length > 0 ? assignments.map((assignment: any) => (
              <div key={assignment.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {assignment.courseName || assignment.course?.name || 'Cours non défini'}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        assignment.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {assignment.status === 'active' ? 'Actif' : 'En attente'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <GraduationCap className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {assignment.className || assignment.class?.name || 'Classe non définie'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {assignment.studentCount || assignment.enrollmentCount || 0} étudiants
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {assignment.credits || assignment.courseCredits || 0} crédits
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {assignment.contractType === 'salarie' ? 'Salarié' : 'Vacataire'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-gray-700">Période :</h4>
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>Du {new Date(assignment.datebut).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>Au {new Date(assignment.datefin).toLocaleDateString('fr-FR')}</span>
                        </div>
                        {assignment.courseAmount && (
                          <div className="flex items-center space-x-1">
                            <DollarSign className="w-3 h-3" />
                            <span>{assignment.courseAmount.toLocaleString()} FCFA</span>
                          </div>
                        )}
                      </div>
                      {assignment.notes && (
                        <div className="text-sm text-gray-600 mt-2">
                          <span className="font-medium">Notes :</span> {assignment.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col space-y-2 ml-6">
                    <button className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                      <span>Gérer</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors">
                      <Calendar className="w-4 h-4" />
                      <span>Planning</span>
                    </button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="p-12 text-center">
                <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune affectation</h3>
                <p className="text-gray-600">
                  Vous n'avez aucune affectation de cours pour le moment.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
