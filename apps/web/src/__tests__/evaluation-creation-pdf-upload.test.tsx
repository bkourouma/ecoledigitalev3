/**
 * Test suite for PDF upload functionality in evaluation creation
 * 
 * This test ensures that the PDF upload functionality is consistently available
 * for all users when creating PDF evaluations, regardless of how they access the page.
 * 
 * Bug fixed: Teachers were not seeing PDF upload option when accessing via URL with evaluation_type=pdf
 * Root cause: contentType state was not being set to "pdf" when URL parameter was processed
 * Solution: Added setContentType("pdf") when evaluation_type=pdf is detected in URL
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import CreateEvaluationPage from '../app/academic/evaluations/create/page';

// Mock Next.js navigation hooks
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mock the hooks used in the component
jest.mock('../lib/hooks/use-evaluations', () => ({
  useCreateAssignment: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
}));

jest.mock('../lib/hooks/use-courses', () => ({
  useCourses: jest.fn(() => ({
    data: {
      data: [
        { id: 'course-1', name: 'Test Course 1' },
        { id: 'course-2', name: 'Test Course 2' },
      ],
    },
  })),
}));

jest.mock('../components/evaluations/DocumentSelector', () => {
  return function MockDocumentSelector() {
    return <div data-testid="document-selector">Document Selector</div>;
  };
});

describe('PDF Upload Functionality in Evaluation Creation', () => {
  const mockPush = jest.fn();
  const mockSearchParams = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
  });

  describe('URL Parameter Processing', () => {
    test('should show PDF upload when evaluation_type=pdf in URL', async () => {
      // Simulate URL: /academic/evaluations/create?courseId=test&evaluation_type=pdf
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'pdf';
        return null;
      });

      render(<CreateEvaluationPage />);

      // Wait for the component to process URL parameters and update state
      await waitFor(() => {
        // Check that homework section is rendered (isHomework = true)
        expect(screen.getByText('Paramètres du devoir')).toBeInTheDocument();
      });

      // Check that PDF content type is selected by default
      await waitFor(() => {
        const pdfRadio = screen.getByLabelText('Document PDF');
        expect(pdfRadio).toBeChecked();
      });

      // Check that PDF upload section is visible
      expect(screen.getByText('Document PDF du sujet *')).toBeInTheDocument();
      expect(screen.getByText('Cliquez pour sélectionner un fichier PDF')).toBeInTheDocument();
    });

    test('should not show PDF upload when evaluation_type=online in URL', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'online';
        return null;
      });

      render(<CreateEvaluationPage />);

      await waitFor(() => {
        // Should not show homework section for online evaluations
        expect(screen.queryByText('Paramètres du devoir')).not.toBeInTheDocument();
      });

      // Should not show PDF upload
      expect(screen.queryByText('Document PDF du sujet *')).not.toBeInTheDocument();
    });

    test('should not show PDF upload when evaluation_type=ai_generated in URL', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'ai_generated';
        return null;
      });

      render(<CreateEvaluationPage />);

      await waitFor(() => {
        // Should show AI configuration section instead
        expect(screen.getByText('Configuration de l\'évaluation IA')).toBeInTheDocument();
      });

      // Should not show PDF upload
      expect(screen.queryByText('Document PDF du sujet *')).not.toBeInTheDocument();
    });
  });

  describe('Manual Type Selection', () => {
    test('should show PDF upload when user manually selects PDF type', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        return null; // No evaluation_type in URL
      });

      render(<CreateEvaluationPage />);

      // Find and click the PDF evaluation type button
      const pdfButton = screen.getByText('Devoir PDF');
      fireEvent.click(pdfButton);

      await waitFor(() => {
        // Check that homework section appears
        expect(screen.getByText('Paramètres du devoir')).toBeInTheDocument();
      });

      // Check that PDF content type is selected
      await waitFor(() => {
        const pdfRadio = screen.getByLabelText('Document PDF');
        expect(pdfRadio).toBeChecked();
      });

      // Check that PDF upload section is visible
      expect(screen.getByText('Document PDF du sujet *')).toBeInTheDocument();
      expect(screen.getByText('Cliquez pour sélectionner un fichier PDF')).toBeInTheDocument();
    });

    test('should hide PDF upload when switching from PDF to online type', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'pdf';
        return null;
      });

      render(<CreateEvaluationPage />);

      // Wait for PDF type to be set from URL
      await waitFor(() => {
        expect(screen.getByText('Paramètres du devoir')).toBeInTheDocument();
      });

      // Switch to online evaluation
      const onlineButton = screen.getByText('En ligne (QCM)');
      fireEvent.click(onlineButton);

      await waitFor(() => {
        // Homework section should disappear
        expect(screen.queryByText('Paramètres du devoir')).not.toBeInTheDocument();
      });

      // PDF upload should not be visible
      expect(screen.queryByText('Document PDF du sujet *')).not.toBeInTheDocument();
    });
  });

  describe('Content Type Toggle', () => {
    test('should toggle between text and PDF content types in homework mode', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'pdf';
        return null;
      });

      render(<CreateEvaluationPage />);

      await waitFor(() => {
        expect(screen.getByText('Paramètres du devoir')).toBeInTheDocument();
      });

      // Initially PDF should be selected
      const pdfRadio = screen.getByLabelText('Document PDF');
      const textRadio = screen.getByLabelText('Texte descriptif');
      
      expect(pdfRadio).toBeChecked();
      expect(screen.getByText('Document PDF du sujet *')).toBeInTheDocument();

      // Switch to text content type
      fireEvent.click(textRadio);

      await waitFor(() => {
        expect(textRadio).toBeChecked();
        expect(screen.getByText('Description du sujet *')).toBeInTheDocument();
        expect(screen.queryByText('Document PDF du sujet *')).not.toBeInTheDocument();
      });

      // Switch back to PDF content type
      fireEvent.click(pdfRadio);

      await waitFor(() => {
        expect(pdfRadio).toBeChecked();
        expect(screen.getByText('Document PDF du sujet *')).toBeInTheDocument();
        expect(screen.queryByText('Description du sujet *')).not.toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle missing courseId parameter gracefully', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'evaluation_type') return 'pdf';
        return null; // No courseId
      });

      render(<CreateEvaluationPage />);

      // Should still process evaluation_type parameter
      await waitFor(() => {
        expect(screen.getByText('Paramètres du devoir')).toBeInTheDocument();
      });
    });

    test('should handle invalid evaluation_type parameter gracefully', async () => {
      mockSearchParams.get.mockImplementation((param: string) => {
        if (param === 'courseId') return 'test-course-id';
        if (param === 'evaluation_type') return 'invalid_type';
        return null;
      });

      render(<CreateEvaluationPage />);

      // Should default to online evaluation
      await waitFor(() => {
        expect(screen.queryByText('Paramètres du devoir')).not.toBeInTheDocument();
      });
    });
  });
});
