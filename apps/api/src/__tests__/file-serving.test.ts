import Fastify, { FastifyInstance } from 'fastify';
import { filesRoutes } from '../routes/files';
import fs from 'fs/promises';
import path from 'path';

describe('File Serving API', () => {
  let app: FastifyInstance;
  const testTenantId = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
  const testAssignmentId = '22a57716-1b30-4567-8234-f03f28d5ebbf';
  const testFilename = 'test-document.pdf';
  const testFilePath = path.join(process.cwd(), 'uploads', testTenantId, testAssignmentId, testFilename);

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register the files routes
    await app.register(filesRoutes, { prefix: '/api/v1/files' });
    await app.ready();

    // Create test directory structure
    await fs.mkdir(path.dirname(testFilePath), { recursive: true });

    // Create a test PDF file
    const testPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000074 00000 n \n0000000120 00000 n \ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n179\n%%EOF');
    await fs.writeFile(testFilePath, testPdfContent);
  });

  afterAll(async () => {
    await app.close();

    // Clean up test files
    try {
      await fs.unlink(testFilePath);
      await fs.rmdir(path.dirname(testFilePath));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('GET /api/v1/files/:tenantId/:assignmentId/:filename', () => {
    const validHeaders = {
      'X-Tenant': testTenantId,
      'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb'
    };

    it('should successfully serve an existing PDF file', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/${testFilename}`,
        headers: validHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toBe(`inline; filename="${testFilename}"`);
      expect(response.headers['cache-control']).toBe('public, max-age=31536000');
      expect(response.rawPayload).toBeInstanceOf(Buffer);
    });

    it('should return 401 when X-Tenant header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/${testFilename}`,
        headers: {
          'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: "Authentification requise"
      });
    });

    it('should return 401 when X-User-Id header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/${testFilename}`,
        headers: {
          'X-Tenant': testTenantId,
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: "Authentification requise"
      });
    });

    it('should return 403 when tenant ID does not match', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/${testFilename}`,
        headers: {
          ...validHeaders,
          'X-Tenant': 'different-tenant-id'
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        error: "Accès non autorisé"
      });
    });

    it('should return 400 for invalid filename with directory traversal', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/../../../etc/passwd`,
        headers: validHeaders
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        success: false,
        error: "Nom de fichier invalide"
      });
    });

    it('should return 404 when file does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/nonexistent-file.pdf`,
        headers: validHeaders
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        success: false,
        error: "Fichier non trouvé"
      });
    });

    it('should handle server errors gracefully without content-type conflicts', async () => {
      // Create a test file that will cause sendFile to fail
      const badFilePath = path.join(process.cwd(), 'uploads', testTenantId, testAssignmentId, 'bad-file.pdf');
      await fs.writeFile(badFilePath, 'invalid pdf content');

      // Make the file unreadable to simulate a server error
      try {
        await fs.chmod(badFilePath, 0o000);
      } catch {
        // Skip this test on systems that don't support chmod
        return;
      }

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/${testTenantId}/${testAssignmentId}/bad-file.pdf`,
        headers: validHeaders
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: "Erreur lors de la récupération du fichier"
      });

      // Clean up
      try {
        await fs.chmod(badFilePath, 0o644);
        await fs.unlink(badFilePath);
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
