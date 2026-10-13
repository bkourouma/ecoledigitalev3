"use client";

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  BookOpen,
  FileText,
  Video,
  Image,
  Download,
  Upload,
  Plus,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  Share2,
  Calendar,
  Users,
  Tag,
  Folder,
  Grid,
  List,
  MoreVertical,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useTeacherMaterials, formatFileSize, getFileTypeCategory, useMaterialDownload } from '@/lib/hooks/use-materials';
import { useTeacherAssignments } from '@/lib/hooks/use-teacher-assignments';
import UploadMaterialModal from '@/components/UploadMaterialModal';
import { AntSelect } from "@/platform/ui/FormField";

export default function TeacherContentPage() {
  const { data: session, status } = useSession();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // ID de l'utilisateur connecté (utilisé côté API comme teacherId)
  const teacherId = (session as any)?.user?.id as string | undefined;

  // Logs de debug pour la session
  console.log('🔍 TeacherContentPage - Session debug:', {
    status,
    hasSession: !!session,
    hasUser: !!session?.user,
    userId: session?.user?.id,
    teacherId,
    userRoles: (session as any)?.roles,
    tenantSlug: (session as any)?.tenantSlug
  });

  // Fetch teacher materials with filters
  const {
    data: materialsData,
    isLoading,
    error,
    refetch
  } = useTeacherMaterials(teacherId, {
    search: searchQuery || undefined,
    fileType: selectedType !== 'all' ? selectedType : undefined,
    page: currentPage,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  // Logs de debug pour les matériaux
  console.log('📚 TeacherContentPage - Materials debug:', {
    teacherId,
    isLoading,
    hasError: !!error,
    errorMessage: error?.message,
    materialsData,
    materialsCount: materialsData?.data?.length || 0,
    pagination: materialsData?.pagination
  });

  // Fetch teacher assignments to get available courses (optional - modal will fetch its own courses)
  const { data: assignmentsData } = useTeacherAssignments({
    status: "active"
  });

  const downloadMutation = useMaterialDownload();

  // Check authentication and roles
  const roles = (session as any)?.roles ?? [];
  const isTeacher = roles.includes('teacher') || roles.includes('admin');

  // Logs de debug pour l'authentification
  console.log('🔐 TeacherContentPage - Auth debug:', {
    status,
    roles,
    isTeacher,
    shouldRedirect: status === 'unauthenticated' || !isTeacher
  });

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !isTeacher) {
    redirect('/');
  }

  // Handle download
  const handleDownload = async (materialId: string, fileName: string, material: any) => {
    // Don't allow download for fake assignment materials
    if (material.fileType === 'assignment' && material.fileSize === 0) {
      console.log('Cannot download assignment placeholder');
      return;
    }

    try {
      const downloadUrl = await downloadMutation.mutateAsync(materialId);

      // Create a temporary link to trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
      // TODO: Show error toast
    }
  };

  // Get materials data
  const materials = materialsData?.data || [];
  const pagination = materialsData?.pagination;

  // Get unique courses for filter
  const uniqueCourses = [...new Set(materials.map(m => m.courseName).filter(Boolean))];

  // Note: Courses are now fetched directly in the UploadMaterialModal component

  // Filter materials by course if selected
  const filteredMaterials = selectedCourse === 'all'
    ? materials
    : materials.filter(m => m.courseName === selectedCourse);

  // Logs de debug pour le rendu
  console.log('🎨 TeacherContentPage - Render debug:', {
    materials,
    filteredMaterials,
    uniqueCourses,
    selectedCourse,
    selectedType,
    searchQuery,
    materialsLength: materials.length,
    filteredLength: filteredMaterials.length
  });

  const getTypeIcon = (fileType: string) => {
    const category = getFileTypeCategory(fileType);
    switch (category) {
      case 'document': return <FileText className="w-5 h-5" />;
      case 'video': return <Video className="w-5 h-5" />;
      case 'image': return <Image className="w-5 h-5" />;
      case 'presentation': return <BookOpen className="w-5 h-5" />;
      default: return <FileText className="w-5 h-5" />;
    }
  };

  const getTypeColor = (fileType: string) => {
    const category = getFileTypeCategory(fileType);
    switch (category) {
      case 'document': return 'text-blue-600 bg-blue-100';
      case 'video': return 'text-red-600 bg-red-100';
      case 'image': return 'text-green-600 bg-green-100';
      case 'presentation': return 'text-purple-600 bg-purple-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'processing': return 'text-yellow-600 bg-yellow-100';
      case 'failed': return 'text-red-600 bg-red-100';
      case 'pending': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  // Loading state
  if (isLoading) {
    console.log('⏳ TeacherContentPage - Loading state');
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin h-12 w-12 text-purple-600 mx-auto" />
          <p className="mt-4 text-gray-600">Chargement des contenus...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    console.log('❌ TeacherContentPage - Error state:', error);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-600 mx-auto" />
          <p className="mt-4 text-gray-600">Erreur lors du chargement des contenus</p>
          <p className="mt-2 text-sm text-red-600">{error.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  console.log('🚀 TeacherContentPage - Rendering main content');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-gray-900 flex items-center whitespace-nowrap text-2xl leading-tight md:text-3xl">
                <BookOpen className="w-8 h-8 text-purple-600 mr-3" />
                Gestion des Contenus
              </h1>
              <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                Gérez vos ressources pédagogiques et partagez-les avec vos étudiants
              </p>
            </div>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter du contenu</span>
            </button>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Rechercher du contenu..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent w-full sm:w-64"
                />
              </div>

              {/* Type Filter */}
              <AntSelect
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setCurrentPage(1); // Reset to first page when filtering
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">Tous les types</option>
                <option value="pdf">PDF</option>
                <option value="doc">Documents Word</option>
                <option value="video">Vidéos</option>
                <option value="image">Images</option>
                <option value="ppt">Présentations</option>
              </AntSelect>

              {/* Course Filter */}
              <AntSelect
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value);
                  setCurrentPage(1); // Reset to first page when filtering
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">Tous les cours</option>
                {uniqueCourses.map((course) => (
                  <option key={course} value={course}>{course}</option>
                ))}
              </AntSelect>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-purple-100 text-purple-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-purple-100 text-purple-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Grid/List */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredMaterials.map((material) => (
              <div key={material.id} className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg ${getTypeColor(material.fileType)}`}>
                      {getTypeIcon(material.fileType)}
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className={`px-2 py-1 rounded-full text-xs ${getStatusColor(material.processingStatus)}`}>
                        {material.processingStatus}
                      </div>
                      <button
                        onClick={() => window.location.href = `/teacher/courses/${material.courseId}`}
                        className="text-gray-400 hover:text-purple-600 transition-colors"
                        title="Voir les détails du cours"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className="text-gray-400 hover:text-gray-600">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
                    {material.title}
                    {material.fileType === 'assignment' && material.fileSize === 0 && (
                      <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        Placeholder
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {material.fileType === 'assignment' && material.fileSize === 0
                      ? 'Affectation d\'enseignement - Aucun material uploadé pour ce cours'
                      : material.fileName
                    }
                  </p>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center text-xs text-gray-500">
                      <BookOpen className="w-3 h-3 mr-1" />
                      {material.courseName}
                    </div>
                    <div className="flex items-center text-xs text-gray-500">
                      <Users className="w-3 h-3 mr-1" />
                      {material.className}
                    </div>
                    <div className="flex items-center text-xs text-gray-500">
                      <Calendar className="w-3 h-3 mr-1" />
                      {new Date(material.createdAt).toLocaleDateString('fr-FR')}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-4">
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                      {material.fileType}
                    </span>
                    <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded">
                      {getFileTypeCategory(material.fileType)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{formatFileSize(material.fileSize)}</span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleDownload(material.id, material.fileName, material)}
                        className={`${material.fileType === 'assignment' && material.fileSize === 0
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-400 hover:text-purple-600'}`}
                        disabled={downloadMutation.isPending || (material.fileType === 'assignment' && material.fileSize === 0)}
                      >
                        {downloadMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                      <button className="text-gray-400 hover:text-purple-600">
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button className="text-gray-400 hover:text-purple-600">
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contenu
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Taille
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredMaterials.map((material) => (
                    <tr key={material.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`p-2 rounded-lg ${getTypeColor(material.fileType)} mr-3`}>
                            {getTypeIcon(material.fileType)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{material.title}</div>
                            <div className="text-sm text-gray-500">{material.fileName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-900">{material.fileType}</span>
                          <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(material.processingStatus)}`}>
                            {material.processingStatus}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{material.courseName}</div>
                        <div className="text-sm text-gray-500">{material.className}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(material.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatFileSize(material.fileSize)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleDownload(material.id, material.fileName, material)}
                            className={`${material.fileType === 'assignment' && material.fileSize === 0
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-purple-600 hover:text-purple-900'}`}
                            disabled={downloadMutation.isPending || (material.fileType === 'assignment' && material.fileSize === 0)}
                          >
                            {downloadMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                          <button className="text-purple-600 hover:text-purple-900">
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button className="text-purple-600 hover:text-purple-900">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {filteredMaterials.length === 0 && (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun contenu trouvé</h3>
            <p className="text-gray-500 mb-4">
              {searchQuery || selectedType !== 'all' || selectedCourse !== 'all'
                ? 'Aucun contenu ne correspond à vos critères de recherche.'
                : 'Commencez par ajouter du contenu pédagogique.'}
            </p>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 mx-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter du contenu</span>
            </button>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-8">
            <div className="text-sm text-gray-700">
              Affichage de {((pagination.page - 1) * pagination.limit) + 1} à{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} sur{' '}
              {pagination.total} résultats
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>

              {/* Page numbers */}
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                const pageNum = Math.max(1, Math.min(pagination.totalPages - 4, currentPage - 2)) + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-2 border rounded-lg text-sm font-medium ${
                      pageNum === currentPage
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(Math.min(pagination.totalPages, currentPage + 1))}
                disabled={currentPage === pagination.totalPages}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        )}

        {/* Upload Modal */}
        <UploadMaterialModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onSuccess={() => {
            // Refresh the materials list
            refetch();
          }}
        />
      </div>
    </div>
  );
}
