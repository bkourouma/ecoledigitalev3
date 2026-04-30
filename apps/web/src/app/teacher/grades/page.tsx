"use client";

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Award,
  BookOpen,
  Users,
  Save,
  Download,
  Upload,
  Calculator,
  Eye,
  Edit,
  Check,
  X,
  Plus,
  Loader2
} from 'lucide-react';
import { useTeacherAssignments, useTeacherAssignmentStudents } from '@/lib/hooks/use-teachers';

export default function GradesPage() {
  const { data: session, status } = useSession();
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedAssignment, setSelectedAssignment] = useState('');
  const [editingGrade, setEditingGrade] = useState<number | null>(null);
  const [grades, setGrades] = useState<{[key: number]: number | string}>({});

  // Fetch real data
  const { data: assignments = [], isLoading: assignmentsLoading } = useTeacherAssignments();
  const { data: students = [], isLoading: studentsLoading } = useTeacherAssignmentStudents(selectedCourse);

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

  // Process real data
  const courses = useMemo(() => {
    return assignments.map((assignment: any) => ({
      id: assignment.id,
      name: assignment.courseName,
      class: assignment.className
    }));
  }, [assignments]);

  const assignmentTypes = [
    { id: 'ctrl1', name: 'Contrôle 1 - Fonctions', totalPoints: 20, type: 'Contrôle' },
    { id: 'td1', name: 'TD 1 - Exercices', totalPoints: 10, type: 'TD' },
    { id: 'exam1', name: 'Examen Partiel', totalPoints: 40, type: 'Examen' },
    { id: 'proj1', name: 'Projet de Groupe', totalPoints: 30, type: 'Projet' }
  ];

  // Transform students data
  const transformedStudents = useMemo(() => {
    return students.map((student: any) => ({
      id: student.id,
      firstName: student.first_name || student.firstName,
      lastName: student.last_name || student.lastName,
      matricule: student.matricule,
      email: student.email,
      currentGrade: student.currentGrade || null,
      hasSubmitted: student.hasSubmitted || false,
      submissionDate: student.submissionDate || null
    }));
  }, [students]);

  const selectedCourseData = courses.find(c => c.id === selectedCourse);
  const selectedAssignmentData = assignmentTypes.find(a => a.id === selectedAssignment);

  const handleGradeChange = (studentId: number, value: string) => {
    setGrades(prev => ({
      ...prev,
      [studentId]: value
    }));
  };

  const handleSaveGrade = (studentId: number) => {
    const grade = grades[studentId];
    if (grade !== undefined && grade !== '') {
      // Here you would save to your API
      console.log(`Saving grade ${grade} for student ${studentId}`);
      setEditingGrade(null);
    }
  };

  const handleSaveAllGrades = () => {
    console.log('Saving all grades:', grades);
    alert('Toutes les notes ont été sauvegardées !');
  };

  const calculateStatistics = () => {
    const validGrades = transformedStudents
      .map(s => s.currentGrade || grades[s.id])
      .filter(g => g !== null && g !== undefined && g !== '')
      .map(g => Number(g));

    if (validGrades.length === 0) return { average: 0, min: 0, max: 0, count: 0 };

    return {
      average: validGrades.reduce((sum, grade) => sum + grade, 0) / validGrades.length,
      min: Math.min(...validGrades),
      max: Math.max(...validGrades),
      count: validGrades.length
    };
  };

  const stats = calculateStatistics();

  // Loading state
  if (assignmentsLoading || studentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-pink-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Chargement des données...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                Saisie des Notes
              </h1>
              <p className="text-gray-600 mt-2">
                Gérez et saisissez les notes de vos étudiants
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button className="flex items-center space-x-2 px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50">
                <Upload className="w-4 h-4" />
                <span>Importer</span>
              </button>
              <button className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                <Download className="w-4 h-4" />
                <span>Exporter</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Course and Assignment Selection */}
        <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sélection du Cours et de l'Évaluation</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cours *
              </label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">Sélectionner un cours</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name} ({course.class})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Évaluation *
              </label>
              <select
                value={selectedAssignment}
                onChange={(e) => setSelectedAssignment(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={!selectedCourse}
              >
                <option value="">Sélectionner une évaluation</option>
                {assignmentTypes.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.name} ({assignment.totalPoints} pts)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {selectedCourse && selectedAssignment && (
          <>
            {/* Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Moyenne</p>
                    <p className="text-2xl font-bold text-purple-600">{stats.average.toFixed(1)}</p>
                  </div>
                  <div className="bg-purple-100 p-3 rounded-lg">
                    <Calculator className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Note Min</p>
                    <p className="text-2xl font-bold text-red-600">{stats.min}</p>
                  </div>
                  <div className="bg-red-100 p-3 rounded-lg">
                    <Award className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Note Max</p>
                    <p className="text-2xl font-bold text-green-600">{stats.max}</p>
                  </div>
                  <div className="bg-green-100 p-3 rounded-lg">
                    <Award className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Notés</p>
                    <p className="text-2xl font-bold text-blue-600">{stats.count}/{students.length}</p>
                  </div>
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <Users className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Grades Table */}
            <div className="bg-white rounded-xl shadow-sm border border-purple-100">
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {selectedAssignmentData?.name}
                    </h2>
                    <p className="text-gray-600 mt-1">
                      {selectedCourseData?.name} • Total: {selectedAssignmentData?.totalPoints} points
                    </p>
                  </div>
                  <button
                    onClick={handleSaveAllGrades}
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    <Save className="w-4 h-4" />
                    <span>Sauvegarder tout</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Étudiant
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Statut
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Note (/{selectedAssignmentData?.totalPoints})
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transformedStudents.map((student) => {
                      const currentGrade = grades[student.id] !== undefined ? grades[student.id] : student.currentGrade;
                      const isEditing = editingGrade === student.id;

                      return (
                        <tr key={student.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {student.firstName} {student.lastName}
                              </div>
                              <div className="text-sm text-gray-500">{student.matricule}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {student.hasSubmitted ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                                Rendu
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                                Non rendu
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {isEditing ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type="number"
                                  min="0"
                                  max={selectedAssignmentData?.totalPoints}
                                  step="0.5"
                                  value={grades[student.id] || ''}
                                  onChange={(e) => handleGradeChange(student.id, e.target.value)}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveGrade(student.id)}
                                  className="p-1 text-green-600 hover:text-green-800"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setEditingGrade(null)}
                                  className="p-1 text-red-600 hover:text-red-800"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <span className={`text-sm font-medium ${
                                  currentGrade !== null && currentGrade !== undefined && currentGrade !== ''
                                    ? 'text-gray-900'
                                    : 'text-gray-400'
                                }`}>
                                  {currentGrade !== null && currentGrade !== undefined && currentGrade !== ''
                                    ? `${currentGrade}/${selectedAssignmentData?.totalPoints}`
                                    : 'Non noté'
                                  }
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex items-center space-x-2">
                              {!isEditing && (
                                <button
                                  onClick={() => setEditingGrade(student.id)}
                                  className="text-purple-600 hover:text-purple-900"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                              )}
                              {student.hasSubmitted && (
                                <button className="text-blue-600 hover:text-blue-900">
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {(!selectedCourse || !selectedAssignment) && (
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-12 text-center">
            <Award className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Sélectionnez un cours et une évaluation</h3>
            <p className="text-gray-600">
              Choisissez d'abord un cours et une évaluation pour commencer la saisie des notes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
