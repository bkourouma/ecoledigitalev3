/**
 * Tests for Teacher Assignments Create Page
 * 
 * This test file validates the behavioral logic correction for the teacher assignments creation page.
 * The issue was that the page was using useTeacherAssignments() instead of useTeacherCourses() + useCurrentTeacherId().
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { jest } from '@jest/globals';

// Mock the hooks
jest.mock('@/lib/hooks/use-courses', () => ({
  useTeacherCourses: jest.fn(),
}));

jest.mock('@/lib/hooks/use-current-teacher', () => ({
  useCurrentTeacherId: jest.fn(),
}));

jest.mock('@/lib/hooks/use-evaluations', () => ({
  useCreateEvaluation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

// Mock the UI components
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
  Textarea: ({ placeholder, value, onChange }: { placeholder?: string; value?: string; onChange?: (e: any) => void }) => (
    <textarea data-testid="textarea" placeholder={placeholder} value={value} onChange={onChange} />
  ),
  Select: ({ children }: { children: React.ReactNode }) => <select data-testid="select">{children}</select>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

import CreateAssignmentPage from '@/app/teacher/assignments/create/page';
import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { useCurrentTeacherId } from '@/lib/hooks/use-current-teacher';

const mockUseTeacherCourses = useTeacherCourses as jest.MockedFunction<typeof useTeacherCourses>;
const mockUseCurrentTeacherId = useCurrentTeacherId as jest.MockedFunction<typeof useCurrentTeacherId>;

// Mock session data
const mockSession = {
  user: {
    id: 'teacher-123',
    email: 'teacher@example.com',
    name: 'Test Teacher',
    role: 'teacher',
  },
  expires: '2024-12-31',
};

describe('Teacher Assignments Create Page - Behavioral Logic Tests', () => {
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

  describe('✅ Correct Hook Usage', () => {
    test('should use useCurrentTeacherId to get teacher ID', async () => {
      // Mock successful teacher ID fetch
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      // Mock empty courses initially
      mockUseTeacherCourses.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      // Verify useCurrentTeacherId was called
      expect(mockUseCurrentTeacherId).toHaveBeenCalled();
      
      // Verify useTeacherCourses was called with the teacher ID
      expect(mockUseTeacherCourses).toHaveBeenCalledWith('teacher-123');
    });

    test('should display courses when teacher has assigned courses', async () => {
      // Mock teacher ID
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      // Mock teacher courses data
      const mockCourses = [
        {
          courseId: 'course-1',
          courseName: 'Mathématiques',
          courseCode: 'MATH101',
          className: 'Terminale A',
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

      mockUseTeacherCourses.mockReturnValue({
        data: mockCourses,
        isLoading: false,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        // Should display course selection
        expect(screen.getByText('Sélectionner un cours')).toBeInTheDocument();
        
        // Should not show "Aucun cours assigné" message
        expect(screen.queryByText('Aucun cours assigné')).not.toBeInTheDocument();
      });
    });

    test('should show "Aucun cours assigné" when teacher has no courses', async () => {
      // Mock teacher ID
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      // Mock empty courses
      mockUseTeacherCourses.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        // Should show "Aucun cours assigné" message
        expect(screen.getByText('Aucun cours assigné')).toBeInTheDocument();
      });
    });
  });

  describe('🔄 Loading States', () => {
    test('should show loading state while fetching teacher ID', () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      expect(screen.getByText('Chargement...')).toBeInTheDocument();
    });

    test('should show loading state while fetching courses', () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      expect(screen.getByText('Chargement...')).toBeInTheDocument();
    });
  });

  describe('❌ Error Handling', () => {
    test('should handle courses fetch error gracefully', async () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      mockUseTeacherCourses.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch courses'),
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur lors du chargement/)).toBeInTheDocument();
      });
    });
  });

  describe('🔍 Data Transformation Logic', () => {
    test('should correctly transform teacher courses data', async () => {
      mockUseCurrentTeacherId.mockReturnValue({
        data: 'teacher-123',
        isLoading: false,
        error: null,
      } as any);

      const mockApiResponse = [
        {
          courseId: 'course-1',
          courseName: 'Mathématiques Avancées',
          courseCode: 'MATH201',
          className: 'Terminale C',
          classId: 'class-1',
          assignmentId: 'assignment-1',
        },
      ];

      mockUseTeacherCourses.mockReturnValue({
        data: mockApiResponse,
        isLoading: false,
        error: null,
      } as any);

      renderWithProviders(<CreateAssignmentPage />);

      await waitFor(() => {
        // The component should process the data correctly
        expect(mockUseTeacherCourses).toHaveBeenCalledWith('teacher-123');
        
        // Should display the course selection interface
        expect(screen.getByText('Sélectionner un cours')).toBeInTheDocument();
      });
    });
  });
});
