import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentGradesRoutes } from '../../apps/api/src/routes/parent-grades';

describe('Parent Grade Trends Integration Tests', () => {
  let app: FastifyInstance;
  let parentUser: any;
  let childUser: any;
  let studentProfileId: string;
  let tenantId: string;
  let courseId: string;
  let assignmentId1: string;
  let assignmentId2: string;
  let assignmentId3: string;
  let submissionId1: string;
  let submissionId2: string;
  let submissionId3: string;

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
        `INSERT INTO tenants (name, domain) 
         VALUES ($1, $2) RETURNING id`,
        [`test-tenant-${Date.now()}`, `test-${Date.now()}.com`]
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

      // Create child user
      const childResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name`,
        [
          tenantId,
          `child-${Date.now()}@test.com`,
          'Test Child',
          '$2b$10$dummyhash',
          ['student']
        ]
      );
      childUser = childResult.rows[0];

      // Create student profile
      const studentProfileResult = await client.query(
        `INSERT INTO student_profiles (tenant_id, user_id, status) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, childUser.id, 'active']
      );
      studentProfileId = studentProfileResult.rows[0].id;

      // Create parent-child relationship
      await client.query(
        `INSERT INTO student_parents (tenant_id, parent_id, student_id) 
         VALUES ($1, $2, $3)`,
        [tenantId, parentUser.id, studentProfileId]
      );

      // Create teacher
      const teacherResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, roles) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          tenantId,
          `teacher-${Date.now()}@test.com`,
          'Test Teacher',
          '$2b$10$dummyhash',
          ['teacher']
        ]
      );
      const teacherId = teacherResult.rows[0].id;

      const teacherProfileResult = await client.query(
        `INSERT INTO teachers (tenant_id, user_id, status) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, teacherId, 'active']
      );
      const teacherProfileId = teacherProfileResult.rows[0].id;

      // Create course
      const courseResult = await client.query(
        `INSERT INTO courses (tenant_id, name, code) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, 'Mathematics', 'MATH101']
      );
      courseId = courseResult.rows[0].id;

      // Create assignments
      const assignment1Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId, teacherProfileId, 'Math Assignment 1', 'homework', new Date(), 'published']
      );
      assignmentId1 = assignment1Result.rows[0].id;

      const assignment2Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId, teacherProfileId, 'Math Assignment 2', 'homework', new Date(), 'published']
      );
      assignmentId2 = assignment2Result.rows[0].id;

      const assignment3Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId, teacherProfileId, 'Math Assignment 3', 'homework', new Date(), 'published']
      );
      assignmentId3 = assignment3Result.rows[0].id;

      // Create graded submissions with different dates (spread over time)
      const date1 = new Date();
      date1.setDate(date1.getDate() - 60); // 2 months ago
      const date2 = new Date();
      date2.setDate(date2.getDate() - 30); // 1 month ago
      const date3 = new Date(); // Now

      const submission1Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId1, studentProfileId, 15.0, date1, 'graded']
      );
      submissionId1 = submission1Result.rows[0].id;

      const submission2Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId2, studentProfileId, 17.0, date2, 'graded']
      );
      submissionId2 = submission2Result.rows[0].id;

      const submission3Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId3, studentProfileId, 18.0, date3, 'graded']
      );
      submissionId3 = submission3Result.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const pool = app.pg as any;
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM assignment_submissions WHERE id = ANY($1)', [[submissionId1, submissionId2, submissionId3]]);
      await client.query('DELETE FROM assignments WHERE id = ANY($1)', [[assignmentId1, assignmentId2, assignmentId3]]);
      await client.query('DELETE FROM courses WHERE id = $1', [courseId]);
      await client.query('DELETE FROM student_parents WHERE parent_id = $1', [parentUser.id]);
      await client.query('DELETE FROM student_profiles WHERE id = $1', [studentProfileId]);
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[parentUser.id, childUser.id]]);
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      client.release();
    }
    await app.close();
  });

  describe('Grade Trends Calculation', () => {
    test('should group trends by month correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends?period=month')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trends).toBeDefined();
      expect(Array.isArray(response.body.data.trends)).toBe(true);
    });

    test('should calculate average grade per period correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends?period=month')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.trends.forEach((trend: any) => {
        expect(trend).toHaveProperty('periodStart');
        expect(trend).toHaveProperty('periodEnd');
        expect(trend).toHaveProperty('periodLabel');
        expect(trend).toHaveProperty('averageGrade');
        expect(trend).toHaveProperty('gradeCount');
        expect(typeof trend.averageGrade).toBe('number');
        expect(trend.averageGrade).toBeGreaterThanOrEqual(0);
        expect(trend.averageGrade).toBeLessThanOrEqual(20);
        expect(typeof trend.gradeCount).toBe('number');
        expect(trend.gradeCount).toBeGreaterThan(0);
      });
    });

    test('should order trends by period start date', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/trends?period=month')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      if (response.body.data.trends.length > 1) {
        const trends = response.body.data.trends;
        for (let i = 1; i < trends.length; i++) {
          const prevDate = new Date(trends[i - 1].periodStart);
          const currDate = new Date(trends[i].periodStart);
          expect(currDate >= prevDate).toBe(true);
        }
      }
    });

    test('should filter by childId correctly', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/trends?childId=${studentProfileId}&period=month`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.trends).toBeDefined();
    });

    test('should filter by date range correctly', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      const endDate = new Date();

      const response = await request(app.server)
        .get(`/api/v1/parent/grades/trends?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&period=month`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.trends).toBeDefined();
      
      // Verify all trends are within date range
      response.body.data.trends.forEach((trend: any) => {
        const periodStart = new Date(trend.periodStart);
        const periodEnd = new Date(trend.periodEnd);
        expect(periodStart >= startDate).toBe(true);
        expect(periodEnd <= endDate).toBe(true);
      });
    });

    test('should support different time period groupings', async () => {
      const periods = ['week', 'month'];
      
      for (const period of periods) {
        const response = await request(app.server)
          .get(`/api/v1/parent/grades/trends?period=${period}`)
          .set('X-Tenant-ID', tenantId)
          .set('X-User-ID', parentUser.id)
          .set('X-User-Roles', JSON.stringify(['parent']));

        expect(response.status).toBe(200);
        expect(response.body.data.trends).toBeDefined();
        expect(Array.isArray(response.body.data.trends)).toBe(true);
      }
    });

    test('should verify parent-child relationship for filtered child', async () => {
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
        .get(`/api/v1/parent/grades/trends?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Child not linked to parent');
    });
  });
});

