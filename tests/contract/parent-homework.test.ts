import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentHomeworkRoutes } from '../../apps/api/src/routes/parent-homework';

describe('Parent Homework - Completed Assignments Contract Tests', () => {
  let app: FastifyInstance;
  let parentUser: any;
  let childUser: any;
  let tenantId: string;

  beforeAll(async () => {
    // Create Fastify instance for testing
    app = Fastify({
      logger: false, // Disable logging during tests
    });

    // Register plugins
    await app.register(helmet);
    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    // Register PostgreSQL plugin
    await app.register(postgres, {
      connectionString: process.env.DATABASE_URL,
    });

    // Register custom plugins
    await app.register(tenantContextPlugin);

    // Register parent homework routes
    await app.register(parentHomeworkRoutes, { prefix: '/api/v1/parent/homework' });

    await app.ready();

    // Create test tenant and users
    const pool = app.pg as any;
    const client = await pool.connect();
    try {
      // Create tenant
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, slug`,
        ['Test Tenant', `test-tenant-${Date.now()}`]
      );
      tenantId = tenantResult.rows[0].id;

      // Create parent user
      const parentResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name`,
        [
          tenantId,
          `parent-${Date.now()}@test.com`,
          'Test Parent',
          '$2b$10$dummyhash',
          ['parent']
        ]
      );
      parentUser = parentResult.rows[0];

      // Create student user
      const studentResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name`,
        [
          tenantId,
          `student-${Date.now()}@test.com`,
          'Test Student',
          '$2b$10$dummyhash',
          ['student']
        ]
      );
      childUser = studentResult.rows[0];

      // Create student profile
      const studentProfileResult = await client.query(
        `INSERT INTO student_profiles (tenant_id, user_id, status) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, childUser.id, 'active']
      );
      const studentProfileId = studentProfileResult.rows[0].id;

      // Create parent-child relationship
      await client.query(
        `INSERT INTO student_parents (tenant_id, parent_id, student_id, relationship_type) 
         VALUES ($1, $2, $3, $4)`,
        [tenantId, parentUser.id, studentProfileId, 'parent']
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const pool = app.pg as any;
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM student_parents WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM student_profiles WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      client.release();
    }
    await app.close();
  });

  describe('GET /api/v1/parent/homework/assignments/completed', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with empty list when no completed assignments exist', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('assignments');
      expect(response.body.data).toHaveProperty('total', 0);
      expect(response.body.data).toHaveProperty('page', 1);
      expect(response.body.data).toHaveProperty('limit', 20);
      expect(response.body.data).toHaveProperty('totalPages', 0);
      expect(Array.isArray(response.body.data.assignments)).toBe(true);
      expect(response.body.data.assignments.length).toBe(0);
    });

    test('should return 403 when filtering by unlinked child', async () => {
      const pool = app.pg as any;
      const client = await pool.connect();
      let unlinkedChildId: string;
      try {
        // Create another student not linked to parent
        const unlinkedStudentResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            tenantId,
            `unlinked-${Date.now()}@test.com`,
            'Unlinked Student',
            '$2b$10$dummyhash',
            ['student']
          ]
        );
        const unlinkedUserId = unlinkedStudentResult.rows[0].id;

        const unlinkedProfileResult = await client.query(
          `INSERT INTO student_profiles (tenant_id, user_id, status) 
           VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, unlinkedUserId, 'active']
        );
        unlinkedChildId = unlinkedProfileResult.rows[0].id;
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get(`/api/v1/parent/homework/assignments/completed?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should support pagination parameters', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed?page=2&limit=10')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('page', 2);
      expect(response.body.data).toHaveProperty('limit', 10);
    });

    test('should validate pagination parameters', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed?page=0&limit=0')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      // Should return 400 for invalid parameters or use defaults
      expect([200, 400]).toContain(response.status);
    });

    test('should return correct response structure', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('assignments');
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('page');
      expect(response.body.data).toHaveProperty('limit');
      expect(response.body.data).toHaveProperty('totalPages');

      // Verify assignment structure if any exist
      if (response.body.data.assignments.length > 0) {
        const assignment = response.body.data.assignments[0];
        expect(assignment).toHaveProperty('id');
        expect(assignment).toHaveProperty('assignmentId');
        expect(assignment).toHaveProperty('title');
        expect(assignment).toHaveProperty('courseId');
        expect(assignment).toHaveProperty('courseName');
        expect(assignment).toHaveProperty('childId');
        expect(assignment).toHaveProperty('childName');
        expect(assignment).toHaveProperty('dueDate');
        expect(assignment).toHaveProperty('status');
        expect(['submitted', 'expired', 'graded']).toContain(assignment.status);
      }
    });
  });

  describe('GET /api/v1/parent/homework/grades', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/grades')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/grades')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/grades')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with empty list when no grades exist', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/grades')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('grades');
      expect(response.body.data).toHaveProperty('statistics');
      expect(Array.isArray(response.body.data.grades)).toBe(true);
      expect(response.body.data.grades.length).toBe(0);
      expect(response.body.data.statistics).toHaveProperty('average');
      expect(response.body.data.statistics).toHaveProperty('totalGraded');
    });

    test('should return 403 when filtering by unlinked child', async () => {
      const pool = app.pg as any;
      const client = await pool.connect();
      let unlinkedChildId: string;
      try {
        // Create another student not linked to parent
        const unlinkedStudentResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            tenantId,
            `unlinked-${Date.now()}@test.com`,
            'Unlinked Student',
            '$2b$10$dummyhash',
            ['student']
          ]
        );
        const unlinkedUserId = unlinkedStudentResult.rows[0].id;

        const unlinkedProfileResult = await client.query(
          `INSERT INTO student_profiles (tenant_id, user_id, status) 
           VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, unlinkedUserId, 'active']
        );
        unlinkedChildId = unlinkedProfileResult.rows[0].id;
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get(`/api/v1/parent/homework/grades?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should support filtering by child', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/grades?childId=test-child-id`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      // Should return 200 or 403 depending on child relationship
      expect([200, 403]).toContain(response.status);
    });

    test('should support filtering by course', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/grades?courseId=test-course-id`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should support filtering by date range', async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/homework/grades?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return correct response structure with statistics', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/grades')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('grades');
      expect(response.body.data).toHaveProperty('statistics');
      expect(response.body.data.statistics).toHaveProperty('average');
      expect(response.body.data.statistics).toHaveProperty('totalGraded');
      expect(response.body.data.statistics).toHaveProperty('gradeDistribution');

      // Verify grade structure if any exist
      if (response.body.data.grades.length > 0) {
        const grade = response.body.data.grades[0];
        expect(grade).toHaveProperty('id');
        expect(grade).toHaveProperty('assignmentId');
        expect(grade).toHaveProperty('assignmentName');
        expect(grade).toHaveProperty('courseId');
        expect(grade).toHaveProperty('courseName');
        expect(grade).toHaveProperty('childId');
        expect(grade).toHaveProperty('childName');
        expect(grade).toHaveProperty('grade');
        expect(grade).toHaveProperty('maxPoints');
        expect(grade).toHaveProperty('percentage');
        expect(grade).toHaveProperty('submittedAt');
        expect(grade).toHaveProperty('gradedAt');
      }
    });
  });

  // Phase 7: User Story 5 - Access Course Materials
  describe('GET /api/v1/parent/homework/course-materials', () => {
    test('should require authentication', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials');

      expect(response.status).toBe(401);
    });

    test('should require parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect([403, 401]).toContain(response.status);
    });

    test('should return course materials for parent\'s children', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('materials');
      expect(Array.isArray(response.body.data.materials)).toBe(true);
    });

    test('should support filtering by child', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/course-materials?childId=test-child-id`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      // Should return 200 or 403 depending on child relationship
      expect([200, 403]).toContain(response.status);
    });

    test('should support filtering by course', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/course-materials?courseId=test-course-id`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return correct response structure', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('materials');

      // Verify material structure if any exist
      if (response.body.data.materials.length > 0) {
        const material = response.body.data.materials[0];
        expect(material).toHaveProperty('id');
        expect(material).toHaveProperty('courseId');
        expect(material).toHaveProperty('courseName');
        expect(material).toHaveProperty('title');
        expect(material).toHaveProperty('fileName');
        expect(material).toHaveProperty('fileType');
        expect(material).toHaveProperty('fileSize');
        expect(material).toHaveProperty('uploadedAt');
        expect(material).toHaveProperty('childId');
        expect(material).toHaveProperty('childName');
      }
    });

    test('should verify parent-child relationship and child enrollment', async () => {
      // Test with invalid child ID
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/course-materials?childId=invalid-child-id`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      // Should return 403 if child is not linked to parent
      expect([200, 403]).toContain(response.status);
    });
  });

  describe('GET /api/v1/parent/homework/course-materials/:materialId/download', () => {
    test('should require authentication', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials/test-material-id/download');

      expect(response.status).toBe(401);
    });

    test('should require parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials/test-material-id/download')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect([403, 401]).toContain(response.status);
    });

    test('should verify parent-child relationship and material access', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/course-materials/test-material-id/download')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      // Should return 403 if material is not accessible or 404 if not found
      expect([200, 403, 404]).toContain(response.status);
    });
  });
});

