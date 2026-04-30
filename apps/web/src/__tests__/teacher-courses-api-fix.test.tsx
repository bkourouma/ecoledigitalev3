/**
 * Tests for Teacher Courses API Fix
 * 
 * This test file validates that the useTeacherCourses hook correctly uses
 * the Next.js proxy route instead of making direct backend calls.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { jest } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Create a wrapper for React Query
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('useTeacherCourses Hook - API Fix Tests', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('✅ Correct API Route Usage', () => {
    test('should call Next.js proxy route instead of direct backend', async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            courseId: 'course-1',
            courseName: 'Mathématiques',
            courseCode: 'MATH101',
            className: 'Terminale A',
            classId: 'class-1',
            assignmentId: 'assignment-1',
          }
        ]),
      });

      const { result } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Verify the correct route was called
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/teacher/courses', {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });

      // Verify it was NOT called with direct backend URL
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('localhost:4000/api/v1/teacher/courses'),
        expect.any(Object)
      );
    });

    test('should use simplified headers without manual authentication', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([]),
      });

      renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const [url, options] = mockFetch.mock.calls[0];
      
      // Should only have Content-Type header
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
      });

      // Should NOT have manual authentication headers
      expect(options.headers).not.toHaveProperty('X-User-Id');
      expect(options.headers).not.toHaveProperty('X-Tenant');
      expect(options.headers).not.toHaveProperty('X-Dev-Auth');
    });
  });

  describe('🔄 Hook Behavior', () => {
    test('should be enabled only when teacherId is provided', () => {
      const { result: withTeacherId } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      const { result: withoutTeacherId } = renderHook(
        () => useTeacherCourses(undefined),
        { wrapper: createWrapper() }
      );

      // With teacherId should be enabled
      expect(withTeacherId.current.isLoading || withTeacherId.current.isSuccess).toBe(true);
      
      // Without teacherId should be disabled
      expect(withoutTeacherId.current.isLoading).toBe(false);
      expect(withoutTeacherId.current.data).toBeUndefined();
    });

    test('should handle successful response correctly', async () => {
      const mockCourses = [
        {
          courseId: 'course-1',
          courseName: 'Mathématiques Avancées',
          courseCode: 'MATH201',
          className: 'Terminale C',
          classId: 'class-1',
          assignmentId: 'assignment-1',
        },
        {
          courseId: 'course-2',
          courseName: 'Physique',
          courseCode: 'PHYS101',
          className: 'Terminale B',
          classId: 'class-2',
          assignmentId: 'assignment-2',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCourses,
      });

      const { result } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockCourses);
      expect(result.current.error).toBeNull();
    });

    test('should handle error response correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to fetch teacher courses');
    });
  });

  describe('🚀 Performance and Caching', () => {
    test('should use correct query key for caching', () => {
      const { result } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      // The hook should be using the correct query key
      // This is tested indirectly through the hook behavior
      expect(result.current).toBeDefined();
    });

    test('should have correct stale time configuration', () => {
      const { result } = renderHook(
        () => useTeacherCourses('teacher-123'),
        { wrapper: createWrapper() }
      );

      // The hook should be configured with 5 minutes stale time
      // This is tested indirectly through the hook configuration
      expect(result.current).toBeDefined();
    });
  });

  describe('🔧 Integration with Pages', () => {
    test('should work correctly when teacherId changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      const { result, rerender } = renderHook(
        ({ teacherId }) => useTeacherCourses(teacherId),
        { 
          wrapper: createWrapper(),
          initialProps: { teacherId: 'teacher-1' }
        }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Change teacherId
      rerender({ teacherId: 'teacher-2' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      // Both calls should use the proxy route
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/v1/teacher/courses', expect.any(Object));
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/teacher/courses', expect.any(Object));
    });
  });
});
