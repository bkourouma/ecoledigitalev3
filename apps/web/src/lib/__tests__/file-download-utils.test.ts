/**
 * Test file for file download utilities
 * 
 * This test verifies that the file download functions work correctly
 * with authentication and proper error handling.
 */

import { downloadFileWithAuth, downloadFileAsBlob } from '../file-download-utils';

// Mock fetch
global.fetch = jest.fn();
global.URL.createObjectURL = jest.fn(() => 'blob:http://localhost:3000/mock-blob-url');
global.URL.revokeObjectURL = jest.fn();
global.window.open = jest.fn(() => ({ focus: jest.fn() } as any));

describe('File Download Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('downloadFileWithAuth', () => {
    it('should download file with authentication and open in new tab', async () => {
      const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });
      const mockResponse = {
        ok: true,
        blob: jest.fn().mockResolvedValue(mockBlob),
        text: jest.fn().mockResolvedValue(''),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await downloadFileWithAuth(fileUrl, { onSuccess, onError });

      expect(global.fetch).toHaveBeenCalledWith(fileUrl, {
        method: 'GET',
      });
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(global.window.open).toHaveBeenCalledWith(
        'blob:http://localhost:3000/mock-blob-url',
        '_blank',
        'noopener,noreferrer'
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should handle authentication errors', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: jest.fn().mockResolvedValue(JSON.stringify({
          success: false,
          error: 'Authentification requise',
        })),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await expect(
        downloadFileWithAuth(fileUrl, { onSuccess, onError })
      ).rejects.toThrow('Authentification requise');

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
    });

    it('should handle file not found errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue(JSON.stringify({
          success: false,
          error: 'Fichier non trouvé',
        })),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';
      const onError = jest.fn();

      await expect(
        downloadFileWithAuth(fileUrl, { onError })
      ).rejects.toThrow('Fichier non trouvé');

      expect(onError).toHaveBeenCalled();
    });

    it('should normalize absolute URLs to relative URLs', async () => {
      const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });
      const mockResponse = {
        ok: true,
        blob: jest.fn().mockResolvedValue(mockBlob),
        text: jest.fn().mockResolvedValue(''),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const fileUrl = 'http://localhost:3000/api/v1/files/tenant-id/report-cards/file.pdf';

      await downloadFileWithAuth(fileUrl);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/files/tenant-id/report-cards/file.pdf',
        expect.any(Object)
      );
    });

    it('should handle popup blocker errors', async () => {
      const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });
      const mockResponse = {
        ok: true,
        blob: jest.fn().mockResolvedValue(mockBlob),
        text: jest.fn().mockResolvedValue(''),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      (global.window.open as jest.Mock).mockReturnValue(null);

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';

      await expect(downloadFileWithAuth(fileUrl)).rejects.toThrow(
        'Impossible d\'ouvrir le fichier'
      );
    });
  });

  describe('downloadFileAsBlob', () => {
    it('should download file as blob and trigger browser download', async () => {
      const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });
      const mockResponse = {
        ok: true,
        blob: jest.fn().mockResolvedValue(mockBlob),
        text: jest.fn().mockResolvedValue(''),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Mock DOM methods
      const mockLink = {
        href: '',
        download: '',
        style: { display: '' },
        click: jest.fn(),
      };
      document.createElement = jest.fn(() => mockLink as any);
      document.body.appendChild = jest.fn();
      document.body.removeChild = jest.fn();

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';
      const fileName = 'report-card.pdf';
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await downloadFileAsBlob(fileUrl, fileName, { onSuccess, onError });

      expect(global.fetch).toHaveBeenCalledWith(fileUrl, {
        method: 'GET',
      });
      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(mockLink.href).toBe('blob:http://localhost:3000/mock-blob-url');
      expect(mockLink.download).toBe(fileName);
      expect(mockLink.click).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should handle download errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue(JSON.stringify({
          success: false,
          error: 'Erreur serveur',
        })),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const fileUrl = '/api/v1/files/tenant-id/report-cards/file.pdf';
      const fileName = 'report-card.pdf';
      const onError = jest.fn();

      await expect(
        downloadFileAsBlob(fileUrl, fileName, { onError })
      ).rejects.toThrow('Erreur serveur');

      expect(onError).toHaveBeenCalled();
    });
  });
});

