/**
 * Test pour vérifier que le problème de téléchargement de fichier est résolu
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FileUploadSubmission from '@/components/assignments/FileUploadSubmission';

// Mock des hooks
jest.mock('@/lib/hooks/use-student-data', () => ({
  useMySubmission: jest.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  useCreateSubmission: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
  useUpdateSubmission: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
  useSubmitAssignment: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
}));

// Mock de fetch
global.fetch = jest.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('FileUploadSubmission - Fix Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it('should use correct assignmentId in upload URL', async () => {
    const user = userEvent.setup();
    const assignmentId = '44d4eb08-e62e-43c8-a9bb-40a7ade39ce9';
    
    // Mock successful upload response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          submissionId: 'test-submission-id',
          fileUrl: '/api/v1/files/test-file-url',
          fileName: 'test.pdf',
          fileSize: 1024,
          status: 'in_progress'
        }
      })
    });

    const wrapper = createWrapper();
    render(
      <FileUploadSubmission
        assignmentId={assignmentId}
        maxFileSizeMB={10}
        allowedFileTypes={['.pdf']}
      />,
      { wrapper }
    );

    // Create a test PDF file
    const file = new File(['test pdf content'], 'test.pdf', { type: 'application/pdf' });
    
    // Find file input and upload file
    const fileInput = screen.getByRole('button', { name: /sélectionner un fichier/i });
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    // Simulate file selection
    Object.defineProperty(hiddenInput, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(hiddenInput);

    // Wait for file to be processed and upload button to appear
    await waitFor(() => {
      expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });

    // Click upload button
    const uploadButton = screen.getByRole('button', { name: /télécharger le fichier/i });
    await user.click(uploadButton);

    // Verify that fetch was called with correct URL
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/v1/assignments/${assignmentId}/submissions/upload`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Tenant': 'imhotepacademy',
'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
          }),
          body: expect.any(FormData),
        })
      );
    });
  });

  it('should handle upload errors gracefully', async () => {
    const user = userEvent.setup();
    const assignmentId = '44d4eb08-e62e-43c8-a9bb-40a7ade39ce9';
    
    // Mock error response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: 'Internal server error'
      })
    });

    const wrapper = createWrapper();
    render(
      <FileUploadSubmission
        assignmentId={assignmentId}
        maxFileSizeMB={10}
        allowedFileTypes={['.pdf']}
      />,
      { wrapper }
    );

    // Create a test PDF file
    const file = new File(['test pdf content'], 'test.pdf', { type: 'application/pdf' });
    
    // Find file input and upload file
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    // Simulate file selection
    Object.defineProperty(hiddenInput, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(hiddenInput);

    // Wait for file to be processed and upload button to appear
    await waitFor(() => {
      expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });

    // Click upload button
    const uploadButton = screen.getByRole('button', { name: /télécharger le fichier/i });
    await user.click(uploadButton);

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/une erreur inattendue s'est produite/i)).toBeInTheDocument();
    });
  });

  it('should validate file type correctly', async () => {
    const user = userEvent.setup();
    const assignmentId = '44d4eb08-e62e-43c8-a9bb-40a7ade39ce9';

    const wrapper = createWrapper();
    render(
      <FileUploadSubmission
        assignmentId={assignmentId}
        maxFileSizeMB={10}
        allowedFileTypes={['.pdf']}
      />,
      { wrapper }
    );

    // Create a non-PDF file
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    
    // Find file input and upload file
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    // Simulate file selection
    Object.defineProperty(hiddenInput, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(hiddenInput);

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/type de fichier non autorisé/i)).toBeInTheDocument();
    });

    // Verify that fetch was not called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
