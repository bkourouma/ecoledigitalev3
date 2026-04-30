import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentGradesRoutes } from '../../apps/api/src/routes/parent-grades';

describe('Parent Grades - Assignment Grades Contract Tests', () => {
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
      studentProfileId = studentProfileResult.rows[0].id;

      // Create parent-child relationship
      await client.query(
        `INSERT INTO student_parents (tenant_id, parent_id, student_id, relationship_type) 
         VALUES ($1, $2, $3, $4)`,
        [tenantId, parentUser.id, studentProfileId, 'parent']
      );

      // Create course
      const courseResult = await client.query(
        `INSERT INTO courses (tenant_id, name, code) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, 'Test Course', 'TEST-101']
      );
      courseId = courseResult.rows[0].id;

      // Create assignment
      const assignmentResult = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, title, description, type, max_points) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, courseId, 'Test Assignment', 'Test Description', 'homework', 20]
      );
      assignmentId = assignmentResult.rows[0].id;

      // Create graded assignment submission
      const submissionResult = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, max_points, submitted_at, graded_at, feedback) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          tenantId,
          assignmentId,
          studentProfileId,
          15.5,
          20,
          new Date(),
          new Date(),
          'Good work!'
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

  describe('GET /api/v1/parent/grades/assignments', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with empty list when no graded assignments exist', async () => {
      // Create a parent with no graded assignments
      const pool = app.pg as any;
      const client = await pool.connect();
      let emptyParentId: string;
      try {
        const emptyParentResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            tenantId,
            `empty-parent-${Date.now()}@test.com`,
            'Empty Parent',
            '$2b$10$dummyhash',
            ['parent']
          ]
        );
        emptyParentId = emptyParentResult.rows[0].id;
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', emptyParentId)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('grades');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.grades)).toBe(true);
      expect(response.body.data.grades.length).toBe(0);
      expect(response.body.data.pagination).toHaveProperty('page', 1);
      expect(response.body.data.pagination).toHaveProperty('limit', 20);
      expect(response.body.data.pagination).toHaveProperty('total', 0);
      expect(response.body.data.pagination).toHaveProperty('totalPages', 0);
    });

    test('should return 200 with graded assignments for linked children', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('grades');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.grades)).toBe(true);
      
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
      }
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
        .get(`/api/v1/parent/grades/assignments?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should filter by childId when provided', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.grades.every((g: any) => g.childId === studentProfileId)).toBe(true);
    });

    test('should filter by courseId when provided', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?courseId=${courseId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.grades.every((g: any) => g.courseId === courseId)).toBe(true);
    });

    test('should filter by date range when provided', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/assignments?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      // All grades should be within the date range
      response.body.data.grades.forEach((grade: any) => {
        if (grade.gradedAt) {
          const gradedDate = new Date(grade.gradedAt);
          expect(gradedDate >= startDate).toBe(true);
          expect(gradedDate <= endDate).toBe(true);
        }
      });
    });

    test('should support pagination parameters', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/assignments?page=1&limit=10')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.pagination).toHaveProperty('page', 1);
      expect(response.body.data.pagination).toHaveProperty('limit', 10);
      expect(response.body.data.grades.length).toBeLessThanOrEqual(10);
    });

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
  });

  describe('GET /api/v1/parent/grades/by-course', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with empty list when no graded assignments exist', async () => {
      // Create a parent with no graded assignments
      const pool = app.pg as any;
      const client = await pool.connect();
      let emptyParentId: string;
      try {
        const emptyParentResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            tenantId,
            `empty-parent-${Date.now()}@test.com`,
            'Empty Parent',
            '$2b$10$dummyhash',
            ['parent']
          ]
        );
        emptyParentId = emptyParentResult.rows[0].id;
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', emptyParentId)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('courses');
      expect(Array.isArray(response.body.data.courses)).toBe(true);
      expect(response.body.data.courses.length).toBe(0);
    });

    test('should return 200 with grades grouped by course', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('courses');
      expect(Array.isArray(response.body.data.courses)).toBe(true);
      
      if (response.body.data.courses.length > 0) {
        const course = response.body.data.courses[0];
        expect(course).toHaveProperty('courseId');
        expect(course).toHaveProperty('courseName');
        expect(course).toHaveProperty('childId');
        expect(course).toHaveProperty('childName');
        expect(course).toHaveProperty('assignmentGrades');
        expect(course).toHaveProperty('courseAverage');
        expect(course).toHaveProperty('totalGraded');
        expect(Array.isArray(course.assignmentGrades)).toBe(true);
        expect(typeof course.courseAverage).toBe('number');
        expect(typeof course.totalGraded).toBe('number');
      }
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
        .get(`/api/v1/parent/grades/by-course?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should filter by childId when provided', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/by-course?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.courses.every((c: any) => c.childId === studentProfileId)).toBe(true);
    });

    test('should calculate course average correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.courses.forEach((course: any) => {
        if (course.assignmentGrades.length > 0) {
          const expectedAverage = course.assignmentGrades.reduce((sum: number, ag: any) => sum + ag.grade, 0) / course.assignmentGrades.length;
          expect(course.courseAverage).toBeCloseTo(expectedAverage, 2);
        }
      });
    });

    test('should return total graded assignments per course', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.courses.forEach((course: any) => {
        expect(course.totalGraded).toBe(course.assignmentGrades.length);
      });
    });
  });

  describe('GET /api/v1/parent/grades/averages', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with overall averages and statistics', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('statistics');
      expect(response.body.data.statistics).toHaveProperty('overallAverage');
      expect(response.body.data.statistics).toHaveProperty('totalGraded');
      expect(response.body.data.statistics).toHaveProperty('gradeDistribution');
      expect(response.body.data.statistics).toHaveProperty('bestScore');
      expect(response.body.data.statistics).toHaveProperty('worstScore');
      expect(typeof response.body.data.statistics.overallAverage).toBe('number');
      expect(typeof response.body.data.statistics.totalGraded).toBe('number');
      expect(typeof response.body.data.statistics.bestScore).toBe('number');
      expect(typeof response.body.data.statistics.worstScore).toBe('number');
    });

    test('should return correct grade distribution', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      const distribution = response.body.data.statistics.gradeDistribution;
      expect(distribution).toHaveProperty('excellent');
      expect(distribution).toHaveProperty('good');
      expect(distribution).toHaveProperty('average');
      expect(distribution).toHaveProperty('belowAverage');
      expect(typeof distribution.excellent).toBe('number');
      expect(typeof distribution.good).toBe('number');
      expect(typeof distribution.average).toBe('number');
      expect(typeof distribution.belowAverage).toBe('number');
    });

    test('should filter by childId when provided', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/averages?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.statistics).toBeDefined();
    });

    test('should return 403 when filtering by unlinked child', async () => {
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
        .get(`/api/v1/parent/grades/averages?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should filter by date range when provided', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/averages?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.statistics).toBeDefined();
    });

    test('should calculate overall average correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/averages')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      const stats = response.body.data.statistics;
      
      // Overall average should be between 0 and 20
      expect(stats.overallAverage).toBeGreaterThanOrEqual(0);
      expect(stats.overallAverage).toBeLessThanOrEqual(20);
      
      // Best score should be >= worst score
      expect(stats.bestScore).toBeGreaterThanOrEqual(stats.worstScore);
      
      // Total graded should be sum of distribution
      const distributionSum = stats.gradeDistribution.excellent + 
                             stats.gradeDistribution.good + 
                             stats.gradeDistribution.average + 
                             stats.gradeDistribution.belowAverage;
      expect(stats.totalGraded).toBe(distributionSum);
    });
  });

  describe('GET /api/v1/parent/grades/trends', () => {
    test('should return 401 when not authenticated', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends')
        .set('X-Tenant-ID', tenantId);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication Required');
    });

    test('should return 403 when user does not have parent role', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', childUser.id)
        .set('X-User-Roles', JSON.stringify(['student']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    test('should return 400 when tenant context is missing', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends')
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });

    test('should return 200 with grade trends data', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('trends');
      expect(Array.isArray(response.body.data.trends)).toBe(true);
      
      if (response.body.data.trends.length > 0) {
        const trend = response.body.data.trends[0];
        expect(trend).toHaveProperty('periodStart');
        expect(trend).toHaveProperty('periodEnd');
        expect(trend).toHaveProperty('periodLabel');
        expect(trend).toHaveProperty('averageGrade');
        expect(trend).toHaveProperty('gradeCount');
        expect(typeof trend.averageGrade).toBe('number');
        expect(typeof trend.gradeCount).toBe('number');
      }
    });

    test('should filter by childId when provided', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/trends?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.trends).toBeDefined();
    });

    test('should return 403 when filtering by unlinked child', async () => {
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
        .get(`/api/v1/parent/grades/trends?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(response.body).toHaveProperty('message', 'Child not linked to parent');
    });

    test('should filter by date range when provided', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/trends?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.trends).toBeDefined();
    });

    test('should group by time period correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends?period=month')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.trends).toBeDefined();
      
      // Verify trends are ordered by period
      if (response.body.data.trends.length > 1) {
        const trends = response.body.data.trends;
        for (let i = 1; i < trends.length; i++) {
          const prevDate = new Date(trends[i - 1].periodStart);
          const currDate = new Date(trends[i].periodStart);
          expect(currDate >= prevDate).toBe(true);
        }
      }
    });

    test('should support different time period groupings', async () => {
      const periods = ['week', 'month', 'semester'];
      
      for (const period of periods) {
        const response = await request(app.server)
          .get(`/api/v1/parent/grades/trends?period=${period}`)
          .set('X-Tenant-ID', tenantId)
          .set('X-User-ID', parentUser.id)
          .set('X-User-Roles', JSON.stringify(['parent']));

        expect(response.status).toBe(200);
        expect(response.body.data.trends).toBeDefined();
      }
    });
  });
});

