import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';

const STUDENT_PROFILE_MISSING_MESSAGE =
  "Ce compte n'est pas encore rattache a une fiche etudiant. Veuillez contacter l'administrateur.";

type StudentApiErrorPayload = {
  error?: string;
  message?: string;
  details?: {
    error?: string;
    message?: string;
  };
};

async function getStudentApiErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const errorText = await response.text();
  let errorData: StudentApiErrorPayload = {};

  if (errorText) {
    try {
      errorData = JSON.parse(errorText) as StudentApiErrorPayload;
    } catch {
      errorData = { message: errorText };
    }
  }

  const detailMessage = errorData.details?.message;
  const detailError = errorData.details?.error;
  const normalizedError = [
    errorData.error,
    errorData.message,
    detailError,
    detailMessage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    response.status === 404 &&
    (normalizedError.includes('student not found') ||
      normalizedError.includes('no student profile found'))
  ) {
    return STUDENT_PROFILE_MISSING_MESSAGE;
  }

  return detailMessage || errorData.message || detailError || errorData.error || fallbackMessage;
}

export function isStudentProfileMissingError(error: unknown): boolean {
  return error instanceof Error && error.message === STUDENT_PROFILE_MISSING_MESSAGE;
}

// Hook pour récupérer les cours de l'étudiant
export function useStudentCourses(params?: {
  status?: 'active' | 'completed' | 'all';
  search?: string;
  limit?: number;
  offset?: number;
  student_id?: string;
}) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['student-courses', params],
    queryFn: async () => {
      const queryString = buildQueryString(params);
      const headers = createApiHeaders(session, params?.student_id ? { 'X-Student-Id': params.student_id } : undefined);

      const response = await fetch(`/api/v1/student/courses${queryString}`, {
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error('Erreur lors de la récupération des cours');
      }

      return response.json();
    },
    enabled: !!session, // Only run query if session exists
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook pour récupérer les détails d'un cours spécifique
export function useStudentCourse(courseId: string) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['student-course', courseId],
    queryFn: async () => {
      const headers = createApiHeaders(session);

      const response = await fetch(`/api/v1/student/courses/${courseId}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération du cours');
      }

      return response.json();
    },
    enabled: !!courseId, // Only run query if courseId exists
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook pour récupérer les supports d'un cours
export function useCourseMaterials(courseId: string) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['course-materials', courseId],
    queryFn: async () => {
      const headers = createApiHeaders(session);

      const response = await fetch(`/api/v1/student/courses/${courseId}/materials`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des supports');
      }

      return response.json();
    },
    enabled: !!courseId, // Only run query if courseId exists
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}



// Hook pour récupérer les informations de l'étudiant connecté
export function useCurrentStudent() {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['current-student', (session?.user as any)?.id],
    queryFn: async () => {
      if (!(session?.user as any)?.id) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(`/api/v1/students/me`, {
        headers: createApiHeaders(session),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to fetch current student');
      }

      const data = await response.json();
      if (!data?.student) {
        throw new Error('Student record not found for current user');
      }
      return data.student;
    },
    enabled: !!(session?.user as any)?.id,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });
}

// Hook pour récupérer les devoirs de l'étudiant via assignment instances
export function useStudentAssignments(params?: {
  status?: 'available' | 'expired' | 'all' | 'pending' | 'submitted' | 'graded';
  course_id?: string;
}) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['student-assignments', params],
    queryFn: async () => {
      console.log('🚀 useStudentAssignments - Starting API call');
      console.log('- session:', session);
      console.log('- params:', params);

      if (!(session?.user as any)?.id) {
        throw new Error('User not authenticated');
      }

      const searchParams = new URLSearchParams();
      if (params?.status && params.status !== 'all') {
        searchParams.append('status', params.status);
      }
      if (params?.course_id) {
        searchParams.append('course_id', params.course_id);
      }

      // Use the correct student assignments endpoint
      const url = `/api/v1/student/assignments${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
      console.log('- Final URL:', url);

      const response = await fetch(url, {
        headers: {
          "X-Tenant": "imhotepacademy",
"X-User-Id": (session?.user as any)?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
          "Content-Type": "application/json"
        },
      });

      console.log('- Response status:', response.status);
      console.log('- Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`Erreur lors de la récupération des devoirs: ${response.status}`);
      }

      const data = await response.json();
      console.log('- Response data:', data);
      return data.data || [];
    },
    enabled: !!session,
    staleTime: 30 * 1000, // 30 seconds for faster refresh
    refetchOnWindowFocus: true, // Auto-refresh when window regains focus
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      if (error.message.includes('4')) return false;
      return failureCount < 3;
    },
  });
}

// Hook pour récupérer un devoir spécifique
export function useStudentAssignment(assignmentId: string) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['student-assignment', assignmentId],
    queryFn: async () => {
      if (!(session?.user as any)?.id) {
        throw new Error('User not authenticated');
      }

      // Use the student assignments proxy endpoint (which forwards to student assignments backend)
      const response = await fetch(`/api/v1/student/assignments/${assignmentId}`, {
        headers: {
          "X-Tenant": "imhotepacademy",
"X-User-Id": (session?.user as any)?.id || '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
          "Content-Type": "application/json"
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`Erreur lors de la récupération du devoir: ${response.status}`);
      }

      const responseData = await response.json();
      
      // Check if the response is already in the correct format (with nested success/data)
      if (responseData.success && responseData.data) {
        // Backend returned structured format - use it directly
        const assignmentData = responseData.data;
        
        // Ensure all required fields are present with defaults
        const transformedData = {
          ...assignmentData,
          max_file_size_mb: assignmentData.max_file_size_mb || 10,
          allow_late_submissions: assignmentData.allow_late_submissions || false,
          max_attempts: assignmentData.max_attempts || 2,
          submission_count: assignmentData.submission_count || 0,
          can_submit: assignmentData.can_submit !== undefined ? assignmentData.can_submit : true,
          subject_content: assignmentData.subject_content,
          subject_document_url: assignmentData.subject_document_url,
          subject_document_name: assignmentData.subject_document_name
        };
        
        return { success: true, data: transformedData };
      }
      
      // Legacy format - transform flat structure to nested
      const assignmentData = responseData;
      const transformedData = {
        ...assignmentData,
        course: {
          id: assignmentData.course_id,
          name: assignmentData.course_title,
          code: assignmentData.course_code
        },
        instructor: {
          id: assignmentData.teacher_id,
          first_name: assignmentData.teacher_name?.split(' ')[0] || 'Unknown',
          last_name: assignmentData.teacher_name?.split(' ').slice(1).join(' ') || 'Teacher'
        },
        due_date: assignmentData.ends_at,
        max_points: assignmentData.max_points || 20,
        priority: assignmentData.priority || 'medium',
        submission_type: assignmentData.type === 'evaluation' ? 'evaluation' : 'homework',
        max_file_size_mb: assignmentData.max_file_size_mb || 10,
        allow_late_submissions: assignmentData.late_submission_allowed || false,
        max_attempts: assignmentData.max_attempts || 2,
        submission_count: 0,
        can_submit: true,
        subject_content: assignmentData.subject_content,
        subject_document_url: assignmentData.subject_document_url,
        subject_document_name: assignmentData.subject_document_name
      };
      
      return { success: true, data: transformedData };
    },
    enabled: !!assignmentId && !!session,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      if (error.message.includes('4')) return false;
      return failureCount < 3;
    },
  });
}

// Hook pour récupérer les notes de l'étudiant
export function useStudentGrades(params?: {
  course_id?: string;
  assignment_type?: 'quiz' | 'exam' | 'project' | 'homework' | 'lab' | 'all';
  semester?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['student-grades', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.course_id) searchParams.append('course_id', params.course_id);
      if (params?.assignment_type) searchParams.append('assignment_type', params.assignment_type);
      if (params?.semester) searchParams.append('semester', params.semester);
      if (params?.limit) searchParams.append('limit', params.limit.toString());
      if (params?.offset) searchParams.append('offset', params.offset.toString());

      const response = await fetch(`/api/v1/student/grades?${searchParams}`, {
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des notes');
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Hook pour récupérer le résumé des notes
export function useStudentGradesSummary() {
  return useQuery({
    queryKey: ['student-grades-summary'],
    queryFn: async () => {
      const response = await fetch(`/api/v1/student/grades/summary`, {
        headers: {
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
      "Content-Type": "application/json"
    },
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la récupération du résumé des notes');
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Types pour TypeScript
export interface StudentCourse {
  id: string;
  name: string;
  code: string;
  description: string | null;
  credits: number | null;
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  status: string;
  progress: number;
  next_session: string | null;
  total_hours: number | null;
  completed_hours: number | null;
  is_favorite: boolean;
}

export interface StudentAssignment {
  id: string;
  title: string;
  description: string;
  course: {
    id: string;
    name: string;
    code: string;
  };
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
  };
  due_date: string;
  submitted_at: string | null;
  status: 'pending' | 'submitted' | 'graded';
  priority: 'low' | 'medium' | 'high';
  max_points: number;
  grade: number | null;
  submission_type: 'evaluation' | 'homework';
  feedback: string | null;
}

export interface StudentGrade {
  id: string;
  course: {
    id: string;
    name: string;
    code: string;
  };
  assignment: {
    id: string;
    title: string;
    type: string;
  };
  grade: number;
  max_grade: number;
  coefficient: number;
  date: string;
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
  };
  feedback: string | null;
}

export interface GradesSummary {
  overall_average: number;
  total_credits: number;
  courses: Array<{
    course_id: string;
    course_name: string;
    course_code: string;
    credits: number;
    average: number;
    grade_count: number;
    last_updated: string;
  }>;
}

// Submission interfaces
export interface AssignmentSubmission {
  id: string;
  assignment_id: string;
  student_id: string;
  attempt_number: number;
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
  answers?: Record<string, any>;
  auto_score?: number;
  manual_score?: number;
  final_score?: number;
  time_spent_seconds?: number;
  submitted_at?: string;
  graded_at?: string;
  graded_by?: string;
  feedback?: string;
  is_late: boolean;
  status: 'in_progress' | 'submitted' | 'graded';
  created_at: string;
  updated_at: string;
}

export interface CreateSubmissionData {
  assignment_id: string;
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
  answers?: Record<string, any>;
  text_content?: string;
  time_spent_seconds?: number;
}

export interface UpdateSubmissionData {
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
  answers?: Record<string, any>;
  text_content?: string;
  time_spent_seconds?: number;
}

// API functions for submissions
async function createSubmission(data: CreateSubmissionData): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${data.assignment_id}/submissions`, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
      // X-Tenant and X-User-Id added automatically by fetch interceptor from session
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Erreur lors de la création de la soumission');
  }

  return response.json();
}

async function updateSubmission(assignmentId: string, submissionId: string, data: UpdateSubmissionData): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}`, {
    method: 'PATCH',
    headers: {
      "Content-Type": "application/json"
      // X-Tenant and X-User-Id added automatically by fetch interceptor from session
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Erreur lors de la mise à jour de la soumission');
  }

  return response.json();
}

async function submitAssignment(assignmentId: string, submissionId: string): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/submit`, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
      // X-Tenant and X-User-Id added automatically by fetch interceptor from session
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Erreur lors de la soumission');
  }

  return response.json();
}

async function fetchMySubmission(assignmentId: string): Promise<AssignmentSubmission | null> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/my-submission`);

  if (response.status === 404) {
    return null; // No submission found
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Erreur lors de la récupération de la soumission');
  }

  return response.json();
}

// Hooks for submissions
export function useCreateSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSubmission,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-submission', variables.assignment_id] });
      queryClient.invalidateQueries({ queryKey: ['student-assignments'] });
    },
  });
}

export function useUpdateSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId, data }: { assignmentId: string; submissionId: string; data: UpdateSubmissionData }) =>
      updateSubmission(assignmentId, submissionId, data),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: ['my-submission', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['student-assignments'] });
    },
  });
}

export function useSubmitAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) =>
      submitAssignment(assignmentId, submissionId),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: ['my-submission', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['student-assignments'] });
    },
  });
}

// Hook pour réviser une soumission avant envoi final
export function useReviewSubmission() {
  return useMutation({
    mutationFn: async ({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) => {
      const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // X-Tenant and X-User-Id are added automatically by fetch interceptor from session
        },
        body: JSON.stringify({
          confirm_submit: false
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erreur lors de la révision');
      }

      return response.json();
    },
  });
}

// Hook pour finaliser une soumission
export function useFinalizeSubmission() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) => {
      const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          confirm_submit: true
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erreur lors de la finalisation');
      }

      return response.json();
    },
    onSuccess: (_, { assignmentId }) => {
      // Invalidate and refetch submission data
      queryClient.invalidateQueries({ queryKey: ['my-submission', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['student-assignments'] });
    },
  });
}

export function useMySubmission(assignmentId: string) {
  return useQuery({
    queryKey: ['my-submission', assignmentId],
    queryFn: () => fetchMySubmission(assignmentId),
    enabled: !!assignmentId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Hook pour récupérer le planning de l'étudiant
export function useStudentSchedule(startDate?: string, endDate?: string) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ['student-schedule', startDate, endDate],
    queryFn: async () => {
      if (!(session?.user as any)?.id) {
        throw new Error('User not authenticated');
      }

      // Calculer les dates de début et fin de la semaine si non fournies
      const start = startDate || new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];
      const end = endDate || new Date(Date.now() + 21 * 864e5).toISOString().split('T')[0];

      // Récupérer les sessions via l'endpoint spécifique pour les étudiants
      const response = await fetch(
        `/api/v1/student/courses/schedule?startDate=${start}&endDate=${end}`,
        {
          headers: createApiHeaders(session),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error('Erreur lors de la récupération du planning');
      }

      const data = await response.json();
      return data;
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
