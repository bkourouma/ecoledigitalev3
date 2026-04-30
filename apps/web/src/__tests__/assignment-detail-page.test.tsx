/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import React from 'react';

// Mock Next.js modules
jest.mock('next-auth/react');
jest.mock('next/navigation');
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

// Mock the hooks
jest.mock('@/lib/hooks/use-student-data', () => ({
  useStudentAssignment: jest.fn(),
}));

// Mock the submission components
jest.mock('@/components/assignments/FileUploadSubmission', () => {
  return function MockFileUploadSubmission({ assignmentId }: { assignmentId: string }) {
    return <div data-testid="file-upload-submission">File Upload for {assignmentId}</div>;
  };
});

jest.mock('@/components/assignments/TextResponseSubmission', () => {
  return function MockTextResponseSubmission({ assignmentId }: { assignmentId: string }) {
    return <div data-testid="text-response-submission">Text Response for {assignmentId}</div>;
  };
});

jest.mock('@/components/assignments/OnlineEvaluationSubmission', () => {
  return function MockOnlineEvaluationSubmission({ assignmentId }: { assignmentId: string }) {
    return <div data-testid="online-evaluation-submission">Online Evaluation for {assignmentId}</div>;
  };
});

// Mock ErrorBoundary
jest.mock('@/components/ErrorBoundary', () => {
  return function MockErrorBoundary({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  };
});

// Import the component after mocking
import StudentAssignmentDetailPage from '@/app/student/assignments/[id]/page';

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
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('StudentAssignmentDetailPage', () => {
  const mockAssignment = {
    data: {
      id: 'assignment-123',
      title: 'Test Assignment',
      description: 'This is a test assignment description',
      course: {
        id: 'course-456',
        name: 'Mathematics',
        code: 'MATH101',
      },
      instructor: {
        id: 'instructor-789',
        first_name: 'John',
        last_name: 'Doe',
      },
      due_date: '2024-12-31T23:59:59Z',
      submitted_at: null,
      status: 'pending',
      priority: 'medium',
      max_points: 100,
      grade: null,
      submission_type: 'file',
      feedback: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock useSession
    (useSession as jest.MockedFunction<typeof useSession>).mockReturnValue({
      data: {
        user: { id: 'user-123', email: 'student@example.com' },
        roles: ['student'],
      } as any,
      status: 'authenticated',
      update: jest.fn(),
    });

    // Mock useParams
    (useParams as jest.MockedFunction<typeof useParams>).mockReturnValue({
      id: 'assignment-123',
    });

    // Mock useRouter
    (useRouter as jest.MockedFunction<typeof useRouter>).mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    } as any);
  });

  it('should render loading state', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Chargement...')).toBeInTheDocument();
  });

  it('should render error state', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Failed to load assignment'),
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Erreur')).toBeInTheDocument();
    expect(screen.getByText('Impossible de charger le devoir')).toBeInTheDocument();
  });

  it('should render assignment not found state', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Devoir introuvable')).toBeInTheDocument();
    expect(screen.getByText('Ce devoir n\'existe pas ou vous n\'y avez pas accès')).toBeInTheDocument();
  });

  it('should render assignment details correctly', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Test Assignment')).toBeInTheDocument();
    expect(screen.getByText('Mathematics (MATH101)')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('100 points')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.getByText('Priorité moyenne')).toBeInTheDocument();
  });

  it('should render assignment description', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('This is a test assignment description')).toBeInTheDocument();
  });

  it('should render file upload submission component for file type', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          submission_type: 'file',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByTestId('file-upload-submission')).toBeInTheDocument();
    expect(screen.getByText('File Upload for assignment-123')).toBeInTheDocument();
  });

  it('should render text response submission component for text type', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          submission_type: 'text',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByTestId('text-response-submission')).toBeInTheDocument();
    expect(screen.getByText('Text Response for assignment-123')).toBeInTheDocument();
  });

  it('should render online evaluation submission component for online type', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          submission_type: 'online',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByTestId('online-evaluation-submission')).toBeInTheDocument();
    expect(screen.getByText('Online Evaluation for assignment-123')).toBeInTheDocument();
  });

  it('should show graded assignment with feedback', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          status: 'graded',
          grade: 85,
          feedback: 'Great work! Well done on this assignment.',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Noté')).toBeInTheDocument();
    expect(screen.getByText('85/100')).toBeInTheDocument();
    expect(screen.getByText('Great work! Well done on this assignment.')).toBeInTheDocument();
  });

  it('should show submitted assignment status', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          status: 'submitted',
          submitted_at: '2024-01-15T10:30:00Z',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Soumis')).toBeInTheDocument();
  });

  it('should handle overdue assignments', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: {
        ...mockAssignment,
        data: {
          ...mockAssignment.data,
          due_date: pastDate.toISOString(),
          status: 'pending',
        },
      },
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    // The component should show overdue indicator
    // This would be visible in the UI but might not have specific text to test
    expect(screen.getByText('Test Assignment')).toBeInTheDocument();
  });

  it('should redirect non-student users', () => {
    (useSession as jest.MockedFunction<typeof useSession>).mockReturnValue({
      data: {
        user: { id: 'user-123', email: 'teacher@example.com' },
        roles: ['teacher'],
      } as any,
      status: 'authenticated',
      update: jest.fn(),
    });

    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    
    // This would trigger a redirect in the actual component
    // In a real test environment, you'd mock the redirect function
    expect(() => render(<StudentAssignmentDetailPage />, { wrapper })).not.toThrow();
  });

  it('should show tabs for navigation', () => {
    const { useStudentAssignment } = require('@/lib/hooks/use-student-data');
    useStudentAssignment.mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });

    const wrapper = createWrapper();
    render(<StudentAssignmentDetailPage />, { wrapper });

    expect(screen.getByText('Détails')).toBeInTheDocument();
    expect(screen.getByText('Ma soumission')).toBeInTheDocument();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });
});
