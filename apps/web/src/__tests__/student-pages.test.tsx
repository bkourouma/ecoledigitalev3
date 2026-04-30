/**
 * Test file for student-related pages to verify Next.js 15 params handling
 * and ensure all pages load correctly without console errors
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { jest } from '@jest/globals';

// Mock Next.js navigation hooks
jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// Mock the student hooks
jest.mock('@/lib/hooks/use-students', () => ({
  useStudent: jest.fn(),
  useUpdateStudent: jest.fn(),
  useCreateStudent: jest.fn(),
  useDeleteStudent: jest.fn(),
  useStudents: jest.fn(),
  generateMatricule: jest.fn(),
}));

jest.mock('@/lib/hooks/use-academic-years', () => ({
  useAcademicYears: jest.fn(),
  useActiveAcademicYear: jest.fn(),
}));

jest.mock('@/lib/hooks/use-programmes', () => ({
  useProgrammes: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

// Mock UI components
jest.mock('@ecoledigitale/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="card-title">{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p data-testid="card-description">{children}</p>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => 
    <button data-testid="button" onClick={onClick}>{children}</button>,
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
  Input: (props: any) => <input data-testid="input" {...props} />,
  Label: ({ children }: { children: React.ReactNode }) => <label data-testid="label">{children}</label>,
  Textarea: (props: any) => <textarea data-testid="textarea" {...props} />,
  Select: ({ children }: { children: React.ReactNode }) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div data-testid="select-item">{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <div data-testid="select-value">{children}</div>,
}));

// Mock other components
jest.mock('@/components/ui/separator', () => ({
  Separator: () => <hr data-testid="separator" />,
}));

jest.mock('@/components/DatePickerFr', () => ({
  __esModule: true,
  default: (props: any) => <input data-testid="date-picker" {...props} />,
}));

// Import components after mocking
import StudentDetailPage from '@/app/academic/students/[id]/page';
import EditStudentPage from '@/app/academic/students/[id]/edit/page';
import StudentsPage from '@/app/academic/students/page';
import NewStudentPage from '@/app/academic/students/new/page';

// Mock student data
const mockStudent = {
  id: '67c4dae5-66a7-4213-b178-9e5935c96d5f',
  studentNumber: 'STU2024001',
  currentYear: 1,
  status: 'active' as const,
  dateOfBirth: '2000-01-01T00:00:00Z',
  placeOfBirth: 'Paris',
  nationality: 'Française',
  address: '123 Rue de la Paix, Paris',
  phone: '+33123456789',
  emergencyPhone: '+33987654321',
  bio: 'Étudiant motivé',
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  user: {
    id: 'user-id',
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean.dupont@example.com',
    name: 'Jean Dupont',
  },
};

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('Student Pages - Next.js 15 Params Handling', () => {
  const mockUseParams = useParams as jest.MockedFunction<typeof useParams>;
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
  const mockPush = jest.fn();
  const mockBack = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockUseRouter.mockReturnValue({
      push: mockPush,
      back: mockBack,
      forward: jest.fn(),
      refresh: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
    });

    // Mock console methods to catch any warnings
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { useAcademicYears, useActiveAcademicYear } = require('@/lib/hooks/use-academic-years');
    const { useProgrammes } = require('@/lib/hooks/use-programmes');
    const { useSession } = require('next-auth/react');

    useAcademicYears.mockReturnValue({ data: { data: [] } });
    useActiveAcademicYear.mockReturnValue({ data: { data: { id: 'year-1', name: '2025-2026' } } });
    useProgrammes.mockReturnValue({ data: { data: [] } });
    useSession.mockReturnValue({ data: { roles: ['admin'] } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('StudentDetailPage', () => {
    beforeEach(() => {
      mockUseParams.mockReturnValue({ id: '67c4dae5-66a7-4213-b178-9e5935c96d5f' });
      
      const { useStudent } = require('@/lib/hooks/use-students');
      useStudent.mockReturnValue({
        data: mockStudent,
        isLoading: false,
        error: null,
      });
    });

    it('should render without Next.js params warnings', async () => {
      renderWithQueryClient(<StudentDetailPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Profil étudiant')).toBeInTheDocument();
      });

      // Verify no console warnings about params access
      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('param property was accessed directly')
      );
      expect(console.error).not.toHaveBeenCalledWith(
        expect.stringContaining('param property was accessed directly')
      );
    });

    it('should use useParams hook correctly', () => {
      renderWithQueryClient(<StudentDetailPage />);
      
      expect(mockUseParams).toHaveBeenCalled();
      expect(useParams).toHaveBeenCalledTimes(1);
    });

    it('should handle student data loading', async () => {
      renderWithQueryClient(<StudentDetailPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Profil étudiant')).toBeInTheDocument();
        expect(screen.getByText(`Matricule: ${mockStudent.studentNumber}`)).toBeInTheDocument();
      });
    });

    it('should handle loading state', () => {
      const { useStudent } = require('@/lib/hooks/use-students');
      useStudent.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });

      renderWithQueryClient(<StudentDetailPage />);
      
      expect(screen.getByTestId('card')).toBeInTheDocument();
    });

    it('should handle error state', () => {
      const { useStudent } = require('@/lib/hooks/use-students');
      useStudent.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Student not found'),
      });

      renderWithQueryClient(<StudentDetailPage />);
      
      expect(screen.getByText(/Erreur:/)).toBeInTheDocument();
    });
  });

  describe('EditStudentPage', () => {
    beforeEach(() => {
      mockUseParams.mockReturnValue({ id: '67c4dae5-66a7-4213-b178-9e5935c96d5f' });
      
      const { useStudent, useUpdateStudent } = require('@/lib/hooks/use-students');
      useStudent.mockReturnValue({
        data: mockStudent,
        isLoading: false,
        error: null,
      });
      useUpdateStudent.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      });
    });

    it('should render without Next.js params warnings', async () => {
      renderWithQueryClient(<EditStudentPage />);
      
      await waitFor(() => {
        expect(screen.getByText('Modifier l\'étudiant')).toBeInTheDocument();
      });

      // Verify no console warnings about params access
      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('param property was accessed directly')
      );
    });

    it('should use useParams hook correctly', () => {
      renderWithQueryClient(<EditStudentPage />);
      
      expect(mockUseParams).toHaveBeenCalled();
    });
  });

  describe('StudentsPage', () => {
    beforeEach(() => {
      const { useStudents, useDeleteStudent } = require('@/lib/hooks/use-students');
      useStudents.mockReturnValue({
        data: { data: [mockStudent], pagination: { total: 1, page: 1, limit: 20, totalPages: 1 } },
        isLoading: false,
        error: null,
      });
      useDeleteStudent.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      });
    });

    it('should render students list without params issues', () => {
      renderWithQueryClient(<StudentsPage />);
      
      expect(screen.getByText('Gestion des étudiants')).toBeInTheDocument();
      
      // Should not call useParams since it's not a dynamic route
      expect(mockUseParams).not.toHaveBeenCalled();
    });
  });

  describe('NewStudentPage', () => {
    beforeEach(() => {
      const { useCreateStudent, generateMatricule } = require('@/lib/hooks/use-students');
      useCreateStudent.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      });
      generateMatricule.mockReturnValue('STU2024002');
    });

    it('should render new student form without params issues', () => {
      renderWithQueryClient(<NewStudentPage />);
      
      expect(screen.getByText('Nouvel étudiant')).toBeInTheDocument();
      
      // Should not call useParams since it's not a dynamic route
      expect(mockUseParams).not.toHaveBeenCalled();
    });
  });
});

describe('Integration Tests', () => {
  const mockUseParams = useParams as jest.MockedFunction<typeof useParams>;
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockUseRouter.mockReturnValue({
      push: mockPush,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
    });

    mockUseParams.mockReturnValue({ id: '67c4dae5-66a7-4213-b178-9e5935c96d5f' });

    const { useAcademicYears, useActiveAcademicYear } = require('@/lib/hooks/use-academic-years');
    const { useProgrammes } = require('@/lib/hooks/use-programmes');
    const { useSession } = require('next-auth/react');

    useAcademicYears.mockReturnValue({ data: { data: [] } });
    useActiveAcademicYear.mockReturnValue({ data: { data: { id: 'year-1', name: '2025-2026' } } });
    useProgrammes.mockReturnValue({ data: { data: [] } });
    useSession.mockReturnValue({ data: { roles: ['admin'] } });
  });

  it('should navigate between student pages correctly', async () => {
    const { useStudent } = require('@/lib/hooks/use-students');
    useStudent.mockReturnValue({
      data: mockStudent,
      isLoading: false,
      error: null,
    });

    renderWithQueryClient(<StudentDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Modifier')).toBeInTheDocument();
    });

    // Simulate clicking edit button
    const editButton = screen.getByText('Modifier');
    editButton.click();

    expect(mockPush).toHaveBeenCalledWith('/academic/students/67c4dae5-66a7-4213-b178-9e5935c96d5f/edit');
  });
});
