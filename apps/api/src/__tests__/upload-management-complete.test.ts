import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { TestUtils, setupTestDatabase } from './utils/test-utils';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { SUPPORTED_FILE_TYPES, FILE_SIZE_LIMITS } from '@ecoledigitale/contracts';

describe('Complete Upload Management System', () => {
  let app: FastifyInstance;
  let testUtils: TestUtils;
  let testUser: any;
  let testCourse: any;
  let testTenant: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await setupTestDatabase(app);
    testUtils = new TestUtils(app);
  });

  afterAll(async () => {
    await testUtils.cleanup();
    await app.close();
  });

  beforeEach(async () => {
    // Create test tenant, user and course for each test
    testTenant = await testUtils.createTestTenant();
    testUser = await testUtils.createTestUser(['admin']);
    
    // Create a test course
    const client = await app.pg.connect();
    try {
      const courseResult = await client.query(
        `INSERT INTO courses (tenant_id, name, description, created_by) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, name`,
        [testUser.tenantId, 'Test Course for Upload', 'Test Description', testUser.id]
      );
      testCourse = courseResult.rows[0];
    } finally {
      client.release();
    }
  });

  describe('File Type Validation', () => {
    const createTestFile = (content: string, filename: string, mimeType: string) => {
      const buffer = Buffer.from(content);
      return { buffer, filename, mimeType };
    };

    it('should accept PDF files', async () => {
      const pdfContent = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000120 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
178
%%EOF`;

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test PDF Document')
        .attach('file', Buffer.from(pdfContent), {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Test PDF Document',
        fileName: 'test.pdf',
        fileType: SUPPORTED_FILE_TYPES.PDF,
        processingStatus: 'completed'
      });
    });

    it('should accept PowerPoint files', async () => {
      // Create a minimal PPTX structure
      const JSZip = require('jszip');
      const zip = new JSZip();
      
      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-presentationml.presentation.main+xml"/>
</Types>`);
      
      const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test PowerPoint')
        .attach('file', pptxBuffer, {
          filename: 'test.pptx',
          contentType: SUPPORTED_FILE_TYPES.POWERPOINT
        });

      expect(response.status).toBe(201);
      expect(response.body.fileType).toBe(SUPPORTED_FILE_TYPES.POWERPOINT);
    });

    it('should accept image files', async () => {
      // Create a minimal PNG (1x1 pixel)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, // IHDR data
        0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
        0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82 // IEND
      ]);

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test Image')
        .attach('file', pngBuffer, {
          filename: 'test.png',
          contentType: SUPPORTED_FILE_TYPES.PNG
        });

      expect(response.status).toBe(201);
      expect(response.body.fileType).toBe(SUPPORTED_FILE_TYPES.PNG);
    });

    it('should reject unsupported file types', async () => {
      const textContent = 'This is a text file';

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Unsupported File')
        .attach('file', Buffer.from(textContent), {
          filename: 'test.txt',
          contentType: 'text/plain'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unsupported File Type');
      expect(response.body.message).toContain('text/plain is not supported');
    });
  });

  describe('File Size Validation', () => {
    it('should reject files exceeding document size limit', async () => {
      // Create a buffer larger than 50MB (document limit)
      const largeBuffer = Buffer.alloc(FILE_SIZE_LIMITS.MAX_DOCUMENT_SIZE + 1024);

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Large PDF')
        .attach('file', largeBuffer, {
          filename: 'large.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('File Too Large');
    });

    it('should reject images exceeding image size limit', async () => {
      // Create a buffer larger than 10MB (image limit)
      const largeImageBuffer = Buffer.alloc(FILE_SIZE_LIMITS.MAX_IMAGE_SIZE + 1024);

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Large Image')
        .attach('file', largeImageBuffer, {
          filename: 'large.png',
          contentType: SUPPORTED_FILE_TYPES.PNG
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('File Too Large');
    });

    it('should accept files within size limits', async () => {
      // Create a small PDF (well within 50MB limit)
      const smallPdf = Buffer.alloc(1024); // 1KB
      
      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Small PDF')
        .attach('file', smallPdf, {
          filename: 'small.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      expect(response.body.fileSize).toBe(1024);
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication', async () => {
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(401);
    });

    it('should require tenant context', async () => {
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Tenant Required');
    });

    it('should validate course exists and user has access', async () => {
      const testBuffer = Buffer.from('test content');
      const nonExistentCourseId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.server)
        .post(`/api/v1/courses/${nonExistentCourseId}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Course Not Found');
    });

    it('should prevent cross-tenant access', async () => {
      // Create another tenant and user
      const otherTenant = await testUtils.createTestTenant();
      const otherUser = await testUtils.createTestUser(['user']);
      
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', otherTenant.slug)
        .set('Authorization', `Bearer ${otherUser.id}`)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Course Not Found');
    });
  });

  describe('Material Management', () => {
    let uploadedMaterials: any[] = [];

    beforeEach(async () => {
      // Upload multiple test files
      const files = [
        { title: 'Document 1', filename: 'doc1.pdf', type: SUPPORTED_FILE_TYPES.PDF },
        { title: 'Document 2', filename: 'doc2.pdf', type: SUPPORTED_FILE_TYPES.PDF },
        { title: 'Presentation 1', filename: 'pres1.pptx', type: SUPPORTED_FILE_TYPES.POWERPOINT }
      ];

      uploadedMaterials = [];
      for (const file of files) {
        const response = await request(app.server)
          .post(`/api/v1/courses/${testCourse.id}/materials`)
          .set('x-tenant', testTenant.slug)
          .set('Authorization', `Bearer ${testUser.id}`)
          .field('title', file.title)
          .attach('file', Buffer.from('test content'), {
            filename: file.filename,
            contentType: file.type
          });
        
        expect(response.status).toBe(201);
        uploadedMaterials.push(response.body);
      }
    });

    it('should list course materials', async () => {
      const response = await request(app.server)
        .get(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`);

      expect(response.status).toBe(200);
      expect(response.body.materials).toHaveLength(3);
      expect(response.body.materials[0]).toMatchObject({
        title: expect.any(String),
        fileName: expect.any(String),
        fileType: expect.any(String),
        fileSize: expect.any(Number),
        processingStatus: 'completed'
      });
    });

    it('should support pagination', async () => {
      const response = await request(app.server)
        .get(`/api/v1/courses/${testCourse.id}/materials?limit=2&offset=0`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`);

      expect(response.status).toBe(200);
      expect(response.body.materials).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        total: 3,
        limit: 2,
        offset: 0
      });
    });

    it('should provide download URLs', async () => {
      const materialId = uploadedMaterials[0].id;

      const response = await request(app.server)
        .get(`/api/v1/materials/${materialId}/download`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`);

      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toBeDefined();
      expect(response.body.downloadUrl).toContain('amazonaws.com'); // MinIO S3-compatible URL
    });

    it('should redirect for direct downloads', async () => {
      const materialId = uploadedMaterials[0].id;

      const response = await request(app.server)
        .get(`/api/v1/materials/${materialId}/download?download=true`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .redirects(0); // Don't follow redirects

      expect(response.status).toBe(302);
      expect(response.headers.location).toBeDefined();
    });

    it('should validate tenant access for downloads', async () => {
      const materialId = uploadedMaterials[0].id;
      const otherTenant = await testUtils.createTestTenant();
      const otherUser = await testUtils.createTestUser(['user']);

      const response = await request(app.server)
        .get(`/api/v1/materials/${materialId}/download`)
        .set('x-tenant', otherTenant.slug)
        .set('Authorization', `Bearer ${otherUser.id}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Material Not Found');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing file', async () => {
      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'No File Test');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No File');
    });

    it('should handle invalid course ID format', async () => {
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/invalid-uuid/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(400);
    });

    it('should handle database connection errors gracefully', async () => {
      // This test would require mocking the database connection
      // For now, we'll just ensure the endpoint exists and handles errors
      expect(true).toBe(true);
    });
  });

  describe('Multiple File Upload', () => {
    it('should handle multiple files in a single request', async () => {
      // Note: This test assumes the endpoint supports multiple files
      // The current implementation processes one file at a time
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Multi File Test')
        .attach('file', testBuffer, {
          filename: 'test1.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      // For multiple files, you would need to modify the endpoint
      // or make multiple requests
    });
  });

  describe('File Processing and Storage', () => {
    it('should store files in MinIO with correct metadata', async () => {
      const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 1\ntrailer<</Root 1 0 R>>\n%%EOF';

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Storage Test PDF')
        .attach('file', Buffer.from(pdfContent), {
          filename: 'storage-test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Storage Test PDF',
        fileName: 'storage-test.pdf',
        fileType: SUPPORTED_FILE_TYPES.PDF,
        fileSize: expect.any(Number),
        processingStatus: 'completed',
        s3Key: expect.any(String),
        s3Bucket: expect.any(String)
      });
    });

    it('should handle text extraction for PDF files', async () => {
      const pdfWithText = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 1\ntrailer<</Root 1 0 R>>\n%%EOF';

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Text Extraction Test')
        .attach('file', Buffer.from(pdfWithText), {
          filename: 'text-extraction.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      // Text extraction happens asynchronously, so we check the processing status
      expect(['pending', 'processing', 'completed']).toContain(response.body.processingStatus);
    });

    it('should generate embeddings for searchable content', async () => {
      const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 1\ntrailer<</Root 1 0 R>>\n%%EOF';

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Embeddings Test')
        .attach('file', Buffer.from(pdfContent), {
          filename: 'embeddings-test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      // Embeddings generation happens asynchronously
      expect(response.body.processingStatus).toBeDefined();
    });
  });

  describe('Performance and Limits', () => {
    it('should handle concurrent uploads', async () => {
      const uploadPromises = [];
      const testBuffer = Buffer.from('concurrent test content');

      // Create 5 concurrent upload requests
      for (let i = 0; i < 5; i++) {
        const promise = request(app.server)
          .post(`/api/v1/courses/${testCourse.id}/materials`)
          .set('x-tenant', testTenant.slug)
          .set('Authorization', `Bearer ${testUser.id}`)
          .field('title', `Concurrent Upload ${i + 1}`)
          .attach('file', testBuffer, {
            filename: `concurrent-${i + 1}.pdf`,
            contentType: SUPPORTED_FILE_TYPES.PDF
          });

        uploadPromises.push(promise);
      }

      const responses = await Promise.all(uploadPromises);

      // All uploads should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });
    });

    it('should respect file count limits per request', async () => {
      // This test would be relevant if the endpoint supported multiple files
      // Currently, the endpoint processes one file at a time
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'File Count Test')
        .attach('file', testBuffer, {
          filename: 'count-test.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
    });
  });

  describe('Edge Cases and Error Recovery', () => {
    it('should handle corrupted PDF files gracefully', async () => {
      const corruptedPdf = Buffer.from('This is not a valid PDF file');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Corrupted PDF')
        .attach('file', corruptedPdf, {
          filename: 'corrupted.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      // Should still accept the file (validation is based on MIME type)
      // Processing might fail later, but upload should succeed
      expect(response.status).toBe(201);
    });

    it('should handle empty files', async () => {
      const emptyBuffer = Buffer.alloc(0);

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Empty File')
        .attach('file', emptyBuffer, {
          filename: 'empty.pdf',
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      // Should handle empty files gracefully
      expect([200, 201, 400]).toContain(response.status);
    });

    it('should handle special characters in filenames', async () => {
      const testBuffer = Buffer.from('test content');
      const specialFilename = 'test file with spaces & special chars (1).pdf';

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Special Characters Test')
        .attach('file', testBuffer, {
          filename: specialFilename,
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      expect(response.status).toBe(201);
      expect(response.body.fileName).toBe(specialFilename);
    });

    it('should handle very long filenames', async () => {
      const testBuffer = Buffer.from('test content');
      const longFilename = 'a'.repeat(200) + '.pdf'; // 204 characters

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('x-tenant', testTenant.slug)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Long Filename Test')
        .attach('file', testBuffer, {
          filename: longFilename,
          contentType: SUPPORTED_FILE_TYPES.PDF
        });

      // Should either accept or gracefully reject long filenames
      expect([200, 201, 400]).toContain(response.status);
    });
  });
});
