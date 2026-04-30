import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentGradesRoutes } from '../../apps/api/src/routes/parent-grades';

describe('Parent Assignment Grades Integration Tests', () => {
  let app: FastifyInstance;
  let parentUser: any;
  let childUser: any;
  let studentProfileId: string;
  let tenantId: string;
  let courseId: string;
  let assignmentId: string;
  let submissionId: string;

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

    // Register parent grades routes
    await app.register(parentGradesRoutes, { prefix: '/api/v1/parent/grades' });

    await app.ready();

    // Create test data
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
      studentProfileId = studentProfileResult.rows[0].id;

      // Create parent-child relationship
      await client.query(
        `INSERT INTO student_parents (tenant_id, parent_id, student_id, relationship_type) 
         VALUES ($1, $2, $3, $4)`,
        [tenantId, parentUser.id, studentProfileId, 'parent']
      );

      // Create course
      const courseResult = await client.query(
        `INSERT INTO courses (tenant_id, name, code, description) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, 'Test Course', 'TEST101', 'Test Course Description']
      );
      courseId = courseResult.rows[0].id;

      // Create assignment
      const assignmentResult = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, title, description, type, status, max_points) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          tenantId,
          courseId,
          'Test Assignment',
          'Test Assignment Description',
          'homework',
          'published',
          20
        ]
      );
      assignmentId = assignmentResult.rows[0].id;

      // Create graded submission
      const submissionDate = new Date();
      submissionDate.setDate(submissionDate.getDate() - 5); // 5 days ago
      const gradedDate = new Date();
      gradedDate.setDate(gradedDate.getDate() - 3); // 3 days ago

      const submissionResult = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submitted_at, final_score, max_points, feedback, status, graded_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenantId,
          assignmentId,
          studentProfileId,
          submissionDate,
          15.5,
          20,
          'Good work!',
          'graded',
          gradedDate
        ]
      );
      submissionId = submissionResult.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const pool = app.pg as any;
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM assignment_submissions WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM assignments WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM courses WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM student_parents WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM student_profiles WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      client.release();
    }
    await app.close();
  });

  describe('Filter Combinations', () => {
    test('should filter by child and course together', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?childId=${studentProfileId}&courseId=${courseId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      response.body.data.grades.forEach((grade: any) => {
        expect(grade.childId).toBe(studentProfileId);
        expect(grade.courseId).toBe(courseId);
      });
    });

    test('should filter by child and date range together', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?childId=${studentProfileId}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      response.body.data.grades.forEach((grade: any) => {
        expect(grade.childId).toBe(studentProfileId);
        if (grade.gradedAt) {
          const gradedDate = new Date(grade.gradedAt);
          expect(gradedDate >= startDate).toBe(true);
          expect(gradedDate <= endDate).toBe(true);
        }
      });
    });

    test('should filter by course and date range together', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?courseId=${courseId}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      response.body.data.grades.forEach((grade: any) => {
        expect(grade.courseId).toBe(courseId);
        if (grade.gradedAt) {
          const gradedDate = new Date(grade.gradedAt);
          expect(gradedDate >= startDate).toBe(true);
          expect(gradedDate <= endDate).toBe(true);
        }
      });
    });
  });

  describe('Child Relationship Verification', () => {
    test('should verify parent-child relationship before returning grades', async () => {
      // Create an unlinked child
      const pool = app.pg as any;
      const client = await pool.connect();
      let unlinkedChildId: string;
      try {
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
        .get(`/api/v1/parent/grades/assignments?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });
  });

  describe('Grade Calculations', () => {
    test('should calculate percentage correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.grades.forEach((grade: any) => {
        if (grade.grade && grade.maxPoints) {
          const expectedPercentage = (grade.grade / grade.maxPoints) * 100;
          expect(grade.percentage).toBeCloseTo(expectedPercentage, 2);
        }
      });
    });

    test('should only return graded assignments (final_score or manual_score not null)', async () => {
      // Create an ungraded submission
      const pool = app.pg as any;
      const client = await pool.connect();
      try {
        const assignmentResult = await client.query(
          `INSERT INTO assignments (tenant_id, course_id, title, description, type, status, max_points) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            tenantId,
            courseId,
            'Ungraded Assignment',
            'Test Description',
            'homework',
            'published',
            20
          ]
        );

        await client.query(
          `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submitted_at, status) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            assignmentResult.rows[0].id,
            studentProfileId,
            new Date(),
            'submitted'
          ]
        );
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      // Should not include ungraded submissions
      response.body.data.grades.forEach((grade: any) => {
        expect(grade.grade).not.toBeNull();
        expect(grade.grade).toBeDefined();
      });
    });
  });
});

