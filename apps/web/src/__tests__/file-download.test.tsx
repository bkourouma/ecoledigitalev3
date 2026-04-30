import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudentAssignmentPage from '../app/student/assignments/[id]/page';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-assignment-id' }),
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
  redirect: jest.fn(),
}));

// Mock the student data hook
jest.mock('../lib/hooks/use-student-data', () => ({
  useStudentAssignment: () => ({
    data: {
      assignment_id: 'test-assignment-id',
      title: 'Test Assignment',
      submission_type: 'homework',
      subject_document_url: '/api/v1/files/6eb9c106-b650-4398-b6fa-091b6828c4ba/22a57716-1b30-4567-8234-f03f28d5ebbf/test-document.pdf',
      due_date: '2024-12-31T23:59:59Z',
      allow_late_submissions: false,
      max_file_size_mb: 10,
    },
    isLoading: false,
    error: null,
  }),
  useMySubmission: () => ({
    data: null,
    isLoading: false,
    error: null,
  }),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = jest.fn(() => 'mock-blob-url');
global.URL.revokeObjectURL = jest.fn();

// Mock alert
global.alert = jest.fn();

describe('File Download Button', () => {
  let queryClient: QueryClient;
  const mockSession = {
    user: {
      id: '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
      email: 'test@example.com',
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <SessionProvider session={mockSession}>
        <QueryClientProvider client={queryClient}>
          <StudentAssignmentPage />
        </QueryClientProvider>
      </SessionProvider>
    );
  };

  it('should successfully download file when server responds correctly', async () => {
    const mockBlob = new Blob(['test pdf content'], { type: 'application/pdf' });
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    // Mock document methods
    const mockLink = {
      href: '',
      download: '',
      click: jest.fn(),
    };
    const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
    const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation();
    const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation();

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/files/6eb9c106-b650-4398-b6fa-091b6828c4ba/22a57716-1b30-4567-8234-f03f28d5ebbf/test-document.pdf',
        {
          headers: {
            'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
          },
        }
      );
    });

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockLink.href).toBe('mock-blob-url');
    expect(mockLink.download).toBe('devoir-Test Assignment.pdf');
    expect(mockLink.click).toHaveBeenCalled();
    expect(appendChildSpy).toHaveBeenCalledWith(mockLink);
    expect(removeChildSpy).toHaveBeenCalledWith(mockLink);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-blob-url');

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('should show specific error message for 404 response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Fichier non trouvé' }),
    });

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        'Fichier non trouvé\n\nSi le problème persiste, veuillez contacter le support technique.'
      );
    });
  });

  it('should show specific error message for 403 response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.reject(new Error('Not JSON')),
    });

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        'Accès non autorisé. Vous n\'avez pas les permissions pour télécharger ce fichier.\n\nSi le problème persiste, veuillez contacter le support technique.'
      );
    });
  });

  it('should show specific error message for 500 response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('Not JSON')),
    });

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        'Erreur serveur. Veuillez réessayer dans quelques instants.\n\nSi le problème persiste, veuillez contacter le support technique.'
      );
    });
  });

  it('should handle network errors gracefully', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        'Network error\n\nSi le problème persiste, veuillez contacter le support technique.'
      );
    });
  });

  it('should handle JSON error responses correctly', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ 
        success: false, 
        error: 'Erreur lors de la récupération du fichier' 
      }),
    });

    renderComponent();

    const downloadButton = await screen.findByText('Télécharger');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        'Erreur lors de la récupération du fichier\n\nSi le problème persiste, veuillez contacter le support technique.'
      );
    });
  });
});
