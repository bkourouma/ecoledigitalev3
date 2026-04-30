/**
 * Integration Tests for Teacher Pages
 * 
 * This test file validates that all teacher pages that use useTeacherCourses
 * work correctly after the API fix.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { jest } from '@jest/globals';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  }),
  redirect: jest.fn(),
}));

// Mock the hooks
jest.mock('@/lib/hooks/use-courses', () => ({
  useTeacherCourses: jest.fn(),
}));

jest.mock('@/lib/hooks/use-current-teacher', () => ({
  useCurrentTeacherId: jest.fn(),
}));

jest.mock('@/lib/hooks/use-evaluations', () => ({
  useTeacherEvaluations: jest.fn(),
  useCreateEvaluation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
}));

// Mock UI components
jest.mock('@ecoledigitale/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="card-title">{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button data-testid="button" onClick={onClick}>{children}</button>
  ),
  Input: ({ placeholder, value, onChange }: { placeholder?: string; value?: string; onChange?: (e: any) => void }) => (
    <input data-testid="input" placeholder={placeholder} value={value} onChange={onChange} />
  ),
  Select: ({ children }: { children: React.ReactNode }) => <select data-testid="select">{children}</select>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { useCurrentTeacherId } from '@/lib/hooks/use-current-teacher';
import { useTeacherEvaluations } from '@/lib/hooks/use-evaluations';

const mockUseTeacherCourses = useTeacherCourses as jest.MockedFunction<typeof useTeacherCourses>;
const mockUseCurrentTeacherId = useCurrentTeacherId as jest.MockedFunction<typeof useCurrentTeacherId>;
const mockUseTeacherEvaluations = useTeacherEvaluations as jest.MockedFunction<typeof useTeacherEvaluations>;

// Mock session data
const mockSession = {
  user: {
    id: 'teacher-123',
    email: 'teacher@example.com',
    name: 'Test Teacher',
    role: 'teacher',
  },
  roles: ['teacher'],
  expires: '2024-12-31',
};

describe('Teacher Pages Integration Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    jest.clearAllMocks();
  });

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider session={mockSession}>
          {component}
        </SessionProvider>
      </QueryClientProvider>
    );
  };

  describe('✅ Teacher Assignments Create Page', () => {
    test('should load and display courses correctly', async () => {
      // Mock successful hooks
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: [
          {
            courseId: 'course-1',
            courseName: 'Mathématiques',
            courseCode: 'MATH101',
            className: 'Terminale A',
            classId: 'class-1',
            assignmentId: 'assignment-1',
          }
        ],
        isLoading: false,
        error: null,
      } as any);

      // Dynamic import to avoid module loading issues
      const CreateAssignmentPage = (await import('@/app/teacher/assignments/create/page')).default;
      
      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        expect(screen.getByText('Sélectionner un cours')).toBeInTheDocument();
      });

      // Verify hooks were called correctly
      expect(mockUseCurrentTeacherId).toHaveBeenCalled();
      expect(mockUseTeacherCourses).toHaveBeenCalledWith('teacher-123');
    });
  });

  describe('✅ Teacher Assignments List Page', () => {
    test('should load and display teacher data correctly', async () => {
      // Mock successful hooks
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: [
          {
            courseId: 'course-1',
            courseName: 'Mathématiques',
            courseCode: 'MATH101',
            className: 'Terminale A',
          }
        ],
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherEvaluations.mockReturnValue({
        data: {
          data: [
            {
              id: 'eval-1',
              title: 'Test Evaluation',
              courseId: 'course-1',
              courseName: 'Mathématiques',
            }
          ]
        },
        isLoading: false,
        error: null,
      } as any);

      // Dynamic import
      const AssignmentsListPage = (await import('@/app/teacher/assignments/list/page')).default;
      
      renderWithProviders(<AssignmentsListPage />);

      await waitFor(() => {
        expect(screen.getByText('Mes Devoirs & Évaluations')).toBeInTheDocument();
      });

      // Verify all hooks were called correctly
      expect(mockUseCurrentTeacherId).toHaveBeenCalled();
      expect(mockUseTeacherCourses).toHaveBeenCalledWith('teacher-123');
      expect(mockUseTeacherEvaluations).toHaveBeenCalledWith('teacher-123', expect.any(Object));
    });
  });

  describe('🔄 Error Handling', () => {
    test('should handle teacher courses fetch error gracefully', async () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch teacher courses'),
      } as any);

      const CreateAssignmentPage = (await import('@/app/teacher/assignments/create/page')).default;
      
      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur lors du chargement/)).toBeInTheDocument();
      });
    });

    test('should handle teacher ID fetch error gracefully', async () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Teacher not found'),
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      const CreateAssignmentPage = (await import('@/app/teacher/assignments/create/page')).default;
      
      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur lors du chargement/)).toBeInTheDocument();
      });
    });
  });

  describe('🚀 Performance', () => {
    test('should not make unnecessary API calls', async () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      const CreateAssignmentPage = (await import('@/app/teacher/assignments/create/page')).default;
      
      renderWithProviders(<CreateAssignmentPage />);

      // Hooks should be called only once
      expect(mockUseCurrentTeacherId).toHaveBeenCalledTimes(1);
      expect(mockUseTeacherCourses).toHaveBeenCalledTimes(1);
    });
  });
});
