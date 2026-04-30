"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
import { useSession } from "next-auth/react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Types based on our contracts
interface Assignment {
  id: string;
  tenant_id: string;
  course_id: string;
  teacher_id: string;
  title: string;
  description?: string;
  type: 'evaluation' | 'homework';
  creation_mode: 'manual' | 'ai_generated';
  source_document_url?: string;
  
  // Evaluation parameters
  duration_minutes?: number;
  starts_at?: string;
  ends_at: string;
  max_attempts: number;
  shuffle_questions: boolean;
  show_results_mode: 'immediate' | 'after_end' | 'after_correction';
  
  // Homework parameters
  subject_content?: string;
  subject_document_url?: string;
  max_file_size_mb: number;
  late_submission_allowed: boolean;
  late_penalty_percent: number;
  
  status: 'draft' | 'published' | 'archived';
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
  
  // Extended fields from API
  course_title?: string;
  course_code?: string;
  teacher_name?: string;
}

interface EvaluationQuestion {
  id: string;
  tenant_id: string;
  assignment_id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'fill_blank';
  question_text: string;
  options?: string[];
  correct_answer: any;
  points: number;
  order_index: number;
  ai_generated: boolean;
  created_at: string;
}

interface EvaluationQuestionsResponse {
  questions: EvaluationQuestion[];
  assignment?: {
    id: string;
    title: string;
    course_name?: string;
    course_code?: string;
    ends_at?: string;
    type?: string;
    status?: string;
  };
  meta?: {
    total_questions?: number;
    total_points?: number;
  };
}

interface CreateAssignment {
  course_id: string;
  title: string;
  description?: string;
  type: 'evaluation' | 'homework';
  creation_mode?: 'manual' | 'ai_generated';
  evaluation_type?: 'online' | 'pdf' | 'ai_generated';
  source_document_url?: string;

  // AI evaluation parameters
  source_documents?: string[];
  ai_config?: {
    mcq: number;
    short_answer: number;
    long_answer: number;
    true_false: number;
    difficulty: 'easy' | 'medium' | 'hard';
  };

  // Evaluation parameters
  duration_minutes?: number;
  starts_at?: string;
  ends_at?: string;
  max_attempts?: number;
  shuffle_questions?: boolean;
  show_results_mode?: 'immediate' | 'after_end' | 'after_correction';

  // Homework parameters
  subject_content?: string;
  subject_document_url?: string;
  max_file_size_mb?: number;
  late_submission_allowed?: boolean;
  late_penalty_percent?: number;

  settings?: Record<string, any>;
}

interface UpdateAssignment extends Partial<CreateAssignment> {
  status?: 'draft' | 'published' | 'archived';
}

interface CreateEvaluationQuestion {
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'fill_blank';
  question_text: string;
  options?: string[];
  correct_answer: any;
  points?: number;
  order_index: number;
  ai_generated?: boolean;
}

interface AssignmentQuery {
  page?: number;
  limit?: number;
  type?: 'evaluation' | 'homework';
  status?: 'draft' | 'published' | 'archived';
  course_id?: string;
  teacher_id?: string;
  search?: string;
}

const getAssignmentQuestionsQueryKey = (assignmentId: string) =>
  ["assignments", assignmentId, "questions-v2"] as const;

function normalizeQuestionsResponse(result: any): EvaluationQuestionsResponse {
  return {
    questions: result?.data || result?.questions || [],
    assignment: result?.assignment,
    meta: result?.meta,
  };
}

// API functions
async function fetchAssignments(query: AssignmentQuery = {}, session?: any): Promise<{ assignments: Assignment[]; total: number; page: number; limit: number }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const url = `/api/v1/assignments?${searchParams}`;
  console.log("🔍 Fetching assignments from:", url);
  console.log("🔍 Query params:", query);

  // Use createApiHeaders for consistent header handling
  // The fetch interceptor will automatically add JWT token and X-User-Id
  const headers = createApiHeaders(session);

  const response = await fetch(url, {
    headers,
  });

  console.log("📡 Response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ Failed to fetch assignments:", errorText);
    let errorMessage = "Failed to fetch assignments";
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorJson.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  console.log("✅ Assignments fetched:", result.assignments?.length || result.data?.length || 0, "total:", result.total);

  // Handle different response formats
  if (result.data && Array.isArray(result.data)) {
    return {
      assignments: result.data,
      total: result.total || result.data.length,
      page: result.page || 1,
      limit: result.limit || 20,
    };
  }

  return result;
}

async function fetchAssignment(id: string): Promise<Assignment> {
  const response = await fetch(`/api/v1/assignments/${id}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch assignment");
  }

  return response.json();
}

async function createAssignment(data: CreateAssignment & { userId?: string }): Promise<Assignment> {
  // Convert datetime-local format to ISO string if needed
  const { userId, ...assignmentData } = data;
  const processedData = {
    ...assignmentData,
    ...(assignmentData.ends_at ? { ends_at: new Date(assignmentData.ends_at).toISOString() } : {}),
    ...(assignmentData.starts_at ? { starts_at: new Date(assignmentData.starts_at).toISOString() } : {}),
  };

  const response = await fetch(`/api/v1/assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
      // The userId parameter is kept for backward compatibility but won't be used if fetch-interceptor is active
    },
    body: JSON.stringify(processedData),
    credentials: 'include', // Include cookies for session
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    throw new Error(error.message || `HTTP ${response.status}: Failed to create assignment`);
  }

  return response.json();
}

async function updateAssignment(id: string, data: UpdateAssignment): Promise<Assignment> {
  const response = await fetch(`/api/v1/assignments/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update assignment");
  }

  return response.json();
}

async function deleteAssignment(id: string): Promise<void> {
  const response = await fetch(`/api/v1/assignments/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to delete assignment");
  }
}

async function fetchQuestions(assignmentId: string): Promise<EvaluationQuestionsResponse> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/questions`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch questions");
  }

  const result = await response.json();
  return normalizeQuestionsResponse(result);
}

async function createQuestion(assignmentId: string, data: CreateEvaluationQuestion): Promise<EvaluationQuestion> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create question");
  }

  const result = await response.json();
  return result.data || result;
}

async function updateQuestion(assignmentId: string, questionId: string, data: Partial<CreateEvaluationQuestion>): Promise<EvaluationQuestion> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/questions/${questionId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update question");
  }

  const result = await response.json();
  return result.data || result;
}

async function deleteQuestion(assignmentId: string, questionId: string): Promise<void> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/questions/${questionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to delete question");
  }
}

// Hooks
export function useAssignments(query: AssignmentQuery = {}) {
  const { data: session } = useSession();
  
  return useQuery({
    queryKey: ["assignments", query],
    queryFn: () => fetchAssignments(query, session),
    enabled: !!session, // Only fetch when session is available
    staleTime: 0, // Always fetch fresh data for debugging
    refetchOnWindowFocus: true,
  });
}

export function useAssignment(id: string) {
  return useQuery({
    queryKey: ["assignments", id],
    queryFn: () => fetchAssignment(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateAssignment() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (data: CreateAssignment) => {
      // ✅ Pass the current user's ID from session
      const userId = (session?.user as any)?.id;
      console.log('🔑 Creating assignment with user ID:', userId);
      return createAssignment({ ...data, userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-evaluations"] });
    },
  });
}

export function useUpdateAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAssignment }) => updateAssignment(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["assignments", id] });
      queryClient.invalidateQueries({ queryKey: ["teacher-evaluations"] });
    },
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-evaluations"] });
    },
  });
}

export function useQuestions(assignmentId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: getAssignmentQuestionsQueryKey(assignmentId),
    queryFn: () => fetchQuestions(assignmentId),
    enabled: !!assignmentId && (options?.enabled !== false),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateQuestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: CreateEvaluationQuestion }) => 
      createQuestion(assignmentId, data),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: getAssignmentQuestionsQueryKey(assignmentId) });
    },
  });
}

export function useUpdateQuestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, questionId, data }: { assignmentId: string; questionId: string; data: Partial<CreateEvaluationQuestion> }) => 
      updateQuestion(assignmentId, questionId, data),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: getAssignmentQuestionsQueryKey(assignmentId) });
    },
  });
}

export function useDeleteQuestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, questionId }: { assignmentId: string; questionId: string }) => 
      deleteQuestion(assignmentId, questionId),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: getAssignmentQuestionsQueryKey(assignmentId) });
    },
  });
}

// Hook pour récupérer les questions d'une évaluation
export function useEvaluationQuestions(assignmentId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: getAssignmentQuestionsQueryKey(assignmentId),
    queryFn: () => fetchQuestions(assignmentId),
    enabled: options?.enabled !== false && !!assignmentId,
  });
}

// Student-specific types and functions
interface AssignmentSubmission {
  id: string;
  tenant_id: string;
  assignment_id: string;
  student_id: string;
  attempt_number: number;
  answers?: Record<string, any>;
  auto_score?: number;
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
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

interface CreateSubmission {
  assignment_id: string;
  answers?: Record<string, any>;
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
  time_spent_seconds?: number;
}

interface UpdateSubmission {
  answers?: Record<string, any>;
  submitted_file_url?: string;
  submitted_file_name?: string;
  submitted_file_size_mb?: number;
  time_spent_seconds?: number;
  status?: 'in_progress' | 'submitted';
}

// Student API functions
async function fetchStudentAssignments(query: AssignmentQuery = {}): Promise<{ assignments: Assignment[]; total: number; page: number; limit: number }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/students/assignments?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch student assignments");
  }

  return response.json();
}

async function fetchSubmission(assignmentId: string): Promise<AssignmentSubmission | null> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submission`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (response.status === 404) {
    return null; // No submission yet
  }

  if (!response.ok) {
    throw new Error("Failed to fetch submission");
  }

  return response.json();
}

async function createSubmission(data: CreateSubmission): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${data.assignment_id}/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create submission");
  }

  return response.json();
}

async function updateSubmission(assignmentId: string, submissionId: string, data: UpdateSubmission): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to update submission");
  }

  return response.json();
}

async function submitAssignment(assignmentId: string, submissionId: string): Promise<AssignmentSubmission> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to submit assignment");
  }

  return response.json();
}

// Student hooks
export function useStudentAssignments(query: AssignmentQuery = {}) {
  return useQuery({
    queryKey: ["student-assignments", query],
    queryFn: () => fetchStudentAssignments(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Teacher evaluations history hook
export function useTeacherEvaluations(teacherId?: string, query: Omit<AssignmentQuery, 'teacher_id'> = {}) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ["teacher-evaluations", teacherId, query],
    queryFn: () => fetchAssignments({ ...query, teacher_id: teacherId }, session),
    enabled: !!teacherId,
    staleTime: 60 * 1000,
    refetchOnMount: "always",
  });
}

export function useSubmission(assignmentId: string) {
  return useQuery({
    queryKey: ["submissions", assignmentId],
    queryFn: () => fetchSubmission(assignmentId),
    enabled: !!assignmentId,
    staleTime: 30 * 1000, // 30 seconds for real-time updates
  });
}

export function useCreateSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSubmission,
    onSuccess: (_, { assignment_id }) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignment_id] });
    },
  });
}

export function useUpdateSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId, data }: { assignmentId: string; submissionId: string; data: UpdateSubmission }) =>
      updateSubmission(assignmentId, submissionId, data),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId] });
    },
  });
}

export function useSubmitAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) =>
      submitAssignment(assignmentId, submissionId),
    onSuccess: (_, { assignmentId }) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["student-assignments"] });
    },
  });
}

// Grading types and functions
interface GradeSubmission {
  manual_score?: number;
  feedback?: string;
  auto_grade?: boolean;
}

interface SubmissionWithStudent extends AssignmentSubmission {
  student_name: string;
  student_email: string;
  student_number: string;
  assignment_title?: string;
  assignment_type?: string;
}

interface SubmissionsQuery {
  status?: 'in_progress' | 'submitted' | 'graded';
  student_id?: string;
  page?: number;
  limit?: number;
}

// Grading API functions
async function fetchSubmissions(assignmentId: string, query: SubmissionsQuery = {}): Promise<{ submissions: SubmissionWithStudent[]; total: number; page: number; limit: number }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions?${searchParams}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch submissions");
  }

  return response.json();
}

async function fetchSubmissionDetails(assignmentId: string, submissionId: string): Promise<SubmissionWithStudent> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}`, {
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch submission details");
  }

  return response.json();
}

async function gradeSubmission(assignmentId: string, submissionId: string, data: GradeSubmission): Promise<Partial<AssignmentSubmission>> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/grade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to grade submission");
  }

  return response.json();
}

async function autoGradeSubmission(assignmentId: string, submissionId: string): Promise<Partial<AssignmentSubmission>> {
  const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/auto-grade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to auto-grade submission");
  }

  return response.json();
}

// Grading hooks
export function useSubmissions(assignmentId: string, query: SubmissionsQuery = {}) {
  return useQuery({
    queryKey: ["submissions", assignmentId, query],
    queryFn: () => fetchSubmissions(assignmentId, query),
    enabled: !!assignmentId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useSubmissionDetails(assignmentId: string, submissionId: string) {
  return useQuery({
    queryKey: ["submissions", assignmentId, submissionId],
    queryFn: () => fetchSubmissionDetails(assignmentId, submissionId),
    enabled: !!assignmentId && !!submissionId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useGradeSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId, data }: { assignmentId: string; submissionId: string; data: GradeSubmission }) =>
      gradeSubmission(assignmentId, submissionId, data),
    onSuccess: (_, { assignmentId, submissionId }) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId, submissionId] });
    },
  });
}

export function useAutoGradeSubmission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ assignmentId, submissionId }: { assignmentId: string; submissionId: string }) =>
      autoGradeSubmission(assignmentId, submissionId),
    onSuccess: (_, { assignmentId, submissionId }) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId] });
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId, submissionId] });
    },
  });
}

// Export types for use in components
export type {
  Assignment,
  EvaluationQuestion,
  CreateAssignment,
  UpdateAssignment,
  CreateEvaluationQuestion,
  AssignmentQuery,
  AssignmentSubmission,
  CreateSubmission,
  UpdateSubmission,
  GradeSubmission,
  SubmissionWithStudent,
  SubmissionsQuery
};
