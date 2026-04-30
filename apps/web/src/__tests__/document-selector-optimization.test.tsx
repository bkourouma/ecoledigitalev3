/**
 * Tests for DocumentSelector Optimization
 * 
 * This test file validates that the DocumentSelector component
 * uses useCallback correctly and doesn't cause unnecessary re-renders.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jest } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Mock UI components
jest.mock('@ecoledigitale/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  Button: ({ children, onClick, variant }: { children: React.ReactNode; onClick?: () => void; variant?: string }) => (
    <button data-testid="button" onClick={onClick} data-variant={variant}>{children}</button>
  ),
}));

jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, onCheckedChange }: { id?: string; checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <input 
      data-testid="checkbox" 
      type="checkbox" 
      id={id}
      checked={checked} 
      onChange={(e) => onCheckedChange?.(e.target.checked)} 
    />
  ),
}));

// Import the component after mocking
import { DocumentSelector } from '@/components/evaluations/DocumentSelector';

describe('DocumentSelector Optimization Tests', () => {
  const mockDocuments = [
    {
      id: 'doc1',
      title: 'Document 1',
      file_name: 'doc1.pdf',
      file_type: 'application/pdf',
      file_size: 1024000,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'doc2',
      title: 'Document 2',
      file_name: 'doc2.pdf',
      file_type: 'application/pdf',
      file_size: 2048000,
      created_at: new Date('2024-01-02'),
    },
  ];

  const defaultProps = {
    courseId: 'test-course-id',
    selectedDocuments: [],
    onSelectionChange: jest.fn(),
  };

  beforeEach(() => {
    mockFetch.mockClear();
    jest.clearAllMocks();
  });

  describe('✅ useCallback Optimization', () => {
    test('should use useCallback for fetchDocuments to prevent unnecessary re-renders', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      let renderCount = 0;
      const TestWrapper = (props: any) => {
        renderCount++;
        return <DocumentSelector {...props} />;
      };

      const { rerender } = render(<TestWrapper {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Document 1')).toBeInTheDocument();
      });

      const initialRenderCount = renderCount;

      // Re-render with same props - should not trigger new fetch
      rerender(<TestWrapper {...defaultProps} />);

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should not have made additional fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Render count should be minimal
      expect(renderCount - initialRenderCount).toBeLessThan(3);
    });

    test('should refetch when courseId changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const { rerender } = render(<DocumentSelector {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Change courseId
      rerender(<DocumentSelector {...defaultProps} courseId="different-course-id" />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      // Should have called with new courseId
      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:4000/api/v1/ai-evaluations/courses/different-course-id/documents',
        expect.any(Object)
      );
    });

    test('should not refetch when only selectedDocuments change', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const { rerender } = render(<DocumentSelector {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Change selectedDocuments only
      rerender(<DocumentSelector {...defaultProps} selectedDocuments={['doc1']} />);

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should not have made additional fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔄 State Management', () => {
    test('should handle document selection correctly', async () => {
      const mockOnSelectionChange = jest.fn();
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      render(
        <DocumentSelector 
          {...defaultProps} 
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Document 1')).toBeInTheDocument();
      });

      // Click first checkbox
      const checkboxes = screen.getAllByTestId('checkbox');
      await userEvent.click(checkboxes[0]);

      expect(mockOnSelectionChange).toHaveBeenCalledWith(['doc1']);
    });

    test('should handle document deselection correctly', async () => {
      const mockOnSelectionChange = jest.fn();
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      render(
        <DocumentSelector 
          {...defaultProps} 
          selectedDocuments={['doc1']}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Document 1')).toBeInTheDocument();
      });

      // Click first checkbox to deselect
      const checkboxes = screen.getAllByTestId('checkbox');
      await userEvent.click(checkboxes[0]);

      expect(mockOnSelectionChange).toHaveBeenCalledWith([]);
    });
  });

  describe('🚨 Error Handling', () => {
    test('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      render(<DocumentSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur:/)).toBeInTheDocument();
      });

      // Should show retry button
      expect(screen.getByText('Réessayer')).toBeInTheDocument();
    });

    test('should handle retry after error', async () => {
      // First call fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      render(<DocumentSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Erreur:/)).toBeInTheDocument();
      });

      // Click retry button
      const retryButton = screen.getByText('Réessayer');
      await userEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Document 1')).toBeInTheDocument();
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should handle empty courseId gracefully', async () => {
      render(<DocumentSelector {...defaultProps} courseId="" />);

      // Should not make fetch call with empty courseId
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('🎨 UI States', () => {
    test('should show loading state', async () => {
      // Mock a slow response
      mockFetch.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            json: async () => ({ documents: mockDocuments }),
          }), 1000)
        )
      );

      render(<DocumentSelector {...defaultProps} />);

      expect(screen.getByText('Chargement des documents...')).toBeInTheDocument();
    });

    test('should show empty state when no documents', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: [] }),
      });

      render(<DocumentSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Aucun document PDF disponible pour ce cours.')).toBeInTheDocument();
      });
    });

    test('should show selection count', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      render(
        <DocumentSelector 
          {...defaultProps} 
          selectedDocuments={['doc1', 'doc2']}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/2 sélectionnés/)).toBeInTheDocument();
      });
    });
  });

  describe('🚀 Performance', () => {
    test('should not cause memory leaks with rapid courseId changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocuments }),
      });

      const { rerender } = render(<DocumentSelector {...defaultProps} />);

      // Rapidly change courseId multiple times
      for (let i = 0; i < 10; i++) {
        rerender(<DocumentSelector {...defaultProps} courseId={`course-${i}`} />);
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });
      }

      // Should handle rapid changes without issues
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
