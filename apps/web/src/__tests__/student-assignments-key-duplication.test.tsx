/**
 * Test suite for Student Assignments Page - Key Duplication Fix
 * 
 * This test ensures that the React key duplication error is resolved and that
 * the page handles duplicate data gracefully.
 * 
 * Bug fixed: React key duplication error caused by duplicate assignment records
 * Root cause: Backend API was joining all student profiles, causing duplicates
 * Solution: Added DISTINCT to SQL query and client-side deduplication
 */

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import StudentAssignmentsPage from '../app/student/assignments/page';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

// Mock next-auth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

// Mock the student data hook
jest.mock('../lib/hooks/use-student-data', () => ({
  useStudentAssignments: jest.fn(),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockUseStudentAssignments = require('../lib/hooks/use-student-data').useStudentAssignments;

describe('Student Assignments Page - Key Duplication Fix', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Mock authenticated student session
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'student-1', email: 'student@test.com' },
        roles: ['student'],
      },
      status: 'authenticated',
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  describe('Duplicate Data Handling', () => {
    test('should handle duplicate assignments gracefully', async () => {
      // Mock API response with duplicate assignments (same ID)
      const duplicateAssignments = [
        {
          id: 'd98f89cc-5081-4f0a-87f9-7f3dcf9241f2',
          title: 'Math Assignment 1',
          description: 'Solve algebra problems',
          course: { id: 'course-1', name: 'Mathematics', code: 'MATH101' },
          instructor: { id: 'teacher-1', first_name: 'John', last_name: 'Doe' },
          due_date: '2024-02-15T23:59:00Z',
          submitted_at: null,
          status: 'pending',
          priority: 'medium',
          max_points: 100,
          grade: null,
          submission_type: 'file',
          feedback: null,
        },
        {
          id: 'd98f89cc-5081-4f0a-87f9-7f3dcf9241f2', // Same ID - duplicate!
          title: 'Math Assignment 1',
          description: 'Solve algebra problems',
          course: { id: 'course-1', name: 'Mathematics', code: 'MATH101' },
          instructor: { id: 'teacher-1', first_name: 'John', last_name: 'Doe' },
          due_date: '2024-02-15T23:59:00Z',
          submitted_at: null,
          status: 'pending',
          priority: 'medium',
          max_points: 100,
          grade: null,
          submission_type: 'file',
          feedback: null,
        },
        {
          id: 'assignment-2',
          title: 'Physics Lab Report',
          description: 'Write lab report',
          course: { id: 'course-2', name: 'Physics', code: 'PHYS101' },
          instructor: { id: 'teacher-2', first_name: 'Jane', last_name: 'Smith' },
          due_date: '2024-02-20T23:59:00Z',
          submitted_at: null,
          status: 'pending',
          priority: 'high',
          max_points: 100,
          grade: null,
          submission_type: 'file',
          feedback: null,
        },
      ];

      mockUseStudentAssignments.mockReturnValue({
        data: { data: duplicateAssignments },
        isLoading: false,
        error: null,
      });

      // Spy on console.error to catch React key warnings
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      renderWithProviders(<StudentAssignmentsPage />);

      await waitFor(() => {
        expect(screen.getByText('Mes Devoirs')).toBeInTheDocument();
      });

      // Should only show unique assignments (2 instead of 3)
      const assignmentCards = screen.getAllByText(/Assignment|Report/);
      expect(assignmentCards).toHaveLength(2);

      // Should show both unique assignments
      expect(screen.getByText('Math Assignment 1')).toBeInTheDocument();
      expect(screen.getByText('Physics Lab Report')).toBeInTheDocument();

      // Should not have React key duplication warnings
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Encountered two children with the same key')
      );

      consoleSpy.mockRestore();
    });

    test('should handle empty assignments list', async () => {
      mockUseStudentAssignments.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<StudentAssignmentsPage />);

      await waitFor(() => {
        expect(screen.getByText('Aucun devoir trouvé')).toBeInTheDocument();
      });
    });

    test('should handle loading state', async () => {
      mockUseStudentAssignments.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });

      renderWithProviders(<StudentAssignmentsPage />);

      expect(screen.getByText('Chargement des devoirs...')).toBeInTheDocument();
    });

    test('should handle error state', async () => {
      mockUseStudentAssignments.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('API Error'),
      });

      renderWithProviders(<StudentAssignmentsPage />);

      expect(screen.getByText('Erreur de chargement')).toBeInTheDocument();
      expect(screen.getByText('Impossible de charger les devoirs. Veuillez réessayer.')).toBeInTheDocument();
    });
  });

  describe('Data Deduplication Logic', () => {
    test('should deduplicate assignments with same ID but different data', async () => {
      const assignmentsWithDuplicateIds = [
        {
          id: 'same-id',
          title: 'Assignment Version 1',
          description: 'First version',
          course: { id: 'course-1', name: 'Math', code: 'MATH101' },
          instructor: { id: 'teacher-1', first_name: 'John', last_name: 'Doe' },
          due_date: '2024-02-15T23:59:00Z',
          submitted_at: null,
          status: 'pending',
          priority: 'medium',
          max_points: 100,
          grade: null,
          submission_type: 'file',
          feedback: null,
        },
        {
          id: 'same-id', // Same ID
          title: 'Assignment Version 2', // Different title
          description: 'Second version', // Different description
          course: { id: 'course-1', name: 'Math', code: 'MATH101' },
          instructor: { id: 'teacher-1', first_name: 'John', last_name: 'Doe' },
          due_date: '2024-02-15T23:59:00Z',
          submitted_at: null,
          status: 'pending',
          priority: 'medium',
          max_points: 100,
          grade: null,
          submission_type: 'file',
          feedback: null,
        },
      ];

      mockUseStudentAssignments.mockReturnValue({
        data: { data: assignmentsWithDuplicateIds },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<StudentAssignmentsPage />);

      await waitFor(() => {
        expect(screen.getByText('Mes Devoirs')).toBeInTheDocument();
      });

      // Should only show the first occurrence (Version 1)
      expect(screen.getByText('Assignment Version 1')).toBeInTheDocument();
      expect(screen.queryByText('Assignment Version 2')).not.toBeInTheDocument();
    });
  });

  describe('Authentication and Authorization', () => {
    test('should redirect non-students', () => {
      const mockRedirect = require('next/navigation').redirect;
      
      mockUseSession.mockReturnValue({
        data: {
          user: { id: 'user-1', email: 'admin@test.com' },
          roles: ['admin'], // Not a student
        },
        status: 'authenticated',
      } as any);

      renderWithProviders(<StudentAssignmentsPage />);

      expect(mockRedirect).toHaveBeenCalledWith('/');
    });

    test('should redirect unauthenticated users', () => {
      const mockRedirect = require('next/navigation').redirect;
      
      mockUseSession.mockReturnValue({
        data: null,
        status: 'unauthenticated',
      } as any);

      renderWithProviders(<StudentAssignmentsPage />);

      expect(mockRedirect).toHaveBeenCalledWith('/login');
    });
  });
});
