"use client";

import React, { useState } from 'react';
import { X, Upload, File, AlertCircle, CheckCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUploadMaterial } from '@/lib/hooks/use-materials';

interface UploadMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  courses?: Array<{
    id: string;
    name: string;
    code?: string;
  }>;
  onSuccess?: () => void;
}

// API function to fetch teacher courses (same as in teacher/courses page)
const fetchTeacherCourses = async () => {
  const response = await fetch('/api/v1/teacher/courses', {
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': 'imhotepacademy',
'X-User-Id': 'd7ea2980-d464-480b-b84c-13ed7df031bb'
    }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch courses');
  }
  return response.json();
};

export default function UploadMaterialModal({ 
  isOpen, 
  onClose, 
  courses: propCourses, 
  onSuccess 
}: UploadMaterialModalProps) {
  const [selectedCourse, setSelectedCourse] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Fetch teacher courses using the same logic as teacher/courses page
  const { data: fetchedCourses = [], isLoading: coursesLoading, error: coursesError } = useQuery({
    queryKey: ['teacher-courses'],
    queryFn: fetchTeacherCourses,
    enabled: isOpen && !propCourses, // Only fetch if modal is open and no courses provided as props
  });

  const uploadMutation = useUploadMaterial();

  // Use prop courses if provided, otherwise use fetched courses
  const courses = propCourses || fetchedCourses;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCourse || !file) {
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title || file.name);
    if (description) {
      formData.append('description', description);
    }

    try {
      await uploadMutation.mutateAsync({ courseId: selectedCourse, formData });
      
      // Reset form
      setSelectedCourse('');
      setTitle('');
      setDescription('');
      setFile(null);
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      if (!title) {
        setTitle(e.dataTransfer.files[0].name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      if (!title) {
        setTitle(e.target.files[0].name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Ajouter un support de cours
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Course Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cours *
            </label>
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white"
              required
              disabled={coursesLoading}
            >
              <option value="">
                {coursesLoading ? 'Chargement des cours...' : 'Sélectionnez un cours'}
              </option>
              {courses.map((course: any) => (
                <option key={course.assignmentId || course.id} value={course.courseId || course.id}>
                  {course.courseCode ? `${course.courseCode} - ${course.courseName}` : course.name}
                  {course.className && ` (${course.className})`}
                </option>
              ))}
            </select>
            {coursesError && (
              <p className="mt-1 text-sm text-red-600">
                Erreur lors du chargement des cours
              </p>
            )}
            {!coursesLoading && courses.length === 0 && (
              <p className="mt-1 text-sm text-gray-500">
                Aucun cours assigné trouvé
              </p>
            )}
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fichier *
            </label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center ${
                dragActive
                  ? 'border-purple-500 bg-purple-50'
                  : file
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="flex items-center justify-center space-x-3">
                  <File className="w-8 h-8 text-green-600" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">
                    Glissez-déposez votre fichier ici ou
                  </p>
                  <label className="inline-block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer">
                    Parcourir les fichiers
                    <input
                      type="file"
                      onChange={handleFileChange}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.mp4,.avi,.mov"
                    />
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    PDF, Word, PowerPoint, Excel, Images, Vidéos (max 100MB)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Titre
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titre du support (optionnel, nom du fichier par défaut)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white placeholder-gray-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description du support (optionnel)"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 bg-white placeholder-gray-500"
            />
          </div>

          {/* Error/Success Messages */}
          {uploadMutation.isError && (
            <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">
                Erreur lors de l'upload: {uploadMutation.error?.message || 'Erreur inconnue'}
              </span>
            </div>
          )}

          {uploadMutation.isSuccess && (
            <div className="flex items-center space-x-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-5 h-5" />
              <span className="text-sm">Fichier uploadé avec succès !</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={uploadMutation.isPending}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!selectedCourse || !file || uploadMutation.isPending}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {uploadMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Upload en cours...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Uploader</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
