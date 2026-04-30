import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentGradesRoutes } from '../../apps/api/src/routes/parent-grades';

describe('Parent Grades by Course Integration Tests', () => {
  let app: FastifyInstance;
  let parentUser: any;
  let childUser: any;
  let studentProfileId: string;
  let tenantId: string;
  let courseId1: string;
  let courseId2: string;
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

      // Create courses
      const course1Result = await client.query(
        `INSERT INTO courses (tenant_id, name, code) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, 'Mathematics', 'MATH101']
      );
      courseId1 = course1Result.rows[0].id;

      const course2Result = await client.query(
        `INSERT INTO courses (tenant_id, name, code) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, 'Physics', 'PHYS101']
      );
      courseId2 = course2Result.rows[0].id;

      // Create assignments
      const assignment1Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId1, teacherProfileId, 'Math Assignment 1', 'homework', new Date(), 'published']
      );
      assignmentId1 = assignment1Result.rows[0].id;

      const assignment2Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId1, teacherProfileId, 'Math Assignment 2', 'homework', new Date(), 'published']
      );
      assignmentId2 = assignment2Result.rows[0].id;

      const assignment3Result = await client.query(
        `INSERT INTO assignments (tenant_id, course_id, teacher_id, title, type, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, courseId2, teacherProfileId, 'Physics Assignment 1', 'homework', new Date(), 'published']
      );
      assignmentId3 = assignment3Result.rows[0].id;

      // Create graded submissions
      const submission1Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId1, studentProfileId, 15.5, new Date(), 'graded']
      );
      submissionId1 = submission1Result.rows[0].id;

      const submission2Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId2, studentProfileId, 18.0, new Date(), 'graded']
      );
      submissionId2 = submission2Result.rows[0].id;

      const submission3Result = await client.query(
        `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, final_score, graded_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, assignmentId3, studentProfileId, 16.5, new Date(), 'graded']
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
      await client.query('DELETE FROM courses WHERE id = ANY($1)', [[courseId1, courseId2]]);
      await client.query('DELETE FROM student_parents WHERE parent_id = $1', [parentUser.id]);
      await client.query('DELETE FROM student_profiles WHERE id = $1', [studentProfileId]);
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[parentUser.id, childUser.id]]);
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      client.release();
    }
    await app.close();
  });

  describe('Grades by Course Grouping', () => {
    test('should group grades by course correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.courses).toHaveLength(2);

      // Verify courses are grouped correctly
      const mathCourse = response.body.data.courses.find((c: any) => c.courseId === courseId1);
      const physicsCourse = response.body.data.courses.find((c: any) => c.courseId === courseId2);

      expect(mathCourse).toBeDefined();
      expect(physicsCourse).toBeDefined();
      expect(mathCourse.assignmentGrades).toHaveLength(2);
      expect(physicsCourse.assignmentGrades).toHaveLength(1);
    });

    test('should calculate course average correctly', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      const mathCourse = response.body.data.courses.find((c: any) => c.courseId === courseId1);
      const physicsCourse = response.body.data.courses.find((c: any) => c.courseId === courseId2);

      // Math course: (15.5 + 18.0) / 2 = 16.75
      expect(mathCourse.courseAverage).toBeCloseTo(16.75, 2);
      
      // Physics course: 16.5 / 1 = 16.5
      expect(physicsCourse.courseAverage).toBeCloseTo(16.5, 2);
    });

    test('should return correct total graded assignments per course', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      const mathCourse = response.body.data.courses.find((c: any) => c.courseId === courseId1);
      const physicsCourse = response.body.data.courses.find((c: any) => c.courseId === courseId2);

      expect(mathCourse.totalGraded).toBe(2);
      expect(physicsCourse.totalGraded).toBe(1);
      expect(mathCourse.totalGraded).toBe(mathCourse.assignmentGrades.length);
      expect(physicsCourse.totalGraded).toBe(physicsCourse.assignmentGrades.length);
    });

    test('should include all required course information', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.courses.forEach((course: any) => {
        expect(course).toHaveProperty('courseId');
        expect(course).toHaveProperty('courseName');
        expect(course).toHaveProperty('courseCode');
        expect(course).toHaveProperty('childId');
        expect(course).toHaveProperty('childName');
        expect(course).toHaveProperty('assignmentGrades');
        expect(course).toHaveProperty('courseAverage');
        expect(course).toHaveProperty('totalGraded');
        expect(Array.isArray(course.assignmentGrades)).toBe(true);
      });
    });

    test('should include all required assignment grade information', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/grades/by-course')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      
      response.body.data.courses.forEach((course: any) => {
        course.assignmentGrades.forEach((ag: any) => {
          expect(ag).toHaveProperty('id');
          expect(ag).toHaveProperty('assignmentId');
          expect(ag).toHaveProperty('assignmentName');
          expect(ag).toHaveProperty('grade');
          expect(ag).toHaveProperty('maxPoints');
          expect(ag).toHaveProperty('percentage');
        });
      });
    });

    test('should filter by childId correctly', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/grades/by-course?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.data.courses.every((c: any) => c.childId === studentProfileId)).toBe(true);
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
        .get(`/api/v1/parent/grades/by-course?childId=${unlinkedChildId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Child not linked to parent');
    });
  });
});

