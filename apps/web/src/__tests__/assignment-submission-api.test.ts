/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  useCreateSubmission, 
  useUpdateSubmission, 
  useSubmitAssignment, 
  useMySubmission 
} from '@/lib/hooks/use-student-data';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock fetch
global.fetch = jest.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('Assignment Submission API Integration', () => {
  beforeEach(() => {
    (fetch as jest.MockedFunction<typeof fetch>).mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('useCreateSubmission', () => {
    it('should create a new submission successfully', async () => {
      const mockSubmission = {
        id: 'submission-123',
        assignment_id: 'assignment-456',
        student_id: 'student-789',
        status: 'in_progress',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubmission,
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCreateSubmission(), { wrapper });

      const submissionData = {
        assignment_id: 'assignment-456',
        submitted_file_url: 'https://example.com/file.pdf',
        submitted_file_name: 'assignment.pdf',
        submitted_file_size_mb: 2.5,
      };

      result.current.mutate(submissionData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/assignments/assignment-456/submissions',
        expect.objectContaining({
          method: 'POST',
          headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
          body: JSON.stringify(submissionData),
        })
      );

      expect(result.current.data).toEqual(mockSubmission);
    });

    it('should handle creation errors', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Assignment not found' }),
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCreateSubmission(), { wrapper });

      const submissionData = {
        assignment_id: 'invalid-assignment',
        submitted_file_url: 'https://example.com/file.pdf',
        submitted_file_name: 'assignment.pdf',
        submitted_file_size_mb: 2.5,
      };

      result.current.mutate(submissionData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Assignment not found');
    });
  });

  describe('useUpdateSubmission', () => {
    it('should update an existing submission successfully', async () => {
      const mockUpdatedSubmission = {
        id: 'submission-123',
        assignment_id: 'assignment-456',
        student_id: 'student-789',
        status: 'in_progress',
        submitted_file_url: 'https://example.com/updated-file.pdf',
        submitted_file_name: 'updated-assignment.pdf',
        submitted_file_size_mb: 3.2,
        updated_at: '2024-01-01T01:00:00Z',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdatedSubmission,
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useUpdateSubmission(), { wrapper });

      const updateData = {
        assignmentId: 'assignment-456',
        submissionId: 'submission-123',
        data: {
          submitted_file_url: 'https://example.com/updated-file.pdf',
          submitted_file_name: 'updated-assignment.pdf',
          submitted_file_size_mb: 3.2,
        },
      };

      result.current.mutate(updateData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/assignments/assignment-456/submissions/submission-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
          body: JSON.stringify(updateData.data),
        })
      );

      expect(result.current.data).toEqual(mockUpdatedSubmission);
    });

    it('should handle update errors for submitted assignments', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Cannot update a submitted or graded submission' }),
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useUpdateSubmission(), { wrapper });

      const updateData = {
        assignmentId: 'assignment-456',
        submissionId: 'submission-123',
        data: {
          submitted_file_url: 'https://example.com/new-file.pdf',
        },
      };

      result.current.mutate(updateData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect((result.current.error as Error).message).toBe('Cannot update a submitted or graded submission');
    });
  });

  describe('useSubmitAssignment', () => {
    it('should submit an assignment successfully', async () => {
      const mockSubmittedAssignment = {
        id: 'submission-123',
        assignment_id: 'assignment-456',
        student_id: 'student-789',
        status: 'submitted',
        submitted_at: '2024-01-01T02:00:00Z',
        is_late: false,
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubmittedAssignment,
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useSubmitAssignment(), { wrapper });

      const submitData = {
        assignmentId: 'assignment-456',
        submissionId: 'submission-123',
      };

      result.current.mutate(submitData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/assignments/assignment-456/submissions/submission-123/submit',
        expect.objectContaining({
          method: 'POST',
          headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        })
      );

      expect(result.current.data).toEqual(mockSubmittedAssignment);
    });

    it('should handle late submission scenarios', async () => {
      const mockLateSubmission = {
        id: 'submission-123',
        assignment_id: 'assignment-456',
        student_id: 'student-789',
        status: 'submitted',
        submitted_at: '2024-01-01T02:00:00Z',
        is_late: true,
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLateSubmission,
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useSubmitAssignment(), { wrapper });

      const submitData = {
        assignmentId: 'assignment-456',
        submissionId: 'submission-123',
      };

      result.current.mutate(submitData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.is_late).toBe(true);
    });

    it('should handle submission deadline errors', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ 
          error: 'Assignment submission deadline has passed and late submissions are not allowed' 
        }),
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useSubmitAssignment(), { wrapper });

      const submitData = {
        assignmentId: 'assignment-456',
        submissionId: 'submission-123',
      };

      result.current.mutate(submitData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect((result.current.error as Error).message).toBe(
        'Assignment submission deadline has passed and late submissions are not allowed'
      );
    });
  });

  describe('useMySubmission', () => {
    it('should fetch user submission successfully', async () => {
      const mockSubmission = {
        id: 'submission-123',
        assignment_id: 'assignment-456',
        student_id: 'student-789',
        status: 'in_progress',
        submitted_file_url: 'https://example.com/file.pdf',
        submitted_file_name: 'assignment.pdf',
        submitted_file_size_mb: 2.5,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
      };

      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubmission,
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useMySubmission('assignment-456'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/assignments/assignment-456/submissions/my-submission',
        expect.objectContaining({
          headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        })
      );

      expect(result.current.data).toEqual(mockSubmission);
    });

    it('should handle no submission found', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No submission found' }),
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useMySubmission('assignment-456'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeNull();
    });
  });

  describe('API Error Handling', () => {
    it('should handle network errors', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCreateSubmission(), { wrapper });

      const submissionData = {
        assignment_id: 'assignment-456',
        submitted_file_url: 'https://example.com/file.pdf',
        submitted_file_name: 'assignment.pdf',
        submitted_file_size_mb: 2.5,
      };

      result.current.mutate(submissionData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
    });

    it('should handle malformed JSON responses', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCreateSubmission(), { wrapper });

      const submissionData = {
        assignment_id: 'assignment-456',
        submitted_file_url: 'https://example.com/file.pdf',
        submitted_file_name: 'assignment.pdf',
        submitted_file_size_mb: 2.5,
      };

      result.current.mutate(submissionData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});
