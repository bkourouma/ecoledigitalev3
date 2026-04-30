import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { TestUtils, setupTestDatabase } from './utils/test-utils';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

describe('Upload Management', () => {
  let app: FastifyInstance;
  let testUtils: TestUtils;
  let testUser: any;
  let testCourse: any;

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
    // Create test user and course for each test
    testUser = await testUtils.createTestUser(['admin']);
    
    // Create a test course
    const client = await app.pg.connect();
    try {
      const courseResult = await client.query(
        `INSERT INTO courses (tenant_id, name, description, created_by) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, name`,
        [testUser.tenantId, 'Test Course', 'Test Description', testUser.id]
      );
      testCourse = courseResult.rows[0];
    } finally {
      client.release();
    }
  });

  describe('File Upload Endpoint', () => {
    it('should upload a PDF file successfully', async () => {
      // Create a test PDF buffer (minimal PDF structure)
      const testPdfContent = Buffer.from(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000120 00000 n 
trailer
<<
/Size 4
/Root 1 0 R
>>
startxref
178
%%EOF`);

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test PDF Document')
        .attach('file', testPdfContent, {
          filename: 'test-document.pdf',
          contentType: 'application/pdf'
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Test PDF Document',
        fileName: 'test-document.pdf',
        fileType: 'application/pdf',
        processingStatus: 'completed',
        message: 'File uploaded successfully'
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.fileSize).toBeGreaterThan(0);
    });

    it('should upload a PowerPoint file successfully', async () => {
      // Create a minimal PPTX file structure (ZIP with basic structure)
      const JSZip = require('jszip');
      const zip = new JSZip();
      
      // Add minimal PPTX structure
      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-presentationml.presentation.main+xml"/>
</Types>`);
      
      zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

      zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst/>
  <p:sldIdLst/>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`);

      const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test PowerPoint Presentation')
        .attach('file', pptxBuffer, {
          filename: 'test-presentation.pptx',
          contentType: 'application/vnd.openxmlformats-presentationml.presentation'
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Test PowerPoint Presentation',
        fileName: 'test-presentation.pptx',
        fileType: 'application/vnd.openxmlformats-presentationml.presentation',
        processingStatus: 'completed',
        message: 'File uploaded successfully'
      });
    });

    it('should reject files that are too large', async () => {
      // Create a buffer larger than 100MB limit
      const largeBuffer = Buffer.alloc(101 * 1024 * 1024); // 101MB

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Large File')
        .attach('file', largeBuffer, {
          filename: 'large-file.pdf',
          contentType: 'application/pdf'
        });

      expect(response.status).toBe(413); // Payload Too Large
    });

    it('should reject unsupported file types', async () => {
      const textBuffer = Buffer.from('This is a text file');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Text File')
        .attach('file', textBuffer, {
          filename: 'test.txt',
          contentType: 'text/plain'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unsupported File Type');
    });

    it('should require authentication', async () => {
      const testBuffer = Buffer.from('test content');

      const response = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: 'application/pdf'
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
          contentType: 'application/pdf'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Tenant Required');
    });

    it('should validate course exists', async () => {
      const testBuffer = Buffer.from('test content');
      const nonExistentCourseId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.server)
        .post(`/api/v1/courses/${nonExistentCourseId}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test File')
        .attach('file', testBuffer, {
          filename: 'test.pdf',
          contentType: 'application/pdf'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Course Not Found');
    });
  });

  describe('File Download Endpoint', () => {
    let uploadedMaterial: any;

    beforeEach(async () => {
      // Upload a test file first
      const testPdfContent = Buffer.from('Test PDF content');
      
      const uploadResponse = await request(app.server)
        .post(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .field('title', 'Test Download File')
        .attach('file', testPdfContent, {
          filename: 'download-test.pdf',
          contentType: 'application/pdf'
        });

      uploadedMaterial = uploadResponse.body;
    });

    it('should provide download URL for uploaded file', async () => {
      const response = await request(app.server)
        .get(`/api/v1/materials/${uploadedMaterial.id}/download`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`);

      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toBeDefined();
      expect(response.body.downloadUrl).toContain('amazonaws.com'); // MinIO S3-compatible URL
    });

    it('should redirect to file for direct download', async () => {
      const response = await request(app.server)
        .get(`/api/v1/materials/${uploadedMaterial.id}/download?download=true`)
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`)
        .redirects(0); // Don't follow redirects

      expect(response.status).toBe(302);
      expect(response.headers.location).toBeDefined();
    });

    it('should require authentication for download', async () => {
      const response = await request(app.server)
        .get(`/api/v1/materials/${uploadedMaterial.id}/download`)
        .set('X-Tenant-ID', testUser.tenantId);

      expect(response.status).toBe(401);
    });

    it('should validate tenant access for download', async () => {
      // Create another tenant and user
      const otherUser = await testUtils.createTestUser(['user']);
      
      const response = await request(app.server)
        .get(`/api/v1/materials/${uploadedMaterial.id}/download`)
        .set('X-Tenant-ID', otherUser.tenantId)
        .set('Authorization', `Bearer ${otherUser.id}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Material Not Found');
    });
  });

  describe('Material Listing', () => {
    beforeEach(async () => {
      // Upload multiple test files
      const files = [
        { title: 'Document 1', filename: 'doc1.pdf', content: 'PDF content 1' },
        { title: 'Document 2', filename: 'doc2.pdf', content: 'PDF content 2' },
        { title: 'Presentation 1', filename: 'pres1.pptx', content: 'PPTX content 1' }
      ];

      for (const file of files) {
        await request(app.server)
          .post(`/api/v1/courses/${testCourse.id}/materials`)
          .set('X-Tenant-ID', testUser.tenantId)
          .set('Authorization', `Bearer ${testUser.id}`)
          .field('title', file.title)
          .attach('file', Buffer.from(file.content), {
            filename: file.filename,
            contentType: file.filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-presentationml.presentation'
          });
      }
    });

    it('should list course materials', async () => {
      const response = await request(app.server)
        .get(`/api/v1/courses/${testCourse.id}/materials`)
        .set('X-Tenant-ID', testUser.tenantId)
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
        .set('X-Tenant-ID', testUser.tenantId)
        .set('Authorization', `Bearer ${testUser.id}`);

      expect(response.status).toBe(200);
      expect(response.body.materials).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        total: 3,
        limit: 2,
        offset: 0
      });
    });
  });
});
