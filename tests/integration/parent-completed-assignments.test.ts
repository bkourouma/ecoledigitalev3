import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../../apps/api/src/plugins/tenant-context';
import { parentHomeworkRoutes } from '../../apps/api/src/routes/parent-homework';

describe('Parent Completed Assignments Integration Tests', () => {
  let app: FastifyInstance;
  let parentUser: any;
  let childUser: any;
  let studentProfileId: string;
  let tenantId: string;
  let courseId: string;
  let classId: string;
  let assignmentId: string;
  let assignmentInstanceId: string;

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

      // Create class
      const classResult = await client.query(
        `INSERT INTO classes (tenant_id, name, code) 
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, 'Test Class', 'CLASS001']
      );
      classId = classResult.rows[0].id;

      // Create student enrollment
      await client.query(
        `INSERT INTO student_enrollments (tenant_id, student_id, class_id, status) 
         VALUES ($1, $2, $3, $4)`,
        [tenantId, studentProfileId, classId, 'active']
      );

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
          100
        ]
      );
      assignmentId = assignmentResult.rows[0].id;

      // Create assignment instance with past deadline (completed)
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 7); // 7 days ago
      const assignmentInstanceResult = await client.query(
        `INSERT INTO assignment_instances (tenant_id, assignment_id, class_id, starts_at, ends_at, status) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          tenantId,
          assignmentId,
          classId,
          new Date(pastDate.getTime() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
          pastDate,
          'active'
        ]
      );
      assignmentInstanceId = assignmentInstanceResult.rows[0].id;
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
      await client.query('DELETE FROM assignment_instances WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM assignments WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM student_enrollments WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM classes WHERE tenant_id = $1', [tenantId]);
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

  describe('Completed Assignments Query', () => {
    test('should return expired assignments (past deadline without submission)', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBeGreaterThanOrEqual(1);
      
      const assignment = response.body.data.assignments.find(
        (a: any) => a.assignmentId === assignmentId
      );
      expect(assignment).toBeDefined();
      expect(assignment.status).toBe('expired');
      expect(assignment.submittedAt).toBeNull();
    });

    test('should return submitted assignments with submission date', async () => {
      // Create a submission for the assignment
      const pool = app.pg as any;
      const client = await pool.connect();
      try {
        const submissionDate = new Date();
        submissionDate.setDate(submissionDate.getDate() - 3); // 3 days ago
        
        await client.query(
          `INSERT INTO assignment_submissions (tenant_id, assignment_id, assignment_instance_id, student_id, submitted_at, status) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            assignmentId,
            assignmentInstanceId,
            studentProfileId,
            submissionDate,
            'submitted'
          ]
        );
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const assignment = response.body.data.assignments.find(
        (a: any) => a.assignmentId === assignmentId
      );
      expect(assignment).toBeDefined();
      expect(assignment.status).toBe('submitted');
      expect(assignment.submittedAt).not.toBeNull();
    });

    test('should return graded assignments with grade and feedback', async () => {
      // Update submission with grade and feedback
      const pool = app.pg as any;
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE assignment_submissions 
           SET final_score = $1, feedback = $2, status = $3, graded_at = NOW()
           WHERE assignment_id = $4 AND student_id = $5 AND tenant_id = $6`,
          [85, 'Good work!', 'graded', assignmentId, studentProfileId, tenantId]
        );
      } finally {
        client.release();
      }

      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const assignment = response.body.data.assignments.find(
        (a: any) => a.assignmentId === assignmentId
      );
      expect(assignment).toBeDefined();
      expect(assignment.status).toBe('graded');
      expect(assignment.grade).toBe(85);
      expect(assignment.feedback).toBe('Good work!');
      expect(assignment.maxPoints).toBe(100);
    });

    test('should filter by child', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/assignments/completed?childId=${studentProfileId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // All assignments should be for the specified child
      response.body.data.assignments.forEach((assignment: any) => {
        expect(assignment.childId).toBe(studentProfileId);
      });
    });

    test('should filter by course', async () => {
      const response = await request(app.server)
        .get(`/api/v1/parent/homework/assignments/completed?courseId=${courseId}`)
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // All assignments should be for the specified course
      response.body.data.assignments.forEach((assignment: any) => {
        expect(assignment.courseId).toBe(courseId);
      });
    });

    test('should paginate results correctly', async () => {
      // Create multiple assignments to test pagination
      const pool = app.pg as any;
      const client = await pool.connect();
      try {
        for (let i = 0; i < 5; i++) {
          const pastDate = new Date();
          pastDate.setDate(pastDate.getDate() - (i + 1));
          
          const assignmentResult = await client.query(
            `INSERT INTO assignments (tenant_id, course_id, title, description, type, status, max_points) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              tenantId,
              courseId,
              `Test Assignment ${i}`,
              'Test Description',
              'homework',
              'published',
              100
            ]
          );
          
          await client.query(
            `INSERT INTO assignment_instances (tenant_id, assignment_id, class_id, starts_at, ends_at, status) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              tenantId,
              assignmentResult.rows[0].id,
              classId,
              new Date(pastDate.getTime() - 7 * 24 * 60 * 60 * 1000),
              pastDate,
              'active'
            ]
          );
        }
      } finally {
        client.release();
      }

      // Test first page
      const page1Response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed?page=1&limit=3')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(page1Response.status).toBe(200);
      expect(page1Response.body.data.page).toBe(1);
      expect(page1Response.body.data.limit).toBe(3);
      expect(page1Response.body.data.assignments.length).toBeLessThanOrEqual(3);

      // Test second page
      const page2Response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed?page=2&limit=3')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(page2Response.status).toBe(200);
      expect(page2Response.body.data.page).toBe(2);
      expect(page2Response.body.data.limit).toBe(3);
    });

    test('should order by submission date or deadline (most recent first)', async () => {
      const response = await request(app.server)
        .get('/api/v1/parent/homework/assignments/completed')
        .set('X-Tenant-ID', tenantId)
        .set('X-User-ID', parentUser.id)
        .set('X-User-Roles', JSON.stringify(['parent']));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify ordering (most recent first)
      const assignments = response.body.data.assignments;
      for (let i = 0; i < assignments.length - 1; i++) {
        const current = assignments[i];
        const next = assignments[i + 1];
        
        const currentDate = current.submittedAt 
          ? new Date(current.submittedAt) 
          : new Date(current.dueDate);
        const nextDate = next.submittedAt 
          ? new Date(next.submittedAt) 
          : new Date(next.dueDate);
        
        expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
      }
    });
  });
});

