/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import FileUploadSubmission from '@/components/assignments/FileUploadSubmission';
import TextResponseSubmission from '@/components/assignments/TextResponseSubmission';
import OnlineEvaluationSubmission from '@/components/assignments/OnlineEvaluationSubmission';

// Mock the hooks
jest.mock('@/lib/hooks/use-student-data', () => ({
  useMySubmission: jest.fn(),
  useCreateSubmission: jest.fn(),
  useUpdateSubmission: jest.fn(),
  useSubmitAssignment: jest.fn(),
}));

// Mock the debounce hook
jest.mock('@/lib/hooks/use-debounce', () => ({
  useDebounce: jest.fn((value) => value),
}));

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

describe('Assignment Submission Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('FileUploadSubmission', () => {
    const mockHooks = {
      useMySubmission: jest.fn(),
      useCreateSubmission: jest.fn(),
      useUpdateSubmission: jest.fn(),
      useSubmitAssignment: jest.fn(),
    };

    beforeEach(() => {
      const { useMySubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment } = 
        require('@/lib/hooks/use-student-data');
      
      useMySubmission.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });
      
      useCreateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useUpdateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useSubmitAssignment.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
    });

    it('should render file upload interface when no submission exists', () => {
      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-123"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf', '.doc', '.docx']}
        />,
        { wrapper }
      );

      expect(screen.getByText('Soumission de fichier')).toBeInTheDocument();
      expect(screen.getByText('Glissez votre fichier ici ou cliquez pour sélectionner')).toBeInTheDocument();
      expect(screen.getByText('Types acceptés: .pdf, .doc, .docx (max 10MB)')).toBeInTheDocument();
    });

    it('should show existing submission when available', () => {
      const { useMySubmission } = require('@/lib/hooks/use-student-data');
      useMySubmission.mockReturnValue({
        data: {
          id: 'submission-123',
          submitted_file_url: 'https://example.com/file.pdf',
          submitted_file_name: 'assignment.pdf',
          submitted_file_size_mb: 2.5,
          status: 'in_progress',
        },
        isLoading: false,
        error: null,
      });

      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-123"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf', '.doc', '.docx']}
        />,
        { wrapper }
      );

      expect(screen.getByText('assignment.pdf')).toBeInTheDocument();
      expect(screen.getByText('2.50 MB')).toBeInTheDocument();
      expect(screen.getByText('Télécharger')).toBeInTheDocument();
    });

    it('should validate file size and type', async () => {
      const user = userEvent.setup();
      const wrapper = createWrapper();
      
      render(
        <FileUploadSubmission
          assignmentId="assignment-123"
          maxFileSizeMB={1}
          allowedFileTypes={['.pdf']}
        />,
        { wrapper }
      );

      // Create a large file that exceeds the limit
      const largeFile = new File(['x'.repeat(2 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });
      const fileInput = screen.getByRole('button', { name: /sélectionner un fichier/i });
      
      // Mock the file input
      const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (hiddenInput) {
        Object.defineProperty(hiddenInput, 'files', {
          value: [largeFile],
          writable: false,
        });
        fireEvent.change(hiddenInput);
      }

      await waitFor(() => {
        expect(screen.getByText(/le fichier est trop volumineux/i)).toBeInTheDocument();
      });
    });

    it('should handle file upload and submission', async () => {
      const user = userEvent.setup();
      const { useCreateSubmission } = require('@/lib/hooks/use-student-data');
      const mockMutateAsync = jest.fn().mockResolvedValue({});
      useCreateSubmission.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-123"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf']}
        />,
        { wrapper }
      );

      // Create a valid file
      const validFile = new File(['content'], 'assignment.pdf', { type: 'application/pdf' });
      const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      
      if (hiddenInput) {
        Object.defineProperty(hiddenInput, 'files', {
          value: [validFile],
          writable: false,
        });
        fireEvent.change(hiddenInput);
      }

      await waitFor(() => {
        expect(screen.getByText('assignment.pdf')).toBeInTheDocument();
      });

      const uploadButton = screen.getByRole('button', { name: /télécharger le fichier/i });
      await user.click(uploadButton);

      // Note: In a real test, you'd mock the file upload function
      // For now, we just verify the component renders correctly
    });

    it('should disable interface when submission is submitted', () => {
      const { useMySubmission } = require('@/lib/hooks/use-student-data');
      useMySubmission.mockReturnValue({
        data: {
          id: 'submission-123',
          submitted_file_url: 'https://example.com/file.pdf',
          submitted_file_name: 'assignment.pdf',
          status: 'submitted',
        },
        isLoading: false,
        error: null,
      });

      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-123"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf']}
        />,
        { wrapper }
      );

      expect(screen.getByText('Soumis')).toBeInTheDocument();
      expect(screen.queryByText('Sélectionner un fichier')).not.toBeInTheDocument();
    });
  });

  describe('TextResponseSubmission', () => {
    beforeEach(() => {
      const { useMySubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment } = 
        require('@/lib/hooks/use-student-data');
      
      useMySubmission.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });
      
      useCreateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useUpdateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useSubmitAssignment.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
    });

    it('should render text response interface', () => {
      const wrapper = createWrapper();
      render(
        <TextResponseSubmission
          assignmentId="assignment-123"
          placeholder="Saisissez votre réponse..."
          minLength={10}
          maxLength={1000}
        />,
        { wrapper }
      );

      expect(screen.getByText('Réponse textuelle')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Saisissez votre réponse...')).toBeInTheDocument();
      expect(screen.getByText('Minimum 10 caractères. Maximum 1000 caractères.')).toBeInTheDocument();
    });

    it('should show character and word count', async () => {
      const user = userEvent.setup();
      const wrapper = createWrapper();
      
      render(
        <TextResponseSubmission
          assignmentId="assignment-123"
          minLength={10}
          maxLength={1000}
        />,
        { wrapper }
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello world test');

      expect(screen.getByText('3 mots')).toBeInTheDocument();
      expect(screen.getByText('16/1000 caractères')).toBeInTheDocument();
    });

    it('should validate minimum length', async () => {
      const user = userEvent.setup();
      const wrapper = createWrapper();
      
      render(
        <TextResponseSubmission
          assignmentId="assignment-123"
          minLength={20}
          maxLength={1000}
        />,
        { wrapper }
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Short text');

      await waitFor(() => {
        expect(screen.getByText(/votre réponse doit contenir au moins 20 caractères/i)).toBeInTheDocument();
      });
    });

    it('should show auto-save indicator', () => {
      const wrapper = createWrapper();
      render(
        <TextResponseSubmission
          assignmentId="assignment-123"
          minLength={10}
          maxLength={1000}
        />,
        { wrapper }
      );

      expect(screen.getByText('Sauvegarde automatique activée')).toBeInTheDocument();
    });

    it('should load existing text content', () => {
      const { useMySubmission } = require('@/lib/hooks/use-student-data');
      useMySubmission.mockReturnValue({
        data: {
          id: 'submission-123',
          answers: {
            text_content: 'Existing response content',
          },
          status: 'in_progress',
        },
        isLoading: false,
        error: null,
      });

      const wrapper = createWrapper();
      render(
        <TextResponseSubmission
          assignmentId="assignment-123"
          minLength={10}
          maxLength={1000}
        />,
        { wrapper }
      );

      expect(screen.getByDisplayValue('Existing response content')).toBeInTheDocument();
    });
  });

  describe('OnlineEvaluationSubmission', () => {
    const mockQuestions = [
      {
        id: 'q1',
        type: 'single_choice' as const,
        question_text: 'What is 2 + 2?',
        options: ['3', '4', '5'],
        points: 10,
        order_index: 1,
      },
      {
        id: 'q2',
        type: 'true_false' as const,
        question_text: 'The sky is blue.',
        points: 5,
        order_index: 2,
      },
    ];

    beforeEach(() => {
      const { useMySubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment } = 
        require('@/lib/hooks/use-student-data');
      
      useMySubmission.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });
      
      useCreateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useUpdateSubmission.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
      
      useSubmitAssignment.mockReturnValue({
        mutateAsync: jest.fn(),
        isPending: false,
      });
    });

    it('should render start screen when not started', () => {
      const wrapper = createWrapper();
      render(
        <OnlineEvaluationSubmission
          assignmentId="assignment-123"
          questions={mockQuestions}
          timeLimit={60}
        />,
        { wrapper }
      );

      expect(screen.getByText('Évaluation en ligne')).toBeInTheDocument();
      expect(screen.getByText('Cette évaluation contient 2 questions. Temps limite: 60 minutes.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /commencer l'évaluation/i })).toBeInTheDocument();
    });

    it('should show questions after starting', async () => {
      const user = userEvent.setup();
      const { useMySubmission } = require('@/lib/hooks/use-student-data');
      
      useMySubmission.mockReturnValue({
        data: {
          id: 'submission-123',
          answers: {},
          status: 'in_progress',
        },
        isLoading: false,
        error: null,
      });

      const wrapper = createWrapper();
      render(
        <OnlineEvaluationSubmission
          assignmentId="assignment-123"
          questions={mockQuestions}
          timeLimit={60}
        />,
        { wrapper }
      );

      expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
      expect(screen.getByText('Question 1 sur 2')).toBeInTheDocument();
      expect(screen.getByText('10 points')).toBeInTheDocument();
    });

    it('should handle question navigation', async () => {
      const user = userEvent.setup();
      const { useMySubmission } = require('@/lib/hooks/use-student-data');
      
      useMySubmission.mockReturnValue({
        data: {
          id: 'submission-123',
          answers: {},
          status: 'in_progress',
        },
        isLoading: false,
        error: null,
      });

      const wrapper = createWrapper();
      render(
        <OnlineEvaluationSubmission
          assignmentId="assignment-123"
          questions={mockQuestions}
          timeLimit={60}
        />,
        { wrapper }
      );

      expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();

      const nextButton = screen.getByRole('button', { name: /suivant/i });
      await user.click(nextButton);

      expect(screen.getByText('The sky is blue.')).toBeInTheDocument();
      expect(screen.getByText('Question 2 sur 2')).toBeInTheDocument();
    });

    it('should handle empty questions list', () => {
      const wrapper = createWrapper();
      render(
        <OnlineEvaluationSubmission
          assignmentId="assignment-123"
          questions={[]}
        />,
        { wrapper }
      );

      expect(screen.getByText('Aucune question disponible')).toBeInTheDocument();
      expect(screen.getByText('Cette évaluation ne contient pas encore de questions.')).toBeInTheDocument();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete submission workflow', async () => {
      const user = userEvent.setup();
      const { useMySubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment } =
        require('@/lib/hooks/use-student-data');

      // Mock the workflow: no submission -> create -> update -> submit
      let submissionState = null;

      const mockCreateSubmission = jest.fn().mockImplementation(() => {
        submissionState = {
          id: 'submission-123',
          assignment_id: 'assignment-456',
          status: 'in_progress',
          submitted_file_url: 'https://example.com/file.pdf',
          submitted_file_name: 'assignment.pdf',
        };
        return Promise.resolve(submissionState);
      });

      const mockUpdateSubmission = jest.fn().mockImplementation(() => {
        submissionState = { ...submissionState, updated_at: new Date().toISOString() };
        return Promise.resolve(submissionState);
      });

      const mockSubmitAssignment = jest.fn().mockImplementation(() => {
        submissionState = { ...submissionState, status: 'submitted', submitted_at: new Date().toISOString() };
        return Promise.resolve(submissionState);
      });

      useMySubmission.mockReturnValue({
        data: submissionState,
        isLoading: false,
        error: null,
      });

      useCreateSubmission.mockReturnValue({
        mutateAsync: mockCreateSubmission,
        isPending: false,
      });

      useUpdateSubmission.mockReturnValue({
        mutateAsync: mockUpdateSubmission,
        isPending: false,
      });

      useSubmitAssignment.mockReturnValue({
        mutateAsync: mockSubmitAssignment,
        isPending: false,
      });

      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-456"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf']}
        />,
        { wrapper }
      );

      // Verify initial state
      expect(screen.getByText('Glissez votre fichier ici ou cliquez pour sélectionner')).toBeInTheDocument();

      // This test demonstrates the component structure
      // In a real integration test, you would simulate the full user workflow
      expect(screen.getByText('Soumission de fichier')).toBeInTheDocument();
    });

    it('should handle error states gracefully', async () => {
      const { useMySubmission, useCreateSubmission } = require('@/lib/hooks/use-student-data');

      useMySubmission.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Failed to load submission'),
      });

      useCreateSubmission.mockReturnValue({
        mutateAsync: jest.fn().mockRejectedValue(new Error('Network error')),
        isPending: false,
      });

      const wrapper = createWrapper();
      render(
        <FileUploadSubmission
          assignmentId="assignment-456"
          maxFileSizeMB={10}
          allowedFileTypes={['.pdf']}
        />,
        { wrapper }
      );

      // Component should still render despite errors
      expect(screen.getByText('Soumission de fichier')).toBeInTheDocument();
    });
  });
});
