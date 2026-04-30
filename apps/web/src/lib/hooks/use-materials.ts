import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface Material {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  minioKey: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  className?: string;
  classCode?: string;
}

export interface MaterialsQuery {
  courseId?: string;
  teacherId?: string;
  fileType?: string;
  processingStatus?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'title' | 'fileSize';
  sortOrder?: 'asc' | 'desc';
}

// Get materials for a specific course
export function useCourseMaterials(courseId: string, query: Omit<MaterialsQuery, 'courseId'> = {}) {
  return useQuery({
    queryKey: ['course-materials', courseId, query],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, value.toString());
        }
      });

      const response = await fetch(`/api/v1/courses/${courseId}/materials?${searchParams}`, {
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch course materials');
      }

      return response.json();
    },
    enabled: !!courseId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get all materials for a teacher (across all their courses)
export function useTeacherMaterials(teacherId?: string, query: MaterialsQuery = {}) {
  return useQuery({
    queryKey: ['teacher-materials', teacherId, query],
    queryFn: async () => {
      // Use the Next.js proxy route instead of direct backend call
      console.log('🔄 Fetching teacher courses from /api/teacher/courses');
      const coursesResponse = await fetch('/api/teacher/courses', {
        headers: {
          'Content-Type': 'application/json',
        }
      });

      console.log('📡 Courses response:', {
        status: coursesResponse.status,
        ok: coursesResponse.ok,
        headers: Object.fromEntries(coursesResponse.headers.entries())
      });

      if (!coursesResponse.ok) {
        const errorText = await coursesResponse.text();
        console.error('❌ Failed to fetch teacher courses:', errorText);
        throw new Error(`Failed to fetch teacher courses: ${coursesResponse.status} ${errorText}`);
      }

      const courses = await coursesResponse.json();
      console.log('🎯 Teacher courses data:', courses);
      console.log('🔍 First course structure:', courses?.[0]);

      // Check if we have valid course data
      const hasValidCourses = courses && courses.length > 0;

      if (!hasValidCourses) {
        console.log('⚠️ No courses found for teacher, returning empty materials');
        return {
          data: [],
          pagination: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0
          }
        };
      }

      // Extract course IDs from the courses data
      const courseIds = [...new Set(courses.map((course: any) => course.courseId).filter(Boolean))];

      console.log('📚 Extracted course IDs:', courseIds);

      if (courseIds.length === 0) {
        return { data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } };
      }

      // Get materials for all courses
      const materialsPromises = courseIds.map(async (courseId: string) => {
        const searchParams = new URLSearchParams();
        
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== '' && key !== 'teacherId') {
            searchParams.append(key, value.toString());
          }
        });

        const response = await fetch(`/api/v1/courses/${courseId}/materials?${searchParams}`, {
          headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        });

        if (!response.ok) {
          console.warn(`Failed to fetch materials for course ${courseId}`);
          return { data: [] };
        }

        const materialsData = await response.json();
        
        // Add course info to each material
        const courseInfo = courses.find((c: any) => c.courseId === courseId);

        return {
          ...materialsData,
          data: materialsData.data?.map((material: Material) => ({
            ...material,
            courseId,
            courseName: courseInfo?.courseName || 'Unknown Course',
            courseCode: courseInfo?.courseCode || '',
            className: courseInfo?.className || '',
            classCode: courseInfo?.classCode || '',
          })) || []
        };
      });

      const results = await Promise.all(materialsPromises);
      
      // Combine all materials
      const allMaterials = results.flatMap(result => result.data || []);
      
      // Apply search filter if provided
      let filteredMaterials = allMaterials;
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        filteredMaterials = allMaterials.filter(material => 
          material.title.toLowerCase().includes(searchLower) ||
          material.fileName.toLowerCase().includes(searchLower) ||
          material.courseName?.toLowerCase().includes(searchLower)
        );
      }

      // Apply file type filter
      if (query.fileType) {
        filteredMaterials = filteredMaterials.filter(material => 
          material.fileType.toLowerCase().includes(query.fileType!.toLowerCase())
        );
      }

      // Apply processing status filter
      if (query.processingStatus) {
        filteredMaterials = filteredMaterials.filter(material => 
          material.processingStatus === query.processingStatus
        );
      }

      // Sort materials
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'desc';
      
      filteredMaterials.sort((a, b) => {
        let aValue: any = a[sortBy as keyof Material];
        let bValue: any = b[sortBy as keyof Material];
        
        if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        }
        
        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      // Apply pagination
      const page = query.page || 1;
      const limit = query.limit || 20;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedMaterials = filteredMaterials.slice(startIndex, endIndex);

      return {
        data: paginatedMaterials,
        pagination: {
          total: filteredMaterials.length,
          page,
          limit,
          totalPages: Math.ceil(filteredMaterials.length / limit)
        }
      };
    },
    enabled: !!teacherId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get material details
export function useMaterial(materialId: string) {
  return useQuery({
    queryKey: ['material', materialId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/courses/materials/${materialId}`, {
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch material');
      }

      return response.json();
    },
    enabled: !!materialId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Get material download URL
export function useMaterialDownload(materialId: string) {
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/v1/courses/materials/${materialId}/content`, {
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Failed to get download URL');
      }

      const data = await response.json();
      return data.downloadUrl;
    },
  });
}

// Upload material to course
export function useUploadMaterial() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ courseId, formData }: { courseId: string; formData: FormData }) => {
      const response = await fetch(`/api/v1/courses/${courseId}/materials`, {
        method: 'POST',
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(error.message || 'Failed to upload material');
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['course-materials', variables.courseId] });
      queryClient.invalidateQueries({ queryKey: ['teacher-materials'] });
    },
  });
}

// Delete material
export function useDeleteMaterial() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (materialId: string) => {
      const response = await fetch(`/api/v1/courses/materials/${materialId}`, {
        method: 'DELETE',
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Failed to delete material');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate all material queries
      queryClient.invalidateQueries({ queryKey: ['course-materials'] });
      queryClient.invalidateQueries({ queryKey: ['teacher-materials'] });
      queryClient.invalidateQueries({ queryKey: ['material'] });
    },
  });
}

// Helper function to format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper function to get file type icon
export function getFileTypeCategory(fileType: string): 'document' | 'video' | 'image' | 'presentation' | 'other' {
  const type = fileType.toLowerCase();
  
  if (type.includes('pdf') || type.includes('doc') || type.includes('txt')) {
    return 'document';
  }
  if (type.includes('video') || type.includes('mp4') || type.includes('avi') || type.includes('mov')) {
    return 'video';
  }
  if (type.includes('image') || type.includes('png') || type.includes('jpg') || type.includes('jpeg') || type.includes('gif')) {
    return 'image';
  }
  if (type.includes('presentation') || type.includes('ppt') || type.includes('pptx')) {
    return 'presentation';
  }
  
  return 'other';
}
