/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AjouterClassePage from '../app/annee-academique/ajouter-classe/page';

// Mock the hooks
jest.mock('../lib/hooks/use-academic-years', () => ({
  useActiveAcademicYear: () => ({
    data: {
      data: {
        id: '1',
        name: '2023-2024',
        startDate: '2023-09-01',
        endDate: '2024-06-30',
        isActive: true
      }
    }
  })
}));

jest.mock('../lib/hooks/use-programmes', () => ({
  useProgrammes: () => ({
    data: {
      data: [
        { id: '1', name: 'BTS Informatique', code: 'BTS-INFO', status: 'active' }
      ]
    }
  })
}));

jest.mock('../lib/hooks/use-classes', () => ({
  useCreateClass: () => ({ mutateAsync: jest.fn() }),
  useAvailableCourses: () => ({ data: { data: [] } }),
  useClassesByProgramme: () => ({ data: { data: [] } }),
  useUpdateClass: () => ({ mutateAsync: jest.fn() }),
  useDeleteClass: () => ({ mutateAsync: jest.fn() }),
  useClass: () => ({ data: null }),
  useClasses: () => ({ data: { data: [] } })
}));

jest.mock('../lib/hooks/use-classrooms', () => ({
  useClassrooms: () => ({
    data: {
      data: [
        { id: '1', name: 'Salle A', code: 'A01', capacity: 30, isActive: true }
      ]
    }
  })
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock react-hook-form
jest.mock('react-hook-form', () => ({
  useForm: () => ({
    register: jest.fn(),
    handleSubmit: jest.fn(),
    formState: { errors: {}, isSubmitting: false },
    setValue: jest.fn(),
    watch: jest.fn(() => ''),
    reset: jest.fn()
  })
}));

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark">
        {children}
      </div>
    </QueryClientProvider>
  );
};

describe('Text Visibility Tests', () => {
  beforeEach(() => {
    // Set up dark mode for testing
    document.documentElement.classList.add('dark');
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  describe('AjouterClassePage Text Visibility', () => {
    it('should render with proper theme-aware text colors', () => {
      render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check that main heading is visible
      const heading = screen.getByText('Classes');
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveClass('text-foreground');
    });

    it('should use theme-aware colors for muted text', () => {
      render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check for muted text elements
      const description = screen.getByText(/Gérez les classes pour l'année académique/);
      expect(description).toBeInTheDocument();
      expect(description).toHaveClass('text-muted-foreground');
    });

    it('should not use hardcoded gray colors', () => {
      const { container } = render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check that no elements use problematic gray colors
      const elementsWithGray900 = container.querySelectorAll('.text-gray-900');
      const elementsWithGray600 = container.querySelectorAll('.text-gray-600');
      const elementsWithGray500 = container.querySelectorAll('.text-gray-500');

      expect(elementsWithGray900).toHaveLength(0);
      expect(elementsWithGray600).toHaveLength(0);
      expect(elementsWithGray500).toHaveLength(0);
    });

    it('should use proper border colors', () => {
      const { container } = render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check for theme-aware border colors
      const elementsWithBorderBorder = container.querySelectorAll('.border-border');
      expect(elementsWithBorderBorder.length).toBeGreaterThan(0);

      // Check that no elements use hardcoded gray borders
      const elementsWithGrayBorder = container.querySelectorAll('.border-gray-100, .border-gray-300');
      expect(elementsWithGrayBorder).toHaveLength(0);
    });

    it('should use theme-aware hover states', () => {
      const { container } = render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check for theme-aware hover backgrounds
      const elementsWithMutedHover = container.querySelectorAll('.hover\\:bg-muted\\/50');
      expect(elementsWithMutedHover.length).toBeGreaterThan(0);

      // Check that no elements use hardcoded gray hover states
      const elementsWithGrayHover = container.querySelectorAll('.hover\\:bg-gray-100');
      expect(elementsWithGrayHover).toHaveLength(0);
    });
  });

  describe('CSS Variables and Theme Support', () => {
    it('should have proper CSS variables defined', () => {
      // Check that CSS variables are properly defined
      const computedStyle = getComputedStyle(document.documentElement);
      
      // These should be defined in the CSS
      expect(computedStyle.getPropertyValue('--foreground')).toBeTruthy();
      expect(computedStyle.getPropertyValue('--muted-foreground')).toBeTruthy();
      expect(computedStyle.getPropertyValue('--border')).toBeTruthy();
      expect(computedStyle.getPropertyValue('--card')).toBeTruthy();
      expect(computedStyle.getPropertyValue('--card-foreground')).toBeTruthy();
    });

    it('should apply dark mode classes correctly', () => {
      document.documentElement.classList.add('dark');
      
      const computedStyle = getComputedStyle(document.documentElement);
      
      // In dark mode, these should have appropriate values
      const foreground = computedStyle.getPropertyValue('--foreground');
      const background = computedStyle.getPropertyValue('--background');
      
      expect(foreground).toBeTruthy();
      expect(background).toBeTruthy();
      
      document.documentElement.classList.remove('dark');
    });
  });

  describe('Accessibility and Contrast', () => {
    it('should maintain proper contrast ratios', () => {
      render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Check that text elements use appropriate contrast classes
      const foregroundElements = screen.getAllByText(/Classes|Gérez|Programme|Nom/);
      foregroundElements.forEach(element => {
        // Should use theme-aware text colors
        expect(element.className).toMatch(/text-(foreground|muted-foreground|primary|destructive)/);
      });
    });

    it('should be readable in dark mode', () => {
      document.documentElement.classList.add('dark');
      
      render(
        <TestWrapper>
          <AjouterClassePage />
        </TestWrapper>
      );

      // Main heading should be visible
      const heading = screen.getByText('Classes');
      expect(heading).toBeVisible();
      
      // Description should be visible
      const description = screen.getByText(/Gérez les classes/);
      expect(description).toBeVisible();
      
      document.documentElement.classList.remove('dark');
    });
  });
});
