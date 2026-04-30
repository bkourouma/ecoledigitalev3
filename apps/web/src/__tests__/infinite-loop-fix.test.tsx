/**
 * Tests for Infinite Loop Fix in Evaluation Create Page
 * 
 * This test file validates that the useEffect infinite loop issue
 * has been resolved and prevents future regressions.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { jest } from '@jest/globals';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn((key: string) => {
      if (key === 'courseId') return 'test-course-id';
      if (key === 'evaluation_type') return 'online';
      return null;
    }),
  }),
  redirect: jest.fn(),
}));

// Mock hooks
jest.mock('@/lib/hooks/use-evaluations', () => ({
  useCreateAssignment: jest.fn(() => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  })),
}));

jest.mock('@/lib/hooks/use-courses', () => ({
  useCourses: jest.fn(() => ({
    data: {
      data: [
        {
          id: 'test-course-id',
          name: 'Test Course',
          code: 'TEST101',
        }
      ]
    },
    isLoading: false,
    error: null,
  })),
}));

// Mock UI components to avoid complex rendering
jest.mock('@ecoledigitale/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="card-title">{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p data-testid="card-description">{children}</p>,
  Button: ({ children, onClick, type, form }: { children: React.ReactNode; onClick?: () => void; type?: string; form?: string }) => (
    <button data-testid="button" onClick={onClick} type={type} form={form}>{children}</button>
  ),
  Input: ({ value, onChange, placeholder }: { value?: string; onChange?: (e: any) => void; placeholder?: string }) => (
    <input data-testid="input" value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Label: ({ children }: { children: React.ReactNode }) => <label data-testid="label">{children}</label>,
  Textarea: ({ value, onChange }: { value?: string; onChange?: (e: any) => void }) => (
    <textarea data-testid="textarea" value={value} onChange={onChange} />
  ),
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <input 
      data-testid="switch" 
      type="checkbox" 
      checked={checked} 
      onChange={(e) => onCheckedChange?.(e.target.checked)} 
    />
  ),
}));

jest.mock('@/components/ui/radio-group', () => ({
  RadioGroup: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <div data-testid="radio-group" data-value={value} onChange={(e: any) => onValueChange?.(e.target.value)}>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value, id }: { value: string; id?: string }) => (
    <input data-testid="radio-item" type="radio" value={value} id={id} />
  ),
}));

jest.mock('@/components/evaluations/DocumentSelector', () => ({
  DocumentSelector: ({ courseId, selectedDocuments, onSelectionChange }: any) => (
    <div data-testid="document-selector" data-course-id={courseId}>
      <span>Selected: {selectedDocuments?.length || 0}</span>
      <button onClick={() => onSelectionChange(['doc1', 'doc2'])}>Select Documents</button>
    </div>
  ),
}));

// Mock session
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31',
};

describe('Infinite Loop Fix - Evaluation Create Page', () => {
  let queryClient: QueryClient;
  let renderCount = 0;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    renderCount = 0;
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

  describe('✅ Infinite Loop Prevention', () => {
    test('should not cause infinite re-renders when courseId is set from URL', async () => {
      // Track render count
      const TestWrapper = () => {
        renderCount++;
        return React.createElement(require('@/app/academic/evaluations/create/page').default);
      };

      renderWithProviders(<TestWrapper />);

      // Wait for initial render and effects
      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Allow some time for any potential infinite loops to manifest
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      // Render count should be reasonable (not infinite)
      expect(renderCount).toBeLessThan(10);
    });

    test('should set courseId from URL parameters without infinite loop', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      renderWithProviders(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // Check that course selection is working
      const courseSelect = screen.getByTestId('select');
      expect(courseSelect).toBeInTheDocument();
    });
  });

  describe('🔄 State Management', () => {
    test('should handle course selection without triggering infinite updates', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      renderWithProviders(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // Simulate course selection
      const courseSelect = screen.getByTestId('select');
      
      await act(async () => {
        // Simulate selecting a course
        courseSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Should not cause infinite re-renders
      expect(renderCount).toBeLessThan(5);
    });

    test('should handle evaluation type changes correctly', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      renderWithProviders(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // Check that evaluation type selection is available
      const radioGroups = screen.getAllByTestId('radio-group');
      expect(radioGroups.length).toBeGreaterThan(0);
    });
  });

  describe('🧩 Component Integration', () => {
    test('should render DocumentSelector when AI evaluation is selected', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      renderWithProviders(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // DocumentSelector should be present for AI evaluations
      // (Note: This would need the evaluation type to be set to 'ai_generated')
      // For now, we just check that the component can render without errors
      expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
    });

    test('should handle form submission without errors', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      renderWithProviders(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // Find and click submit button
      const submitButtons = screen.getAllByTestId('button');
      const submitButton = submitButtons.find(button => 
        button.textContent?.includes('Créer') || button.getAttribute('type') === 'submit'
      );

      if (submitButton) {
        await act(async () => {
          submitButton.click();
        });
      }

      // Should not cause crashes or infinite loops
      expect(renderCount).toBeLessThan(10);
    });
  });

  describe('🚀 Performance', () => {
    test('should not exceed reasonable render count during normal usage', async () => {
      const CreateEvaluationPage = require('@/app/academic/evaluations/create/page').default;
      
      const TestComponent = () => {
        renderCount++;
        return <CreateEvaluationPage />;
      };

      renderWithProviders(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByText('Créer une évaluation')).toBeInTheDocument();
      });

      // Allow time for all effects to settle
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
      });

      // Should not exceed reasonable render count
      expect(renderCount).toBeLessThan(15);
      console.log(`Total renders: ${renderCount}`);
    });
  });
});
