import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import { useAssignment, useQuestions, useSubmissions } from '@/lib/hooks/use-evaluations';
import TeacherAssignmentDetailPage from '@/app/teacher/assignments/[id]/page';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

// Mock the hooks
jest.mock('@/lib/hooks/use-evaluations', () => ({
  useAssignment: jest.fn(),
  useQuestions: jest.fn(),
  useSubmissions: jest.fn(),
}));

// Mock UI components
jest.mock('@ecoledigitale/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <div data-testid="card-description">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div data-testid="card-title">{children}</div>,
  Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
    <button data-testid="button" {...props}>{children}</button>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs">{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-content">{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-trigger">{children}</div>,
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="link">{children}</a>
  );
});

const mockAssignment = {
  id: '6c2ac0c5-8c0e-492c-b53c-30a7b831cd85',
  title: 'Test Assignment',
  description: 'This is a test assignment',
  type: 'evaluation',
  status: 'published',
  course_title: 'Mathematics',
  course_code: 'MATH101',
  ends_at: '2024-12-31T23:59:59Z',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  duration_minutes: 60,
  max_attempts: 3,
  shuffle_questions: true,
  show_results_mode: 'immediate',
  max_file_size_mb: 10,
  late_submission_allowed: true,
  late_penalty_percent: 10,
};

const mockQuestions = [
  {
    id: 'q1',
    type: 'single_choice',
    question_text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    points: 2,
  },
  {
    id: 'q2',
    type: 'multiple_choice',
    question_text: 'Select all even numbers:',
    options: ['1', '2', '3', '4'],
    points: 3,
  },
];

const mockSubmissions = [
  {
    id: 's1',
    student_name: 'John Doe',
    student_email: 'john@example.com',
    status: 'graded',
    final_score: 18,
    submitted_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 's2',
    student_name: 'Jane Smith',
    student_email: 'jane@example.com',
    status: 'submitted',
    final_score: null,
    submitted_at: '2024-01-16T11:00:00Z',
    created_at: '2024-01-16T11:00:00Z',
  },
];

describe('TeacherAssignmentDetailPage', () => {
  beforeEach(() => {
    (useParams as jest.Mock).mockReturnValue({ id: '6c2ac0c5-8c0e-492c-b53c-30a7b831cd85' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state correctly', () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({ data: null });
    (useSubmissions as jest.Mock).mockReturnValue({ data: null });

    render(<TeacherAssignmentDetailPage />);

    expect(screen.getByText('Chargement...')).toBeInTheDocument();
  });

  it('renders error state correctly', () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Failed to load'),
    });
    (useQuestions as jest.Mock).mockReturnValue({ data: null });
    (useSubmissions as jest.Mock).mockReturnValue({ data: null });

    render(<TeacherAssignmentDetailPage />);

    expect(screen.getByText('Erreur')).toBeInTheDocument();
    expect(screen.getByText('Impossible de charger les détails du devoir.')).toBeInTheDocument();
  });

  it('renders assignment details correctly', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Assignment')).toBeInTheDocument();
      expect(screen.getByText('Mathematics (MATH101)')).toBeInTheDocument();
      expect(screen.getByText('This is a test assignment')).toBeInTheDocument();
    });
  });

  it('displays correct statistics', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      // Total submissions: 2
      expect(screen.getByText('2')).toBeInTheDocument();
      // Graded submissions: 1
      expect(screen.getByText('1')).toBeInTheDocument();
      // Pending submissions: 1
      expect(screen.getByText('1')).toBeInTheDocument();
      // Average score: 18/20 = 18.0
      expect(screen.getByText('18.0/20')).toBeInTheDocument();
    });
  });

  it('shows evaluation-specific content for evaluations', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Questions (2)')).toBeInTheDocument();
      expect(screen.getByText('60 minutes')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument(); // max attempts
    });
  });

  it('shows homework-specific content for homework', async () => {
    const homeworkAssignment = {
      ...mockAssignment,
      type: 'homework',
    };

    (useAssignment as jest.Mock).mockReturnValue({
      data: homeworkAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: [] },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('10 MB')).toBeInTheDocument(); // max file size
      expect(screen.getByText('Autorisée')).toBeInTheDocument(); // late submission
      expect(screen.getByText('10%')).toBeInTheDocument(); // late penalty
    });
  });

  it('displays questions correctly', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
      expect(screen.getByText('Select all even numbers:')).toBeInTheDocument();
      expect(screen.getByText('Question 1 - 2 points')).toBeInTheDocument();
      expect(screen.getByText('Question 2 - 3 points')).toBeInTheDocument();
    });
  });

  it('displays submissions correctly', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      expect(screen.getByText('18/20')).toBeInTheDocument();
    });
  });

  it('has correct navigation links', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      const links = screen.getAllByTestId('link');
      const backLink = links.find(link => link.getAttribute('href') === '/teacher/assignments');
      const adminLink = links.find(link => 
        link.getAttribute('href') === `/academic/evaluations/${mockAssignment.id}`
      );
      
      expect(backLink).toBeInTheDocument();
      expect(adminLink).toBeInTheDocument();
    });
  });

  it('handles empty questions correctly', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: [] },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: mockSubmissions },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Aucune question')).toBeInTheDocument();
      expect(screen.getByText('Commencez par ajouter des questions à votre évaluation.')).toBeInTheDocument();
    });
  });

  it('handles empty submissions correctly', async () => {
    (useAssignment as jest.Mock).mockReturnValue({
      data: mockAssignment,
      isLoading: false,
      error: null,
    });
    (useQuestions as jest.Mock).mockReturnValue({
      data: { questions: mockQuestions },
    });
    (useSubmissions as jest.Mock).mockReturnValue({
      data: { submissions: [] },
    });

    render(<TeacherAssignmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Aucune soumission')).toBeInTheDocument();
      expect(screen.getByText('Les soumissions des étudiants apparaîtront ici.')).toBeInTheDocument();
    });
  });
});
